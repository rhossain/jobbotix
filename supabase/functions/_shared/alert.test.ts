import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert';
import { alertWorthy, buildAlert } from './alert.ts';

Deno.test('alertWorthy: off when no threshold, best first otherwise', () => {
  const roles = [{ score: 60 }, { score: 82 }, { score: 75 }];
  assertEquals(alertWorthy(roles, null), []);
  assertEquals(
    alertWorthy(roles, 70).map((r) => r.score),
    [82, 75],
  );
});

Deno.test(
  'buildAlert: subject leads with the best role, links into the app, escapes HTML',
  () => {
    const email = buildAlert({
      name: 'Sazzad Hossain',
      appUrl: 'https://jobbotix.com',
      roles: [
        {
          id: 'r1',
          company: 'Acme <Labs>',
          title: 'Senior Angular Engineer',
          score: 88,
          source: 'Company careers',
          location: 'Remote, worldwide',
        },
        {
          id: 'r2',
          company: 'Beta',
          title: 'Frontend Lead',
          score: 76,
          source: 'Himalayas',
          location: '',
        },
      ],
    });
    assertEquals(
      email.subject,
      '88: Senior Angular Engineer at Acme <Labs>, and 1 more',
    );
    assert(email.text.startsWith('Hi Sazzad,'));
    assert(email.text.includes('https://jobbotix.com/roles/r1'));
    assert(
      email.html.includes('Acme &lt;Labs&gt;') &&
        !email.html.includes('<Labs>'),
    );
  },
);
