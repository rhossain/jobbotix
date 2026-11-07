// Company careers: the public job-board feeds of four applicant-tracking
// systems, polled per company (AdapterContext.companies, chosen by
// fetch-sources: followed companies first, then discovered ones).
//
//   greenhouse  GET https://boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true
//   lever       GET https://api.lever.co/v0/postings/<slug>?mode=json
//   ashby       GET https://api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true
//   workable    GET https://apply.workable.com/api/v1/widget/accounts/<slug>
//
// A big company lists hundreds of roles; only titles that look like the
// users' kind of work (their search terms, or common product-engineering
// words) go into the pool. The company's own posting page is the link.

import { parseLocations } from '../countries.ts';
import { fetcher, remoteFields } from './http.ts';
import {
  descriptionText,
  draft,
  employmentType,
  isHttp,
  normaliseTitle,
  text,
  textList,
  toIso,
} from './normalise.ts';
import type {
  AdapterContext,
  AdapterResult,
  CompanyResult,
  CompanyTarget,
  DraftPosting,
  RemotePolicy,
  SourceAdapter,
} from './types.ts';

type Json = Record<string, unknown>;

const ENGINEERING =
  /\b(frontend|backend|fullstack|engineer|engineering|developer|programmer|software|web|ui|ux|javascript|typescript|mobile|devops|sre|architect)\b/;

/** Keeps titles that match a search term, or product-engineering roles generally. */
export function wanted(title: string, queries: string[]): boolean {
  const t = normaliseTitle(title);
  if (queries.some((q) => q.split(' ').every((w) => t.includes(w))))
    return true;
  return ENGINEERING.test(t);
}

/** Where a role can be done from, given an ATS's location words and flags. */
function where(
  locations: string[],
  remoteFlag: boolean | null,
  workplace: string,
): Pick<
  DraftPosting,
  'location' | 'remote_policy' | 'hiring_countries' | 'hiring_regions'
> {
  const words = locations.filter(Boolean);
  const label = words.join(', ').slice(0, 300);
  const kind = workplace.toLowerCase();
  const remote =
    remoteFlag === true ||
    /remote/.test(kind) ||
    words.some((w) => /remote|anywhere/i.test(w));
  if (/hybrid/.test(kind) || words.some((w) => /hybrid/i.test(w))) {
    const loc = parseLocations(words);
    return {
      location: label || 'Hybrid',
      remote_policy: 'hybrid',
      hiring_countries: loc.countries,
      hiring_regions: loc.regions,
    };
  }
  if (remote) {
    const rest = words
      .map((w) => w.replace(/\b(fully\s+)?remote\b[:\s-]*/gi, '').trim())
      .filter(Boolean);
    const f = remoteFields(rest.length ? rest : ['Remote'], parseLocations);
    return { ...f, location: label || f.location };
  }
  const loc = parseLocations(words);
  const policy: RemotePolicy = words.length ? 'onsite' : 'unknown';
  return {
    location: label,
    remote_policy: policy,
    hiring_countries: loc.countries,
    hiring_regions: loc.regions,
  };
}

// ---------------------------------------------------------------------------
// Parsers, one per ATS
// ---------------------------------------------------------------------------

export function parseGreenhouse(j: Json, company: string): DraftPosting | null {
  const url = text(j.absolute_url, 1000);
  const title = text(j.title, 200);
  if (!isHttp(url) || !title) return null;
  const loc = text((j.location as Json | undefined)?.name, 200);
  return draft({
    external_id: `gh-${j.id ?? url}`,
    source_url: url,
    url,
    company: text(j.company_name, 200) || company,
    title,
    ...where([loc], null, ''),
    // Greenhouse escapes the HTML in `content`; text() decodes it first
    description: descriptionText(text(j.content, 200_000)),
    posted_at: toIso(j.first_published ?? j.updated_at),
  });
}

export function parseLever(j: Json, company: string): DraftPosting | null {
  const url = text(j.hostedUrl, 1000);
  const title = text(j.text, 200);
  if (!isHttp(url) || !title) return null;
  const cat = (j.categories ?? {}) as Json;
  const locations = [
    ...(Array.isArray(cat.allLocations)
      ? (cat.allLocations as unknown[]).map(String)
      : []),
  ];
  if (!locations.length && cat.location) locations.push(String(cat.location));
  return draft({
    external_id: `lever-${j.id ?? url}`,
    source_url: url,
    url: isHttp(text(j.applyUrl, 1000)) ? text(j.applyUrl, 1000) : url,
    company,
    title,
    ...where(locations, null, text(j.workplaceType, 40)),
    employment_type: employmentType(cat.commitment),
    tags: textList([cat.team, cat.department].filter(Boolean)),
    description:
      text(j.descriptionPlain, 20_000) ||
      descriptionText(text(j.description, 200_000)),
    posted_at: toIso(j.createdAt),
  });
}

export function parseAshby(j: Json, company: string): DraftPosting | null {
  const url = text(j.jobUrl, 1000);
  const title = text(j.title, 200);
  if (!isHttp(url) || !title || j.isListed === false) return null;
  const locations = [
    text(j.location, 200),
    ...(Array.isArray(j.secondaryLocations)
      ? (j.secondaryLocations as Json[]).map((l) => text(l.location, 200))
      : []),
  ];
  const comp = text(
    ((j.compensation ?? {}) as Json).compensationTierSummary,
    100,
  );
  return draft({
    external_id: `ashby-${j.id ?? url}`,
    source_url: url,
    url: isHttp(text(j.applyUrl, 1000)) ? text(j.applyUrl, 1000) : url,
    company,
    title,
    ...where(
      locations,
      j.isRemote === true ? true : null,
      text(j.workplaceType, 40),
    ),
    employment_type: employmentType(j.employmentType),
    salary_text: comp,
    tags: textList([j.department, j.team].filter(Boolean)),
    description:
      text(j.descriptionPlain, 20_000) ||
      descriptionText(text(j.descriptionHtml, 200_000)),
    posted_at: toIso(j.publishedAt),
  });
}

export function parseWorkable(j: Json, company: string): DraftPosting | null {
  const url = text(j.url ?? j.shortlink, 1000);
  const title = text(j.title, 200);
  if (!isHttp(url) || !title) return null;
  const loc = [text(j.city, 100), text(j.state, 100), text(j.country, 100)]
    .filter(Boolean)
    .join(', ');
  return draft({
    external_id: `workable-${j.shortcode ?? url}`,
    source_url: url,
    url: isHttp(text(j.application_url, 1000))
      ? text(j.application_url, 1000)
      : url,
    company,
    title,
    ...where(
      loc ? [loc] : [],
      j.telecommuting === true ? true : null,
      text(j.workplace, 40),
    ),
    employment_type: employmentType(j.employment_type),
    tags: textList([j.department].filter(Boolean)),
    description: descriptionText(text(j.description, 200_000)),
    posted_at: toIso(j.published_on ?? j.created_at),
  });
}

const FEED: Record<CompanyTarget['kind'], (slug: string) => string> = {
  greenhouse: (s) =>
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(s)}/jobs?content=true`,
  lever: (s) =>
    `https://api.lever.co/v0/postings/${encodeURIComponent(s)}?mode=json`,
  ashby: (s) =>
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(s)}?includeCompensation=true`,
  workable: (s) =>
    `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(s)}`,
};

/** The feed's job list and, where the feed gives one, the company's own name. */
function unpack(
  kind: CompanyTarget['kind'],
  body: unknown,
): { jobs: Json[]; name: string } {
  if (Array.isArray(body)) return { jobs: body as Json[], name: '' };
  const b = (body ?? {}) as Json;
  const jobs = Array.isArray(b.jobs) ? (b.jobs as Json[]) : [];
  return { jobs, name: kind === 'workable' ? text(b.name, 200) : '' };
}

const PARSE: Record<
  CompanyTarget['kind'],
  (j: Json, company: string) => DraftPosting | null
> = {
  greenhouse: parseGreenhouse,
  lever: parseLever,
  ashby: parseAshby,
  workable: parseWorkable,
};

export const ats: SourceAdapter = {
  id: 'ats',
  async run(ctx: AdapterContext): Promise<AdapterResult> {
    const f = fetcher(ctx, 300);
    const postings: DraftPosting[] = [];
    const companies: CompanyResult[] = [];
    for (const c of ctx.companies ?? []) {
      if (f.left <= 0) break;
      const before = f.warnings.length;
      const body = await f.json(FEED[c.kind](c.slug));
      if (body === null) {
        companies.push({
          id: c.id,
          error: f.warnings.at(before) ?? 'No response',
        });
        continue;
      }
      const { jobs, name } = unpack(c.kind, body);
      const company = name || c.name || c.slug;
      for (const j of jobs) {
        const d = PARSE[c.kind](j, company);
        if (d && wanted(d.title, ctx.queries)) postings.push(d);
      }
      companies.push({
        id: c.id,
        open_roles: jobs.length,
        ...(name ? { name } : {}),
      });
    }
    f.assertSomeSucceeded('company careers');
    return {
      postings,
      requests: f.requests,
      warnings: f.warnings.slice(0, 10),
      companies,
    };
  },
};
