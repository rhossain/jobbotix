import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert';
import {
  canonicalUrl,
  extractionKey,
  MAX_AGE_DAYS,
  readExtraction,
  writeExtraction,
  type Extraction,
} from './extract-cache.ts';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-12T10:00:00Z');
const FIELDS: Extraction = {
  company: 'Globex',
  title: 'Senior Angular Engineer',
  location: 'Remote, worldwide',
  type: 'full_time',
  salary: '$90k-$120k',
  stack: ['Angular', 'RxJS'],
  posted: '2026-11-01',
  summary: 'Builds dashboards.',
};

/** A posting_extractions table in memory. */
function store(rows: Record<string, Record<string, unknown>> = {}) {
  const calls: string[] = [];
  let failing = false;
  const admin = {
    from(table: string) {
      assertEquals(table, 'posting_extractions');
      return {
        select: () => ({
          eq: (_c: string, key: string) => ({
            maybeSingle: () => {
              calls.push('read');
              return Promise.resolve(
                failing
                  ? { data: null, error: { message: 'down' } }
                  : { data: rows[key] ?? null, error: null },
              );
            },
          }),
        }),
        upsert: (row: Record<string, unknown>) => {
          calls.push('write');
          if (failing) return Promise.resolve({ error: { message: 'down' } });
          rows[String(row['key'])] = row;
          return Promise.resolve({ error: null });
        },
        delete: () => ({
          lt: (_c: string, before: string) => {
            calls.push('prune');
            for (const [k, r] of Object.entries(rows))
              if (String(r['created_at']) < before) delete rows[k];
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
  };
  return {
    // deno-lint-ignore no-explicit-any
    admin: admin as any,
    rows,
    calls,
    fail: () => (failing = true),
  };
}

Deno.test(
  'canonicalUrl drops what varies by visitor and keeps what picks the posting',
  () => {
    assertEquals(
      canonicalUrl(
        'https://WWW.Globex.com/careers/123/?utm_source=x&gh_jid=42&ref=tw#apply',
      ),
      'https://globex.com/careers/123?gh_jid=42',
    );
    // The order of the parameters does not matter.
    assertEquals(
      canonicalUrl('https://jobs.example.com/view?b=2&a=1'),
      canonicalUrl('https://jobs.example.com/view?a=1&b=2&fbclid=zzz'),
    );
    assertEquals(canonicalUrl('https://globex.com'), 'https://globex.com/');
    assertEquals(canonicalUrl('not a url'), 'not a url');
  },
);

Deno.test(
  'extractionKey: the same posting gives the same key, another text another',
  async () => {
    const a = await extractionKey(
      'https://globex.com/jobs/1?utm_source=newsletter',
      'Senior Angular Engineer\n\n  Remote,   worldwide.',
    );
    const b = await extractionKey(
      'https://www.globex.com/jobs/1/',
      'Senior Angular Engineer Remote, worldwide.',
    );
    assertEquals(a, b);
    assert(/^[0-9a-f]{64}$/.test(a));
    // A careers page with another job pasted in is another posting.
    assert(
      a !==
        (await extractionKey(
          'https://globex.com/jobs/1',
          'Backend Engineer, Go.',
        )),
    );
    // And the same text at another address is, too.
    assert(
      a !==
        (await extractionKey(
          'https://globex.com/jobs/2',
          'Senior Angular Engineer Remote, worldwide.',
        )),
    );
  },
);

Deno.test(
  'a stored extraction is written once and read back through the parser',
  async () => {
    const s = store();
    await writeExtraction(
      s.admin,
      'k1',
      FIELDS,
      { provider: 'anthropic', model: 'claude-haiku-5-5' },
      NOW,
    );
    assertEquals(s.rows['k1']['provider'], 'anthropic');
    assertEquals(s.rows['k1']['model'], 'claude-haiku-5-5');
    // The row says what the posting says and who read it, not who added it.
    assertEquals(Object.keys(s.rows['k1']).sort(), [
      'created_at',
      'extraction',
      'key',
      'model',
      'provider',
    ]);
    assertEquals(await readExtraction(s.admin, 'k1', NOW + DAY), FIELDS);
    assertEquals(await readExtraction(s.admin, 'other', NOW), null);
  },
);

Deno.test('an extraction older than the limit is not used', async () => {
  const s = store();
  await writeExtraction(
    s.admin,
    'k1',
    FIELDS,
    { provider: 'groq', model: 'm' },
    NOW,
  );
  assert(await readExtraction(s.admin, 'k1', NOW + MAX_AGE_DAYS * DAY));
  assertEquals(
    await readExtraction(s.admin, 'k1', NOW + (MAX_AGE_DAYS + 1) * DAY),
    null,
  );
  // A row dated in the future (a clock that was wrong) is not trusted either.
  assertEquals(await readExtraction(s.admin, 'k1', NOW - DAY), null);
});

Deno.test('a row that does not read as an extraction is ignored', async () => {
  const s = store({
    junk: {
      extraction: { company: 7, stack: 'Angular' },
      created_at: new Date(NOW).toISOString(),
    },
    odd: {
      extraction: {
        title: 'Engineer',
        type: 'internship',
        stack: ['A', 3, 'B'],
      },
      created_at: new Date(NOW).toISOString(),
    },
  });
  // Nothing usable: no title and no company.
  assertEquals(await readExtraction(s.admin, 'junk', NOW), null);
  // Usable, and cleaned the way a model reply is: an unknown type falls back.
  const odd = await readExtraction(s.admin, 'odd', NOW);
  assertEquals(odd?.type, 'full_time');
  assertEquals(odd?.stack, ['A', 'B']);
});

Deno.test(
  'an empty extraction is not stored, and old rows are cleared on a write',
  async () => {
    const s = store({
      old: {
        key: 'old',
        extraction: FIELDS,
        created_at: new Date(NOW - 120 * DAY).toISOString(),
      },
      recent: {
        key: 'recent',
        extraction: FIELDS,
        created_at: new Date(NOW - 40 * DAY).toISOString(),
      },
    });
    await writeExtraction(
      s.admin,
      'empty',
      { ...FIELDS, company: '', title: '' },
      { provider: 'groq', model: 'm' },
      NOW,
    );
    assertEquals(s.calls, []);
    await writeExtraction(
      s.admin,
      'k1',
      FIELDS,
      { provider: 'groq', model: 'm' },
      NOW,
    );
    assertEquals(Object.keys(s.rows).sort(), ['k1', 'recent']);
  },
);

Deno.test(
  'a store that is down costs nothing: no read, no write, no throw',
  async () => {
    const s = store();
    s.fail();
    assertEquals(await readExtraction(s.admin, 'k1', NOW), null);
    await writeExtraction(
      s.admin,
      'k1',
      FIELDS,
      { provider: 'groq', model: 'm' },
      NOW,
    );
    assertEquals(s.rows, {});
  },
);
