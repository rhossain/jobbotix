// Shared by ingest-roles and its tests. Mirrors IngestRole / IngestPayload in
// libs/shared-types (Edge Functions cannot import from the Nx workspace), so
// keep the two in step.

export interface ScreeningAnswer {
  q: string;
  a: string;
}

export interface IngestRole {
  company: string;
  title: string;
  url: string;
  source?: string;
  location?: string;
  type?: 'Full-time' | 'Contract' | 'full_time' | 'contract';
  salary?: string;
  posted?: string;
  stack?: string | string[];
  score: number;
  aiMatch?: boolean;
  reasons?: string[];
  gaps?: string[];
  coverLetter?: string;
  qa?: ScreeningAnswer[];
  postingText?: string;
}

export interface IngestExcluded {
  company?: string;
  title?: string;
  url?: string;
  reason: string;
}

export interface IngestPayload {
  runAt: string;
  searched: number;
  roles: IngestRole[];
  excluded?: IngestExcluded[];
}

export interface IngestResult {
  inserted: number;
  updated: number;
  skipped: number;
  excludedStored: number;
  errors: { url: string; message: string }[];
}

/** A roles row ready for insert (user_id and found_at added by the caller). */
export interface NormalisedRole {
  company: string;
  title: string;
  url: string;
  source: string;
  location: string;
  remote_scope: string;
  type: 'full_time' | 'contract';
  salary: string;
  posted_at: string | null;
  stack: string[];
  score: number;
  score_breakdown: Record<string, unknown>;
  reasons: string[];
  gaps: string[];
  ai_match: boolean;
  cover_letter: string;
  posting_text: string;
  posting_hash: string;
  qa: ScreeningAnswer[];
}

const str = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strs = (v: unknown, max = 20): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, max) : [];

export function normaliseRole(raw: IngestRole | null | undefined): NormalisedRole | null {
  if (!raw) return null;
  const company = str(raw.company, 200);
  const title = str(raw.title, 200);
  const url = str(raw.url, 1000);
  const score = Number(raw.score);
  if (!company || !title || !/^https?:\/\//i.test(url) || !Number.isFinite(score)) return null;

  const stack =
    typeof raw.stack === 'string'
      ? raw.stack.split(/[,;]/).map((s) => s.trim()).filter(Boolean).slice(0, 40)
      : strs(raw.stack, 40);

  const posted = str(raw.posted, 10);
  const posted_at = /^\d{4}-\d{2}-\d{2}$/.test(posted) ? posted : null;

  const typeRaw = String(raw.type ?? '').toLowerCase();
  const type: 'full_time' | 'contract' = typeRaw.includes('contract') || typeRaw.includes('freelance') ? 'contract' : 'full_time';

  const posting_text = str(raw.postingText, 50_000);
  const qa = Array.isArray(raw.qa)
    ? raw.qa
        .filter((x) => x && typeof x.q === 'string' && x.q.trim())
        .map((x) => ({ q: x.q.trim().slice(0, 1000), a: str(x.a, 5000) }))
        .slice(0, 30)
    : [];

  return {
    company,
    title,
    url,
    source: str(raw.source, 100),
    location: str(raw.location, 200),
    remote_scope: str(raw.location, 200),
    type,
    salary: str(raw.salary, 100),
    posted_at,
    stack,
    score: Math.max(0, Math.min(100, Math.round(score))),
    score_breakdown: {},
    reasons: strs(raw.reasons, 10),
    gaps: strs(raw.gaps, 10),
    ai_match: raw.aiMatch === true,
    cover_letter: str(raw.coverLetter, 10_000),
    posting_text,
    posting_hash: posting_text ? fnv1a(posting_text) : '',
    qa,
  };
}

/** Small stable hash for change detection on posting text (not security). */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
