import { deepStrictEqual as assertEquals } from 'node:assert';
import { fnv1a, normaliseRole } from './ingest.ts';

Deno.test('normaliseRole maps the tracker document shape', () => {
  const r = normaliseRole({
    company: ' vidIQ ',
    title: 'Senior Frontend Engineer',
    url: 'https://careers.vidiq.com/o/x',
    source: 'vidIQ careers',
    location: 'Worldwide',
    type: 'Full-time',
    salary: '$80k–150k',
    posted: '',
    stack: 'TypeScript, React, Tailwind',
    score: 84.4,
    aiMatch: true,
    reasons: ['a', 'b'],
    gaps: ['c'],
    coverLetter: 'Hi',
    qa: [{ q: 'How often?', a: 'Daily' }],
  });
  assertEquals(r?.company, 'vidIQ');
  assertEquals(r?.type, 'full_time');
  assertEquals(r?.stack, ['TypeScript', 'React', 'Tailwind']);
  assertEquals(r?.score, 84);
  assertEquals(r?.posted_at, null);
  assertEquals(r?.ai_match, true);
  assertEquals(r?.qa.length, 1);
});

Deno.test('normaliseRole rejects rows missing required fields', () => {
  assertEquals(
    normaliseRole({ company: 'X', title: '', url: 'https://x', score: 1 }),
    null,
  );
  assertEquals(
    normaliseRole({ company: 'X', title: 'Y', url: 'not-a-url', score: 1 }),
    null,
  );
  assertEquals(
    normaliseRole({
      company: 'X',
      title: 'Y',
      url: 'https://x',
      score: Number.NaN,
    }),
    null,
  );
});

Deno.test('contract and freelance map to contract; scores clamp', () => {
  assertEquals(
    normaliseRole({
      company: 'X',
      title: 'Y',
      url: 'https://x',
      score: 140,
      type: 'Contract',
    })?.type,
    'contract',
  );
  assertEquals(
    normaliseRole({ company: 'X', title: 'Y', url: 'https://x', score: 140 })
      ?.score,
    100,
  );
  assertEquals(
    normaliseRole({ company: 'X', title: 'Y', url: 'https://x', score: -3 })
      ?.score,
    0,
  );
});

Deno.test('fnv1a is stable', () => {
  assertEquals(fnv1a('hello'), fnv1a('hello'));
  assertEquals(fnv1a('hello') === fnv1a('hellp'), false);
});
