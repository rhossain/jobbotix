import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert';
import { HELP_ARTICLES } from './help-articles.ts';
import { HELP_QUESTIONS } from './help-questions.ts';
import {
  buildHelpCall,
  HELP_MAX_ANSWER,
  parseHelpReply,
  readHelpAsk,
} from './help.ts';

Deno.test('every test question names a real article or is a decline', () => {
  const ids = new Set(HELP_ARTICLES.map((a) => a.id));
  for (const t of HELP_QUESTIONS)
    assert(t.decline || (t.article && ids.has(t.article)), t.q);
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
