export interface DedupeIndex {
  /** Normalised URLs already tracked (lower-cased, no query string or trailing slash). */
  urls: string[];
  /** "company | title", lower-cased and whitespace-collapsed. */
  pairs: string[];
  /** Normalised URLs excluded by earlier runs; a run should not re-fetch them. */
  excludedUrls: string[];
  counts: { roles: number; excluded: number };
}

export function normaliseUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = '';
    u.search = '';
    let s = `${u.protocol}//${u.host}${u.pathname}`.toLowerCase();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return url.trim().toLowerCase();
  }
}

export function pairKey(company: string, title: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return `${norm(company)} | ${norm(title)}`;
}

export function buildDedupeIndex(
  roles: { url: string; company: string; title: string }[],
  excluded: { url: string }[],
): DedupeIndex {
  const urls = [...new Set(roles.map((r) => normaliseUrl(r.url)))];
  const pairs = [...new Set(roles.map((r) => pairKey(r.company, r.title)))];
  const excludedUrls = [
    ...new Set(excluded.map((e) => normaliseUrl(e.url)).filter(Boolean)),
  ];
  return {
    urls,
    pairs,
    excludedUrls,
    counts: { roles: roles.length, excluded: excluded.length },
  };
}
