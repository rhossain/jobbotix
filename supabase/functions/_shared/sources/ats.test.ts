import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert';
import {
  ats,
  parseAshby,
  parseGreenhouse,
  parseLever,
  parseWorkable,
  wanted,
} from './ats.ts';
import type { AdapterContext, CompanyTarget } from './types.ts';

const ctx = (
  fake: typeof fetch,
  companies: CompanyTarget[],
  max = 10,
): AdapterContext => ({
  queries: ['angular', 'frontend'],
  since: new Date('2026-11-01T00:00:00Z'),
  maxRequests: max,
  fetch: fake,
  sleep: () => Promise.resolve(),
  companies,
});

Deno.test(
  'wanted keeps search-term and engineering titles, drops the rest',
  () => {
    assert(wanted('Senior Angular Developer', ['angular']));
    assert(wanted('Staff Software Engineer, Payments', ['angular']));
    assert(wanted('Front-End Engineer', ['frontend']));
    assert(!wanted('Account Executive, EMEA', ['angular']));
    assert(!wanted('Head of People', ['angular']));
  },
);

Deno.test('Greenhouse: escaped HTML content, remote location', () => {
  const d = parseGreenhouse(
    {
      id: 4001,
      title: 'Senior Frontend Engineer (Angular)',
      absolute_url: 'https://boards.greenhouse.io/acme/jobs/4001',
      location: { name: 'Remote - Worldwide' },
      content: '&lt;p&gt;We build with &lt;b&gt;Angular&lt;/b&gt;.&lt;/p&gt;',
      updated_at: '2026-11-05T10:00:00-04:00',
    },
    'Acme',
  )!;
  assertEquals(
    [d.company, d.remote_policy, d.external_id],
    ['Acme', 'worldwide', 'gh-4001'],
  );
  assert(
    d.description.startsWith('We build with Angular') &&
      !d.description.includes('<'),
  );
  assertEquals(d.posted_at, '2026-11-05T14:00:00.000Z');
  const ny = parseGreenhouse(
    {
      id: 2,
      title: 'Engineer',
      absolute_url: 'https://boards.greenhouse.io/acme/jobs/2',
      location: { name: 'New York, NY' },
    },
    'Acme',
  )!;
  assertEquals([ny.remote_policy, ny.hiring_countries], ['onsite', ['US']]);
});

Deno.test('Lever: workplace type, all locations, commitment', () => {
  const d = parseLever(
    {
      id: 'abc',
      text: 'Frontend Engineer',
      hostedUrl: 'https://jobs.lever.co/beta/abc',
      applyUrl: 'https://jobs.lever.co/beta/abc/apply',
      workplaceType: 'remote',
      categories: {
        commitment: 'Contract',
        team: 'Web',
        allLocations: ['Poland', 'Germany'],
      },
      descriptionPlain: 'Angular and RxJS.',
      createdAt: 1793800000000,
    },
    'Beta',
  )!;
  assertEquals(
    [d.remote_policy, d.hiring_countries, d.employment_type],
    ['region_locked', ['PL', 'DE'], 'contract'],
  );
  assertEquals(d.url, 'https://jobs.lever.co/beta/abc/apply');
  assertEquals(d.source_url, 'https://jobs.lever.co/beta/abc');
  const hybrid = parseLever(
    {
      id: 'h',
      text: 'Engineer',
      hostedUrl: 'https://jobs.lever.co/beta/h',
      workplaceType: 'hybrid',
      categories: { location: 'Berlin' },
    },
    'Beta',
  )!;
  assertEquals(hybrid.remote_policy, 'hybrid');
});

Deno.test('Ashby: isRemote, compensation, unlisted jobs skipped', () => {
  const d = parseAshby(
    {
      id: 'z1',
      title: 'Senior Angular Engineer',
      jobUrl: 'https://jobs.ashbyhq.com/gamma/z1',
      location: 'Remote',
      isRemote: true,
      employmentType: 'FullTime',
      publishedAt: '2026-11-04T08:00:00.000+00:00',
      compensation: { compensationTierSummary: '$120K – $150K' },
      descriptionPlain: 'Angular',
    },
    'Gamma',
  )!;
  assertEquals(
    [d.remote_policy, d.salary_text],
    ['worldwide', '$120K – $150K'],
  );
  assertEquals(
    parseAshby(
      {
        id: 'x',
        title: 'X',
        jobUrl: 'https://jobs.ashbyhq.com/g/x',
        isListed: false,
      },
      'G',
    ),
    null,
  );
});

Deno.test('Workable: telecommuting and country', () => {
  const d = parseWorkable(
    {
      title: 'Angular Developer',
      shortcode: 'AB12',
      url: 'https://apply.workable.com/delta/j/AB12/',
      country: 'United Arab Emirates',
      city: 'Dubai',
      telecommuting: true,
      employment_type: 'Full-time',
      published_on: '2026-11-03',
    },
    'Delta',
  )!;
  assertEquals(
    [d.remote_policy, d.hiring_countries],
    ['region_locked', ['AE']],
  );
});

Deno.test(
  'the adapter polls each company once, filters titles, reports per company',
  async () => {
    const calls: string[] = [];
    const r = await ats.run(
      ctx(
        (u) => {
          const url = String(u);
          calls.push(url);
          if (url.includes('greenhouse'))
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  jobs: [
                    {
                      id: 1,
                      title: 'Senior Angular Developer',
                      absolute_url: 'https://boards.greenhouse.io/acme/jobs/1',
                      location: { name: 'Remote' },
                    },
                    {
                      id: 2,
                      title: 'Account Executive',
                      absolute_url: 'https://boards.greenhouse.io/acme/jobs/2',
                      location: { name: 'Remote' },
                    },
                  ],
                }),
              ),
            );
          if (url.includes('workable'))
            return Promise.resolve(
              new Response(JSON.stringify({ name: 'Delta Labs', jobs: [] })),
            );
          return Promise.resolve(new Response('not found', { status: 404 }));
        },
        [
          { id: 'c1', kind: 'greenhouse', slug: 'acme', name: 'Acme' },
          { id: 'c2', kind: 'lever', slug: 'gone', name: 'Gone' },
          { id: 'c3', kind: 'workable', slug: 'delta', name: '' },
        ],
      ),
    );
    assertEquals(calls, [
      'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true',
      'https://api.lever.co/v0/postings/gone?mode=json',
      'https://apply.workable.com/api/v1/widget/accounts/delta',
    ]);
    assertEquals(
      r.postings.map((p) => p.title),
      ['Senior Angular Developer'],
    );
    assertEquals(r.companies, [
      { id: 'c1', open_roles: 2 },
      {
        id: 'c2',
        error: '404 from https://api.lever.co/v0/postings/gone?mode=json',
      },
      { id: 'c3', open_roles: 0, name: 'Delta Labs' },
    ]);
  },
);

Deno.test('the adapter does nothing without companies', async () => {
  const r = await ats.run(ctx(() => Promise.reject(new Error('no')), []));
  assertEquals([r.requests, r.postings.length], [0, 0]);
});
