import { deepStrictEqual as assertEquals } from 'node:assert';
import { buildDigest, isDigestHour, type DigestRole } from './digest.ts';

const role = (over: Partial<DigestRole>): DigestRole => ({
  id: 'r1',
  company: 'Northwind',
  title: 'Senior Angular Engineer',
  url: 'https://jobs.example/1',
  location: 'Remote, worldwide',
  type: 'full_time',
  salary: '$95k',
  score: 88,
  ai_match: true,
  status: 'new',
  status_changed_at: '2026-11-01T06:00:00Z',
  cover_letter: 'Hi',
  reasons: ['Angular named first'],
  ...over,
});

Deno.test('buildDigest lists new roles best first and counts letters', () => {
  const d = buildDigest({
    name: 'Sazzad Hossain',
    appUrl: 'https://app.jobbotix.com',
    now: new Date('2026-11-05T01:00:00Z'),
    run: { at: '2026-11-05T00:45:00Z', searched: 47, added: 2, excluded: 21 },
    newRoles: [
      role({ id: 'a', score: 70, cover_letter: '' }),
      role({ id: 'b', score: 92 }),
    ],
    stale: [],
  });
  assertEquals(d.subject, 'Job search: 2 new roles (5 Nov)');
  assertEquals(d.text.startsWith('Good morning, Sazzad.'), true);
  assertEquals(d.text.indexOf('92 ·') < d.text.indexOf('70 ·'), true);
  assertEquals(d.text.includes('1 of these have a cover letter ready'), true);
  assertEquals(
    d.html.includes('href="https://app.jobbotix.com/roles/b"'),
    true,
  );
  assertEquals(d.html.includes('<script'), false);
});

Deno.test('buildDigest says nothing new and shows stale reminders', () => {
  const d = buildDigest({
    name: '',
    appUrl: 'https://app.jobbotix.com',
    now: new Date('2026-11-05T01:00:00Z'),
    run: null,
    newRoles: [],
    stale: [
      role({ status: 'shortlist', status_changed_at: '2026-10-31T06:00:00Z' }),
    ],
  });
  assertEquals(d.subject, 'Job search: nothing new (5 Nov)');
  assertEquals(d.text.includes('Nothing new since the last run.'), true);
  assertEquals(
    d.text.includes('Senior Angular Engineer at Northwind: 4 days'),
    true,
  );
});

Deno.test('buildDigest escapes HTML in user data', () => {
  const d = buildDigest({
    name: '',
    appUrl: 'https://app.jobbotix.com',
    now: new Date('2026-11-05T01:00:00Z'),
    run: null,
    newRoles: [role({ company: 'Evil <script>alert(1)</script>' })],
    stale: [],
  });
  assertEquals(d.html.includes('<script>alert'), false);
  assertEquals(d.html.includes('&lt;script&gt;'), true);
});

Deno.test('isDigestHour compares in the user timezone', () => {
  const now = new Date('2026-11-05T00:45:00Z'); // 06:45 in Dhaka (UTC+6)
  assertEquals(isDigestHour('06:45', 'Asia/Dhaka', now), true);
  assertEquals(isDigestHour('07:00', 'Asia/Dhaka', now), false);
  assertEquals(isDigestHour('00:30', 'UTC', now), true);
  assertEquals(isDigestHour('00:30', 'Not/AZone', now), true); // falls back to UTC
});
