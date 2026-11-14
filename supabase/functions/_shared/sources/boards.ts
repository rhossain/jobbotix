// Free remote-job boards with public JSON feeds. Each keeps the board's own
// page as source_url, the link users open, because every one of them asks for
// attribution and a link back. Limits are the boards' published fair use;
// source_catalog.max_requests_per_run enforces them per run.
//
//   jobicy          GET https://jobicy.com/api/v2/remote-jobs?count=50&tag=<term>
//   remoteok        GET https://remoteok.com/api                (latest ~100; 1st item is a notice)
//   workingnomads   GET https://www.workingnomads.com/api/exposed_jobs/
//   arbeitnow       GET https://www.arbeitnow.com/api/job-board-api?page=<n>   (Europe; remote flag)
//   remotive        GET https://remotive.com/api/remote-jobs   (all categories)
//                   (asks for at most ~4 requests a day; the feed is 24 h delayed)
//   getonboard      GET https://www.getonbrd.com/api/v0/categories/<id>/jobs?per_page=100&expand=["company"]
//                   (Get on Board: Latin American and remote jobs, many in Spanish;
//                   a few of its 18 categories each run, all of them within a day)
//   fourdayweek     GET https://4dayweek.io/api/v2/jobs         (4 Day Week: remote, hybrid and
//                   on-site jobs at companies with a shorter week; one page a run)

import { termAsTitle } from '../role.ts';
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

/**
 * Jobicy's tag must be 3 to 20 characters: "qa" is answered with an error,
 * so a QA engineer's term was never searched here. A short term is sent as
 * the job title it stands for ("qa engineer", which also finds more QA
 * titles than "quality assurance" did when checked live); a long one is cut
 * at a word.
 */
export function jobicyTag(term: string): string | null {
  let t = term.trim();
  if (t.length < 3) t = termAsTitle(t);
  while (t.length > 20 && t.includes(' ')) t = t.slice(0, t.lastIndexOf(' '));
  return t.length >= 3 && t.length <= 20 ? t : null;
}

export const jobicy: SourceAdapter = {
  id: 'jobicy',
  async run(ctx: AdapterContext) {
    const f = fetcher(ctx, 1500);
    const out: (DraftPosting | null)[] = [];
    for (const q of ctx.queries) {
      if (f.left <= 0) break;
      const tag = jobicyTag(q);
      if (!tag) continue;
      const body = await f.json(
        `https://jobicy.com/api/v2/remote-jobs?count=50&tag=${encodeURIComponent(tag)}`,
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
// Remotive (all categories, one request a run)
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
      // every category: the API lists all active jobs when none is named
      'https://remotive.com/api/remote-jobs',
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

// ---------------------------------------------------------------------------
// 4 Day Week (4dayweek.io): every job says how it is done (remote, hybrid,
// on-site) and lists the countries it is open in; the company says whether
// it hires worldwide. The board's own page is the link.
// ---------------------------------------------------------------------------

export function parseFourDayWeekJob(j: Json): DraftPosting | null {
  const url = text(j.url, 1000);
  const co = (j.company ?? {}) as Json;
  const company = text(co.name, 200);
  const title = text(j.title, 200);
  if (!isHttp(url) || !company || !title) return null;
  const places = Array.isArray(j.locations) ? (j.locations as Json[]) : [];
  const countries = [
    ...new Set(places.map((l) => text(l.country, 100)).filter(Boolean)),
  ];
  const how = text(j.work_arrangement, 20).toLowerCase();
  let where: Pick<
    DraftPosting,
    'location' | 'remote_policy' | 'hiring_countries' | 'hiring_regions'
  >;
  if (how === 'remote') {
    where = remoteFields(
      co.hires_worldwide === true ? ['Worldwide'] : countries,
      parseLocations,
    );
  } else {
    const loc = parseLocations(countries);
    where = {
      location: countries.join(', ').slice(0, 300),
      remote_policy:
        how === 'hybrid' ? 'hybrid' : how === 'onsite' ? 'onsite' : 'unknown',
      hiring_countries: loc.countries,
      hiring_regions: loc.regions,
    };
  }
  const named = (v: unknown) =>
    Array.isArray(v) ? (v as Json[]).map((x) => text(x.name, 60)) : [];
  const logo = text(co.logo_url, 1000);
  return draft({
    external_id: text(j.id, 100) || url,
    source_url: url,
    url,
    company,
    title,
    ...where,
    employment_type: employmentType(j.contract_type),
    seniority: text(j.level, 40),
    tags: textList(
      [text(j.category, 60), ...named(j.skills), ...named(j.tools)].filter(
        Boolean,
      ),
      20,
    ),
    description: descriptionText(text(j.description, 200_000)),
    company_logo: isHttp(logo) ? logo : '',
    posted_at: toIso(j.posted_at),
  });
}

export const fourdayweek: SourceAdapter = {
  id: 'fourdayweek',
  async run(ctx: AdapterContext) {
    const f = fetcher(ctx);
    const body = await f.json('https://4dayweek.io/api/v2/jobs');
    return done(
      f,
      '4 Day Week',
      keepRecent(listOf(body, 'data').map(parseFourDayWeekJob), ctx.since),
    );
  },
};

// ---------------------------------------------------------------------------
// Get on Board (getonbrd.com): jobs are listed per category, in JSON:API
// shape. remote_modality says how the job is done; countries are names.
// Salaries are US dollars a month, so they go in the text only: the number
// fields are read as yearly elsewhere.
// ---------------------------------------------------------------------------

export const GETONBOARD_CATEGORIES = [
  'programming',
  'sysadmin-devops-qa',
  'data-science-analytics',
  'machine-learning-ai',
  'mobile-developer',
  'design-ux',
  'cybersecurity',
  'customer-support',
  'digital-marketing',
  'sales',
  'operations-management',
  'hr',
  'technical-support',
  'innovation-agile',
  'advertising-media',
  'education-coaching',
  'hardware-electronics',
  'other',
];

/** The categories this run reads: a window that moves on every six hours. */
export function getOnBoardCategories(now: Date, budget: number): string[] {
  const n = Math.min(Math.max(0, budget), GETONBOARD_CATEGORIES.length);
  const start =
    (Math.floor(now.getTime() / (6 * 3_600_000)) * n) %
    GETONBOARD_CATEGORIES.length;
  return Array.from(
    { length: n },
    (_, i) => GETONBOARD_CATEGORIES[(start + i) % GETONBOARD_CATEGORIES.length],
  );
}

export function parseGetOnBoardJob(j: Json): DraftPosting | null {
  const a = (j.attributes ?? {}) as Json;
  const url = text(((j.links ?? {}) as Json).public_url, 1000);
  const co = ((((a.company ?? {}) as Json).data ?? {}) as Json).attributes as
    Json | undefined;
  const company = text(co?.name, 200);
  const title = text(a.title, 200);
  if (!isHttp(url) || !company || !title) return null;
  const countries = strings(a.countries);
  const how = text(a.remote_modality, 30).toLowerCase();
  let where: Pick<
    DraftPosting,
    'location' | 'remote_policy' | 'hiring_countries' | 'hiring_regions'
  >;
  if (
    how === 'hybrid' ||
    (how !== 'fully_remote' && how !== 'remote_local' && a.remote !== true)
  ) {
    const loc = parseLocations(countries);
    where = {
      location: countries.join(', ').slice(0, 300),
      remote_policy: how === 'hybrid' ? 'hybrid' : 'onsite',
      hiring_countries: loc.countries,
      hiring_regions: loc.regions,
    };
  } else {
    where = remoteFields(countries, parseLocations);
  }
  const min = num(a.min_salary);
  const max = num(a.max_salary);
  const pay =
    min && max && max > min
      ? `USD ${min.toLocaleString('en-US')}–${max.toLocaleString('en-US')} a month`
      : min || max
        ? `USD ${(min || max)!.toLocaleString('en-US')} a month`
        : '';
  const section = (heading: unknown, body: unknown) =>
    text(body, 100_000)
      ? `${text(heading, 100) ? `<h3>${text(heading, 100)}</h3>` : ''}${text(body, 100_000)}`
      : '';
  const logo = text(co?.logo, 1000);
  return draft({
    external_id: text(j.id, 300) || url,
    source_url: url,
    url,
    company,
    title,
    ...where,
    salary_text: pay,
    tags: textList([text(a.category_name, 60)].filter(Boolean)),
    description: descriptionText(
      [
        section('', a.projects),
        section(a.functions_headline, a.functions),
        section(a.description_headline, a.description),
        section(a.desirable_headline, a.desirable),
        section(a.benefits_headline, a.benefits),
      ]
        .filter(Boolean)
        .join('\n')
        .slice(0, 200_000),
    ),
    company_logo: isHttp(logo) ? logo : '',
    posted_at: toIso(a.published_at),
  });
}

export const getonboard: SourceAdapter = {
  id: 'getonboard',
  async run(ctx: AdapterContext) {
    const f = fetcher(ctx);
    const out: (DraftPosting | null)[] = [];
    for (const id of getOnBoardCategories(new Date(), ctx.maxRequests)) {
      const body = await f.json(
        `https://www.getonbrd.com/api/v0/categories/${id}/jobs?per_page=100&expand=${encodeURIComponent('["company"]')}`,
      );
      out.push(...listOf(body, 'data').map(parseGetOnBoardJob));
    }
    return done(f, 'Get on Board', keepRecent(out, ctx.since));
  },
};
