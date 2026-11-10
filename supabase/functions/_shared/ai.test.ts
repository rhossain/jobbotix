import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert';
import {
  aiNote,
  callProvider,
  errorDetail,
  loadConnections,
  openAiBody,
  parseDuration,
  retryAtFrom,
  runAi,
  type ConnectionRow,
} from './ai.ts';
import { PROVIDERS } from './providers.ts';

// --- a provider on the other end of fetch -----------------------------------

type Reply = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  throws?: string;
};
interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Replaces fetch with scripted replies; returns what was sent and a restore. */
function provider(...replies: Reply[]) {
  const sent: Sent[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
    sent.push({
      url: String(url),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(String(init?.body ?? '{}')),
    });
    const r = replies[Math.min(sent.length - 1, replies.length - 1)];
    if (r.throws) {
      const e = new Error(r.throws);
      e.name = r.throws;
      return Promise.reject(e);
    }
    return Promise.resolve(
      new Response(
        typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {}),
        {
          status: r.status ?? 200,
          headers: r.headers,
        },
      ),
    );
  }) as typeof fetch;
  return { sent, restore: () => (globalThis.fetch = real) };
}

const openAiOk = (text: string, inTok = 100, outTok = 20) => ({
  body: {
    choices: [{ message: { role: 'assistant', content: text } }],
    usage: { prompt_tokens: inTok, completion_tokens: outTok },
  },
});
const claudeOk = (text: string) => ({
  body: {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 50, output_tokens: 10 },
  },
});
const call = { prompt: 'Write a letter', maxTokens: 1200, timeoutMs: 5000 };

// --- a database on the other end of the service client ----------------------

function db(rows: Partial<ConnectionRow>[], keys: Record<string, string> = {}) {
  const connections = rows.map((r, i) => ({
    id: `c${i + 1}`,
    provider: 'gemini',
    key_ref: `ref${i + 1}`,
    model: '',
    position: i,
    status: 'ok',
    limited_until: null,
    ...r,
  })) as ConnectionRow[];
  const usage: Record<string, unknown>[] = [];
  const patches: { id: string; values: Record<string, unknown> }[] = [];
  const admin = {
    from(table: string) {
      if (table === 'ai_usage')
        return {
          insert: (row: Record<string, unknown>) => (
            usage.push(row),
            Promise.resolve({ error: null })
          ),
        };
      return {
        select: () => {
          const q = {
            eq: () => q,
            order: () => q,
            then: (ok: (v: unknown) => void) =>
              ok({ data: connections, error: null }),
          };
          return q;
        },
        update: (values: Record<string, unknown>) => ({
          eq: (_c: string, id: string) => (
            patches.push({ id, values }),
            Promise.resolve({ error: null })
          ),
        }),
      };
    },
    rpc: (_fn: string, args: { p_name: string }) =>
      Promise.resolve({
        data: keys[args.p_name] ?? `key-for-${args.p_name}`,
        error: null,
      }),
  };
  // deno-lint-ignore no-explicit-any
  return { admin: admin as any, usage, patches, connections };
}

// --- durations and retry times ----------------------------------------------

Deno.test('parseDuration reads the reset formats providers send', () => {
  assertEquals(parseDuration('2m59.56s'), 179_560);
  assertEquals(parseDuration('7.66s'), 7660);
  assertEquals(parseDuration('1h2m3s'), 3_723_000);
  assertEquals(parseDuration('250ms'), 250);
  assertEquals(parseDuration(''), null);
  assertEquals(parseDuration('soon'), null);
});

Deno.test(
  'retryAtFrom: Retry-After seconds, a date, a reset header, the body, then a minute',
  () => {
    const now = Date.parse('2026-11-10T12:00:00Z');
    assertEquals(
      retryAtFrom(new Headers({ 'retry-after': '30' }), '', now),
      now + 30_000,
    );
    assertEquals(
      retryAtFrom(
        new Headers({ 'retry-after': 'Tue, 10 Nov 2026 12:05:00 GMT' }),
        '',
        now,
      ),
      now + 300_000,
    );
    assertEquals(
      retryAtFrom(
        new Headers({ 'x-ratelimit-reset-requests': '2m30s' }),
        '',
        now,
      ),
      now + 150_000,
    );
    assertEquals(
      retryAtFrom(
        new Headers(),
        '{"error":{"message":"Quota exceeded. Please retry in 34.2s."}}',
        now,
      ),
      now + 34_200,
    );
    assertEquals(
      retryAtFrom(new Headers(), '{"details":[{"retryDelay": "41s"}]}', now),
      now + 41_000,
    );
    assertEquals(
      retryAtFrom(new Headers(), 'nothing useful', now),
      now + 60_000,
    );
  },
);

Deno.test('retryAtFrom never parks a connection for more than a day', () => {
  const now = 1_000_000;
  assertEquals(
    retryAtFrom(new Headers({ 'retry-after': '999999999' }), '', now),
    now + 86_400_000,
  );
});

Deno.test('errorDetail finds the message in either error shape', () => {
  assertEquals(
    errorDetail({ error: { message: 'Invalid API Key' } }, 'x'),
    'Invalid API Key',
  );
  assertEquals(
    errorDetail([{ error: { code: 429, message: 'Quota exceeded' } }], 'x'),
    'Quota exceeded',
  );
  assertEquals(errorDetail({ error: 'plain' }, 'x'), 'plain');
  assertEquals(errorDetail(null, 'Bad Gateway'), 'Bad Gateway');
});

// --- request shape ----------------------------------------------------------

Deno.test('Gemini: asks for little thinking and leaves room for it', () => {
  const b = openAiBody(PROVIDERS.gemini, 'gemini-3.8-flash', {
    ...call,
    system: 'Be brief',
    temperature: 0,
  });
  assertEquals(b, {
    model: 'gemini-3.8-flash',
    messages: [
      { role: 'system', content: 'Be brief' },
      { role: 'user', content: 'Write a letter' },
    ],
    max_tokens: 5200,
    temperature: 0,
    reasoning_effort: 'low',
  });
});

Deno.test(
  'Groq: its own limit field, capped for the free tier; no thinking setting on Llama',
  () => {
    const big = openAiBody(PROVIDERS.groq, 'openai/gpt-oss-120b', {
      ...call,
      maxTokens: 8000,
    });
    assertEquals(big['max_completion_tokens'], 5500); // 4000 cap + 1500 headroom
    assertEquals(big['reasoning_effort'], 'low');
    assertEquals('max_tokens' in big, false);
    const llama = openAiBody(PROVIDERS.groq, 'llama-3.3-70b-versatile', call);
    assertEquals(llama['max_completion_tokens'], 1200);
    assertEquals('reasoning_effort' in llama, false);
  },
);

// --- one call ---------------------------------------------------------------

Deno.test(
  'callProvider: an OpenAI-compatible reply becomes text and token counts',
  async () => {
    const p = provider(openAiOk('Dear team', 321, 45));
    try {
      const a = await callProvider(
        'gemini',
        'KEY-123',
        'gemini-3.8-flash',
        call,
      );
      assertEquals(a, {
        ok: true,
        text: 'Dear team',
        tokensIn: 321,
        tokensOut: 45,
        provider: 'gemini',
        model: 'gemini-3.8-flash',
      });
      assertEquals(
        p.sent[0].url,
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      );
      assertEquals(p.sent[0].headers['authorization'], 'Bearer KEY-123');
    } finally {
      p.restore();
    }
  },
);

Deno.test('callProvider: content sent as parts is joined', async () => {
  const p = provider({
    body: {
      choices: [
        {
          message: {
            content: [
              { type: 'text', text: 'a' },
              { type: 'text', text: 'b' },
            ],
          },
        },
      ],
    },
  });
  try {
    const a = await callProvider('groq', 'k', 'llama-3.3-70b-versatile', call);
    assert(a.ok && a.text === 'ab' && a.tokensIn === 0);
  } finally {
    p.restore();
  }
});

Deno.test(
  'callProvider: Anthropic goes to the Messages API with its own headers',
  async () => {
    const p = provider(claudeOk('Hello'));
    try {
      const a = await callProvider(
        'anthropic',
        'sk-ant-x',
        'claude-haiku-5-5',
        { ...call, system: 'S' },
      );
      assertEquals(a, {
        ok: true,
        text: 'Hello',
        tokensIn: 50,
        tokensOut: 10,
        provider: 'anthropic',
        model: 'claude-haiku-5-5',
      });
      assertEquals(p.sent[0].url, 'https://api.anthropic.com/v1/messages');
      assertEquals(p.sent[0].headers['x-api-key'], 'sk-ant-x');
      assertEquals(p.sent[0].body['system'], 'S');
    } finally {
      p.restore();
    }
  },
);

Deno.test('callProvider: a rate limit carries when to try again', async () => {
  const p = provider({
    status: 429,
    headers: { 'retry-after': '12' },
    body: { error: { message: 'Rate limit reached' } },
  });
  try {
    const before = Date.now();
    const a = await callProvider('groq', 'k', 'openai/gpt-oss-120b', call);
    assert(!a.ok && a.kind === 'rate_limited' && a.status === 429);
    assert(
      !a.ok &&
        a.retryAt! >= before + 12_000 &&
        a.retryAt! <= Date.now() + 12_000,
    );
  } finally {
    p.restore();
  }
});

Deno.test(
  "callProvider: a bad key is an auth failure, including Gemini's 400",
  async () => {
    const p = provider({
      status: 400,
      body: [
        {
          error: {
            code: 400,
            message: 'API key not valid. Please pass a valid API key.',
          },
        },
      ],
    });
    try {
      const a = await callProvider('gemini', 'bad', 'gemini-3.8-flash', call);
      assert(!a.ok && a.kind === 'auth');
      const q = provider({
        status: 401,
        body: { error: { message: 'Invalid API Key' } },
      });
      try {
        const b = await callProvider(
          'groq',
          'bad',
          'openai/gpt-oss-120b',
          call,
        );
        assert(!b.ok && b.kind === 'auth');
      } finally {
        q.restore();
      }
    } finally {
      p.restore();
    }
  },
);

Deno.test(
  'callProvider: a request over the free limit is too_large',
  async () => {
    const p = provider({
      status: 413,
      body: {
        error: {
          message:
            'Request too large for model on tokens per minute (TPM): Limit 8000, Requested 9120',
        },
      },
    });
    try {
      const a = await callProvider('groq', 'k', 'openai/gpt-oss-120b', call);
      assert(!a.ok && a.kind === 'too_large');
    } finally {
      p.restore();
    }
  },
);

Deno.test(
  'callProvider: a model that refuses the thinking setting is asked again without it',
  async () => {
    const p = provider(
      {
        status: 400,
        body: {
          error: {
            message: 'reasoning_effort is not supported with this model',
          },
        },
      },
      openAiOk('fine'),
    );
    try {
      const a = await callProvider('gemini', 'k', 'gemini-9-nano', call);
      assert(a.ok && a.text === 'fine');
      assertEquals(p.sent.length, 2);
      assertEquals(p.sent[0].body['reasoning_effort'], 'low');
      assertEquals('reasoning_effort' in p.sent[1].body, false);
      assertEquals(p.sent[1].body['max_tokens'], 1200);
    } finally {
      p.restore();
    }
  },
);

Deno.test(
  'callProvider: never throws; a timeout and a network error become failures without the key',
  async () => {
    for (const [name, kind] of [
      ['TimeoutError', 'timeout'],
      ['TypeError', 'error'],
    ] as const) {
      const p = provider({ throws: name });
      try {
        const a = await callProvider(
          'gemini',
          'SECRET-KEY',
          'gemini-3.8-flash',
          call,
        );
        assert(!a.ok && a.kind === kind);
        assert(!a.ok && !a.message.includes('SECRET-KEY'));
      } finally {
        p.restore();
      }
    }
  },
);

// --- the user's connections in order ----------------------------------------

Deno.test(
  'loadConnections returns rows in order and drops providers it does not know',
  async () => {
    const { admin } = db([
      { provider: 'gemini' },
      { provider: 'mystery' as never },
      { provider: 'groq' },
    ]);
    assertEquals(
      (await loadConnections(admin, 'u')).map((c) => c.provider),
      ['gemini', 'groq'],
    );
  },
);

Deno.test('runAi: no connection means nothing was tried', async () => {
  const { admin, usage } = db([]);
  const r = await runAi(admin, 'u', call, { job: 'letter' });
  assertEquals(r, { ok: false, reason: 'no_connection', message: '' });
  assertEquals(usage.length, 0);
  assertEquals(aiNote(r, 'This draft was written locally.'), undefined);
});

Deno.test(
  'runAi: the first connection answers; the call is logged with its provider',
  async () => {
    const { admin, usage, patches } = db([
      { provider: 'gemini' },
      { provider: 'anthropic' },
    ]);
    const p = provider(openAiOk('Dear team', 300, 40));
    try {
      const r = await runAi(admin, 'user-1', call, { job: 'letter' });
      assertEquals(r, {
        ok: true,
        value: 'Dear team',
        text: 'Dear team',
        provider: 'gemini',
        model: 'gemini-3.8-flash',
      });
      assertEquals(p.sent.length, 1);
      assertEquals(p.sent[0].headers['authorization'], 'Bearer key-for-ref1');
      assertEquals(usage, [
        {
          user_id: 'user-1',
          job: 'letter',
          provider: 'gemini',
          model: 'gemini-3.8-flash',
          tokens_in: 300,
          tokens_out: 40,
          cost_usd: 0,
        },
      ]);
      assertEquals(patches.length, 0); // a healthy connection is not rewritten on every call
    } finally {
      p.restore();
    }
  },
);

Deno.test(
  'runAi: a rate-limited provider is parked and the next one answers',
  async () => {
    const { admin, usage, patches } = db([
      { provider: 'gemini' },
      { provider: 'groq' },
    ]);
    const p = provider(
      {
        status: 429,
        headers: { 'retry-after': '600' },
        body: { error: { message: 'Quota exceeded' } },
      },
      openAiOk('From Groq'),
    );
    try {
      const t = Date.parse('2026-11-10T12:00:00Z');
      const r = await runAi(admin, 'u', call, { job: 'letter', now: () => t });
      assert(r.ok && r.provider === 'groq' && r.value === 'From Groq');
      assertEquals(patches, [
        { id: 'c1', values: { limited_until: '2026-11-10T12:10:00.000Z' } },
      ]);
      assertEquals(usage.length, 1);
      assert(p.sent[1].url.startsWith('https://api.groq.com/'));
    } finally {
      p.restore();
    }
  },
);

Deno.test(
  'runAi: a provider still inside its limit is not called at all',
  async () => {
    const t = Date.parse('2026-11-10T12:00:00Z');
    const { admin } = db([
      { provider: 'gemini', limited_until: '2026-11-10T12:12:00Z' },
    ]);
    const p = provider(openAiOk('should not be asked'));
    try {
      const r = await runAi(admin, 'u', call, { job: 'letter', now: () => t });
      assertEquals(r, {
        ok: false,
        reason: 'rate_limited',
        message:
          'Google Gemini has reached its rate limit; it should work again in about 12 minutes.',
        retryAt: Date.parse('2026-11-10T12:12:00Z'),
      });
      assertEquals(p.sent.length, 0);
      assertEquals(
        aiNote(r, 'This draft was written locally.'),
        'Google Gemini has reached its rate limit; it should work again in about 12 minutes. This draft was written locally.',
      );
    } finally {
      p.restore();
    }
  },
);

Deno.test(
  'runAi: once a limit has passed the provider is used again and un-parked',
  async () => {
    const t = Date.parse('2026-11-10T12:00:00Z');
    const { admin, patches } = db([
      { provider: 'gemini', limited_until: '2026-11-10T11:59:00Z' },
    ]);
    const p = provider(openAiOk('back'));
    try {
      const r = await runAi(admin, 'u', call, { job: 'letter', now: () => t });
      assert(r.ok);
      assertEquals(patches[0].values['limited_until'], null);
      assertEquals(patches[0].values['status'], 'ok');
    } finally {
      p.restore();
    }
  },
);

Deno.test(
  'runAi: a rejected key marks the connection and moves on',
  async () => {
    const { admin, patches } = db([
      { provider: 'groq' },
      { provider: 'anthropic' },
    ]);
    const p = provider(
      { status: 401, body: { error: { message: 'Invalid API Key' } } },
      claudeOk('From Claude'),
    );
    try {
      const r = await runAi(admin, 'u', call, { job: 'letter' });
      assert(r.ok && r.provider === 'anthropic');
      assertEquals(patches[0].id, 'c1');
      assertEquals(patches[0].values['status'], 'error');
      assertEquals(
        patches[0].values['last_error'],
        'Groq rejected your key. Check it in Settings.',
      );
    } finally {
      p.restore();
    }
  },
);

Deno.test(
  'runAi: an unreadable reply is asked for once more, then gives up on that provider',
  async () => {
    const parse = (t: string) => (t.startsWith('{') ? JSON.parse(t) : null);
    const { admin, usage } = db([{ provider: 'gemini' }]);
    const good = provider(
      openAiOk('Sure! Here you go'),
      openAiOk('{"score":71}'),
    );
    try {
      const r = await runAi(admin, 'u', call, { job: 'score', parse });
      assert(r.ok);
      assertEquals(r.ok && r.value, { score: 71 });
      assertEquals(good.sent.length, 2);
      assert(
        String(
          (good.sent[1].body['messages'] as { content: string }[])[0].content,
        ).includes('could not be read'),
      );
      assertEquals(usage.length, 2); // both calls used tokens
    } finally {
      good.restore();
    }

    const d = db([{ provider: 'gemini' }]);
    const bad = provider(openAiOk('nope'), openAiOk('still nope'));
    try {
      const r = await runAi(d.admin, 'u', call, { job: 'score', parse });
      assertEquals(r, {
        ok: false,
        reason: 'bad_output',
        message:
          'Google Gemini (gemini-3.8-flash) did not answer in a form Jobbotix could read.',
      });
      assertEquals(bad.sent.length, 2);
    } finally {
      bad.restore();
    }
  },
);

Deno.test(
  "runAi: scoring uses each provider's fast model; a pick applies only to its own provider",
  async () => {
    const fast = db([{ provider: 'gemini', model: 'gemini-3.8-flash' }]);
    const p = provider(openAiOk('ok'));
    try {
      const r = await runAi(fast.admin, 'u', call, {
        job: 'score',
        fast: true,
      });
      assert(r.ok && r.model === 'gemini-3.5-flash-lite');
    } finally {
      p.restore();
    }
    const picked = db([{ provider: 'gemini' }]);
    const q = provider(openAiOk('ok'));
    try {
      const r = await runAi(picked.admin, 'u', call, {
        job: 'letter',
        choice: 'anthropic:claude-opus-5-5',
      });
      assert(r.ok && r.model === 'gemini-3.8-flash');
      const s = await runAi(picked.admin, 'u', call, {
        job: 'letter',
        choice: 'gemini:gemini-3.5-flash-lite',
      });
      assert(s.ok && s.model === 'gemini-3.5-flash-lite');
    } finally {
      q.restore();
    }
  },
);

Deno.test(
  'runAi: a model picked for this generation puts its provider first',
  async () => {
    const { admin } = db([{ provider: 'gemini' }, { provider: 'groq' }]);
    const p = provider(openAiOk('from groq'));
    try {
      const r = await runAi(admin, 'u', call, {
        job: 'letter',
        choice: 'groq:llama-3.3-70b-versatile',
      });
      assert(r.ok && r.provider === 'groq');
      assertEquals(r.ok && r.model, 'llama-3.3-70b-versatile');
      assertEquals(p.sent.length, 1);
      assert(p.sent[0].url.startsWith('https://api.groq.com/'));
    } finally {
      p.restore();
    }
  },
);

Deno.test('runAi: skip leaves a provider out', async () => {
  const { admin } = db([{ provider: 'anthropic' }, { provider: 'groq' }]);
  const p = provider(openAiOk('from groq'));
  try {
    const r = await runAi(admin, 'u', call, {
      job: 'research',
      skip: ['anthropic'],
    });
    assert(r.ok && r.provider === 'groq');
    assertEquals(p.sent.length, 1);
  } finally {
    p.restore();
  }
});

Deno.test(
  'runAi: when everything fails the message says what happened to each',
  async () => {
    const t = Date.parse('2026-11-10T12:00:00Z');
    const { admin } = db([{ provider: 'gemini' }, { provider: 'groq' }]);
    const p = provider(
      {
        status: 429,
        headers: { 'retry-after': '120' },
        body: { error: { message: 'quota' } },
      },
      { status: 500, body: { error: { message: 'Internal error' } } },
    );
    try {
      const r = await runAi(admin, 'u', call, { job: 'letter', now: () => t });
      assertEquals(r, {
        ok: false,
        reason: 'failed',
        message:
          'Google Gemini has reached its rate limit; it should work again in about 2 minutes. Groq could not answer (500): Internal error',
      });
    } finally {
      p.restore();
    }
  },
);
