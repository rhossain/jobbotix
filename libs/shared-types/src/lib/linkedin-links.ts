/**
 * "Who do I know at this company?" and the links that open LinkedIn's own
 * search in the user's browser. Nothing here contacts LinkedIn: the links
 * are plain links the user clicks, and the matching runs on the connections
 * the user imported from their own LinkedIn archive.
 */

/**
 * Words that say what kind of company it is, not which one. Dropped from the
 * end of a name so "Acme", "Acme Inc." and "ACME, LLC" are one company.
 */
const LEGAL_WORDS = new Set([
  'inc',
  'incorporated',
  'llc',
  'llp',
  'lp',
  'ltd',
  'limited',
  'corp',
  'corporation',
  'co',
  'company',
  'gmbh',
  'ag',
  'plc',
  'pvt',
  'private',
  'pte',
  'pty',
  'sa',
  'sas',
  'srl',
  'bv',
  'nv',
  'oy',
  'ab',
  'aps',
  'kk',
  'sdn',
  'bhd',
]);

/**
 * Turned into spaces in a company name: ASCII punctuation and spacing, and
 * a few Unicode spaces, dashes, quotes and CJK punctuation. Letters of every
 * script are kept, so a name written in Japanese or Bengali still has a key.
 * public.company_key() lists the same characters.
 */
// Control characters are listed on purpose, to match the database rule.
/* eslint-disable no-control-regex */
const NOT_IN_A_NAME =
  /[\u0000-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007f\u00a0\u00b7\u2010\u2011\u2012\u2013\u2014\u2015\u2018\u2019\u201a\u201b\u201c\u201d\u201e\u201f\u2022\u2026\u3000\u3001\u3002\u30fb\uff08\uff09\uff0c\uff0e\uff06\uff0f\uff1a]+/g;
/* eslint-enable no-control-regex */

/**
 * The name a company is matched under: lower case (A-Z), "&" as "and", anything in
 * brackets gone, punctuation as spaces, a leading "the" and trailing legal
 * words dropped. '' for a name with nothing left.
 *
 * public.company_key() in the database (migration 0061) is the same rule;
 * the two are tested on the same names and must stay in step.
 */
export function companyKey(name: string): string {
  const words = name
    // only A-Z is lowered: the database lowers nothing else in every locale
    .replace(/[A-Z]/g, (c) => c.toLowerCase())
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    // ASCII punctuation and a few common Unicode marks become spaces; every
    // other letter (Japanese, Arabic, Bengali, accented Latin…) is kept
    .replace(NOT_IN_A_NAME, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (words.length > 1 && words[0] === 'the') words.shift();
  while (words.length > 1 && LEGAL_WORDS.has(words[words.length - 1]))
    words.pop();
  return words.join(' ');
}

/** LinkedIn's own people search for a company, to open in a new tab. */
export function linkedInPeopleSearchUrl(company: string): string {
  const q = new URLSearchParams({ keywords: company.trim().slice(0, 100) });
  return `https://www.linkedin.com/search/results/people/?${q}`;
}

/**
 * LinkedIn's own job search for a job title, to open in a new tab.
 * `location` is a country or city name; `remote` asks for remote jobs only.
 */
export function linkedInJobSearchUrl(o: {
  keywords: string;
  location?: string;
  remote?: boolean;
}): string {
  const q = new URLSearchParams({ keywords: o.keywords.trim().slice(0, 100) });
  if (o.location?.trim()) q.set('location', o.location.trim().slice(0, 100));
  // LinkedIn's own filter for "Remote" in its workplace-type menu
  if (o.remote) q.set('f_WT', '2');
  return `https://www.linkedin.com/jobs/search/?${q}`;
}
