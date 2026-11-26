import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert';
import { HELP_ARTICLES } from './help-articles.ts';
import { HELP_QUESTIONS } from './help-questions.ts';
import {
  buildHelpCall,
  describeSetup,
  HELP_MAX_ANSWER,
  parseHelpReply,
  readHelpAsk,
} from './help.ts';

Deno.test('every test question names a real article or is a decline', () => {
  const ids = new Set(HELP_ARTICLES.map((a) => a.id));
  for (const t of HELP_QUESTIONS) {
    assert(t.decline || (t.article && ids.has(t.article)), t.q);
  }
  assertEquals(HELP_QUESTIONS.length, 40);
});

Deno.test(
  'search hands the model the article that answers each question',
  () => {
    const missed = HELP_QUESTIONS.filter((t) => t.article)
      .filter(
        (t) =>
          !buildHelpCall({
            question: t.q,
            page: t.page ?? '',
          }).allowed.includes(t.article as string),
      )
      .map((t) => `${t.q} → ${t.article}`);
    assertEquals(missed, []);
  },
);

Deno.test(
  'with no matching article the model sees every article in brief',
  () => {
    const p = buildHelpCall({ question: 'চাকরি কীভাবে যোগ করব', page: '' });
    assertEquals(p.best, []);
    assertEquals(p.allowed.length, HELP_ARTICLES.length);
    assert(p.call.context?.includes('[add-job]'));
  },
);

Deno.test('readHelpAsk cuts to size and refuses odd input', () => {
  assertEquals(readHelpAsk({ question: '  hi  ', page: '/jobs' }), {
    question: 'hi',
    page: '/jobs',
  });
  assertEquals(readHelpAsk({ question: '' }), null);
  assertEquals(
    readHelpAsk({ question: 'x', page: 'javascript:alert(1)' })?.page,
    '',
  );
  assertEquals(
    readHelpAsk({ question: 'x'.repeat(900) })?.question.length,
    500,
  );
});

Deno.test('parseHelpReply keeps only articles it was given', () => {
  const r = parseHelpReply(
    'Sure!\n```json\n{"found": true, "answer": "1. Open **Jobs**.\\n2. Press Add job.", "articles": ["add-job", "made-up", "add-job"]}\n```',
    ['add-job', 'filter-jobs'],
  );
  assertEquals(r, {
    found: true,
    answer: '1. Open Jobs.\n2. Press Add job.',
    articles: ['add-job'],
  });
});

Deno.test('parseHelpReply refuses what it cannot use', () => {
  assertEquals(
    parseHelpReply('I think you should open Jobs', ['add-job']),
    null,
  );
  assertEquals(parseHelpReply('{"found": true, "answer": ""}', []), null);
  assertEquals(parseHelpReply('{not json}', []), null);
  const long = parseHelpReply(
    JSON.stringify({ found: true, answer: 'x'.repeat(5000), articles: [] }),
    [],
  );
  assertEquals(long?.answer.length, HELP_MAX_ANSWER);
  assertEquals(
    parseHelpReply(
      '{"found": false, "answer": "Not sure.", "articles": []}',
      [],
    )?.found,
    false,
  );
});

Deno.test('describeSetup: counts and switches in plain lines', () => {
  assertEquals(describeSetup(null), '');
  assertEquals(describeSetup('text'), '');
  const none = describeSetup({ plan: 'Free', preferences_saved: false });
  assert(none.includes('Job preferences: not saved yet'));
  assert(none.includes('Resume: not saved yet'));
  assert(none.includes('Last search for new jobs: not run yet'));
  const full = describeSetup({
    plan: 'Pro',
    resume_saved: true,
    preferences_saved: true,
    job_titles: 3,
    skills: 8,
    home_country: 'DE',
    other_countries: 2,
    remote_only: false,
    daily_email: true,
    daily_email_time: '06:45',
    daily_email_days: 5,
    daily_email_min_score: 70,
    timezone: 'Europe/Berlin',
    last_search: '2026-11-26T09:12:44.1+00:00',
    jobs: 12,
    jobs_last_7_days: 4,
    own_ai: true,
  });
  assert(full.includes('3 job title(s), 8 skill(s)'));
  assert(full.includes('remote, hybrid and on-site'));
  assert(
    full.includes('at 06:45 on 5 day(s) a week, jobs scoring at least 70'),
  );
  assert(full.includes('2026-11-26 09:12 UTC'));
  assert(full.includes('Their own AI connection: yes'));
});

Deno.test('the set-up goes in the question, not the cached part', () => {
  const p = buildHelpCall(
    { question: 'why no jobs', page: '' },
    { preferences_saved: false },
  );
  assert(p.call.prompt.startsWith('Their set-up:'));
  assert(!(p.call.context ?? '').includes('Their set-up'));
  assert(
    !buildHelpCall({ question: 'why no jobs', page: '' }).call.prompt.includes(
      'set-up',
    ),
  );
});
