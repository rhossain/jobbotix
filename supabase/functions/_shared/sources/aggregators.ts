// Country-scoped aggregators with free keys. They search the countries users
// live in or can work for (AdapterContext.countries), so they are what makes
// the country filter worth having. Keys are Edge Function secrets, never in
// the database; a missing key fails the run with a plain message, and each
// source stays disabled in source_catalog until its key is set.
//
//   adzuna   GET https://api.adzuna.com/v1/api/jobs/<cc>/search/1?app_id&app_key&what   ADZUNA_APP_ID, ADZUNA_APP_KEY
//            19 countries; free tier about 1,000 calls a month
//   jooble   POST https://<cc>.jooble.org/api/<key> {keywords}                            JOOBLE_KEYS
//            one key per country site ("BD=key1,AE=key2"); a key only sees its country
//            60+ countries (Bangladesh included); per-key limits
//   reed     GET https://www.reed.co.uk/api/1.0/search?keywords (Basic auth)               REED_API_KEY
//            United Kingdom only; runs only when a user can work in GB
//
// Most of their postings are on-site. A posting whose title or location says
// remote becomes "remote within that country"; hybrid and on-site keep the
// country as source_country, so users who allow local on-site work get them.

import { fetcher, keepRecent } from './http.ts';
import {
  descriptionText,
  draft,
  employmentType,
  isHttp,
  num,
  salaryText,
  text,
  toIso,
} from './normalise.ts';
import type {
  AdapterContext,
  DraftPosting,
  RemotePolicy,
  SourceAdapter,
} from './types.ts';

type Json = Record<string, unknown>;

const REMOTE =
  /\b(remote|work from home|wfh|home[- ]?based|telecommute|distributed|anywhere)\b/i;
const WORLDWIDE =
  /\b(worldwide|anywhere in the world|global(ly)? remote|remote[, -]+(global|worldwide))\b/i;
const HYBRID = /\bhybrid\b/i;

/** Where a country-scoped posting can be done from, read from its own words. */
export function workFrom(
  title: string,
  location: string,
  description: string,
  country: string,
): Pick<DraftPosting, 'remote_policy' | 'hiring_countries' | 'source_country'> {
  const head = `${title} ${location}`;
  let policy: RemotePolicy = 'onsite';
  if (HYBRID.test(head)) policy = 'hybrid';
  else if (WORLDWIDE.test(head) || WORLDWIDE.test(description.slice(0, 1500)))
    policy = 'worldwide';
  else if (REMOTE.test(head)) policy = 'region_locked';
  return {
    remote_policy: policy,
    hiring_countries: policy === 'worldwide' ? [] : [country],
    source_country: country,
  };
}

const CURRENCY: Record<string, string> = {
  GB: 'GBP',
  US: 'USD',
  CA: 'CAD',
  AU: 'AUD',
  NZ: 'NZD',
  DE: 'EUR',
  FR: 'EUR',
  NL: 'EUR',
  AT: 'EUR',
  BE: 'EUR',
  ES: 'EUR',
  IT: 'EUR',
  PL: 'PLN',
  IN: 'INR',
  SG: 'SGD',
  ZA: 'ZAR',
  BR: 'BRL',
  CH: 'CHF',
  MX: 'MXN',
};

/** Spread the request budget across countries first, then terms. */
function plan(
  countries: string[],
  queries: string[],
  budget: number,
): [string, string][] {
  const pairs: [string, string][] = [];
  for (const q of queries) for (const c of countries) pairs.push([c, q]);
  return pairs.slice(0, Math.max(0, budget));
}

const needKey = (ctx: AdapterContext, ...names: string[]): string[] => {
  const values = names.map((n) => ctx.secret?.(n) ?? '');
  const missing = names.filter((_, i) => !values[i]);
  if (missing.length)
    throw new Error(
      `${missing.join(' and ')} not set as Edge Function secrets`,
    );
  return values;
};

// ---------------------------------------------------------------------------
// Adzuna
// ---------------------------------------------------------------------------

export const ADZUNA_COUNTRIES = [
  'GB',
  'US',
  'CA',
  'AU',
  'DE',
  'FR',
  'NL',
  'PL',
  'IN',
  'SG',
  'ZA',
  'NZ',
  'AT',
  'BE',
  'BR',
  'CH',
  'ES',
  'IT',
  'MX',
];

export function parseAdzunaJob(j: Json, country: string): DraftPosting | null {
  const url = text(j.redirect_url, 1000);
  const company = text((j.company as Json | undefined)?.display_name, 200);
  const title = text(j.title, 200).replace(/<\/?strong>/g, '');
  if (!isHttp(url) || !company || !title) return null;
  const location = text((j.location as Json | undefined)?.display_name, 200);
  const description = descriptionText(text(j.description, 20_000));
  const predicted = String(j.salary_is_predicted ?? '0') === '1';
  const min = predicted ? null : num(j.salary_min);
  const max = predicted ? null : num(j.salary_max);
  const currency = min || max ? (CURRENCY[country] ?? '') : '';
  return draft({
    external_id: String(j.id ?? url),
    source_url: url,
    url,
    company,
    title,
    location: location || country,
    ...workFrom(title, location, description, country),
    employment_type: employmentType(j.contract_type),
    salary_min: min,
    salary_max: max,
    salary_currency: currency,
    salary_text: salaryText(min, max, currency),
    tags: [text((j.category as Json | undefined)?.label, 80)].filter(Boolean),
    description,
    posted_at: toIso(j.created),
  });
}

export const adzuna: SourceAdapter = {
  id: 'adzuna',
  async run(ctx: AdapterContext) {
    const [id, key] = needKey(ctx, 'ADZUNA_APP_ID', 'ADZUNA_APP_KEY');
    const countries = (ctx.countries ?? []).filter((c) =>
      ADZUNA_COUNTRIES.includes(c),
    );
    const f = fetcher(ctx, 1200);
    const out: (DraftPosting | null)[] = [];
    const days = Math.max(
      1,
      Math.ceil((Date.now() - ctx.since.getTime()) / 86_400_000),
    );
    for (const [c, q] of plan(countries, ctx.queries, ctx.maxRequests)) {
      const url =
        `https://api.adzuna.com/v1/api/jobs/${c.toLowerCase()}/search/1?app_id=${encodeURIComponent(id)}` +
        `&app_key=${encodeURIComponent(key)}&results_per_page=50&sort_by=date&max_days_old=${days}` +
        `&what=${encodeURIComponent(q)}&content-type=application/json`;
      const body = (await f.json(url)) as { results?: Json[] } | null;
      out.push(...(body?.results ?? []).map((j) => parseAdzunaJob(j, c)));
    }
    f.assertSomeSucceeded('Adzuna');
    return {
      postings: keepRecent(out, ctx.since),
      requests: f.requests,
      warnings: f.warnings.slice(0, 10),
    };
  },
};

// ---------------------------------------------------------------------------
// Jooble
// ---------------------------------------------------------------------------

const countryName = (code: string) =>
  new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;

export function parseJoobleJob(j: Json, country: string): DraftPosting | null {
  const url = text(j.link, 1000);
  const company = text(j.company, 200);
  const title = text(j.title, 200)
    .replace(/<\/?b>|&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!isHttp(url) || !company || !title) return null;
  const location = text(j.location, 200);
  const description = descriptionText(text(j.snippet, 20_000));
  return draft({
    external_id: String(j.id ?? url),
    source_url: url,
    url,
    company,
    title,
    location: location || countryName(country),
    ...workFrom(title, location, description, country),
    employment_type: employmentType(j.type),
    salary_text: text(j.salary, 100),
    tags: [text(j.source, 80)].filter(Boolean),
    description,
    posted_at: toIso(j.updated),
  });
}

/** Jooble's site for a country: jooble.org is the US, uk.jooble.org Britain. */
export const joobleHost = (cc: string) =>
  cc === 'US'
    ? 'jooble.org'
    : `${cc === 'GB' ? 'uk' : cc.toLowerCase()}.jooble.org`;

/** "BD=key1, AE=key2" -> {BD: key1, AE: key2}; a bare JOOBLE_API_KEY is the US site's. */
export function joobleKeys(ctx: AdapterContext): Map<string, string> {
  const keys = new Map<string, string>();
  for (const part of (ctx.secret?.('JOOBLE_KEYS') ?? '').split(/[,;\s]+/)) {
    const m = part.match(/^([A-Za-z]{2})[=:](.+)$/);
    if (m)
      keys.set(
        m[1].toUpperCase() === 'UK' ? 'GB' : m[1].toUpperCase(),
        m[2].trim(),
      );
  }
  const single = ctx.secret?.('JOOBLE_API_KEY');
  if (single && !keys.has('US')) keys.set('US', single);
  return keys;
}

export const jooble: SourceAdapter = {
  id: 'jooble',
  async run(ctx: AdapterContext) {
    const keys = joobleKeys(ctx);
    if (!keys.size)
      throw new Error(
        'JOOBLE_KEYS not set as an Edge Function secret (format: BD=key,AE=key)',
      );
    // Only the users' countries that have a key; each key sees only its own site.
    const countries = (ctx.countries ?? []).filter((c) => keys.has(c));
    if (!countries.length)
      return {
        postings: [],
        requests: 0,
        warnings: [
          `No Jooble key for the users' countries (keys for: ${[...keys.keys()].join(', ')})`,
        ],
      };
    const f = fetcher(ctx, 1200);
    const out: (DraftPosting | null)[] = [];
    for (const [c, q] of plan(countries, ctx.queries, ctx.maxRequests)) {
      const body = (await f.json(
        `https://${joobleHost(c)}/api/${encodeURIComponent(keys.get(c)!)}`,
        { method: 'POST', body: { keywords: q, page: '1' } },
      )) as { jobs?: Json[] } | null;
      out.push(...(body?.jobs ?? []).map((j) => parseJoobleJob(j, c)));
    }
    f.assertSomeSucceeded('Jooble');
    return {
      postings: keepRecent(out, ctx.since),
      requests: f.requests,
      warnings: f.warnings.slice(0, 10),
    };
  },
};

// ---------------------------------------------------------------------------
// Reed (United Kingdom)
// ---------------------------------------------------------------------------

/** Reed writes dates as dd/mm/yyyy. */
const ukDate = (v: unknown): string | null => {
  const m = text(v, 20).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}T00:00:00.000Z` : toIso(v);
};

export function parseReedJob(j: Json): DraftPosting | null {
  const url = text(j.jobUrl, 1000);
  const company = text(j.employerName, 200);
  const title = text(j.jobTitle, 200);
  if (!isHttp(url) || !company || !title) return null;
  const location = text(j.locationName, 200);
  const description = descriptionText(text(j.jobDescription, 20_000));
  const min = num(j.minimumSalary);
  const max = num(j.maximumSalary);
  const currency =
    text(j.currency, 8).toUpperCase() || (min || max ? 'GBP' : '');
  return draft({
    external_id: String(j.jobId ?? url),
    source_url: url,
    url,
    company,
    title,
    location: location || 'United Kingdom',
    ...workFrom(title, location, description, 'GB'),
    salary_min: min,
    salary_max: max,
    salary_currency: currency,
    salary_text: salaryText(min, max, currency),
    description,
    posted_at: ukDate(j.date),
    expires_at: ukDate(j.expirationDate),
  });
}

export const reed: SourceAdapter = {
  id: 'reed',
  async run(ctx: AdapterContext) {
    if (!(ctx.countries ?? []).includes('GB'))
      return {
        postings: [],
        requests: 0,
        warnings: ['No user can work in the United Kingdom; skipped'],
      };
    const [key] = needKey(ctx, 'REED_API_KEY');
    const f = fetcher(ctx, 1000);
    const auth = `Basic ${btoa(`${key}:`)}`;
    const out: (DraftPosting | null)[] = [];
    for (const q of ctx.queries.slice(0, ctx.maxRequests)) {
      const body = (await f.json(
        `https://www.reed.co.uk/api/1.0/search?keywords=${encodeURIComponent(q)}&resultsToTake=100`,
        { headers: { authorization: auth } },
      )) as { results?: Json[] } | null;
      out.push(...(body?.results ?? []).map(parseReedJob));
    }
    f.assertSomeSucceeded('Reed');
    return {
      postings: keepRecent(out, ctx.since),
      requests: f.requests,
      warnings: f.warnings.slice(0, 10),
    };
  },
};
