import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert';
import {
  decodeEntities,
  hn,
  parseHnComment,
  parseWwrItem,
  rssItems,
  weworkremotely,
} from './feeds.ts';
import type { AdapterContext } from './types.ts';

const since = new Date('2026-11-01T00:00:00Z');
const ctx = (fake: typeof fetch): AdapterContext => ({
  queries: [],
  since,
  maxRequests: 5,
  fetch: fake,
  sleep: () => Promise.resolve(),
});

const RSS = `<?xml version="1.0"?><rss><channel><title>WWR</title>
<item>
  <title>Acme Inc: Senior Angular Engineer</title>
  <region>Anywhere in the World</region>
  <country>Worldwide</country>
  <type>Full-Time</type>
  <category>Front-End Programming</category>
  <skills>Angular, TypeScript</skills>
  <description><![CDATA[<p>Build &amp; ship <b>Angular</b> apps.</p>]]></description>
  <pubDate>Wed, 05 Nov 2026 14:00:00 +0000</pubDate>
  <guid>https://weworkremotely.com/remote-jobs/acme-senior-angular-engineer</guid>
  <link>https://weworkremotely.com/remote-jobs/acme-senior-angular-engineer</link>
</item>
<item>
  <title>Beta &amp; Co: Frontend Developer</title>
  <region>USA Only</region>
  <type>Contract</type>
  <description>&lt;p&gt;React&lt;/p&gt;</description>
  <pubDate>Mon, 03 Nov 2026 09:00:00 +0000</pubDate>
  <link>https://weworkremotely.com/remote-jobs/beta-frontend-developer</link>
</item>
<item><title>No colon here</title><link>https://weworkremotely.com/x</link></item>
</channel></rss>`;

Deno.test('rssItems reads plain, entity and CDATA fields', () => {
  const items = rssItems(RSS);
  assertEquals(items.length, 3);
  assertEquals(items[1].title, 'Beta & Co: Frontend Developer');
  assertEquals(
    items[0].description,
    '<p>Build &amp; ship <b>Angular</b> apps.</p>',
  );
  assertEquals(decodeEntities('a &#x2F; b &#39;c&#39;'), "a / b 'c'");
});

Deno.test('We Work Remotely items: company and title, region, type', () => {
  const [a, b, c] = rssItems(RSS).map(parseWwrItem);
  assertEquals(
    [a!.company, a!.title, a!.remote_policy],
    ['Acme Inc', 'Senior Angular Engineer', 'worldwide'],
  );
  assertEquals(a!.tags, ['Front-End Programming', 'Angular', 'TypeScript']);
  assert(a!.description.includes('Build & ship Angular apps'));
  assertEquals(a!.posted_at, '2026-11-05T14:00:00.000Z');
  assertEquals(
    [b!.remote_policy, b!.hiring_countries, b!.employment_type],
    ['region_locked', ['US'], 'contract'],
  );
  assert(b!.description.includes('React') && !b!.description.includes('<p>'));
  assertEquals(c, null);
});

Deno.test('We Work Remotely adapter reads both category feeds', async () => {
  const calls: string[] = [];
  const r = await weworkremotely.run(
    ctx((u) => {
      calls.push(String(u));
      return Promise.resolve(new Response(RSS));
    }),
  );
  assertEquals(calls.length, 2);
  assertEquals(r.postings.length, 2); // same two items in both feeds, merged by guid/link
});

const comment = (id: number, text: string) => ({
  id,
  text,
  created_at: '2026-11-03T15:00:00.000Z',
});

Deno.test('HN: the usual header shape', () => {
  const d = parseHnComment(
    comment(
      1,
      'Acme (YC W21) | Senior Frontend Engineer (Angular) | REMOTE (Worldwide) | $120k&#x2F;yr<p>We build things. Apply: <a href="https:&#x2F;&#x2F;boards.greenhouse.io&#x2F;acme&#x2F;jobs&#x2F;9" rel="nofollow">here</a>',
    ),
  )!;
  assertEquals(
    [d.company, d.title],
    ['Acme', 'Senior Frontend Engineer (Angular)'],
  );
  assertEquals(d.remote_policy, 'worldwide');
  assertEquals(d.salary_text, '$120k/yr');
  assertEquals(d.url, 'https://boards.greenhouse.io/acme/jobs/9');
  assertEquals(d.source_url, 'https://news.ycombinator.com/item?id=1');
  assert(d.description.includes('We build things'));
});

Deno.test(
  'HN: remote with a country, on-site, hybrid, and posts without a role',
  () => {
    const us = parseHnComment(
      comment(2, 'Beta | Full-Stack Engineer | REMOTE (US) | Full-time<p>x'),
    )!;
    assertEquals(
      [us.remote_policy, us.hiring_countries],
      ['region_locked', ['US']],
    );
    const eu = parseHnComment(
      comment(3, 'Gamma | Berlin, Germany or Remote | Backend Developer<p>x'),
    )!;
    assertEquals(eu.title, 'Backend Developer');
    const onsite = parseHnComment(
      comment(4, 'Delta | Software Engineer | ONSITE | London, UK<p>x'),
    )!;
    assertEquals(
      [onsite.remote_policy, onsite.source_country],
      ['onsite', 'GB'],
    );
    const hybrid = parseHnComment(
      comment(5, 'Eps | Frontend Engineer | Hybrid | New York<p>x'),
    )!;
    assertEquals(hybrid.remote_policy, 'hybrid');
    assertEquals(
      parseHnComment(comment(6, 'We are hiring lots of people, email me<p>x')),
      null,
    );
    assertEquals(
      parseHnComment(comment(7, 'Zeta | Hiring | Remote<p>x')),
      null,
    );
    assertEquals(parseHnComment({ id: 8, text: null }), null);
  },
);

Deno.test(
  'HN adapter: finds the latest Who is hiring thread, keeps recent posts',
  async () => {
    const calls: string[] = [];
    const r = await hn.run(
      ctx((u) => {
        const url = String(u);
        calls.push(url);
        if (url.includes('search_by_date'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                hits: [
                  {
                    objectID: '100',
                    title: 'Ask HN: Who wants to be hired? (November 2026)',
                  },
                  {
                    objectID: '200',
                    title: 'Ask HN: Who is hiring? (November 2026)',
                  },
                ],
              }),
            ),
          );
        return Promise.resolve(
          new Response(
            JSON.stringify({
              children: [
                comment(11, 'Acme | Senior Angular Developer | REMOTE<p>x'),
                {
                  ...comment(12, 'Old | Frontend Engineer | REMOTE<p>x'),
                  created_at: '2026-10-02T00:00:00.000Z',
                },
              ],
            }),
          ),
        );
      }),
    );
    assertEquals(calls[1], 'https://hn.algolia.com/api/v1/items/200');
    assertEquals(
      r.postings.map((p) => p.company),
      ['Acme'],
    );
  },
);

Deno.test('HN: remote country lists, "anywhere", and US cities', () => {
  const multi = parseHnComment(
    comment(
      20,
      'Oscilar | Sr/Staff Software Engineers | REMOTE (US/Canada/Brazil/Poland/UK)<p>x',
    ),
  )!;
  assertEquals(
    [multi.remote_policy, multi.hiring_countries],
    ['region_locked', ['US', 'CA', 'BR', 'PL', 'GB']],
  );
  const anywhere = parseHnComment(
    comment(
      21,
      'Search Atlas | Product Engineer | REMOTE (anywhere, EST hours)<p>x',
    ),
  )!;
  assertEquals(anywhere.remote_policy, 'worldwide');
  const eu = parseHnComment(
    comment(
      22,
      'Sortrace | Frontend Engineer | REMOTE (Europe), hybrid Norrköping<p>x',
    ),
  )!;
  assertEquals(
    [eu.remote_policy, eu.hiring_regions],
    ['region_locked', ['europe']],
  );
  const la = parseHnComment(
    comment(23, 'Zefr | Site Reliability Engineer | Los Angeles, CA<p>x'),
  )!;
  assertEquals(
    [la.remote_policy, la.hiring_countries, la.source_country],
    ['onsite', ['US'], 'US'],
  );
});
