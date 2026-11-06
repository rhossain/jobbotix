// Free remote-job boards with public JSON feeds. Each keeps the board's own
// page as source_url, the link users open, because every one of them asks for
// attribution and a link back. Limits are the boards' published fair use;
// source_catalog.max_requests_per_run enforces them per run.
//
//   jobicy          GET https://jobicy.com/api/v2/remote-jobs?count=50&tag=<term>
//   remoteok        GET https://remoteok.com/api                (latest ~100; 1st item is a notice)
//   workingnomads   GET https://www.workingnomads.com/api/exposed_jobs/
//   arbeitnow       GET https://www.arbeitnow.com/api/job-board-api?page=<n>   (Europe; remote flag)
//   remotive        GET https://remotive.com/api/remote-jobs?category=software-dev
//                   (asks for at most ~4 requests a day; the feed is 24 h delayed)

import { parseLocations } from '../countries.ts';
import { fetcher, keepRecent, remoteFields } from './http.ts';
import {
  descriptionText,
  draft,
  employmentType,
  isHttp,
  num,
  salaryText,
  text,
  textList,
  toIso,
} from './normalise.ts';
import type {
  AdapterContext,
  AdapterResult,
  DraftPosting,
  SourceAdapter,
} from './types.ts';

type Json = Record<string, unknown>;

const listOf = (body: unknown, ...keys: string[]): Json[] => {
  if (Array.isArray(body)) return body as Json[];
  if (body && typeof body === 'object')
    for (const k of keys) {
      const v = (body as Json)[k];
      if (Array.isArray(v)) return v as Json[];
    }
  return [];
};

const strings = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map((x) => String(x ?? '')).filter(Boolean)
    : typeof v === 'string' && v.trim()
      ? v
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      : [];

const done = (
  f: ReturnType<typeof fetcher>,
  source: string,
  postings: DraftPosting[],
): AdapterResult => {
  f.assertSomeSucceeded(source);
  return { postings, requests: f.requests, warnings: f.warnings.slice(0, 10) };
};

// ---------------------------------------------------------------------------
// Jobicy
// ---------------------------------------------------------------------------

export function parseJobicyJob(j: Json): DraftPosting | null {
  const url = text(j.url, 1000);
  const company = text(j.companyName, 200);
  const title = text(j.jobTitle ?? j.title, 200);
  if (!isHttp(url) || !company || !title) return null;
  const min = num(j.annualSalaryMin ?? j.salaryMin);
  const max = num(j.annualSalaryMax ?? j.salaryMax);
  const currency = text(j.salaryCurrency, 8).toUpperCase();
  return draft({
    external_id: String(j.id ?? url),
    source_url: url,
    url,
    company,
    title,
    ...remoteFields(strings(j.jobGeo), parseLocations),
    employment_type: employmentType(strings(j.jobType).join(' ')),
    seniority: text(j.jobLevel, 40),
    salary_min: min,
    salary_max: max,
    salary_currency: currency,
    salary_text: salaryText(min, max, currency),
    tags: textList([...strings(j.jobIndustry), ...strings(j.jobTags)], 20),
    description: descriptionText(
      text(j.jobDescription, 200_000) || text(j.jobExcerpt, 5000),
    ),
    company_logo: isHttp(text(j.companyLogo, 1000))
      ? text(j.companyLogo, 1000)
      : '',
    posted_at: toIso(j.pubDate),
  });
}

export const jobicy: SourceAdapter = {
  id: 'jobicy',
  async run(ctx: AdapterContext) {
    const f = fetcher(ctx, 1500);
    const out: (DraftPosting | null)[] = [];
    for (const q of ctx.queries) {
      if (f.left <= 0) break;
      const body = await f.json(
        `https://jobicy.com/api/v2/remote-jobs?count=50&tag=${encodeURIComponent(q)}`,
      );
      out.push(...listOf(body, 'jobs').map(parseJobicyJob));
    }
    return done(f, 'Jobicy', keepRecent(out, ctx.since));
  },
};

// ---------------------------------------------------------------------------
// RemoteOK
// ---------------------------------------------------------------------------

export function parseRemoteOkJob(j: Json): DraftPosting | null {
  if ('legal' in j) return null; // the feed's first element is its terms notice
  const page =
    text(j.url, 1000) ||
    (j.slug ? `https://remoteok.com/remote-jobs/${text(j.slug, 300)}` : '');
  const company = text(j.company, 200);
  const title = text(j.position ?? j.title, 200);
  if (!isHttp(page) || !company || !title) return null;
  const apply = text(j.apply_url, 1000);
  const min = num(j.salary_min);
  const max = num(j.salary_max);
  return draft({
    external_id: String(j.id ?? page),
    source_url: page,
    url: isHttp(apply) ? apply : page,
    company,
    title,
    ...remoteFields(strings(text(j.location, 300)), parseLocations),
    employment_type: employmentType(strings(j.tags).join(' ')),
    salary_min: min,
    salary_max: max,
    salary_currency: min || max ? 'USD' : '',
    salary_text: salaryText(min, max, min || max ? 'USD' : ''),
    tags: textList(strings(j.tags), 20),
    description: descriptionText(text(j.description, 200_000)),
    company_logo: isHttp(text(j.company_logo ?? j.logo, 1000))
      ? text(j.company_logo ?? j.logo, 1000)
      : '',
    posted_at: toIso(j.date ?? j.epoch),
  });
}

export const remoteok: SourceAdapter = {
  id: 'remoteok',
  async run(ctx: AdapterContext) {
    const f = fetcher(ctx);
    const body = await f.json('https://remoteok.com/api');
    return done(
      f,
      'Remote OK',
      keepRecent(listOf(body).map(parseRemoteOkJob), ctx.since),
    );
  },
};

// ---------------------------------------------------------------------------
// Working Nomads
// ---------------------------------------------------------------------------

export function parseWorkingNomadsJob(j: Json): DraftPosting | null {
  const url = text(j.url, 1000);
  const company = text(j.company_name ?? j.company, 200);
  const title = text(j.title, 200);
  if (!isHttp(url) || !company || !title) return null;
  return draft({
    external_id: url,
    source_url: url,
    url,
    company,
    title,
    ...remoteFields(strings(text(j.location, 300)), parseLocations),
    employment_type: employmentType(j.job_type ?? j.type),
    tags: textList([...strings(j.category_name), ...strings(j.tags)], 20),
    description: descriptionText(text(j.description, 200_000)),
    posted_at: toIso(j.pub_date ?? j.date),
  });
}

export const workingnomads: SourceAdapter = {
  id: 'workingnomads',
  async run(ctx: AdapterContext) {
    const f = fetcher(ctx);
    const body = await f.json(
      'https://www.workingnomads.com/api/exposed_jobs/',
    );
    return done(
      f,
      'Working Nomads',
      keepRecent(listOf(body, 'jobs').map(parseWorkingNomadsJob), ctx.since),
    );
  },
};

// ---------------------------------------------------------------------------
// Arbeitnow (Europe, mostly Germany): remote-flagged jobs only. A remote job
// there is nearly always open to residents of its country or the EU, so an
// unreadable location ("Berlin") becomes "Europe", not worldwide.
// ---------------------------------------------------------------------------

export function parseArbeitnowJob(j: Json): DraftPosting | null {
  if (j.remote !== true) return null;
  const url = text(j.url, 1000);
  const company = text(j.company_name, 200);
  const title = text(j.title, 200);
  if (!isHttp(url) || !company || !title) return null;
  const where = text(j.location, 200);
  const loc = parseLocations(where ? [where] : []);
  const located = loc.countries.length || loc.regions.length;
  return draft({
    external_id: text(j.slug, 300) || url,
    source_url: url,
    url,
    company,
    title,
    location: where ? `Remote: ${where}` : 'Remote, Europe',
    remote_policy: 'region_locked',
    hiring_countries: loc.countries,
    hiring_regions: located ? loc.regions : ['europe'],
    source_country: loc.countries[0] ?? null,
    employment_type: employmentType(strings(j.job_types).join(' ')),
    tags: textList(strings(j.tags), 20),
    description: descriptionText(text(j.description, 200_000)),
    posted_at: toIso(j.created_at),
  });
}

export const arbeitnow: SourceAdapter = {
  id: 'arbeitnow',
  async run(ctx: AdapterContext) {
    const f = fetcher(ctx, 1000);
    const out: (DraftPosting | null)[] = [];
    for (let page = 1; f.left > 0; page++) {
      const jobs = listOf(
        await f.json(
          `https://www.arbeitnow.com/api/job-board-api?page=${page}`,
        ),
        'data',
      );
      if (!jobs.length) break;
      out.push(...jobs.map(parseArbeitnowJob));
      // pages run newest first; stop once a page is entirely older than `since`
      const newest = Math.max(
        ...jobs.map((j) => Date.parse(toIso(j.created_at) ?? '') || 0),
      );
      if (newest && newest < ctx.since.getTime()) break;
    }
    return done(f, 'Arbeitnow', keepRecent(out, ctx.since));
  },
};

// ---------------------------------------------------------------------------
// Remotive (software-dev category, one request a run)
// ---------------------------------------------------------------------------

export function parseRemotiveJob(j: Json): DraftPosting | null {
  const url = text(j.url, 1000);
  const company = text(j.company_name, 200);
  const title = text(j.title, 200);
  if (!isHttp(url) || !company || !title) return null;
  const salary = text(j.salary, 100);
  return draft({
    external_id: String(j.id ?? url),
    source_url: url,
    url,
    company,
    title,
    ...remoteFields(
      strings(text(j.candidate_required_location, 300)),
      parseLocations,
    ),
    employment_type: employmentType(j.job_type),
    salary_text: salary,
    tags: textList([...strings(j.category), ...strings(j.tags)], 20),
    description: descriptionText(text(j.description, 200_000)),
    company_logo: isHttp(text(j.company_logo, 1000))
      ? text(j.company_logo, 1000)
      : '',
    posted_at: toIso(j.publication_date),
  });
}

export const remotive: SourceAdapter = {
  id: 'remotive',
  async run(ctx: AdapterContext) {
    const f = fetcher(ctx);
    const body = await f.json(
      'https://remotive.com/api/remote-jobs?category=software-dev',
    );
    // the feed runs a day behind, so allow two extra days before calling a post old
    const since = new Date(ctx.since.getTime() - 2 * 86_400_000);
    return done(
      f,
      'Remotive',
      keepRecent(listOf(body, 'jobs').map(parseRemotiveJob), since),
    );
  },
};
