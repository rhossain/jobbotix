// One contract for every source adapter: a job outside tech that some user
// is looking for must come out of the adapter. A source that filters by
// profession (a fixed category, an engineering-only title filter) fails
// here, and so does a new adapter added to the registry without a fixture.
//
// Each fixture is the board's own response shape with a "Registered Nurse"
// posting in it; the context says a user's target role is "Registered Nurse".

import { ok as assert } from 'node:assert';
import { ADAPTERS } from './registry.ts';
import type { AdapterContext } from './types.ts';

const now = Date.now();
const posted = new Date(now - 86_400_000);
const iso = posted.toISOString();
const epoch = Math.floor(posted.getTime() / 1000);
const uk = `${String(posted.getUTCDate()).padStart(2, '0')}/${String(posted.getUTCMonth() + 1).padStart(2, '0')}/${posted.getUTCFullYear()}`;
const TITLE = 'Registered Nurse';
const json = (body: unknown) => new Response(JSON.stringify(body));

/** What each board answers, by adapter id. */
const FIXTURES: Record<string, (url: string) => Response> = {
  himalayas: () =>
    json({
      jobs: [
        {
          title: TITLE,
          companyName: 'Carewell',
          companySlug: 'carewell',
          employmentType: 'Full Time',
          locationRestrictions: [],
          categories: ['Nursing'],
          parentCategories: ['Healthcare'],
          description: '<p>Telehealth nursing.</p>',
          pubDate: epoch,
          expiryDate: epoch + 30 * 86_400,
          applicationLink: 'https://carewell.example/jobs/1',
          guid: 'https://himalayas.app/companies/carewell/jobs/registered-nurse',
        },
      ],
    }),
  jobicy: () =>
    json({
      jobs: [
        {
          id: 1,
          url: 'https://jobicy.com/jobs/1-registered-nurse',
          jobTitle: TITLE,
          companyName: 'Carewell',
          jobIndustry: ['Healthcare'],
          jobType: ['full-time'],
          jobGeo: 'Anywhere',
          jobDescription: '<p>Telehealth nursing.</p>',
          pubDate: iso.slice(0, 19).replace('T', ' '),
        },
      ],
    }),
  remoteok: () =>
    json([
      { legal: 'terms' },
      {
        id: '1',
        slug: 'remote-registered-nurse-carewell-1',
        epoch,
        date: iso,
        company: 'Carewell',
        position: TITLE,
        tags: ['healthcare'],
        description: '<p>Telehealth nursing.</p>',
        location: 'Worldwide',
        url: 'https://remoteOK.com/remote-jobs/remote-registered-nurse-carewell-1',
      },
    ]),
  workingnomads: () =>
    json([
      {
        url: 'https://www.workingnomads.com/jobs/registered-nurse-carewell',
        title: TITLE,
        description: 'Telehealth nursing',
        company_name: 'Carewell',
        category_name: 'Healthcare',
        tags: 'nursing',
        location: 'Anywhere',
        pub_date: iso,
      },
    ]),
  arbeitnow: (url) =>
    json({
      data: /page=([2-9])/.test(url)
        ? []
        : [
            {
              slug: 'registered-nurse-1',
              company_name: 'Carewell GmbH',
              title: TITLE,
              description: '<p>Remote in Germany</p>',
              remote: true,
              url: 'https://www.arbeitnow.com/jobs/companies/carewell/registered-nurse-1',
              tags: ['Nursing'],
              job_types: ['full time'],
              location: 'Germany',
              created_at: epoch,
            },
          ],
    }),
  remotive: () =>
    json({
      jobs: [
        {
          id: 1,
          url: 'https://remotive.com/remote-jobs/medical/registered-nurse-1',
          title: TITLE,
          company_name: 'Carewell',
          category: 'Medical',
          tags: ['nursing'],
          job_type: 'full_time',
          publication_date: iso.slice(0, 19),
          candidate_required_location: 'Worldwide',
          description: '<p>Telehealth nursing.</p>',
        },
      ],
    }),
  weworkremotely: () =>
    new Response(`<?xml version="1.0"?><rss><channel><title>WWR</title>
<item>
  <title>Carewell: ${TITLE}</title>
  <region>Anywhere in the World</region>
  <type>Full-Time</type>
  <category>All Other Remote</category>
  <description><![CDATA[<p>Telehealth nursing.</p>]]></description>
  <pubDate>${posted.toUTCString()}</pubDate>
  <guid>https://weworkremotely.com/remote-jobs/carewell-registered-nurse</guid>
  <link>https://weworkremotely.com/remote-jobs/carewell-registered-nurse</link>
</item></channel></rss>`),
  getonboard: () =>
    json({
      data: [
        {
          id: 'registered-nurse-carewell',
          type: 'job',
          attributes: {
            title: TITLE,
            description: '<p>Telehealth nursing.</p>',
            remote: true,
            remote_modality: 'fully_remote',
            countries: ['Chile'],
            category_name: 'Other',
            published_at: epoch,
            company: { data: { attributes: { name: 'Carewell' } } },
          },
          links: {
            public_url:
              'https://www.getonbrd.com/jobs/registered-nurse-carewell',
          },
        },
      ],
      meta: { page: 1, per_page: 100, total_pages: 1 },
    }),
  fourdayweek: () =>
    json({
      data: [
        {
          id: 'n1',
          title: TITLE,
          description: 'Telehealth nursing.',
          url: 'https://4dayweek.io/job/registered-nurse-at-carewell',
          category: 'other',
          contract_type: 'permanent',
          work_arrangement: 'remote',
          locations: [{ country: 'United Kingdom' }],
          posted_at: iso,
          company: { name: 'Carewell', hires_worldwide: false },
        },
      ],
    }),
  realworkfromanywhere: () =>
    new Response(`<rss><channel><item>
  <title><![CDATA[${TITLE} at Carewell]]></title>
  <description><![CDATA[<p>Telehealth nursing.</p>]]></description>
  <link>https://www.realworkfromanywhere.com/jobs/registered-nurse-carewell-1</link>
  <guid>https://www.realworkfromanywhere.com/jobs/registered-nurse-carewell-1</guid>
  <pubDate>${posted.toUTCString()}</pubDate>
  <author><![CDATA[Carewell]]></author>
</item></channel></rss>`),
  remotefirstjobs: () =>
    new Response(`<rss><channel><item>
  <title>${TITLE} at Carewell</title>
  <link>https://remotefirstjobs.com/companies/carewell/jobs/registered-nurse-1</link>
  <description>&lt;p&gt;Telehealth nursing.&lt;/p&gt;</description>
  <guid isPermaLink="true">registered-nurse-1</guid>
  <pubDate>${posted.toUTCString()}</pubDate>
</item></channel></rss>`),
  hn: (url) =>
    url.includes('/search_by_date')
      ? json({
          hits: [
            {
              objectID: '1',
              title: `Ask HN: Who is hiring? (${posted.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} ${posted.getUTCFullYear()})`,
            },
          ],
        })
      : json({
          children: [
            {
              id: 11,
              text: `Carewell | ${TITLE} | Remote (US) | Full-time<p>Telehealth nursing team. Apply: https://carewell.example/jobs`,
              created_at: iso,
            },
          ],
        }),
  adzuna: () =>
    json({
      results: [
        {
          id: '1',
          title: `${TITLE} - Remote`,
          description: 'Telehealth nursing',
          created: iso,
          redirect_url: 'https://www.adzuna.co.uk/jobs/details/1',
          company: { display_name: 'Carewell Ltd' },
          location: { display_name: 'London, UK' },
        },
      ],
    }),
  jooble: () =>
    json({
      jobs: [
        {
          id: 1,
          title: TITLE,
          location: 'London',
          snippet: 'Remote friendly',
          salary: '',
          link: 'https://uk.jooble.org/desc/1',
          company: 'Carewell',
          updated: iso,
          type: 'Full-time',
        },
      ],
    }),
  reed: () =>
    json({
      results: [
        {
          jobId: 1,
          employerName: 'Carewell',
          jobTitle: `${TITLE} (Remote)`,
          locationName: 'Bristol',
          date: uk,
          jobDescription: 'Telehealth nursing',
          jobUrl: 'https://www.reed.co.uk/jobs/registered-nurse/1',
        },
      ],
    }),
  ats: () =>
    json({
      jobs: [
        {
          id: 1,
          title: TITLE,
          absolute_url: 'https://boards.greenhouse.io/carewell/jobs/1',
          location: { name: 'Remote' },
          updated_at: iso,
        },
      ],
    }),
};

const ctx = (id: string): AdapterContext => ({
  queries: ['nurse'],
  roles: [TITLE],
  since: new Date(now - 7 * 86_400_000),
  maxRequests: 4,
  fetch: ((u: string | URL | Request) =>
    Promise.resolve(FIXTURES[id](String(u)))) as typeof fetch,
  sleep: () => Promise.resolve(),
  countries: ['GB'],
  secret: (n) =>
    ({
      ADZUNA_APP_ID: 'id',
      ADZUNA_APP_KEY: 'key',
      JOOBLE_KEYS: 'GB=key',
      REED_API_KEY: 'key',
    })[n],
  companies: [
    { id: 'c1', kind: 'greenhouse', slug: 'carewell', name: 'Carewell' },
  ],
});

for (const id of Object.keys(ADAPTERS)) {
  Deno.test(
    `${id} keeps a job outside tech that a user is looking for`,
    async () => {
      assert(
        FIXTURES[id],
        `No contract fixture for "${id}": add its response shape with a "${TITLE}" posting to contract.test.ts`,
      );
      const r = await ADAPTERS[id].run(ctx(id));
      assert(
        r.postings.some((p) => p.title.includes(TITLE)),
        `${id} dropped "${TITLE}" (kept: ${r.postings.map((p) => p.title).join(', ') || 'nothing'}; warnings: ${r.warnings.join('; ') || 'none'})`,
      );
    },
  );
}
