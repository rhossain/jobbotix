import {
  deepStrictEqual as assertEquals,
  ok as assert,
  rejects,
} from 'node:assert';
import {
  arbeitnow,
  jobicy,
  parseArbeitnowJob,
  parseFourDayWeekJob,
  parseJobicyJob,
  parseRemoteOkJob,
  parseRemotiveJob,
  parseWorkingNomadsJob,
  remoteok,
  remotive,
  workingnomads,
} from './boards.ts';
import type { AdapterContext } from './types.ts';

const since = new Date('2026-11-01T00:00:00Z');
const ctx = (
  fake: typeof fetch,
  over: Partial<AdapterContext> = {},
): AdapterContext => ({
  queries: ['angular', 'frontend'],
  since,
  maxRequests: 5,
  fetch: fake,
  sleep: () => Promise.resolve(),
  ...over,
});
const reply = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body)));

const jobicyJob = {
  id: 112233,
  url: 'https://jobicy.com/jobs/112233-senior-angular-developer',
  jobTitle: 'Senior Angular Developer',
  companyName: 'Nimbus',
  companyLogo: 'https://jobicy.com/logo.png',
  jobIndustry: ['Programming'],
  jobType: ['contract'],
  jobGeo: 'Anywhere',
  jobLevel: 'Senior',
  jobExcerpt: 'short',
  jobDescription: '<p>Angular 18, signals, RxJS.</p>',
  pubDate: '2026-11-05 10:00:00',
  annualSalaryMin: '60000',
  annualSalaryMax: '90000',
  salaryCurrency: 'USD',
};

Deno.test('Jobicy: fields, geo, zone-less dates read as UTC', () => {
  const d = parseJobicyJob(jobicyJob)!;
  assertEquals(d.remote_policy, 'worldwide');
  assertEquals(d.employment_type, 'contract');
  assertEquals(d.salary_text, 'USD 60k–90k');
  assertEquals(d.posted_at, '2026-11-05T10:00:00.000Z');
  assertEquals(d.source_url, jobicyJob.url);
  const emea = parseJobicyJob({ ...jobicyJob, jobGeo: 'EMEA, Canada' })!;
  assertEquals(
    [emea.remote_policy, emea.hiring_countries, emea.hiring_regions],
    ['region_locked', ['CA'], ['emea']],
  );
  assertEquals(parseJobicyJob({ ...jobicyJob, url: '' }), null);
});

Deno.test('Jobicy: one tagged request per query within budget', async () => {
  const calls: string[] = [];
  const r = await jobicy.run(
    ctx(
      (u) => {
        calls.push(String(u));
        return reply({
          jobs: [
            jobicyJob,
            { ...jobicyJob, id: 1, pubDate: '2026-09-01 00:00:00' },
          ],
        });
      },
      { maxRequests: 1 },
    ),
  );
  assertEquals(calls, [
    'https://jobicy.com/api/v2/remote-jobs?count=50&tag=angular',
  ]);
  assertEquals(r.postings.length, 1); // the September post is older than `since`
});

Deno.test(
  'RemoteOK: skips the notice, keeps the board page, reads USD salary',
  async () => {
    const job = {
      id: '1099',
      slug: 'remote-senior-frontend-engineer-acme-1099',
      epoch: 1793800000,
      date: '2026-11-04T12:00:00+00:00',
      company: 'Acme',
      position: 'Senior Frontend Engineer',
      tags: ['angular', 'typescript'],
      description: '<p>Hi</p>',
      location: 'Worldwide',
      salary_min: 80000,
      salary_max: 120000,
      apply_url: 'https://remoteOK.com/l/1099',
      url: 'https://remoteOK.com/remote-jobs/remote-senior-frontend-engineer-acme-1099',
    };
    assertEquals(parseRemoteOkJob({ legal: 'API terms' }), null);
    const d = parseRemoteOkJob(job)!;
    assertEquals(
      [d.remote_policy, d.salary_text, d.source_url],
      ['worldwide', 'USD 80k–120k', job.url],
    );
    const r = await remoteok.run(ctx(() => reply([{ legal: 'x' }, job])));
    assertEquals([r.requests, r.postings.length], [1, 1]);
  },
);

Deno.test('Working Nomads: comma tags, location, ISO date', () => {
  const d = parseWorkingNomadsJob({
    url: 'https://www.workingnomads.com/jobs/angular-dev-acme',
    title: 'Angular Developer',
    description: 'Angular work',
    company_name: 'Acme',
    category_name: 'Development',
    tags: 'angular,typescript',
    location: 'Europe',
    pub_date: '2026-11-03T08:00:00Z',
  })!;
  assertEquals(d.tags, ['Development', 'angular', 'typescript']);
  assertEquals(
    [d.remote_policy, d.hiring_regions],
    ['region_locked', ['europe']],
  );
});

Deno.test('Working Nomads adapter makes one request', async () => {
  const r = await workingnomads.run(ctx(() => reply([])));
  assertEquals([r.requests, r.postings.length], [1, 0]);
});

Deno.test(
  'Arbeitnow: remote only; a city means Europe; pages stop at old posts',
  async () => {
    const base = {
      slug: 'frontend-dev-berlin-1',
      company_name: 'Beta GmbH',
      title: 'Frontend Developer (Angular)',
      description: '<p>Remote in Germany</p>',
      remote: true,
      url: 'https://www.arbeitnow.com/jobs/companies/beta/frontend-dev-berlin-1',
      tags: ['Angular'],
      job_types: ['full time'],
      location: 'Berlin',
      created_at: 1793800000,
    };
    assertEquals(parseArbeitnowJob({ ...base, remote: false }), null);
    const d = parseArbeitnowJob(base)!;
    assertEquals(
      [d.remote_policy, d.hiring_countries, d.hiring_regions],
      ['region_locked', [], ['europe']],
    );
    assertEquals(
      parseArbeitnowJob({ ...base, location: 'Germany' })!.hiring_countries,
      ['DE'],
    );

    const calls: string[] = [];
    const r = await arbeitnow.run(
      ctx((u) => {
        calls.push(String(u));
        return reply({
          data:
            calls.length === 1
              ? [base]
              : [{ ...base, slug: 'old', created_at: 1700000000 }],
        });
      }),
    );
    assertEquals(calls.length, 2);
    assertEquals(r.postings.length, 1);
  },
);

Deno.test(
  'Remotive: candidate location, salary text, one request, late feed tolerated',
  async () => {
    const job = {
      id: 4421881,
      url: 'https://remotive.com/remote-jobs/software-dev/senior-frontend-engineer-angular-4421881',
      title: 'Senior Frontend Engineer (Angular)',
      company_name: 'Manila Recruitment',
      category: 'Software Development',
      tags: ['angular'],
      job_type: 'full_time',
      publication_date: '2026-10-31T09:00:00',
      candidate_required_location: 'Worldwide',
      salary: '$4k - $6k/month',
      description: '<p>Angular</p>',
    };
    const d = parseRemotiveJob(job)!;
    assertEquals(
      [d.remote_policy, d.salary_text, d.posted_at],
      ['worldwide', '$4k - $6k/month', '2026-10-31T09:00:00.000Z'],
    );
    const r = await remotive.run(
      ctx(() => reply({ 'job-count': 1, jobs: [job] })),
    );
    assertEquals([r.requests, r.postings.length], [1, 1]); // a day before `since`, still kept
  },
);

Deno.test('a board that answers nothing but errors fails the run', async () => {
  await rejects(
    remotive.run(ctx(() => Promise.resolve(new Response('', { status: 429 })))),
    /Every Remotive request failed/,
  );
  await rejects(
    remoteok.run(ctx(() => Promise.resolve(new Response('<html>')))),
    /Every Remote OK request failed/,
  );
  assert(true);
});

Deno.test('Jobicy tags stay within its 3 to 20 characters', async () => {
  const { jobicyTag } = await import('./boards.ts');
  assertEquals(jobicyTag('qa'), 'qa engineer');
  assertEquals(jobicyTag('go'), 'go developer');
  assertEquals(jobicyTag('frontend'), 'frontend');
  assertEquals(jobicyTag('product manager'), 'product manager');
  assertEquals(jobicyTag('customer support specialist'), 'customer support');
  assertEquals(jobicyTag('supercalifragilisticexpialidocious'), null);
});

// data[0] of 4dayweek.io/api/v2/jobs as returned on 2026-11-14 (shortened).
const FOUR_DAY_JOB = {
  id: '01a1a07c-74a0-75fc-8f90-691f1fc55518',
  slug: 'education-program-specialist-education-at-ohio-state-university-a63723e0',
  title: 'Education Program Specialist - Education',
  description: 'Screen reader users may encounter difficulty with this site.',
  url: 'https://4dayweek.io/job/education-program-specialist-education-at-ohio-state-university-a63723e0',
  category: 'other',
  role: 'Education Program Specialist',
  level: 'mid',
  contract_type: 'permanent',
  schedule_type: 'compressed_week',
  work_arrangement: 'remote',
  locations: [
    {
      country: 'United States',
      continent: 'North America',
      work_arrangement: 'remote',
      is_primary: true,
    },
  ],
  skills: [{ name: 'Program Planning', slug: 'program-planning' }],
  tools: [{ name: 'MS Office', slug: 'ms-office' }],
  posted_at: '2026-11-03T08:17:53Z',
  company: {
    slug: 'ohio-state-university',
    name: 'Ohio State University',
    logo_url:
      'https://media.4dayweek.io/files/1779376705137_77966fab4b0d75f8.png',
    country: 'United States',
    hires_worldwide: false,
  },
};

Deno.test('4 Day Week: remote within its countries, worldwide, hybrid', () => {
  const d = parseFourDayWeekJob(FOUR_DAY_JOB)!;
  assertEquals(
    [d.company, d.title, d.remote_policy, d.hiring_countries, d.seniority],
    [
      'Ohio State University',
      'Education Program Specialist - Education',
      'region_locked',
      ['US'],
      'mid',
    ],
  );
  assertEquals([d.url, d.source_url], [FOUR_DAY_JOB.url, FOUR_DAY_JOB.url]);
  assertEquals(d.posted_at, '2026-11-03T08:17:53.000Z');
  assertEquals(d.tags, ['other', 'Program Planning', 'MS Office']);
  assert(d.company_logo.startsWith('https://media.4dayweek.io/'));

  const anywhere = parseFourDayWeekJob({
    ...FOUR_DAY_JOB,
    company: { ...FOUR_DAY_JOB.company, hires_worldwide: true },
  })!;
  assertEquals(anywhere.remote_policy, 'worldwide');

  const hybrid = parseFourDayWeekJob({
    ...FOUR_DAY_JOB,
    work_arrangement: 'hybrid',
  })!;
  assertEquals(
    [hybrid.remote_policy, hybrid.hiring_countries, hybrid.location],
    ['hybrid', ['US'], 'United States'],
  );
  assertEquals(parseFourDayWeekJob({ ...FOUR_DAY_JOB, company: {} }), null);
});
