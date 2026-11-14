// Company careers: the public job-board feeds of six applicant-tracking
// systems, polled per company (AdapterContext.companies, chosen by
// fetch-sources: followed companies first, then discovered ones).
//
//   greenhouse  GET https://boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true
//   lever       GET https://api.lever.co/v0/postings/<slug>?mode=json
//               (European customers: api.eu.lever.co; tried when the first
//               host has no such board, then remembered per company)
//   ashby       GET https://api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true
//   workable    GET https://apply.workable.com/api/v1/widget/accounts/<slug>
//   recruitee   GET https://<slug>.recruitee.com/api/offers/
//   personio    GET https://<slug>.jobs.personio.de/xml?language=en   (XML;
//               some companies live on jobs.personio.com, tried second)
//
// A big company lists hundreds of roles; only titles that look like the
// users' kind of work (their search terms, or common product-engineering
// words) go into the pool. The company's own posting page is the link.

import { parseLocations } from '../countries.ts';
import { fetcher, remoteFields } from './http.ts';
import {
  decodeEntities,
  descriptionText,
  draft,
  employmentType,
  isHttp,
  normaliseTitle,
  num,
  salaryText,
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
import { anyRoleWants } from '../role.ts';

type Json = Record<string, unknown>;

const ENGINEERING =
  /\b(frontend|backend|fullstack|engineer|engineering|developer|programmer|software|web|ui|ux|javascript|typescript|mobile|devops|sre|architect)\b/;

/** Keeps titles that match a search term, or product-engineering roles generally. */
export function wanted(
  title: string,
  queries: string[],
  roles: string[] = [],
): boolean {
  const t = normaliseTitle(title);
  if (queries.some((q) => q.split(' ').every((w) => t.includes(w)))) {
    return true;
  }
  // any user's designation, whatever the profession
  if (roles.length && anyRoleWants(roles, title)) return true;
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

// Recruitee says where a job is done with three flags and a list of offices.
export function parseRecruitee(j: Json, company: string): DraftPosting | null {
  const url = text(j.careers_url, 1000);
  const title = text(j.title, 200);
  if (!isHttp(url) || !title) return null;
  if (j.status && j.status !== 'published') return null;
  const offices = Array.isArray(j.locations) ? (j.locations as Json[]) : [];
  const locations = offices
    .map((l) =>
      [text(l.city, 100), text(l.country, 100)].filter(Boolean).join(', '),
    )
    .filter(Boolean);
  if (!locations.length && j.location) locations.push(text(j.location, 200));
  const sal = (j.salary ?? {}) as Json;
  const min = num(sal.min);
  const max = num(sal.max);
  const currency = min || max ? text(sal.currency, 3).toUpperCase() : '';
  return draft({
    external_id: `recruitee-${j.id ?? url}`,
    source_url: url,
    url: isHttp(text(j.careers_apply_url, 1000))
      ? text(j.careers_apply_url, 1000)
      : url,
    company: text(j.company_name, 200) || company,
    title,
    ...where(
      locations,
      j.remote === true ? true : null,
      j.hybrid === true ? 'hybrid' : '',
    ),
    employment_type: employmentType(j.employment_type_code),
    salary_min: min,
    salary_max: max,
    salary_currency: currency,
    salary_text: salaryText(min, max, currency),
    tags: textList([j.department, ...strings(j.tags)].filter(Boolean)),
    description: descriptionText(
      `${text(j.description, 200_000)}\n${text(j.requirements, 100_000)}`,
    ),
    posted_at: toIso(recruiteeDate(j.published_at ?? j.created_at)),
  });
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];

/** "2026-11-11 13:21:40 UTC" to ISO, which every date parser reads. */
const recruiteeDate = (v: unknown): unknown =>
  typeof v === 'string'
    ? v.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/, '$1T$2Z')
    : v;

// Personio's feed is XML: one <position> per job, flat fields, and the text
// in <jobDescriptions><jobDescription><name/><value/>. The job's page is not
// in the feed; it is always <board>/job/<id>.
const xmlField = (block: string, tag: string): string => {
  const m = block.match(
    new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'),
  );
  if (!m) return '';
  const raw = m[1].trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1].trim() : decodeEntities(raw);
};

const WORK_FROM_HOME =
  /\b(remote|home[- ]?office|mobiles arbeiten|work from home)\b/i;

export function parsePersonio(
  xml: string,
  company: string,
  board: string,
): DraftPosting[] {
  const out: DraftPosting[] = [];
  for (const m of xml.matchAll(/<position\b[^>]*>([\s\S]*?)<\/position>/gi)) {
    const block = m[1];
    // the description sections carry <name> tags of their own
    const head = block.replace(
      /<jobDescriptions\b[\s\S]*?<\/jobDescriptions>/i,
      '',
    );
    const id = text(xmlField(head, 'id'), 40);
    const title = text(xmlField(head, 'name'), 200);
    if (!/^\d+$/.test(id) || !title) continue;
    const url = `${board}/job/${id}`;
    const offices = [
      xmlField(block, 'office'),
      ...[
        ...block.matchAll(
          /<additionalOffices>([\s\S]*?)<\/additionalOffices>/gi,
        ),
      ]
        .flatMap((a) => [
          ...a[1].matchAll(/<office\b[^>]*>([\s\S]*?)<\/office>/gi),
        ])
        .map((o) =>
          decodeEntities(o[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim()),
        ),
    ]
      .map((o) => text(o, 100))
      .filter(Boolean);
    const sections = [
      ...block.matchAll(
        /<jobDescription\b[^>]*>([\s\S]*?)<\/jobDescription>/gi,
      ),
    ]
      .map((d) => {
        const name = xmlField(d[1], 'name');
        const value = xmlField(d[1], 'value');
        return value ? `${name ? `<h3>${name}</h3>` : ''}${value}` : '';
      })
      .filter(Boolean)
      .join('\n');
    const schedule = xmlField(block, 'schedule');
    const kind = xmlField(block, 'employmentType');
    out.push(
      draft({
        external_id: `personio-${id}`,
        source_url: url,
        url,
        company: text(xmlField(block, 'subcompany'), 200) || company,
        title,
        ...where(offices, WORK_FROM_HOME.test(title) ? true : null, ''),
        employment_type: employmentType(`${kind} ${schedule}`),
        seniority: text(xmlField(block, 'seniority'), 40),
        tags: textList(
          [
            xmlField(block, 'department'),
            ...xmlField(block, 'keywords')
              .split(',')
              .map((k) => k.trim()),
          ].filter(Boolean),
        ),
        description: descriptionText(sections.slice(0, 200_000)),
        posted_at: toIso(xmlField(block, 'createdAt')),
      }),
    );
  }
  return out;
}

const PERSONIO_BOARDS = (s: string) => [
  `https://${encodeURIComponent(s)}.jobs.personio.de`,
  `https://${encodeURIComponent(s)}.jobs.personio.com`,
];

const LEVER_EU = (s: string) =>
  `https://api.eu.lever.co/v0/postings/${encodeURIComponent(s)}?mode=json`;

type JsonKind = Exclude<CompanyTarget['kind'], 'personio'>;

const FEED: Record<JsonKind, (slug: string) => string> = {
  greenhouse: (s) =>
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(s)}/jobs?content=true`,
  lever: (s) =>
    `https://api.lever.co/v0/postings/${encodeURIComponent(s)}?mode=json`,
  ashby: (s) =>
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(s)}?includeCompensation=true`,
  workable: (s) =>
    `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(s)}`,
  recruitee: (s) =>
    `https://${encodeURIComponent(s)}.recruitee.com/api/offers/`,
};

/** The feed's job list and, where the feed gives one, the company's own name. */
function unpack(kind: JsonKind, body: unknown): { jobs: Json[]; name: string } {
  if (Array.isArray(body)) return { jobs: body as Json[], name: '' };
  const b = (body ?? {}) as Json;
  const list = kind === 'recruitee' ? b.offers : b.jobs;
  const jobs = Array.isArray(list) ? (list as Json[]) : [];
  return { jobs, name: kind === 'workable' ? text(b.name, 200) : '' };
}

const PARSE: Record<
  JsonKind,
  (j: Json, company: string) => DraftPosting | null
> = {
  greenhouse: parseGreenhouse,
  lever: parseLever,
  ashby: parseAshby,
  workable: parseWorkable,
  recruitee: parseRecruitee,
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
      if (c.kind === 'personio') {
        let found: DraftPosting[] | null = null;
        for (const board of PERSONIO_BOARDS(c.slug)) {
          if (f.left <= 0) break;
          const xml = await f.text(`${board}/xml?language=en`);
          if (xml !== null && /<workzag-jobs\b/i.test(xml)) {
            found = parsePersonio(xml, c.name || c.slug, board);
            break;
          }
        }
        if (found === null) {
          companies.push({
            id: c.id,
            error: f.warnings.at(before) ?? 'Not a Personio job feed',
          });
          continue;
        }
        const keep = found.filter((d) =>
          wanted(d.title, ctx.queries, ctx.roles),
        );
        postings.push(...keep);
        companies.push({
          id: c.id,
          open_roles: found.length,
          kept: keep.length,
        });
        continue;
      }
      let region: 'eu' | undefined;
      let body: unknown | null;
      if (c.kind === 'lever' && c.region === 'eu') {
        body = await f.json(LEVER_EU(c.slug));
      } else {
        body = await f.json(FEED[c.kind](c.slug));
        // A Lever board missing from the main host may be a European one.
        if (
          body === null &&
          c.kind === 'lever' &&
          f.left > 0 &&
          (f.warnings.at(before) ?? '').startsWith('404 ')
        ) {
          body = await f.json(LEVER_EU(c.slug));
          if (body !== null) region = 'eu';
        }
      }
      if (body === null) {
        companies.push({
          id: c.id,
          error: f.warnings.at(before) ?? 'No response',
        });
        continue;
      }
      const { jobs, name } = unpack(c.kind, body);
      const company = name || c.name || c.slug;
      let kept = 0;
      for (const j of jobs) {
        const d = PARSE[c.kind](j, company);
        if (d && wanted(d.title, ctx.queries, ctx.roles)) {
          postings.push(d);
          kept++;
        }
      }
      companies.push({
        id: c.id,
        open_roles: jobs.length,
        kept,
        ...(region ? { region } : {}),
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
