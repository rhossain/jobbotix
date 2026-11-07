import { deepStrictEqual as assertEquals } from 'node:assert';
import { buildQueries, roleKeywords, stackTerm } from './queries.ts';

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
