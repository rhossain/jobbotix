import { deepStrictEqual as assertEquals } from 'node:assert';
import { employmentType, typeList } from './employment.ts';

Deno.test('employmentType reads board job-type fields', () => {
  const cases: [unknown, string][] = [
    ['Full-time', 'full_time'],
    ['FULL_TIME', 'full_time'],
    [undefined, 'full_time'],
    ['Contractor', 'contract'],
    ['Contract to hire', 'contract'],
    ['Temporary', 'contract'],
    ['Fixed-term', 'contract'],
    ['Freelance', 'freelance'],
    ['Freelancer / Contract', 'freelance'],
    ['Independent contractor', 'freelance'],
    ['Part-time', 'part_time'],
    ['parttime', 'part_time'],
    ['Full-time, Part-time', 'full_time'],
  ];
  for (const [input, want] of cases) assertEquals(employmentType(input), want);
});

Deno.test('typeList names a profile list for an exclusion reason', () => {
  assertEquals(typeList(['full_time']), 'Full-time');
  assertEquals(typeList(['full_time', 'contract']), 'Full-time or contract');
  assertEquals(
    typeList(['full_time', 'contract', 'freelance']),
    'Full-time, contract or freelance',
  );
});
