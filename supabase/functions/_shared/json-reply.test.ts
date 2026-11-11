import { deepStrictEqual as assertEquals } from 'node:assert';
import { parseJsonObject, repairJsonObject } from './json-reply.ts';

Deno.test('parseJsonObject: valid JSON is read as written', () => {
  assertEquals(parseJsonObject('{"a": 1, "b": ["x"]}'), { a: 1, b: ['x'] });
  assertEquals(parseJsonObject('Here:\n```json\n{"a": {"b": 2}}\n```'), {
    a: { b: 2 },
  });
});

Deno.test('parseJsonObject: an array closed with a brace is put right', () => {
  // The reply Groq's gpt-oss-20b sent in the Full check, 11 Nov 2026.
  const reply =
    '{"score":65,"aiMatch":false,"reasons":["Angular primary framework","Senior level experience"],"gaps":["No AI‑assisted tools mentioned","Salary may be low for senior"} }';
  assertEquals(parseJsonObject(reply), {
    score: 65,
    aiMatch: false,
    reasons: ['Angular primary framework', 'Senior level experience'],
    gaps: ['No AI‑assisted tools mentioned', 'Salary may be low for senior'],
  });
});

Deno.test('repairJsonObject: missing, wrong and extra closers', () => {
  assertEquals(repairJsonObject('{"a":[1,2}'), '{"a":[1,2]}');
  assertEquals(repairJsonObject('{"a":[1,2'), '{"a":[1,2]}');
  assertEquals(repairJsonObject('{"a":{"b":1]]'), '{"a":{"b":1}}');
  assertEquals(repairJsonObject('x {"a":1}} trailing }'), '{"a":1}');
});

Deno.test('repairJsonObject: brackets inside strings are text', () => {
  const s = '{"a":"closes ] and } and \\" here","b":[1}';
  assertEquals(parseJsonObject(s), { a: 'closes ] and } and " here', b: [1] });
});

Deno.test(
  'parseJsonObject: nothing is invented from a reply with no object',
  () => {
    assertEquals(parseJsonObject('A great match!'), null);
    assertEquals(parseJsonObject('[1, 2]'), null);
    // Stops inside a string: cut off, not a bracket slip.
    assertEquals(
      parseJsonObject('{"score": 80, "reasons": ["Angular and'),
      null,
    );
    // Still not JSON once the brackets are right.
    assertEquals(parseJsonObject('{score is 80]'), null);
  },
);
