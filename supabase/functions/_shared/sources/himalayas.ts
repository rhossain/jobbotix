// Himalayas (himalayas.app): remote jobs, public JSON, no key.
//
//   GET https://himalayas.app/jobs/api/search?q=<term>&sort=recent&page=<n>
//   GET https://himalayas.app/jobs/api?limit=20&offset=<n>      (latest, unfiltered)
//
// Every Himalayas job is remote; locationRestrictions lists the countries or
// regions it is open to, and an empty list means worldwide. Their terms ask
// for a link back to the Himalayas page and no re-posting to other job sites,
// so the board page is kept as source_url and is what users open.
//
// The parser is deliberately tolerant: fields are read under every name the
// API has used, and a job missing company, title or a link is dropped rather
// than failing the run.

import { parseLocations } from '../countries.ts';
import {
  descriptionText,
  employmentType,
  num,
  salaryText,
  text,
  textList,
  toIso,
} from './normalise.ts';
import {
  USER_AGENT,
  type AdapterContext,
  type AdapterResult,
  type DraftPosting,
  type SourceAdapter,
} from './types.ts';

const BASE = 'https://himalayas.app';
const PAGE_DELAY_MS = 400;
const MAX_PAGES_PER_QUERY = 3;

type Json = Record<string, unknown>;

const isHttp = (s: string) => /^https?:\/\//i.test(s);

function names(v: unknown): string[] {
  if (!Array.isArray(v)) return typeof v === 'string' && v.trim() ? [v] : [];
  return v
    .map((x) =>
      typeof x === 'string'
        ? x
        : x && typeof x === 'object'
          ? String((x as Json).name ?? '')
          : '',
    )
    .filter(Boolean);
}

function timezoneText(v: unknown): string {
  if (!Array.isArray(v) || !v.length) return '';
  const offs = v
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (!offs.length) return '';
  const fmt = (n: number) => `UTC${n >= 0 ? '+' : ''}${n}`;
  return offs.length === 1
    ? fmt(offs[0])
    : `${fmt(offs[0])} to ${fmt(offs[offs.length - 1])}`;
}

/** One Himalayas job object to a draft pool row; null when it is unusable. */
export function parseHimalayasJob(j: Json): DraftPosting | null {
  const company = text(
    j.companyName ?? (j.company as Json | undefined)?.name,
    200,
  );
  const title = text(j.title, 200);
  const companySlug = text(
    j.companySlug ?? (j.company as Json | undefined)?.slug,
    100,
  );
  const slug = text(j.slug, 200);
  const guid = text(j.guid ?? j.url ?? j.jobUrl, 1000);
  const pageUrl = isHttp(guid)
    ? guid
    : companySlug && slug
      ? `${BASE}/companies/${companySlug}/jobs/${slug}`
      : '';
  const applyRaw = text(
    j.applicationLink ?? j.applyUrl ?? j.applicationUrl,
    1000,
  );
  const applyUrl = isHttp(applyRaw) ? applyRaw : pageUrl;
  if (!company || !title || !applyUrl) return null;

  const restrictions = names(j.locationRestrictions ?? j.locations);
  const loc = parseLocations(restrictions);
  const worldwide = restrictions.length === 0 || loc.worldwide;

  const min = num(j.minSalary ?? j.salaryMin);
  const max = num(j.maxSalary ?? j.salaryMax);
  const currency = text(j.currency ?? j.salaryCurrency, 8).toUpperCase();
  const seniority = names(j.seniority).join(', ');

  return {
    external_id: guid || pageUrl || applyUrl,
    source_url: pageUrl || applyUrl,
    company,
    title,
    url: applyUrl,
    location: worldwide
      ? 'Remote, worldwide'
      : `Remote: ${restrictions.join(', ')}`.slice(0, 300),
    remote_policy: worldwide ? 'worldwide' : 'region_locked',
    hiring_countries: worldwide ? [] : loc.countries,
    hiring_regions: worldwide ? [] : loc.regions,
    timezones: timezoneText(j.timezoneRestrictions ?? j.timezones),
    source_country: null,
    employment_type: employmentType(j.employmentType ?? j.type),
    seniority: seniority.slice(0, 40),
    salary_min: min,
    salary_max: max,
    salary_currency: currency,
    salary_text: salaryText(min, max, currency),
    tags: textList(
      [
        ...names(j.skills),
        ...names(j.categories),
        ...names(j.parentCategories),
      ].map((t) => t.replace(/-/g, ' ')),
      30,
    ),
    description: descriptionText(
      text(j.description, 200_000) || text(j.excerpt, 5_000),
    ),
    company_logo: isHttp(text(j.companyLogo, 1000))
      ? text(j.companyLogo, 1000)
      : '',
    posted_at: toIso(j.pubDate ?? j.postedAt ?? j.createdAt),
    expires_at: toIso(j.expiryDate ?? j.expiresAt),
  };
}

function jobsOf(body: unknown): Json[] {
  if (Array.isArray(body)) return body as Json[];
  if (body && typeof body === 'object') {
    const b = body as Json;
    for (const k of ['jobs', 'data', 'results'])
      if (Array.isArray(b[k])) return b[k] as Json[];
  }
  return [];
}

export const himalayas: SourceAdapter = {
  id: 'himalayas',

  async run(ctx: AdapterContext): Promise<AdapterResult> {
    const seen = new Map<string, DraftPosting>();
    const warnings: string[] = [];
    let requests = 0;
    let failures = 0;

    const get = async (url: string): Promise<Json[] | null> => {
      if (requests >= ctx.maxRequests) return null;
      if (requests > 0) await ctx.sleep(PAGE_DELAY_MS);
      requests++;
      try {
        const res = await ctx.fetch(url, {
          headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) {
          failures++;
          warnings.push(`${res.status} from ${url}`);
          return null;
        }
        return jobsOf(await res.json());
      } catch (e) {
        failures++;
        warnings.push(`${(e as Error).message} for ${url}`);
        return null;
      }
    };

    /** Adds a page's jobs; true when the page suggests older pages are still worth reading. */
    const take = (jobs: Json[]): boolean => {
      let oldest = Infinity;
      for (const j of jobs) {
        const d = parseHimalayasJob(j);
        if (!d) continue;
        const t = d.posted_at ? Date.parse(d.posted_at) : NaN;
        if (Number.isFinite(t)) oldest = Math.min(oldest, t);
        if (Number.isFinite(t) && t < ctx.since.getTime()) continue;
        if (!seen.has(d.external_id)) seen.set(d.external_id, d);
      }
      return (
        jobs.length >= 10 &&
        (oldest === Infinity || oldest >= ctx.since.getTime())
      );
    };

    // The newest postings first, unfiltered: one page.
    const latest = await get(`${BASE}/jobs/api?limit=20&offset=0`);
    if (latest) take(latest);

    // Then each query, breadth first: page 1 of every query before any page 2.
    let open = [
      ...new Set(
        ctx.queries.map((q) => q.trim().toLowerCase()).filter(Boolean),
      ),
    ];
    for (let page = 1; page <= MAX_PAGES_PER_QUERY && open.length; page++) {
      const next: string[] = [];
      for (const q of open) {
        if (requests >= ctx.maxRequests) break;
        const jobs = await get(
          `${BASE}/jobs/api/search?q=${encodeURIComponent(q)}&sort=recent&page=${page}`,
        );
        if (jobs && take(jobs)) next.push(q);
      }
      open = next;
    }

    if (requests > 0 && failures === requests) {
      throw new Error(
        `Every Himalayas request failed: ${warnings.slice(0, 3).join('; ')}`,
      );
    }
    return { postings: [...seen.values()], requests, warnings };
  },
};
