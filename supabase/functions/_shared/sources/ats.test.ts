import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert';
import {
  ats,
  parseAshby,
  parseGreenhouse,
  parseLever,
  parsePersonio,
  parseRecruitee,
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
      // a Lever board missing from the main host is tried on the European one
      'https://api.eu.lever.co/v0/postings/gone?mode=json',
      'https://apply.workable.com/api/v1/widget/accounts/delta',
    ]);
    assertEquals(
      r.postings.map((p) => p.title),
      ['Senior Angular Developer'],
    );
    assertEquals(r.companies, [
      { id: 'c1', open_roles: 2, kept: 1 },
      {
        id: 'c2',
        error: '404 from https://api.lever.co/v0/postings/gone?mode=json',
      },
      { id: 'c3', open_roles: 0, kept: 0, name: 'Delta Labs' },
    ]);
  },
);

Deno.test(
  'a European Lever board is found on the EU host and remembered',
  async () => {
    const job = {
      id: 'j1',
      text: 'Frontend Engineer',
      hostedUrl: 'https://jobs.eu.lever.co/berlinco/j1',
      categories: { location: 'Berlin' },
    };
    const serve = (calls: string[]) => (u: string | URL | Request) => {
      const url = String(u);
      calls.push(url);
      return Promise.resolve(
        url.includes('api.eu.lever.co')
          ? new Response(JSON.stringify([job]))
          : new Response('not found', { status: 404 }),
      );
    };
    const first: string[] = [];
    const r = await ats.run(
      ctx(serve(first) as typeof fetch, [
        { id: 'c1', kind: 'lever', slug: 'berlinco', name: 'Berlin Co' },
      ]),
    );
    assertEquals(first, [
      'https://api.lever.co/v0/postings/berlinco?mode=json',
      'https://api.eu.lever.co/v0/postings/berlinco?mode=json',
    ]);
    assertEquals(r.companies, [
      { id: 'c1', open_roles: 1, kept: 1, region: 'eu' },
    ]);
    assertEquals(r.postings.length, 1);

    // once known, only the European host is called
    const second: string[] = [];
    await ats.run(
      ctx(serve(second) as typeof fetch, [
        {
          id: 'c1',
          kind: 'lever',
          slug: 'berlinco',
          name: 'Berlin Co',
          region: 'eu',
        },
      ]),
    );
    assertEquals(second, [
      'https://api.eu.lever.co/v0/postings/berlinco?mode=json',
    ]);
  },
);

Deno.test('the adapter does nothing without companies', async () => {
  const r = await ats.run(ctx(() => Promise.reject(new Error('no')), []));
  assertEquals([r.requests, r.postings.length], [0, 0]);
});

// Field names and values as bunq.recruitee.com/api/offers/ returned them on
// 2026-11-14 (shortened).
const RECRUITEE_OFFER = {
  id: 2823928,
  status: 'published',
  title: 'Security Engineer',
  company_name: 'bunq',
  careers_url: 'https://careers.bunq.com/o/security-engineer-3',
  careers_apply_url: 'https://careers.bunq.com/o/security-engineer-3/c/new',
  location: 'Amsterdam, Noord-Holland, Netherlands',
  locations: [
    {
      id: 39979,
      city: 'Amsterdam',
      country: 'Netherlands',
      country_code: 'NL',
    },
  ],
  remote: false,
  hybrid: true,
  on_site: false,
  employment_type_code: 'fulltime_permanent',
  department: 'Technology',
  tags: ['E2', 'E3'],
  salary: { min: null, max: null, period: null, currency: null },
  description: '<p style="text-align:start;">At bunq, we make life easy.</p>',
  requirements: '<ul><li><p>Hands-on as a security engineer</p></li></ul>',
  published_at: '2026-11-11 13:21:40 UTC',
  created_at: '2026-11-11 13:06:54 UTC',
};

Deno.test('Recruitee: hybrid office, both text fields, UTC date', () => {
  const d = parseRecruitee(RECRUITEE_OFFER, 'fallback')!;
  assertEquals(
    [d.company, d.title, d.external_id, d.remote_policy, d.hiring_countries],
    ['bunq', 'Security Engineer', 'recruitee-2823928', 'hybrid', ['NL']],
  );
  assertEquals(d.source_url, 'https://careers.bunq.com/o/security-engineer-3');
  assertEquals(d.url, 'https://careers.bunq.com/o/security-engineer-3/c/new');
  assertEquals(d.posted_at, '2026-11-11T13:21:40.000Z');
  assert(
    d.description.includes('make life easy') &&
      d.description.includes('Hands-on') &&
      !d.description.includes('<'),
  );
  assertEquals(d.tags.slice(0, 2), ['Technology', 'E2']);
  assertEquals(
    parseRecruitee(
      { ...RECRUITEE_OFFER, remote: true, hybrid: false, locations: [] },
      'x',
    )!.remote_policy !== 'onsite',
    true,
  );
  assertEquals(
    parseRecruitee({ ...RECRUITEE_OFFER, status: 'draft' }, 'x'),
    null,
  );
});

// First <position> of thermondo.jobs.personio.de/xml?language=en on
// 2026-11-14, plus a second one with description sections in the documented shape.
const PERSONIO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<workzag-jobs>
  <position>
    <id>2692963</id>
    <subcompany>Thermondo GmbH</subcompany>
    <office>Neumünster</office>
    <department>Installation</department>
    <recruitingCategory>Installation</recruitingCategory>
    <name>Anlagenmechaniker SHK  (m/w/d) - Mobiles Arbeiten</name>
    <jobDescriptions></jobDescriptions>
    <employmentType>permanent</employmentType>
    <seniority>experienced</seniority>
    <schedule>full-time</schedule>
    <yearsOfExperience>1-2</yearsOfExperience>
    <keywords>Anlagenmechaniker SHK,Heizungsbauer</keywords>
    <occupation>hvac</occupation>
    <createdAt>2026-06-30T16:55:43+00:00</createdAt>
  </position>
  <position>
    <id>31</id>
    <office>Berlin</office>
    <name>Senior Frontend Engineer</name>
    <jobDescriptions>
      <jobDescription>
        <name>Your tasks</name>
        <value><![CDATA[<p>Build our <b>Angular</b> app.</p>]]></value>
      </jobDescription>
    </jobDescriptions>
    <employmentType>permanent</employmentType>
    <schedule>part-time</schedule>
    <createdAt>2026-11-01T09:00:00+00:00</createdAt>
  </position>
</workzag-jobs>`;

Deno.test('Personio: positions from XML, job page built from the id', () => {
  const [a, b] = parsePersonio(
    PERSONIO_XML,
    'thermondo',
    'https://thermondo.jobs.personio.de',
  );
  assertEquals(
    [a.company, a.title, a.url, a.external_id, a.seniority],
    [
      'Thermondo GmbH',
      'Anlagenmechaniker SHK (m/w/d) - Mobiles Arbeiten',
      'https://thermondo.jobs.personio.de/job/2692963',
      'personio-2692963',
      'experienced',
    ],
  );
  assert(a.remote_policy !== 'onsite'); // "Mobiles Arbeiten" in the title
  assertEquals(a.posted_at, '2026-06-30T16:55:43.000Z');
  assertEquals(
    [b.company, b.title, b.remote_policy, b.employment_type],
    ['thermondo', 'Senior Frontend Engineer', 'onsite', 'part_time'],
  );
  assert(
    b.description.includes('Your tasks') &&
      b.description.includes('Build our Angular app') &&
      !b.description.includes('<'),
  );
});

Deno.test(
  'the adapter reads Recruitee and Personio boards, the .com Personio host second',
  async () => {
    const calls: string[] = [];
    const r = await ats.run(
      ctx(
        ((u: string | URL | Request) => {
          const url = String(u);
          calls.push(url);
          if (url.includes('recruitee'))
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  offers: [
                    { ...RECRUITEE_OFFER, title: 'Frontend Engineer' },
                    { ...RECRUITEE_OFFER, id: 2, title: 'AML Manager' },
                  ],
                }),
              ),
            );
          if (url.includes('personio.com'))
            return Promise.resolve(new Response(PERSONIO_XML));
          return Promise.resolve(new Response('nope', { status: 404 }));
        }) as typeof fetch,
        [
          { id: 'r1', kind: 'recruitee', slug: 'bunq', name: '' },
          { id: 'p1', kind: 'personio', slug: 'thermondo', name: 'Thermondo' },
        ],
      ),
    );
    assertEquals(calls, [
      'https://bunq.recruitee.com/api/offers/',
      'https://thermondo.jobs.personio.de/xml?language=en',
      'https://thermondo.jobs.personio.com/xml?language=en',
    ]);
    assertEquals(
      r.postings.map((p) => p.title),
      ['Frontend Engineer', 'Senior Frontend Engineer'],
    );
    assertEquals(
      r.postings[1].url,
      'https://thermondo.jobs.personio.com/job/31',
    );
    assertEquals(r.companies, [
      { id: 'r1', open_roles: 2, kept: 1 },
      { id: 'p1', open_roles: 2, kept: 1 },
    ]);
  },
);
