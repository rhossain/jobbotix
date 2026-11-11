import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert';
import {
  GOLDEN_CASES,
  GOLDEN_RESUME,
  goldenModel,
  goldenSummary,
  replyNote,
  runGolden,
  type GoldenJob,
} from './golden.ts';

const judge = (job: GoldenJob, reply: string) =>
  GOLDEN_CASES.find((c) => c.job === job)!.judge(reply);

const GOOD: Record<GoldenJob, string> = {
  score:
    '{"score": 86, "ai_match": false, "reasons": ["Angular and TypeScript are the core of the role", "Remote, worldwide"], "gaps": []}',
  extract:
    'Here you go:\n{"company": "Lumenstack", "title": "Senior Angular Engineer", "location": "Remote, worldwide", "type": "full_time", "salary": "USD 70,000 to 90,000 a year", "stack": ["Angular", "TypeScript", "RxJS"], "posted": "2026-11-03", "summary": "Own the customer dashboard."}',
  tailor:
    '[{"path": "summary", "kind": "replace", "before": "", "after": "Senior Angular engineer with nine years on data-heavy dashboards.", "reason": "Leads with the stack the posting names"}]',
  letter: (
    'I am a senior frontend engineer and the Senior Angular Engineer role at Lumenstack matches the work I do now. ' +
    'At Northwind Analytics I led the move of a 140-screen dashboard to Angular with signals and cut the main bundle by 38%. '
  ).repeat(4),
};

/** Answers each request by which prompt it carries. */
function provider(replies: Partial<Record<GoldenJob, string | number>>) {
  const real = globalThis.fetch;
  const models: string[] = [];
  globalThis.fetch = ((_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    models.push(body.model);
    const prompt = JSON.stringify(body.messages);
    const job = GOLDEN_CASES.find((c) =>
      prompt.includes(JSON.stringify(c.call.prompt).slice(1, 80)),
    )!.job;
    const r = replies[job] ?? GOOD[job];
    if (typeof r === 'number')
      return Promise.resolve(
        new Response(JSON.stringify({ error: { message: 'slow down' } }), {
          status: r,
          headers: { 'retry-after': '30' },
        }),
      );
    return Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: r } }],
          usage: { prompt_tokens: 900, completion_tokens: 120 },
        }),
      ),
    );
  }) as typeof fetch;
  return { models, restore: () => (globalThis.fetch = real) };
}

Deno.test('the fixture resume is one the tailoring paths can address', () => {
  assertEquals(GOLDEN_RESUME.experience.length, 2);
  assert(GOLDEN_RESUME.summary.length > 40);
});

Deno.test('judges: a right answer passes each job', () => {
  for (const job of Object.keys(GOOD) as GoldenJob[])
    assertEquals(judge(job, GOOD[job]), '', job);
});

Deno.test('judges: wrong answers are named for what is wrong', () => {
  assert(judge('score', 'I think this is a great match!').includes('no score'));
  assert(
    judge('score', '{"score": 20, "reasons": ["x"], "gaps": []}').includes(
      'only 20',
    ),
  );
  assert(
    judge(
      'extract',
      '{"company": "Acme", "title": "Senior Angular Engineer", "type": "full_time", "stack": ["Angular"], "salary": "USD 70,000"}',
    ).includes('"Acme"'),
  );
  assert(
    judge(
      'extract',
      GOOD.extract.replace('USD 70,000 to 90,000 a year', ''),
    ).includes('salary'),
  );
  // a change aimed at a path the resume does not have cannot be applied
  assert(
    judge(
      'tailor',
      '[{"path": "experience.9.bullets.0", "kind": "replace", "after": "x"}]',
    ).includes('no change'),
  );
  assert(judge('letter', 'Dear team, I am interested.').includes('words'));
  assert(
    judge(
      'letter',
      GOOD.letter.replaceAll('Lumenstack', 'your company'),
    ).includes('named the company'),
  );
  // (the letter parser already strips the common "[Your ...]" form)
  assertEquals(judge('letter', GOOD.letter + ' [Your Name]'), '');
  assert(
    judge('letter', GOOD.letter + ' [TODO add a date]').includes('placeholder'),
  );
});

Deno.test(
  'goldenModel: scoring uses the fast model, the rest the saved one',
  () => {
    assertEquals(goldenModel('groq', '', true), 'openai/gpt-oss-20b');
    assertEquals(goldenModel('groq', '', false), 'openai/gpt-oss-120b');
    assertEquals(
      goldenModel('groq', 'llama-3.3-70b-versatile', false),
      'llama-3.3-70b-versatile',
    );
  },
);

Deno.test('runGolden: four jobs, each on its model, all passing', async () => {
  const p = provider({});
  try {
    const seen: string[] = [];
    const results = await runGolden('gemini', 'k', '', {
      onAnswer: (job, a) => void seen.push(`${job}:${a.ok}`),
    });
    assertEquals(
      results.map((r) => [r.job, r.ok, r.model]),
      [
        ['score', true, 'gemini-3.5-flash-lite'],
        ['extract', true, 'gemini-3.8-flash'],
        ['tailor', true, 'gemini-3.8-flash'],
        ['letter', true, 'gemini-3.8-flash'],
      ],
    );
    assertEquals(results[0].tokensIn, 900);
    assertEquals(seen, [
      'score:true',
      'extract:true',
      'tailor:true',
      'letter:true',
    ]);
    assertEquals(goldenSummary(results), '4 of 4 passed');
  } finally {
    p.restore();
  }
});

Deno.test('runGolden: a failed job does not stop the others', async () => {
  const p = provider({ extract: 'Sorry, I cannot help with that.' });
  try {
    const results = await runGolden('groq', 'k', '');
    assertEquals(
      results.map((r) => r.ok),
      [true, false, true, true],
    );
    assert(results[1].detail.includes('not the JSON'));
    // What came back is in the result, so the cause can be read off it.
    assert(
      results[1].detail.endsWith(
        'The reply began: Sorry, I cannot help with that.',
      ),
    );
    assertEquals(results[0].detail, '');
    assertEquals(goldenSummary(results), '3 of 4 passed');
  } finally {
    p.restore();
  }
});

Deno.test(
  'runGolden: a rate limit stops the run and is not held against the model',
  async () => {
    const p = provider({ extract: 429 });
    try {
      const results = await runGolden('groq', 'k', '');
      assertEquals(
        results.map((r) => [r.ok, !!r.limited]),
        [
          [true, false],
          [false, true],
          [false, true],
          [false, true],
        ],
      );
      assertEquals(p.models.length, 2); // nothing sent after the 429
      assertEquals(
        goldenSummary(results),
        '1 of 1 passed, 3 not run (rate limit)',
      );
    } finally {
      p.restore();
    }
  },
);

Deno.test('replyNote: says what came back, or why nothing did', () => {
  const base = {
    ok: true as const,
    tokensIn: 1,
    tokensOut: 1,
    provider: 'groq' as const,
    model: 'm',
  };
  assertEquals(
    replyNote({ ...base, text: ' {"score":\n "high"} ' }),
    'The reply began: {"score": "high"}',
  );
  assertEquals(
    replyNote({ ...base, text: 'x'.repeat(200) }, 10),
    `The reply began: ${'x'.repeat(10)}…`,
  );
  assertEquals(replyNote({ ...base, text: '  ' }), 'The reply was empty.');
  assertEquals(
    replyNote({ ...base, text: '', thoughtOnly: true, finish: 'length' }),
    'The model reasoned but wrote no answer. It was cut off at the limit.',
  );
});
