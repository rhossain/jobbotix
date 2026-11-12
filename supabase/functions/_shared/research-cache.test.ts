import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert';
import { emptyCompanyResearch, type CompanyResearch } from './company.ts';
import {
  readResearch,
  researchKey,
  sharable,
  SHARE_DAYS,
  sharedNote,
  writeResearch,
} from './research-cache.ts';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-12T10:00:00Z');
const FOUND: CompanyResearch = {
  ...emptyCompanyResearch(),
  summary: 'Globex builds analytics dashboards for logistics companies.',
  website: 'https://globex.com',
  headquarters: 'Berlin',
  size: 'about 120 people (2026)',
  remoteHiring: ['Hires contractors worldwide through an employer of record'],
  product: ['Fleet analytics, sold to carriers'],
  redFlags: ['Laid off 10% of staff in March 2026'],
  sources: [
    { title: 'Globex', url: 'https://globex.com/about' },
    {
      title: 'The posting',
      url: 'https://boards.greenhouse.io/globex/jobs/42?gh_src=x',
    },
    {
      title: 'Crunchbase',
      url: 'https://www.crunchbase.com/organization/globex',
    },
  ],
  // What the function adds for the person who asked; none of it is shared.
  researchedAt: '2026-11-12T10:00:00.000Z',
  method: 'ai',
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  webSearch: true,
  note: 'A note for the first person only',
};
const FROM = {
  postingUrl: 'https://boards.greenhouse.io/globex/jobs/42',
  webSearch: true,
  model: 'claude-sonnet-5-5',
};

/** A company_research_cache table in memory. */
function store(rows: Record<string, Record<string, unknown>> = {}) {
  let failing = false;
  const admin = {
    from(table: string) {
      assertEquals(table, 'company_research_cache');
      return {
        select: () => ({
          eq: (_c: string, key: string) => ({
            maybeSingle: () =>
              Promise.resolve(
                failing
                  ? { data: null, error: { message: 'down' } }
                  : { data: rows[key] ?? null, error: null },
              ),
          }),
        }),
        upsert: (row: Record<string, unknown>) => {
          if (failing) return Promise.resolve({ error: { message: 'down' } });
          rows[String(row['company_key'])] = row;
          return Promise.resolve({ error: null });
        },
        delete: () => ({
          lt: (_c: string, before: string) => {
            for (const [k, r] of Object.entries(rows))
              if (String(r['researched_at']) < before) delete rows[k];
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
  };
  // deno-lint-ignore no-explicit-any
  return { admin: admin as any, rows, fail: () => (failing = true) };
}

Deno.test('researchKey: one key for the ways a company name is written', () => {
  assertEquals(researchKey('Globex, Inc.'), researchKey('GLOBEX'));
  assertEquals(researchKey('  '), '');
  assertEquals(researchKey('X'), '');
});

Deno.test('sharable keeps what is about the company and drops the rest', () => {
  const s = sharable(FOUND, FROM)!;
  assertEquals(s['summary'], FOUND.summary);
  assertEquals(s['redFlags'], FOUND.redFlags);
  // The posting the first person was looking at is not passed on.
  assertEquals(s['sources'], [
    { title: 'Globex', url: 'https://globex.com/about' },
    {
      title: 'Crunchbase',
      url: 'https://www.crunchbase.com/organization/globex',
    },
  ]);
  for (const k of ['note', 'provider', 'method', 'researchedAt', 'webSearch'])
    assert(!(k in s), k);
  // Without a web search behind it, or without a summary, nothing is shared.
  assertEquals(sharable(FOUND, { ...FROM, webSearch: false }), null);
  assertEquals(sharable({ ...FOUND, summary: ' ' }, FROM), null);
});

Deno.test(
  'a research is stored once and read back for the same company',
  async () => {
    const s = store();
    await writeResearch(s.admin, 'Globex, Inc.', FOUND, FROM, NOW);
    const row = s.rows[researchKey('globex')];
    // The row names the company, the model and the date: no account, no posting.
    assertEquals(Object.keys(row).sort(), [
      'company_key',
      'model',
      'research',
      'researched_at',
    ]);
    assert(!JSON.stringify(row).includes('greenhouse'));

    const hit = await readResearch(s.admin, 'GLOBEX', { now: NOW + 3 * DAY });
    assertEquals(hit?.model, 'claude-sonnet-5-5');
    assertEquals(hit?.researchedAt, '2026-11-12T10:00:00.000Z');
    assertEquals(hit?.research.summary, FOUND.summary);
    assertEquals(hit?.research.sources.length, 2);
    assertEquals(await readResearch(s.admin, 'Initech', { now: NOW }), null);
  },
);

Deno.test(
  'a shared research is used for 30 days and not a day longer',
  async () => {
    const s = store();
    await writeResearch(s.admin, 'Globex', FOUND, FROM, NOW);
    assert(
      await readResearch(s.admin, 'Globex', { now: NOW + SHARE_DAYS * DAY }),
    );
    assertEquals(
      await readResearch(s.admin, 'Globex', {
        now: NOW + (SHARE_DAYS + 1) * DAY,
      }),
      null,
    );
  },
);

Deno.test(
  'a company of the same name on another site is not answered for',
  async () => {
    const s = store();
    await writeResearch(s.admin, 'Globex', FOUND, FROM, NOW);
    // The posting lives on the company's own site: it must be the same site.
    assert(
      await readResearch(s.admin, 'Globex', {
        now: NOW,
        site: 'https://careers.globex.com',
      }),
    );
    assertEquals(
      await readResearch(s.admin, 'Globex', {
        now: NOW,
        site: 'https://globex.io',
      }),
      null,
    );
    // On a job board there is no site to compare: the stored one is used.
    assert(await readResearch(s.admin, 'Globex', { now: NOW, site: '' }));
  },
);

Deno.test('research without a web search is never written', async () => {
  const s = store();
  await writeResearch(
    s.admin,
    'Globex',
    FOUND,
    { ...FROM, webSearch: false },
    NOW,
  );
  await writeResearch(s.admin, 'X', FOUND, FROM, NOW);
  assertEquals(s.rows, {});
});

Deno.test(
  'old rows are cleared on a write, and a store that is down costs nothing',
  async () => {
    const s = store({
      old: {
        company_key: 'old',
        research: { summary: 'x' },
        researched_at: new Date(NOW - 120 * DAY).toISOString(),
      },
    });
    await writeResearch(s.admin, 'Globex', FOUND, FROM, NOW);
    assertEquals(Object.keys(s.rows), ['globex']);
    s.fail();
    assertEquals(await readResearch(s.admin, 'Globex', { now: NOW }), null);
    await writeResearch(s.admin, 'Initech', FOUND, FROM, NOW);
    assertEquals(Object.keys(s.rows), ['globex']);
  },
);

Deno.test(
  'sharedNote says when it was researched and that it cost nothing',
  () => {
    assertEquals(
      sharedNote('Globex', '2026-11-03T21:15:00.000Z'),
      'Jobbotix researched Globex on 3 November 2026, so this needed no new search and used no credits. Refresh to search again.',
    );
  },
);
