import { deepStrictEqual as assertEquals } from 'node:assert';
import {
  buildQueries,
  planQueries,
  roleKeywords,
  rotateFor,
  stackTerm,
} from './queries.ts';

Deno.test('roleKeywords keeps what the job is, not its level', () => {
  assertEquals(roleKeywords('Senior Angular Developer'), ['angular']);
  assertEquals(roleKeywords('Senior Front-End Engineer'), ['frontend']);
  assertEquals(roleKeywords('Frontend-leaning Full-stack'), [
    'frontend',
    'fullstack',
  ]);
  assertEquals(roleKeywords('Frontend-focused Developer'), ['frontend']);
  assertEquals(roleKeywords('Lead Full Stack Engineer (Angular)'), [
    'fullstack',
    'angular',
  ]);
  assertEquals(roleKeywords('Senior Engineer'), []);
});

Deno.test('stackTerm skips entries that make poor search terms', () => {
  assertEquals(stackTerm('Angular'), 'angular');
  assertEquals(stackTerm('Vue.js'), 'vue');
  assertEquals(stackTerm('HTML5/CSS3'), null);
  assertEquals(stackTerm('SCSS'), null);
});

Deno.test('buildQueries merges profiles, most shared first, capped', () => {
  const q = buildQueries([
    {
      target_roles: ['Senior Angular Developer', 'Senior Frontend Engineer'],
      stacks: ['Angular', 'HTML5/CSS3'],
    },
    { target_roles: ['Frontend Engineer'], stacks: ['React'] },
  ]);
  assertEquals(q, ['angular', 'frontend', 'react']);
  assertEquals(
    buildQueries(
      [{ target_roles: ['Vue dev', 'Svelte dev', 'Solid dev'], stacks: [] }],
      2,
    ),
    ['solid', 'svelte'],
  );
});

Deno.test('rotateFor: a small budget reaches every term across runs', () => {
  const q = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  assertEquals(rotateFor(q, 0, 3), q);
  assertEquals(rotateFor(q, 1, 3).slice(0, 3), ['d', 'e', 'f']);
  assertEquals(rotateFor(q, 2, 3).slice(0, 3), ['g', 'a', 'b']);
  const seen = new Set<string>();
  for (let run = 0; run < 3; run++)
    for (const t of rotateFor(q, run, 3).slice(0, 3)) seen.add(t);
  assertEquals(seen.size, q.length);
  // a budget that covers everything changes nothing
  assertEquals(rotateFor(q, 5, 10), q);
});

Deno.test(
  'planQueries: a term nobody has searched goes first on every source',
  () => {
    const q = ['angular', 'frontend', 'qa', 'nurse', 'react'];
    const searched = { angular: 'x', frontend: 'x', react: 'x' };
    const plan = planQueries(q, searched, 3, 2);
    assertEquals(plan.fresh, ['qa', 'nurse']);
    assertEquals(plan.queries.slice(0, 2), ['qa', 'nurse']);
    assertEquals([...plan.queries].sort(), [...q].sort());
    // nothing new: plain rotation
    assertEquals(planQueries(['a', 'b'], { a: 1, b: 1 }, 0, 5), {
      queries: ['a', 'b'],
      fresh: [],
    });
  },
);
