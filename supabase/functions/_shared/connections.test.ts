import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert';
import {
  probeVerdict,
  removeConnection,
  reorderConnections,
  saveConnection,
  secretName,
} from './connections.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const GEMINI_KEY = 'AIzaSyA-fake-key-for-tests-0123456789';

/** A service client that remembers what was asked of it. */
function fake(
  rows: Record<string, unknown>[] = [],
  opts: { vaultError?: string } = {},
) {
  const calls: { what: string; args: unknown }[] = [];
  const admin = {
    rpc(fn: string, args: unknown) {
      calls.push({ what: `rpc:${fn}`, args });
      return Promise.resolve({
        data: null,
        error: opts.vaultError ? { message: opts.vaultError } : null,
      });
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const q = {
        select: () => q,
        order: () => q,
        limit: () => q,
        eq(col: string, v: unknown) {
          filters[col] = v;
          return q;
        },
        maybeSingle: () =>
          Promise.resolve({
            data:
              table === 'ai_connections'
                ? (rows.find((r) =>
                    Object.entries(filters).every(
                      ([k, v]) => k === 'user_id' || r[k] === v,
                    ),
                  ) ?? null)
                : null,
            error: null,
          }),
        then: (ok: (v: unknown) => void) => ok({ data: rows, error: null }),
        insert(values: unknown) {
          calls.push({ what: `insert:${table}`, args: values });
          return Promise.resolve({ error: null });
        },
        update(values: unknown) {
          const u = {
            eq(_c: string, id: unknown) {
              calls.push({ what: `update:${table}`, args: { id, values } });
              return Promise.resolve({ error: null });
            },
          };
          return u;
        },
        delete() {
          return {
            eq(_c: string, id: unknown) {
              calls.push({ what: `delete:${table}`, args: id });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
      return q;
    },
  };
  // deno-lint-ignore no-explicit-any
  return { admin: admin as any, calls };
}

function provider(status: number, body: unknown, headers?: HeadersInit) {
  const real = globalThis.fetch;
  let asked = 0;
  globalThis.fetch = (() => {
    asked++;
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, headers }),
    );
  }) as typeof fetch;
  return { asked: () => asked, restore: () => (globalThis.fetch = real) };
}

const ready = {
  choices: [{ message: { role: 'assistant', content: 'ready' } }],
  usage: { prompt_tokens: 8, completion_tokens: 1 },
};

Deno.test(
  'secretName: Anthropic keeps its old name, others get their own',
  () => {
    assertEquals(secretName('anthropic', USER), `anthropic_key_${USER}`);
    assertEquals(secretName('gemini', USER), `ai_key_gemini_${USER}`);
    assertEquals(secretName('groq', USER), `ai_key_groq_${USER}`);
  },
);

Deno.test('probeVerdict: a rate limit means the key was accepted', () => {
  const at = Date.parse('2026-11-10T12:05:00Z');
  assertEquals(
    probeVerdict('groq', 'openai/gpt-oss-120b', {
      ok: false,
      kind: 'rate_limited',
      status: 429,
      message: 'slow down',
      retryAt: at,
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
    }),
    { usable: true, limitedUntil: '2026-11-10T12:05:00.000Z' },
  );
});

Deno.test(
  'probeVerdict: a rejected key and a missing model read differently',
  () => {
    const base = {
      ok: false as const,
      provider: 'gemini' as const,
      model: 'm',
    };
    const auth = probeVerdict('gemini', 'm', {
      ...base,
      kind: 'auth',
      status: 401,
      message: 'API key not valid',
    });
    assert(!auth.usable && auth.status === 422);
    assert(!auth.usable && auth.error.startsWith('Google Gemini rejected'));
    const gone = probeVerdict('gemini', 'm', {
      ...base,
      kind: 'error',
      status: 404,
      message: 'models/m is not found',
    });
    assert(!gone.usable && gone.error.includes('could not run the model "m"'));
    const slow = probeVerdict('gemini', 'm', {
      ...base,
      kind: 'timeout',
      status: 0,
      message: 'timed out',
    });
    assert(!slow.usable && slow.status === 504);
  },
);

Deno.test(
  'saveConnection: refuses before any call to the provider',
  async () => {
    const p = provider(200, ready);
    try {
      const { admin, calls } = fake();
      const bad = async (input: Record<string, unknown>) => {
        const r = await saveConnection(admin, USER, input);
        assert(!r.ok && r.status === 400, JSON.stringify(r));
        return r.ok ? '' : r.error;
      };
      await bad({ provider: 'openai', key: 'sk-whatever-0123456789012345' });
      assert(
        (await bad({ provider: 'groq', key: 'not a key' })).includes('gsk_'),
      );
      // Gemini's free tier may train on prompts: the box must be ticked.
      assert(
        (await bad({ provider: 'gemini', key: GEMINI_KEY })).includes(
          'data terms',
        ),
      );
      await bad({
        provider: 'gemini',
        key: GEMINI_KEY,
        consent: true,
        model: 'bad model name',
      });
      assertEquals(p.asked(), 0);
      assertEquals(calls.length, 0);
    } finally {
      p.restore();
    }
  },
);

Deno.test(
  'saveConnection: a key the provider rejects is not stored',
  async () => {
    const p = provider(401, { error: { message: 'API key not valid' } });
    try {
      const { admin, calls } = fake();
      const r = await saveConnection(admin, USER, {
        provider: 'gemini',
        key: GEMINI_KEY,
        consent: true,
      });
      assert(!r.ok && r.status === 422);
      assertEquals(calls.length, 0);
    } finally {
      p.restore();
    }
  },
);

Deno.test(
  'saveConnection: stores the key in Vault and only its name and last four on the row',
  async () => {
    const p = provider(200, ready);
    try {
      const { admin, calls } = fake();
      const r = await saveConnection(admin, USER, {
        provider: 'gemini',
        key: `  ${GEMINI_KEY}  `,
        consent: true,
      });
      assertEquals(r, { ok: true, message: undefined });
      assertEquals(calls[0], {
        what: 'rpc:vault_upsert_secret',
        args: { p_name: `ai_key_gemini_${USER}`, p_secret: GEMINI_KEY },
      });
      const insert = calls.find((c) => c.what === 'insert:ai_connections');
      const row = insert?.args as Record<string, unknown>;
      assertEquals(row['key_ref'], `ai_key_gemini_${USER}`);
      assertEquals(row['key_hint'], '6789');
      assertEquals(row['provider'], 'gemini');
      assertEquals(row['position'], 0);
      assertEquals(row['status'], 'ok');
      assert(typeof row['consented_at'] === 'string');
      assert(!JSON.stringify(row).includes(GEMINI_KEY));
      // Only Anthropic is mirrored on the profile.
      assert(!calls.some((c) => c.what === 'update:profiles'));
    } finally {
      p.restore();
    }
  },
);

Deno.test(
  'saveConnection: a rate-limited provider still saves, parked',
  async () => {
    const p = provider(
      429,
      { error: { message: 'quota' } },
      { 'retry-after': '90' },
    );
    try {
      const { admin, calls } = fake();
      const r = await saveConnection(admin, USER, {
        provider: 'groq',
        key: 'gsk_' + 'a'.repeat(40),
      });
      assert(r.ok && r.message?.includes('rate limited'));
      const row = calls.find((c) => c.what === 'insert:ai_connections')
        ?.args as Record<string, unknown>;
      assert(typeof row['limited_until'] === 'string');
    } finally {
      p.restore();
    }
  },
);

/** The provider never says "ready" in time; its list of models answers `models`. */
function slowProvider(models: number) {
  const real = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
    const u = String(url);
    asked.push(`${init?.method ?? 'GET'} ${u}`);
    if (u.endsWith('/chat/completions'))
      return Promise.reject(
        Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
      );
    return Promise.resolve(
      new Response(
        JSON.stringify(
          models === 200
            ? { data: [] }
            : { error: { message: 'API key not valid' } },
        ),
        { status: models },
      ),
    );
  }) as typeof fetch;
  return { asked, restore: () => (globalThis.fetch = real) };
}

Deno.test(
  'saveConnection: a provider too slow to answer still saves a key it accepts, untested',
  async () => {
    const p = slowProvider(200);
    try {
      const { admin, calls } = fake();
      const r = await saveConnection(admin, USER, {
        provider: 'gemini',
        key: 'AIza' + 'b'.repeat(35),
        consent: true,
      });
      assert(r.ok && r.message?.includes('too slow to answer a test'));
      // Asked without generating anything, and with the key in the header.
      assertEquals(p.asked[1].startsWith('GET '), true);
      assert(p.asked[1].endsWith('/v1beta/openai/models'));
      const row = calls.find((c) => c.what === 'insert:ai_connections')
        ?.args as Record<string, unknown>;
      assertEquals(row['status'], 'untested');
      assertEquals(row['last_checked_at'], null);
      assert(calls.some((c) => c.what === 'rpc:vault_upsert_secret'));
    } finally {
      p.restore();
    }
  },
);

Deno.test(
  'saveConnection: slow and the key is refused, or nothing is known: not stored',
  async () => {
    for (const [models, status, words] of [
      [401, 422, 'rejected that key'],
      [500, 504, 'took too long'],
    ] as const) {
      const p = slowProvider(models);
      try {
        const { admin, calls } = fake();
        const r = await saveConnection(admin, USER, {
          provider: 'groq',
          key: 'gsk_' + 'a'.repeat(40),
        });
        assert(!r.ok && r.status === status && r.error.includes(words));
        assertEquals(calls.length, 0);
      } finally {
        p.restore();
      }
    }
  },
);

Deno.test(
  'reorderConnections: needs each of the user’s connections once',
  async () => {
    const { admin, calls } = fake([{ id: 'a' }, { id: 'b' }]);
    for (const ids of [['a'], ['a', 'a'], ['a', 'x'], 'a,b'])
      assert(!(await reorderConnections(admin, USER, ids)).ok);
    assertEquals(calls.length, 0);
    assert((await reorderConnections(admin, USER, ['b', 'a'])).ok);
    assertEquals(
      calls.map((c) => c.args),
      [
        { id: 'b', values: { position: 0 } },
        { id: 'a', values: { position: 1 } },
      ],
    );
  },
);

Deno.test(
  'removeConnection: deletes the Vault secret, then the row',
  async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const { admin, calls } = fake([
      {
        id,
        provider: 'anthropic',
        key_ref: `anthropic_key_${USER}`,
        model: '',
      },
    ]);
    assert((await removeConnection(admin, USER, { id })).ok);
    assertEquals(
      calls.map((c) => c.what),
      ['rpc:vault_delete_secret', 'delete:ai_connections', 'update:profiles'],
    );
    // Someone else's id (or a made-up one) is simply not found.
    const other = await removeConnection(admin, USER, {
      id: '33333333-3333-4333-8333-333333333333',
    });
    assert(!other.ok && other.status === 404);
  },
);
