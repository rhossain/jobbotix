import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert';
import {
  buildDigest,
  digestDue,
  summariseRuns,
  isDigestHour,
  isoWeekday,
  type DigestRole,
} from './digest.ts';

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
    appUrl: 'https://jobbotix.com',
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
  assertEquals(d.html.includes('href="https://jobbotix.com/roles/b"'), true);
  assertEquals(d.html.includes('<script'), false);
});

Deno.test('buildDigest says nothing new and shows stale reminders', () => {
  const d = buildDigest({
    name: '',
    appUrl: 'https://jobbotix.com',
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
    appUrl: 'https://jobbotix.com',
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

Deno.test('digestDue honours weekdays and the off switch', () => {
  const now = new Date('2026-11-07T00:50:00Z'); // Saturday 06:50 in Dhaka
  assertEquals(isoWeekday('Asia/Dhaka', now), 6);
  assertEquals(digestDue({ digest_time: '06:45' }, 'Asia/Dhaka', now), true);
  assertEquals(
    digestDue(
      { digest_time: '06:45', digest_days: [1, 2, 3, 4, 5] },
      'Asia/Dhaka',
      now,
    ),
    false,
  );
  assertEquals(
    digestDue(
      { digest_time: '06:45', digest_enabled: false },
      'Asia/Dhaka',
      now,
    ),
    false,
  );
});

Deno.test('summariseRuns sums the last day and labels the digest line', () => {
  const now = new Date('2026-11-07T06:00:00Z');
  const ev = (at: string, p: Record<string, unknown>) => ({
    payload: { at, ...p },
    created_at: at,
  });
  const r = summariseRuns(
    [
      ev('2026-11-07T05:50:00Z', { searched: 40, added: 2, excluded: 3 }),
      ev('2026-11-06T23:50:00Z', { searched: 130, added: 1, excluded: 1 }),
      ev('2026-11-07T00:05:00Z', { digest: true, roles: 3 }),
    ],
    now,
  )!;
  assertEquals([r.searched, r.added, r.excluded, r.runs], [170, 3, 4, 2]);
  const email = buildDigest({
    name: 'Sazzad',
    appUrl: 'https://jobbotix.com',
    now,
    run: r,
    newRoles: [],
    stale: [],
  });
  assert(
    email.text.includes(
      'Last 24 hours (2 runs): 170 listings reviewed, 3 added, 4 excluded.',
    ),
  );
  assertEquals(
    summariseRuns([ev('2026-11-07T00:05:00Z', { digest: true })], now),
    null,
  );
});

Deno.test('buildDigest leads with interviews in the user time zone', () => {
  const d = buildDigest({
    name: 'Sazzad Hossain',
    appUrl: 'https://jobbotix.com',
    // 07:00 in Dhaka
    now: new Date('2026-11-05T01:00:00Z'),
    run: null,
    newRoles: [],
    stale: [],
    timezone: 'Asia/Dhaka',
    interviews: [
      {
        role_id: 'r9',
        kind: 'technical',
        title: '',
        // 14:00 in Dhaka the same day
        scheduled_at: '2026-11-05T08:00:00Z',
        interviewers: 'Ana Ruiz',
        company: 'Acme & Co',
        role_title: 'Senior Angular Engineer',
      },
    ],
  });
  assertEquals(d.subject, 'Interview today · Job search: nothing new (5 Nov)');
  assert(
    d.text.includes(
      'Interviews coming up:\n- Thu 5 Nov, 14:00 · Technical interview · Senior Angular Engineer at Acme & Co · with Ana Ruiz',
    ),
  );
  assert(d.text.includes('https://jobbotix.com/roles/r9?tab=prep'));
  assert(d.html.includes('Acme &amp; Co'));
  assert(
    d.html.indexOf('Interviews coming up') < d.html.indexOf('Nothing new'),
  );
});

Deno.test('buildDigest leaves the subject alone for later interviews', () => {
  const d = buildDigest({
    name: '',
    appUrl: 'https://jobbotix.com',
    now: new Date('2026-11-05T01:00:00Z'),
    run: null,
    newRoles: [],
    stale: [],
    timezone: 'Asia/Dhaka',
    interviews: [
      {
        role_id: 'r9',
        kind: 'final',
        title: 'Final with the CEO',
        scheduled_at: '2026-11-06T08:00:00Z',
        interviewers: '',
        company: 'Acme',
        role_title: 'Lead UI Engineer',
      },
    ],
  });
  assertEquals(d.subject, 'Job search: nothing new (5 Nov)');
  assert(
    d.text.includes(
      'Fri 6 Nov, 14:00 · Final with the CEO · Lead UI Engineer at Acme',
    ),
  );
});
