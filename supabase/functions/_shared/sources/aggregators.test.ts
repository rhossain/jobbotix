import {
  deepStrictEqual as assertEquals,
  ok as assert,
  rejects,
} from 'node:assert';
import {
  adzuna,
  jooble,
  joobleKeys,
  parseAdzunaJob,
  parseJoobleJob,
  parseReedJob,
  reed,
  workFrom,
} from './aggregators.ts';
import { redact } from './http.ts';
import type { AdapterContext } from './types.ts';

const since = new Date(Date.now() - 3 * 86_400_000);
const recent = new Date(Date.now() - 86_400_000).toISOString();
const ctx = (
  fake: typeof fetch,
  over: Partial<AdapterContext> = {},
): AdapterContext => ({
  queries: ['angular', 'frontend'],
  since,
  maxRequests: 4,
  fetch: fake,
  sleep: () => Promise.resolve(),
  countries: ['BD', 'GB', 'AE'],
  secret: (n) =>
    ({
      ADZUNA_APP_ID: 'id1',
      ADZUNA_APP_KEY: 'sekret',
      JOOBLE_KEYS: 'BD=jk-bd, uk=jk-uk',
      REED_API_KEY: 'rk',
    })[n],
  ...over,
});

Deno.test(
  'workFrom reads remote, hybrid and on-site from the posting words',
  () => {
    assertEquals(
      workFrom('Senior Angular Developer (Remote)', 'London', '', 'GB'),
      {
        remote_policy: 'region_locked',
        hiring_countries: ['GB'],
        source_country: 'GB',
      },
    );
    assertEquals(
      workFrom('Frontend Engineer', 'Manchester, Hybrid', '', 'GB')
        .remote_policy,
      'hybrid',
    );
    assertEquals(
      workFrom('Frontend Engineer', 'Leeds', '', 'GB').remote_policy,
      'onsite',
    );
    assertEquals(
      workFrom('Frontend Engineer - Remote, Worldwide', '', '', 'GB')
        .remote_policy,
      'worldwide',
    );
  },
);

Deno.test(
  'Adzuna: predicted salaries are dropped, currency by country, only its countries',
  async () => {
    const job = {
      id: '4767428727',
      title: 'Senior <strong>Angular</strong> Developer - Remote',
      description: 'Angular and TypeScript',
      created: recent,
      redirect_url: 'https://www.adzuna.co.uk/jobs/details/4767428727',
      company: { display_name: 'Acme Ltd' },
      location: { display_name: 'London, UK' },
      salary_min: 60000,
      salary_max: 75000,
      salary_is_predicted: '0',
      contract_type: 'contract',
      category: { label: 'IT Jobs' },
    };
    const d = parseAdzunaJob(job, 'GB')!;
    assertEquals(
      [d.title, d.salary_text, d.remote_policy, d.employment_type],
      [
        'Senior Angular Developer - Remote',
        'GBP 60k–75k',
        'region_locked',
        'contract',
      ],
    );
    assertEquals(
      parseAdzunaJob({ ...job, salary_is_predicted: '1' }, 'GB')!.salary_text,
      '',
    );

    const calls: string[] = [];
    const r = await adzuna.run(
      ctx((u) => {
        calls.push(String(u));
        return Promise.resolve(
          new Response(JSON.stringify({ results: [job] })),
        );
      }),
    );
    // BD and AE are not Adzuna countries: only GB, once per term
    assertEquals(calls.length, 2);
    assert(calls.every((u) => u.includes('/jobs/gb/search/1')));
    assertEquals(r.postings.length, 1);
    await rejects(
      adzuna.run(ctx(fetch, { secret: () => undefined })),
      /ADZUNA_APP_ID and ADZUNA_APP_KEY not set/,
    );
  },
);

Deno.test(
  'Jooble: one key per country site; only countries with a key',
  async () => {
    const sent: { url: string; body: unknown }[] = [];
    const r = await jooble.run(
      ctx(
        (u, init) => {
          sent.push({ url: String(u), body: JSON.parse(String(init?.body)) });
          return Promise.resolve(
            new Response(
              JSON.stringify({
                jobs: [
                  {
                    id: 1,
                    title: '<b>Angular</b> Developer',
                    location: 'Dhaka',
                    snippet: 'Remote friendly',
                    salary: '',
                    link: 'https://bd.jooble.org/desc/1',
                    company: 'Shohoz',
                    updated: recent,
                    type: 'Full-time',
                  },
                ],
              }),
            ),
          );
        },
        { maxRequests: 3 },
      ),
    );
    // countries BD, GB, AE: AE has no key, so BD and GB (uk.jooble.org) only
    assertEquals(
      sent.map((s) => s.url),
      [
        'https://bd.jooble.org/api/jk-bd',
        'https://uk.jooble.org/api/jk-uk',
        'https://bd.jooble.org/api/jk-bd',
      ],
    );
    assertEquals(sent[0].body, { keywords: 'angular', page: '1' });
    assertEquals(r.postings.length, 1);
    const d = parseJoobleJob(
      {
        id: 2,
        title: 'Frontend Developer',
        location: 'Dhaka',
        link: 'https://jooble.org/desc/2',
        company: 'X',
      },
      'BD',
    )!;
    assertEquals(
      [d.remote_policy, d.source_country, d.location],
      ['onsite', 'BD', 'Dhaka'],
    );

    const none = await jooble.run(ctx(fetch, { countries: ['AE'] }));
    assertEquals(none.requests, 0);
    await rejects(
      jooble.run(ctx(fetch, { secret: () => undefined })),
      /JOOBLE_KEYS not set/,
    );
    const legacy = joobleKeys(
      ctx(fetch, {
        secret: (n) => (n === 'JOOBLE_API_KEY' ? 'us-key' : undefined),
      }),
    );
    assertEquals([...legacy.entries()], [['US', 'us-key']]);
    assertEquals(
      redact('https://bd.jooble.org/api/jk-bd'),
      'https://bd.jooble.org/api/***',
    );
  },
);

Deno.test(
  'Reed: UK dates, Basic auth, skipped when nobody can work in the UK',
  async () => {
    const d = parseReedJob({
      jobId: 55,
      employerName: 'Beta',
      jobTitle: 'Angular Developer (Remote)',
      locationName: 'Bristol',
      minimumSalary: 50000,
      maximumSalary: 60000,
      date: '05/11/2026',
      expirationDate: '17/12/2026',
      jobDescription: 'Angular',
      jobUrl: 'https://www.reed.co.uk/jobs/angular-developer/55',
    })!;
    assertEquals(
      [d.posted_at, d.expires_at, d.salary_text, d.remote_policy],
      [
        '2026-11-05T00:00:00.000Z',
        '2026-12-17T00:00:00.000Z',
        'GBP 50k–60k',
        'region_locked',
      ],
    );
    let auth = '';
    await reed.run(
      ctx((_u, init) => {
        auth = (init?.headers as Record<string, string>).authorization;
        return Promise.resolve(new Response(JSON.stringify({ results: [] })));
      }),
    );
    assertEquals(auth, `Basic ${btoa('rk:')}`);
    const none = await reed.run(ctx(fetch, { countries: ['BD'] }));
    assertEquals(none.requests, 0);
  },
);

Deno.test('keys never reach the run log', async () => {
  assertEquals(
    redact(
      'https://api.adzuna.com/v1/api/jobs/gb/search/1?app_id=id1&app_key=sekret&what=x',
    ),
    'https://api.adzuna.com/v1/api/jobs/gb/search/1?app_id=***&app_key=***&what=x',
  );
  assertEquals(
    redact('https://jooble.org/api/jk'),
    'https://jooble.org/api/***',
  );
  const r = await adzuna.run(
    ctx((u) =>
      Promise.resolve(
        String(u).includes('what=angular')
          ? new Response('', { status: 401 })
          : new Response('{"results":[]}'),
      ),
    ),
  );
  assert(r.warnings.length === 1 && !r.warnings[0].includes('sekret'));
});
