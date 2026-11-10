// Two sources that are not JSON job feeds:
//
//   weworkremotely  RSS per category (front-end and full-stack programming).
//                   Item titles read "Company: Job title"; <region> says where.
//   hn              Hacker News "Ask HN: Who is hiring?" (monthly), through the
//                   free Algolia HN API. Each top-level comment is one company's
//                   post, by convention headed "Company | Role | Location |
//                   REMOTE | Salary". Posts without a recognisable role in that
//                   header are skipped rather than guessed at.

import { parseLocations } from '../countries.ts';
import { htmlToText } from '../extract.ts';
import { fetcher, keepRecent, remoteFields } from './http.ts';
export { decodeEntities } from './normalise.ts';
import {
  decodeEntities,
  descriptionText,
  draft,
  employmentType,
  isHttp,
  text,
  toIso,
} from './normalise.ts';
import type { AdapterContext, DraftPosting, SourceAdapter } from './types.ts';

// ---------------------------------------------------------------------------
// RSS (just enough for job feeds: <item> blocks, plain or CDATA fields)
// ---------------------------------------------------------------------------

export function rssItems(xml: string): Record<string, string>[] {
  const items: Record<string, string>[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const fields: Record<string, string> = {};
    for (const f of m[1].matchAll(
      /<([a-z][\w:-]*)\b[^>]*>([\s\S]*?)<\/\1>/gi,
    )) {
      const raw = f[2].trim();
      const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
      fields[f[1].toLowerCase()] = cdata ? cdata[1] : decodeEntities(raw);
    }
    items.push(fields);
  }
  return items;
}

export function parseWwrItem(it: Record<string, string>): DraftPosting | null {
  const link = text(it.link ?? it.guid, 1000);
  const heading = text(it.title, 400);
  const colon = heading.indexOf(':');
  const company = colon > 0 ? heading.slice(0, colon).trim() : '';
  const title = colon > 0 ? heading.slice(colon + 1).trim() : '';
  if (!isHttp(link) || !company || !title) return null;
  return draft({
    external_id: text(it.guid, 1000) || link,
    source_url: link,
    url: link,
    company: company.slice(0, 200),
    title: title.slice(0, 200),
    ...remoteFields(
      [text(it.region, 300), text(it.country, 100)].filter(Boolean),
      parseLocations,
    ),
    employment_type: employmentType(it.type),
    tags: [
      text(it.category, 80),
      ...text(it.skills, 400)
        .split(',')
        .map((x) => x.trim()),
    ]
      .filter(Boolean)
      .slice(0, 20),
    description: descriptionText(decodeEntities(it.description ?? '')),
    company_logo: isHttp(text(it['media:content'] ?? '', 1000))
      ? text(it['media:content'], 1000)
      : '',
    posted_at: toIso(it.pubdate),
    expires_at: toIso(it.expires_at),
  });
}

const WWR_FEEDS = [
  'https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss',
  'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss',
];

export const weworkremotely: SourceAdapter = {
  id: 'weworkremotely',
  async run(ctx: AdapterContext) {
    const f = fetcher(ctx, 1000);
    const out: (DraftPosting | null)[] = [];
    for (const url of WWR_FEEDS) {
      if (f.left <= 0) break;
      const xml = await f.text(url);
      if (xml) out.push(...rssItems(xml).map(parseWwrItem));
    }
    f.assertSomeSucceeded('We Work Remotely');
    return {
      postings: keepRecent(out, ctx.since),
      requests: f.requests,
      warnings: f.warnings.slice(0, 10),
    };
  },
};

// ---------------------------------------------------------------------------
// Hacker News: Who is hiring?
// ---------------------------------------------------------------------------

const ROLE =
  /\b(engineers?|developers?|programmers?|front[- ]?end|back[- ]?end|full[- ]?stack|designers?|architects?|devops|sre|scientists?|swe|cto|vp of engineering|head of (engineering|product|design)|product managers?|tech lead)\b/i;
const SALARY = /[$€£]\s?\d|\b\d{2,3}\s?k\b|\bequity\b/i;
const URLISH = /https?:\/\/|www\.|\.(com|io|ai|dev|co|org|net)\b/i;

export interface HnComment {
  id: number | string;
  text?: string | null;
  created_at?: string;
  created_at_i?: number;
}

export function parseHnComment(c: HnComment): DraftPosting | null {
  const html = c.text ?? '';
  if (!html) return null;
  const decoded = decodeEntities(html);
  // The header is the first paragraph: everything before the first <p>.
  const headerHtml = decoded.split(/<p>/i)[0];
  const header = htmlToText(headerHtml).replace(/\s+/g, ' ').trim();
  const parts = header
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;

  const company = parts[0]
    .replace(/\(.*?\)/g, '')
    .replace(URLISH, '')
    .trim()
    .slice(0, 200);
  const titlePart = parts.slice(1).find((p) => ROLE.test(p) && !SALARY.test(p));
  if (!company || !titlePart) return null;

  const rest = parts.slice(1).filter((p) => p !== titlePart);
  const remoteParts = rest.filter((p) => /remote/i.test(p));
  const onsite = rest.some((p) => /\bon[- ]?site\b|\bin[- ]office\b/i.test(p));
  const hybrid = rest.some((p) => /\bhybrid\b/i.test(p));
  const placeParts = rest.filter(
    (p) =>
      !SALARY.test(p) &&
      !URLISH.test(p) &&
      !/remote|on[- ]?site|hybrid|full[- ]?time|part[- ]?time|contract|intern/i.test(
        p,
      ),
  );

  let remote: Pick<
    DraftPosting,
    'location' | 'remote_policy' | 'hiring_countries' | 'hiring_regions'
  >;
  if (remoteParts.length) {
    // "REMOTE (US)", "Remote - EU", "Remote, worldwide"
    const qualifiers = remoteParts
      .map((p) =>
        p
          .replace(/remote/gi, ' ')
          .replace(/[()]/g, ' ')
          // keep "," and "/": they separate the countries in "(US/Canada/UK)"
          .replace(/^[\s\-–:,]+|[\s\-–:,]+$/g, '')
          .trim(),
      )
      .filter(Boolean);
    remote = qualifiers.length
      ? remoteFields(qualifiers, parseLocations)
      : {
          location: 'Remote',
          remote_policy: 'unknown',
          hiring_countries: [],
          hiring_regions: [],
        };
    if (remote.remote_policy === 'unknown' && placeParts.length) {
      // "Berlin or REMOTE (EU)": a place beside REMOTE narrows it
      const loc = parseLocations(placeParts);
      if (loc.countries.length || loc.regions.length)
        remote = {
          ...remote,
          remote_policy: 'region_locked',
          hiring_countries: loc.countries,
          hiring_regions: loc.regions,
        };
    }
  } else {
    const loc = parseLocations(placeParts);
    remote = {
      location: placeParts.join(', ').slice(0, 300),
      remote_policy: hybrid
        ? 'hybrid'
        : onsite || placeParts.length
          ? 'onsite'
          : 'unknown',
      hiring_countries: loc.countries,
      hiring_regions: loc.regions,
    };
  }
  if (remoteParts.length)
    remote.location = [...remoteParts, ...placeParts].join(', ').slice(0, 300);

  const href = decoded.match(/<a\s[^>]*href="([^"]+)"/i)?.[1] ?? '';
  const page = `https://news.ycombinator.com/item?id=${c.id}`;
  const salary = rest.find((p) => SALARY.test(p)) ?? '';
  return draft({
    external_id: String(c.id),
    source_url: page,
    url: isHttp(href) ? href : page,
    company,
    title: titlePart.slice(0, 200),
    ...remote,
    source_country:
      remote.remote_policy === 'onsite' || remote.remote_policy === 'hybrid'
        ? (remote.hiring_countries[0] ?? null)
        : null,
    employment_type: /contract|freelanc|part[- ]?time/i.test(header)
      ? employmentType(header)
      : 'full_time',
    salary_text: salary.slice(0, 100),
    description: htmlToText(decoded.replace(/<p>/gi, '\n\n')).slice(0, 20_000),
    posted_at: toIso(c.created_at ?? c.created_at_i),
  });
}

export const hn: SourceAdapter = {
  id: 'hn',
  async run(ctx: AdapterContext) {
    const f = fetcher(ctx);
    const search = (await f.json(
      'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=6',
    )) as { hits?: { objectID: string; title?: string }[] } | null;
    const thread = (search?.hits ?? []).find((h) =>
      /who is hiring/i.test(h.title ?? ''),
    );
    let posts: DraftPosting[] = [];
    if (thread) {
      const item = (await f.json(
        `https://hn.algolia.com/api/v1/items/${thread.objectID}`,
      )) as { children?: HnComment[] } | null;
      posts = keepRecent((item?.children ?? []).map(parseHnComment), ctx.since);
    }
    f.assertSomeSucceeded('Hacker News');
    return {
      postings: posts,
      requests: f.requests,
      warnings: f.warnings.slice(0, 10),
    };
  },
};
