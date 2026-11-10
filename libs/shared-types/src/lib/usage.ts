// AI usage on the user's Anthropic key: totals, breakdowns and an estimated
// cost for the Usage page, from the ai_usage rows the Edge Functions write.
//
// Costs are estimates at Anthropic's standard list prices (Nov 2026), without
// prompt-caching or batch discounts. The bill itself is in the Anthropic
// Console. A model missing from PRICES shows no cost rather than a guess.

import type { AiJob } from './database.types';

/** USD per million tokens. */
interface Price {
  in: number;
  out: number;
  /** Longer prompts cost more on some models (Haiku 5.5 above 100k tokens). */
  long?: { over: number; in: number; out: number };
}

const PRICES: Record<string, Price> = {
  'claude-fable-5-1': { in: 10, out: 50 },
  'claude-mythos-5-1': { in: 10, out: 50 },
  'claude-fable-5': { in: 10, out: 50 },
  'claude-mythos-5': { in: 10, out: 50 },
  'claude-opus-5-5': { in: 4, out: 20 },
  'claude-opus-5': { in: 5, out: 25 },
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-opus-4-7': { in: 5, out: 25 },
  'claude-opus-4-6': { in: 5, out: 25 },
  'claude-opus-4-5': { in: 5, out: 25 },
  'claude-opus-4-1': { in: 15, out: 75 },
  'claude-opus-4': { in: 15, out: 75 },
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-sonnet-4-5': { in: 3, out: 15 },
  'claude-sonnet-4': { in: 3, out: 15 },
  'claude-haiku-5-5': {
    in: 0.1,
    out: 0.5,
    long: { over: 100_000, in: 0.5, out: 2.5 },
  },
  'claude-haiku-4-5': { in: 1, out: 5 },
};

/** USD per web search (Anthropic's web search tool). */
export const WEB_SEARCH_USD = 0.01;

/** The date the prices above were taken from Anthropic's pricing page. */
export const PRICES_AS_OF = 'November 2026';

export const JOB_LABELS: Record<AiJob, string> = {
  extract: 'Reading postings',
  score: 'Match scoring',
  tailor: 'Tailored resumes',
  letter: 'Cover letters',
  answer: 'Screening answers',
  prep: 'Interview prep',
  import: 'Resume import',
  research: 'Company research',
  thank_you: 'Thank-you notes',
};

/** "claude-sonnet-4-5-20250929" and "-latest" ids priced as their family id. */
function priceOf(model: string): Price | null {
  const id = model.replace(/-(\d{8}|latest)$/, '');
  return PRICES[id] ?? null;
}

export interface UsageRow {
  job: AiJob;
  model: string;
  tokens_in: number;
  tokens_out: number;
  created_at: string;
  web_searches?: number | null;
}

/** Estimated USD for one call, or null when the model's price is unknown. */
export function estimateCost(r: UsageRow): number | null {
  const p = priceOf(r.model);
  if (!p) return null;
  const rate = p.long && r.tokens_in > p.long.over ? p.long : p;
  return (
    (r.tokens_in * rate.in + r.tokens_out * rate.out) / 1_000_000 +
    (r.web_searches ?? 0) * WEB_SEARCH_USD
  );
}

export interface UsageGroup {
  key: string;
  label: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  webSearches: number;
  /** Sum of the calls with a known price. */
  cost: number;
  /** Calls whose model has no price in the table. */
  unpriced: number;
  last: string;
}

export interface UsageBucket {
  /** ISO date (UTC) the bucket starts on. */
  start: string;
  calls: number;
  cost: number;
}

export interface UsageSummary {
  total: UsageGroup;
  byModel: UsageGroup[];
  byJob: UsageGroup[];
  /** Calls and cost per day (periods up to 31 days) or per week (longer). */
  buckets: UsageBucket[];
  bucket: 'day' | 'week';
}

function group(key: string, label: string): UsageGroup {
  return {
    key,
    label,
    calls: 0,
    tokensIn: 0,
    tokensOut: 0,
    webSearches: 0,
    cost: 0,
    unpriced: 0,
    last: '',
  };
}

function add(g: UsageGroup, r: UsageRow) {
  g.calls++;
  g.tokensIn += r.tokens_in;
  g.tokensOut += r.tokens_out;
  g.webSearches += r.web_searches ?? 0;
  const c = estimateCost(r);
  if (c === null) g.unpriced++;
  else g.cost += c;
  if (r.created_at > g.last) g.last = r.created_at;
}

const DAY = 86_400_000;
const dayStart = (t: number) => Math.floor(t / DAY) * DAY;
/** Monday 00:00 UTC of the week holding `t`. */
const weekStart = (t: number) => {
  const d = dayStart(t);
  const dow = (new Date(d).getUTCDay() + 6) % 7;
  return d - dow * DAY;
};

/**
 * Summarises the rows from `since` (inclusive) to `now`. `days` sets the
 * chart: one bar per day up to 31 days, one per week beyond; null means
 * all time, bucketed by week from the first call.
 */
export function summariseUsage(
  rows: UsageRow[],
  days: number | null,
  now: Date = new Date(),
): UsageSummary {
  const end = now.getTime();
  const from = days === null ? null : dayStart(end) - (days - 1) * DAY;
  const inRange = rows.filter((r) => {
    const t = Date.parse(r.created_at);
    return Number.isFinite(t) && (from === null || t >= from) && t <= end;
  });

  const total = group('all', 'All');
  const models = new Map<string, UsageGroup>();
  const jobs = new Map<string, UsageGroup>();
  for (const r of inRange) {
    add(total, r);
    const m = models.get(r.model) ?? group(r.model, r.model);
    add(m, r);
    models.set(r.model, m);
    const j = jobs.get(r.job) ?? group(r.job, JOB_LABELS[r.job] ?? r.job);
    add(j, r);
    jobs.set(r.job, j);
  }

  const bucket: 'day' | 'week' = days !== null && days <= 31 ? 'day' : 'week';
  const first =
    from ??
    (inRange.length
      ? Math.min(...inRange.map((r) => Date.parse(r.created_at)))
      : end);
  const startOf = bucket === 'day' ? dayStart : weekStart;
  const step = bucket === 'day' ? DAY : 7 * DAY;
  const buckets: UsageBucket[] = [];
  for (let t = startOf(first); t <= end; t += step)
    buckets.push({
      start: new Date(t).toISOString().slice(0, 10),
      calls: 0,
      cost: 0,
    });
  const index = new Map(buckets.map((b, i) => [b.start, i]));
  for (const r of inRange) {
    const key = new Date(startOf(Date.parse(r.created_at)))
      .toISOString()
      .slice(0, 10);
    const b = buckets[index.get(key) ?? -1];
    if (!b) continue;
    b.calls++;
    b.cost += estimateCost(r) ?? 0;
  }

  const byCost = (a: UsageGroup, b: UsageGroup) =>
    b.cost - a.cost || b.calls - a.calls;
  return {
    total,
    byModel: [...models.values()].sort(byCost),
    byJob: [...jobs.values()].sort(byCost),
    buckets,
    bucket,
  };
}

/** "<$0.001", "$0.004", "$0.12", "$3.40": enough precision to see small amounts. */
export function formatUsd(v: number): string {
  if (v === 0) return '$0.00';
  if (v < 0.001) return '<$0.001';
  if (v < 0.01) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

/** 1234 → "1.2k", 2_500_000 → "2.5M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
