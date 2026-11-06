import {
  deepStrictEqual as assertEquals,
  ok as assert,
  rejects,
} from 'node:assert';
import { himalayas, parseHimalayasJob } from './himalayas.ts';
import {
  detectAts,
  dedupeKey,
  finishPosting,
  normaliseTitle,
  salaryText,
  toIso,
} from './normalise.ts';
import type { AdapterContext } from './types.ts';

const now = Date.parse('2026-11-06T12:00:00Z');
const days = (n: number) => Math.floor((now - n * 86_400_000) / 1000);

const worldwideJob = {
  title: 'Senior Angular Developer',
  excerpt: 'Build our dashboard in Angular.',
  companyName: 'Acme Analytics',
  companySlug: 'acme-analytics',
  companyLogo: 'https://cdn.himalayas.app/acme.png',
  employmentType: 'Full Time',
  minSalary: 70000,
  maxSalary: 95000,
  currency: 'usd',
  seniority: ['Senior'],
  locationRestrictions: [],
  timezoneRestrictions: [],
  categories: ['Frontend-Developer', 'Angular'],
  parentCategories: ['Software-Engineering'],
  description:
    '<p>We use <b>Angular</b> and TypeScript.</p><ul><li>5+ years</li></ul>',
  pubDate: days(1),
  expiryDate: days(-30),
  applicationLink: 'https://boards.greenhouse.io/acmeanalytics/jobs/123',
  guid: 'https://himalayas.app/companies/acme-analytics/jobs/senior-angular-developer',
};

const lockedJob = {
  title: 'Frontend Engineer (React)',
  companyName: 'Beta GmbH',
  employmentType: 'Contractor',
  seniority: 'Mid-level',
  locationRestrictions: ['Germany', 'Poland', 'Europe'],
  timezoneRestrictions: [1, -1, 2],
  description: 'React role',
  pubDate: days(2),
  applicationLink: 'https://jobs.lever.co/beta/abc',
  guid: 'https://himalayas.app/companies/beta/jobs/frontend-engineer-react',
};

Deno.test('parseHimalayasJob maps a worldwide posting', () => {
  const d = parseHimalayasJob(worldwideJob)!;
  assertEquals(d.company, 'Acme Analytics');
  assertEquals(d.remote_policy, 'worldwide');
  assertEquals(d.hiring_countries, []);
  assertEquals(d.location, 'Remote, worldwide');
  assertEquals(d.employment_type, 'full_time');
  assertEquals(d.salary_text, 'USD 70k–95k');
  assertEquals(d.source_url, worldwideJob.guid);
  assertEquals(d.url, worldwideJob.applicationLink);
  assertEquals(d.tags, [
    'Frontend Developer',
    'Angular',
    'Software Engineering',
  ]);
  assert(d.description.includes('Angular and TypeScript'));
  assert(!d.description.includes('<'));
  assertEquals(d.posted_at, new Date(days(1) * 1000).toISOString());
});

Deno.test('parseHimalayasJob maps a region-locked contract', () => {
  const d = parseHimalayasJob(lockedJob)!;
  assertEquals(d.remote_policy, 'region_locked');
  assertEquals(d.hiring_countries, ['DE', 'PL']);
  assertEquals(d.hiring_regions, ['europe']);
  assertEquals(d.employment_type, 'contract');
  assertEquals(d.timezones, 'UTC-1 to UTC+2');
  assertEquals(d.seniority, 'Mid-level');
});

Deno.test('parseHimalayasJob drops jobs without company, title or link', () => {
  assertEquals(parseHimalayasJob({ title: 'X', companyName: 'Y' }), null);
  assertEquals(parseHimalayasJob({ ...worldwideJob, companyName: '' }), null);
  // a job with only the board page still works: the page is the apply link
  const d = parseHimalayasJob({
    ...worldwideJob,
    applicationLink: 'mailto:jobs@acme.test',
  })!;
  assertEquals(d.url, worldwideJob.guid);
});

Deno.test(
  'the adapter pages breadth-first, stays in budget and skips old posts',
  async () => {
    const calls: string[] = [];
    const fake: typeof fetch = (input) => {
      const url = String(input);
      calls.push(url);
      let jobs: unknown[] = [];
      if (url.includes('/jobs/api?')) jobs = [worldwideJob];
      else if (url.includes('q=angular') && url.includes('page=1')) {
        jobs = Array.from({ length: 12 }, (_, i) => ({
          ...worldwideJob,
          title: `Angular role ${i}`,
          guid: `https://himalayas.app/companies/acme-analytics/jobs/a-${i}`,
        }));
      } else if (url.includes('q=angular') && url.includes('page=2')) {
        jobs = [
          {
            ...lockedJob,
            title: 'Old one',
            pubDate: days(40),
            guid: 'https://himalayas.app/x/old',
          },
        ];
      } else if (url.includes('q=frontend')) jobs = [lockedJob, worldwideJob];
      return Promise.resolve(
        new Response(JSON.stringify({ jobs }), { status: 200 }),
      );
    };
    const ctx: AdapterContext = {
      queries: ['Angular', 'frontend', 'angular'],
      since: new Date(now - 7 * 86_400_000),
      maxRequests: 10,
      fetch: fake,
      sleep: () => Promise.resolve(),
    };
    const r = await himalayas.run(ctx);
    // latest + angular p1 + frontend p1 + angular p2 (frontend page too short to page on)
    assertEquals(calls.length, 4);
    assertEquals(r.requests, 4);
    assert(calls[1].includes('q=angular&sort=recent&page=1'));
    assert(calls[2].includes('q=frontend'));
    assert(calls[3].includes('q=angular&sort=recent&page=2'));
    // 12 angular + worldwide + locked, the old one dropped, duplicates merged
    assertEquals(r.postings.length, 14);
    assert(!r.postings.some((p) => p.title === 'Old one'));

    const tight = await himalayas.run({ ...ctx, maxRequests: 2 });
    assertEquals(tight.requests, 2);
  },
);

Deno.test(
  'the adapter fails the run only when every request fails',
  async () => {
    let n = 0;
    const flaky: typeof fetch = () =>
      Promise.resolve(
        n++ === 0
          ? new Response('nope', { status: 503 })
          : new Response(JSON.stringify({ jobs: [lockedJob] })),
      );
    const ok = await himalayas.run({
      queries: ['react'],
      since: new Date(now - 7 * 86_400_000),
      maxRequests: 5,
      fetch: flaky,
      sleep: () => Promise.resolve(),
    });
    assertEquals(ok.postings.length, 1);
    assertEquals(ok.warnings.length, 1);

    await rejects(
      himalayas.run({
        queries: ['react'],
        since: new Date(now - 7 * 86_400_000),
        maxRequests: 5,
        fetch: () => Promise.reject(new Error('blocked')),
        sleep: () => Promise.resolve(),
      }),
      /Every Himalayas request failed/,
    );
  },
);

Deno.test('dedupe keys ignore board noise in company and title', async () => {
  assertEquals(
    await dedupeKey('Acme Analytics, Inc.', 'Sr. Front-End Engineer (Remote)'),
    await dedupeKey('acme analytics', 'Senior Frontend Engineer'),
  );
  assert(
    (await dedupeKey('Acme', 'Senior Angular Engineer')) !==
      (await dedupeKey('Acme', 'Senior React Engineer')),
  );
  assertEquals(normaliseTitle('Full Stack Dev - 100% Remote'), 'fullstack dev');
});

Deno.test(
  'detectAts reads the ATS and company slug from apply links',
  async () => {
    assertEquals(detectAts('https://boards.greenhouse.io/acme/jobs/1'), {
      kind: 'greenhouse',
      slug: 'acme',
    });
    assertEquals(detectAts('https://job-boards.eu.greenhouse.io/acme/jobs/1'), {
      kind: 'greenhouse',
      slug: 'acme',
    });
    assertEquals(detectAts('https://jobs.lever.co/beta/abc'), {
      kind: 'lever',
      slug: 'beta',
    });
    assertEquals(detectAts('https://jobs.ashbyhq.com/Gamma/xyz'), {
      kind: 'ashby',
      slug: 'gamma',
    });
    assertEquals(detectAts('https://apply.workable.com/delta/j/1'), {
      kind: 'workable',
      slug: 'delta',
    });
    assertEquals(detectAts('https://epsilon.recruitee.com/o/x'), {
      kind: 'recruitee',
      slug: 'epsilon',
    });
    assertEquals(detectAts('https://zeta.wd5.myworkdayjobs.com/en-US/x'), {
      kind: 'workday',
      slug: 'zeta',
    });
    assertEquals(detectAts('https://acme.com/careers/1'), null);
    const p = await finishPosting(parseHimalayasJob(worldwideJob)!);
    assertEquals([p.ats_kind, p.ats_slug], ['greenhouse', 'acmeanalytics']);
    assertEquals(p.dedupe_key.length, 32);
  },
);

Deno.test('salary and date helpers', () => {
  assertEquals(salaryText(null, null, 'USD'), '');
  assertEquals(salaryText(90000, null, ''), '90k+');
  assertEquals(salaryText(null, 5000, 'eur'), 'EUR up to 5k');
  assertEquals(toIso(1793620800), '2026-11-02T12:00:00.000Z');
  assertEquals(toIso(1793620800000), '2026-11-02T12:00:00.000Z');
  assertEquals(toIso('2026-11-02'), '2026-11-02T00:00:00.000Z');
  assertEquals(toIso('soon'), null);
});

Deno.test(
  'text() decodes entities and repairs Latin-1-decoded UTF-8',
  async () => {
    const { text } = await import('./normalise.ts');
    assertEquals(text('hims &#038; hers'), 'hims & hers');
    assertEquals(
      text('Scheduling &amp; Coordinating'),
      'Scheduling & Coordinating',
    );
    assertEquals(
      text('ML Engineer â\u0080\u0094 Bench'),
      'ML Engineer — Bench',
    );
    assertEquals(text('CafÃ©'), 'Café');
    assertEquals(text('Café — ok'), 'Café — ok');
  },
);
