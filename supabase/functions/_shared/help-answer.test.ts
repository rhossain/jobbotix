import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert';
import { answerHelp } from './help-answer.ts';

// --- AI providers on the other end of fetch ---------------------------------

function providers(
  replies: Record<string, { status?: number; body: unknown }[]>,
) {
  const sent: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string | URL) => {
    const host = new URL(String(url)).host;
    sent.push(host);
    const list = replies[host] ?? [{ status: 500, body: {} }];
    const r = list.length > 1 ? list.shift()! : list[0];
    return Promise.resolve(
      new Response(JSON.stringify(r.body), { status: r.status ?? 200 }),
    );
  }) as typeof fetch;
  return { sent, restore: () => (globalThis.fetch = real) };
}

const reply = (o: unknown) => JSON.stringify(o);
const claude = (text: string) => ({
  body: {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 2500, output_tokens: 120 },
  },
});
const openAi = (text: string) => ({
  body: {
    choices: [{ message: { role: 'assistant', content: text } }],
    usage: { prompt_tokens: 2500, completion_tokens: 120 },
  },
});
const GOOD = reply({
  found: true,
  answer: '1. Open Jobs.\n2. Press Add job.',
  articles: ['add-job'],
});

// --- the database ------------------------------------------------------------

function db(opts: {
  connections?: { provider: string }[];
  own?: unknown;
  platform?: unknown;
}) {
  const saved: Record<string, unknown>[] = [];
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  const connections = (opts.connections ?? []).map((c, i) => ({
    id: `c${i}`,
    key_ref: `ref${i}`,
    model: '',
    position: i,
    status: 'ok',
    limited_until: null,
    ...c,
  }));
  const admin = {
    from(table: string) {
      if (table === 'help_messages')
        return {
          insert: (row: Record<string, unknown>) => {
            saved.push(row);
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({ data: { id: 'm1' }, error: null }),
              }),
            };
          },
        };
      if (table === 'ai_usage')
        return { insert: () => Promise.resolve({ error: null }) };
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
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      if (fn === 'help_ai_check')
        return Promise.resolve({
          data:
            args['p_route'] === 'own'
              ? (opts.own ?? { ok: true, model: '' })
              : (opts.platform ?? { ok: true, model: 'claude-haiku-5-5' }),
          error: null,
        });
      if (fn === 'help_ai_log')
        return Promise.resolve({ data: 0.0003, error: null });
      return Promise.resolve({ data: 'their-key', error: null }); // vault
    },
  };
  // deno-lint-ignore no-explicit-any
  return { admin: admin as any, saved, rpcs };
}

const ASK = { question: 'how do I add a job I found', page: '/jobs' };

Deno.test('their own AI answers first, and Jobbotix pays nothing', async () => {
  const p = providers({ 'api.groq.com': [openAi(GOOD)] });
  const d = db({ connections: [{ provider: 'groq' }] });
  try {
    const r = await answerHelp(d.admin, 'u1', ASK, 'sk-platform');
    assertEquals(r.route, 'own');
    assertEquals(r.articles, ['add-job']);
    assert(r.answer.startsWith('1. Open Jobs.'));
    assertEquals(p.sent, ['api.groq.com']);
    assert(!d.rpcs.some((x) => x.fn === 'help_ai_log'));
    assertEquals(d.saved[0].route, 'own');
  } finally {
    p.restore();
  }
});

Deno.test(
  'without their own AI, Jobbotix’s key answers and the cost is logged',
  async () => {
    const p = providers({ 'api.anthropic.com': [claude(GOOD)] });
    const d = db({});
    try {
      const r = await answerHelp(d.admin, 'u1', ASK, 'sk-platform');
      assertEquals(r.route, 'platform');
      assertEquals(r.ownAi, false);
      const log = d.rpcs.find((x) => x.fn === 'help_ai_log');
      assertEquals(log?.args['p_tokens_in'], 2500);
      assertEquals(log?.args['p_model'], 'claude-haiku-5-5');
    } finally {
      p.restore();
    }
  },
);

Deno.test('when their AI fails, Jobbotix’s key answers instead', async () => {
  const p = providers({
    'api.groq.com': [
      { status: 429, body: { error: { message: 'slow down' } } },
    ],
    'api.anthropic.com': [claude(GOOD)],
  });
  const d = db({ connections: [{ provider: 'groq' }] });
  try {
    const r = await answerHelp(d.admin, 'u1', ASK, 'sk-platform');
    assertEquals(r.route, 'platform');
    assertEquals(r.ownAi, true);
  } finally {
    p.restore();
  }
});

Deno.test('over the daily limit: the best article, and why', async () => {
  const p = providers({});
  const d = db({ platform: { ok: false, reason: 'daily_limit', limit: 10 } });
  try {
    const r = await answerHelp(d.admin, 'u1', ASK, 'sk-platform');
    assertEquals(r.route, 'articles');
    assertEquals(r.reason, 'daily_limit');
    assertEquals(r.articles[0], 'add-job');
    assertEquals(p.sent, []);
    assertEquals(d.saved[0].route, 'articles');
  } finally {
    p.restore();
  }
});

Deno.test(
  'budget used up: articles, even when their own limit is also used',
  async () => {
    const p = providers({});
    const d = db({
      connections: [{ provider: 'groq' }],
      own: { ok: false, reason: 'daily_limit' },
      platform: { ok: false, reason: 'budget' },
    });
    try {
      const r = await answerHelp(d.admin, 'u1', ASK, 'sk-platform');
      assertEquals(r.route, 'articles');
      assertEquals(r.reason, 'budget');
    } finally {
      p.restore();
    }
  },
);

Deno.test('no platform key and no own AI: articles, reason off', async () => {
  const p = providers({});
  const d = db({});
  try {
    const r = await answerHelp(d.admin, 'u1', ASK, '');
    assertEquals(r.route, 'articles');
    assertEquals(r.reason, 'off');
  } finally {
    p.restore();
  }
});

Deno.test(
  'an unreadable reply is asked once more, then falls back',
  async () => {
    const p = providers({
      'api.anthropic.com': [claude('Open Jobs, I think')],
    });
    const d = db({});
    try {
      const r = await answerHelp(d.admin, 'u1', ASK, 'sk-platform');
      assertEquals(p.sent.length, 2);
      assertEquals(r.route, 'articles');
      assertEquals(r.reason, 'failed');
      // Both calls cost something and are logged.
      assertEquals(d.rpcs.filter((x) => x.fn === 'help_ai_log').length, 2);
    } finally {
      p.restore();
    }
  },
);

Deno.test(
  'a question the articles do not answer is kept as not found',
  async () => {
    const p = providers({
      'api.anthropic.com': [
        claude(
          reply({
            found: false,
            answer: 'I can only help with using Jobbotix.',
            articles: [],
          }),
        ),
      ],
    });
    const d = db({});
    try {
      const r = await answerHelp(
        d.admin,
        'u1',
        { question: 'what salary should I ask for', page: '' },
        'sk-platform',
      );
      assertEquals(r.route, 'platform');
      assertEquals(r.found, false);
      assertEquals(r.articles, []);
      assertEquals(d.saved[0].found, false);
    } finally {
      p.restore();
    }
  },
);
