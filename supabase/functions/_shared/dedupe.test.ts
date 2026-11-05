import { deepStrictEqual as assertEquals } from 'node:assert';
import { buildDedupeIndex, normaliseUrl, pairKey } from './dedupe.ts';

Deno.test('normaliseUrl drops query, hash, trailing slash and case', () => {
  assertEquals(
    normaliseUrl('https://Jobs.Example.com/role/123/?utm=x#top'),
    'https://jobs.example.com/role/123',
  );
  assertEquals(normaliseUrl('not a url'), 'not a url');
});

Deno.test('pairKey collapses whitespace and case', () => {
  assertEquals(
    pairKey('  Acme   Corp', 'Senior  ANGULAR Engineer '),
    'acme corp | senior angular engineer',
  );
});

Deno.test('buildDedupeIndex dedupes and counts', () => {
  const idx = buildDedupeIndex(
    [
      { url: 'https://a.example/1?x=1', company: 'Acme', title: 'Dev' },
      { url: 'https://a.example/1', company: 'ACME', title: 'dev' },
      { url: 'https://b.example/2', company: 'Beta', title: 'Lead' },
    ],
    [{ url: 'https://c.example/3/' }, { url: '' }],
  );
  assertEquals(idx.urls, ['https://a.example/1', 'https://b.example/2']);
  assertEquals(idx.pairs, ['acme | dev', 'beta | lead']);
  assertEquals(idx.excludedUrls, ['https://c.example/3']);
  assertEquals(idx.counts, { roles: 3, excluded: 2 });
});
