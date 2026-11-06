// Shared finishing step for every adapter: the dedupe key that makes one
// posting seen on three boards a single pool row, ATS detection from the apply
// link (which feeds the company watchlist later), and small text helpers.

import { htmlToText } from '../extract.ts';
import type { DraftPosting, PoolPosting } from './types.ts';

const LEGAL_SUFFIX =
  /\b(inc|incorporated|llc|l l c|ltd|limited|gmbh|ag|sa|sas|sarl|bv|b v|nv|plc|pty|pte|corp|corporation|co|company|oy|ab|as|aps|srl|spa|kft|sp z o o|s a)\b/g;

export function normaliseCompany(company: string): string {
  return company
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(LEGAL_SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normaliseTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\bsr\.?(?=\s)/g, 'senior')
    .replace(/\bjr\.?(?=\s)/g, 'junior')
    .replace(/\bfront[\s-]+end\b/g, 'frontend')
    .replace(/\bback[\s-]+end\b/g, 'backend')
    .replace(/\bfull[\s-]+stack\b/g, 'fullstack')
    .replace(/\b(100%\s*)?remote\b|\bwfh\b|\bwork from home\b/g, ' ')
    .replace(/[^a-z0-9+# ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(s),
  );
  return Array.from(new Uint8Array(buf), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

/** Same company and same title = same posting, whichever board it came from. */
export async function dedupeKey(
  company: string,
  title: string,
): Promise<string> {
  return (
    await sha256Hex(`${normaliseCompany(company)}|${normaliseTitle(title)}`)
  ).slice(0, 32);
}

const ATS_PATTERNS: [kind: string, re: RegExp][] = [
  [
    'greenhouse',
    /^https?:\/\/(?:job-)?boards(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_app\?for=)?([a-z0-9_-]+)/i,
  ],
  ['lever', /^https?:\/\/jobs(?:\.eu)?\.lever\.co\/([a-z0-9_.-]+)/i],
  ['ashby', /^https?:\/\/jobs\.ashbyhq\.com\/([a-z0-9_.%-]+)/i],
  ['workable', /^https?:\/\/apply\.workable\.com\/([a-z0-9_-]+)/i],
  [
    'smartrecruiters',
    /^https?:\/\/(?:jobs|careers)\.smartrecruiters\.com\/([a-z0-9_-]+)/i,
  ],
  ['recruitee', /^https?:\/\/([a-z0-9_-]+)\.recruitee\.com\//i],
  ['personio', /^https?:\/\/([a-z0-9_-]+)\.jobs\.personio\.(?:de|com)\//i],
  ['workday', /^https?:\/\/([a-z0-9_-]+)\.wd\d+\.myworkdayjobs\.com\//i],
  ['bamboohr', /^https?:\/\/([a-z0-9_-]+)\.bamboohr\.com\//i],
];

/** The applicant-tracking system and company slug behind an apply link, if any. */
export function detectAts(url: string): { kind: string; slug: string } | null {
  for (const [kind, re] of ATS_PATTERNS) {
    const m = url.match(re);
    if (m?.[1]) {
      const slug = decodeURIComponent(m[1]).toLowerCase();
      if (['embed', 'jobs', 'www'].includes(slug)) continue;
      return { kind, slug };
    }
  }
  return null;
}

export async function finishPosting(d: DraftPosting): Promise<PoolPosting> {
  const ats = detectAts(d.url);
  return {
    ...d,
    dedupe_key: await dedupeKey(d.company, d.title),
    ats_kind: ats?.kind ?? null,
    ats_slug: ats?.slug ?? null,
  };
}

/** Plain text from a source's HTML description, capped for the pool. */
export function descriptionText(html: string, max = 20_000): string {
  if (!html) return '';
  const capped = html.length > max * 3 ? html.slice(0, max * 3) : html;
  return htmlToText(capped).slice(0, max);
}

/** "USD 80k–120k" from a range; '' when neither end is known. */
export function salaryText(
  min: number | null,
  max: number | null,
  currency: string,
): string {
  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const cur = currency ? `${currency.toUpperCase()} ` : '';
  if (min && max)
    return min === max ? `${cur}${k(min)}` : `${cur}${k(min)}–${k(max)}`;
  if (min) return `${cur}${k(min)}+`;
  if (max) return `${cur}up to ${k(max)}`;
  return '';
}

/** Seconds, milliseconds or an ISO string to an ISO timestamp; null when unreadable. */
export function toIso(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = v > 1e12 ? v : v * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof v === 'string') {
    if (/^\d+$/.test(v)) return toIso(Number(v));
    // "2026-11-05 10:00:00" / "2026-11-05T10:00:00" with no zone: boards mean UTC
    const s = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(
      v.trim(),
    )
      ? v.trim().replace(' ', 'T') + 'Z'
      : v;
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  return null;
}

export const num = (v: unknown): number | null => {
  const n =
    typeof v === 'string' ? Number(v.replace(/[^0-9.]/g, '')) : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

export const text = (v: unknown, max = 300): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

export const textList = (v: unknown, max = 40): string[] =>
  Array.isArray(v)
    ? [
        ...new Set(v.map((x) => text(String(x ?? ''), 80)).filter(Boolean)),
      ].slice(0, max)
    : [];

/** "Contractor", "Freelance", "Temporary" → contract; everything else full time. */
export function employmentType(v: unknown): 'full_time' | 'contract' {
  return /contract|freelanc|temporar|fixed[- ]term|consult/i.test(
    String(v ?? ''),
  )
    ? 'contract'
    : 'full_time';
}

/** A draft with every optional field defaulted, so adapters set only what they know. */
export function draft(
  p: Partial<DraftPosting> &
    Pick<
      DraftPosting,
      'external_id' | 'source_url' | 'company' | 'title' | 'url'
    >,
): DraftPosting {
  return {
    location: '',
    remote_policy: 'unknown',
    hiring_countries: [],
    hiring_regions: [],
    timezones: '',
    source_country: null,
    employment_type: 'full_time',
    seniority: '',
    salary_min: null,
    salary_max: null,
    salary_currency: '',
    salary_text: '',
    tags: [],
    description: '',
    company_logo: '',
    posted_at: null,
    expires_at: null,
    ...p,
  };
}

export const isHttp = (s: string) => /^https?:\/\//i.test(s);
