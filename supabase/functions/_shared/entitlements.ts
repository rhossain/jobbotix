// What an account may use: the answer of the database's entitlements()
// function (migration 0033), read the same way by the app and by the Edge
// Functions. Billing is off by default; while it is off for an account
// (`enforced` false) every feature is on and no limit applies.
//
// Copy of libs/shared-types/src/lib/entitlements.ts for the Edge runtime; keep
// the two in step.

/** Feature keys as stored in plans.features. */
export const FEATURES = [
  'ai',
  'company_research',
  'interview_prep',
  'resume_review',
  'multiple_profiles',
  'instant_alerts',
  'outcome_insights',
  'extra_templates',
  'docx_export',
  'credit_topup',
] as const;
export type Feature = (typeof FEATURES)[number];

/** Numeric limits a plan can set (plans.limits). */
export const LIMIT_KEYS = ['search_profiles', 'resume_reviews'] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

/**
 * Things an account is counted using (feature_uses, migration 0046). A count
 * is set against the limit of the same name: a Free account gets
 * limits.resume_reviews AI reviews of its resume, once, not each month.
 */
export const USE_KEYS = ['resume_reviews'] as const;
export type UseKey = (typeof USE_KEYS)[number];

export type SubscriptionStatus =
  'none' | 'trialing' | 'active' | 'past_due' | 'canceled';

export interface Entitlements {
  /** False while billing is off for this account: everything is on. */
  enforced: boolean;
  /** The plan in force now; "free" once a subscription has lapsed. */
  plan: string;
  planName: string;
  status: SubscriptionStatus;
  /** Who controls the subscription: an admin grant or the payment provider. */
  source: 'admin' | 'polar' | null;
  /** ISO time the current period ends; null when there is no end date. */
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  features: Feature[];
  limits: Partial<Record<LimitKey, number>>;
  /** How often the account has used what a limit counts. */
  used: Partial<Record<UseKey, number>>;
  /**
   * The account was opened before some features moved to Pro and keeps them
   * on Free (settings.billing.early).
   */
  early: boolean;
  /** Credits the plan grants each month. */
  monthlyCredits: number;
  /** AI credits left. */
  credits: number;
  /** An admin suspended the account: AI calls and scheduled matching stop. */
  suspended: boolean;
}

/**
 * What applies when the answer is unknown (not loaded yet, the lookup failed,
 * demo mode): billing off, every feature on. The server decides for real;
 * this only keeps the app from hiding things it has no reason to hide.
 */
export const OPEN_ENTITLEMENTS: Entitlements = {
  enforced: false,
  plan: 'free',
  planName: 'Free',
  status: 'none',
  source: null,
  periodEnd: null,
  cancelAtPeriodEnd: false,
  features: [...FEATURES],
  limits: {},
  used: {},
  early: false,
  monthlyCredits: 0,
  credits: 0,
  suspended: false,
};

const STATUSES: SubscriptionStatus[] = [
  'none',
  'trialing',
  'active',
  'past_due',
  'canceled',
];

const int = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/** The whole numbers stored under `keys` in a jsonb object; the rest is dropped. */
function counts<K extends string>(
  raw: unknown,
  keys: readonly K[],
): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of keys) {
    const n = (raw as Record<string, unknown>)[k];
    if (typeof n === 'number' && Number.isFinite(n))
      out[k] = Math.max(0, Math.trunc(n));
  }
  return out;
}

/** Reads the jsonb entitlements() returns; anything malformed falls back to open. */
export function normaliseEntitlements(v: unknown): Entitlements {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return OPEN_ENTITLEMENTS;
  const o = v as Record<string, unknown>;
  if (typeof o['plan'] !== 'string' || !Array.isArray(o['features']))
    return OPEN_ENTITLEMENTS;
  const known = new Set<string>(FEATURES);
  const limits = counts(o['limits'], LIMIT_KEYS);
  const used = counts(o['used'], USE_KEYS);
  const status = STATUSES.includes(o['status'] as SubscriptionStatus)
    ? (o['status'] as SubscriptionStatus)
    : 'none';
  const source =
    o['source'] === 'admin' || o['source'] === 'polar' ? o['source'] : null;
  return {
    enforced: o['enforced'] === true,
    plan: o['plan'],
    planName:
      typeof o['plan_name'] === 'string' && o['plan_name']
        ? o['plan_name']
        : o['plan'],
    status,
    source,
    periodEnd: typeof o['period_end'] === 'string' ? o['period_end'] : null,
    cancelAtPeriodEnd: o['cancel_at_period_end'] === true,
    features: (o['features'] as unknown[]).filter(
      (f): f is Feature => typeof f === 'string' && known.has(f),
    ),
    limits,
    used,
    early: o['early'] === true,
    monthlyCredits: Math.max(0, int(o['monthly_credits'])),
    credits: Math.max(0, int(o['credits'])),
    suspended: o['suspended'] === true,
  };
}

/**
 * May this account use the feature? Unknown entitlements count as open, and
 * so does an account billing is not enforced for: its feature list can come
 * from a database that does not know a newer feature yet.
 */
export function can(e: Entitlements | null | undefined, feature: Feature) {
  const ent = e ?? OPEN_ENTITLEMENTS;
  return !ent.enforced || ent.features.includes(feature);
}

/** The plan's limit for `key`, or null when nothing limits it. */
export function limitOf(
  e: Entitlements | null | undefined,
  key: LimitKey,
): number | null {
  const v = (e ?? OPEN_ENTITLEMENTS).limits[key];
  return typeof v === 'number' ? v : null;
}

/**
 * How many AI resume reviews the account has left: null when nothing limits
 * them (Pro, an early account, billing off), else what remains of the plan's
 * allowance, which is given once and does not come back each month.
 */
export function reviewsLeft(e: Entitlements | null | undefined): number | null {
  if (can(e, 'resume_review')) return null;
  const limit = limitOf(e, 'resume_reviews') ?? 0;
  return Math.max(
    0,
    limit - ((e ?? OPEN_ENTITLEMENTS).used.resume_reviews ?? 0),
  );
}

export const isPaidPlan = (e: Entitlements | null | undefined) =>
  !!e && e.plan !== 'free';

/** What each feature is called, for upgrade prompts and the pricing table. */
export const FEATURE_LABELS: Record<Feature, string> = {
  ai: 'AI drafting and scoring',
  company_research: 'Company research',
  interview_prep: 'Interview prep',
  resume_review: 'More resume reviews',
  multiple_profiles: 'Several search profiles',
  instant_alerts: 'Instant alerts',
  outcome_insights: 'Outcome insights',
  extra_templates: 'Extra resume templates',
  docx_export: 'Word (.docx) export',
  credit_topup: 'Credit top-ups',
};

const PLURAL = new Set<Feature>([
  'resume_review',
  'multiple_profiles',
  'instant_alerts',
  'outcome_insights',
  'extra_templates',
  'credit_topup',
]);

/** One sentence for a blocked action: what it is and which plan has it. */
export function upgradeMessage(feature: Feature): string {
  const label = FEATURE_LABELS[feature] ?? 'This feature';
  return `${label} ${PLURAL.has(feature) ? 'are' : 'is'} part of Jobbotix Pro.`;
}

/** The AI jobs the Edge Functions run (the ai_job enum). */
export type GatedAiJob =
  | 'extract'
  | 'score'
  | 'tailor'
  | 'letter'
  | 'answer'
  | 'prep'
  | 'import'
  | 'research'
  | 'thank_you'
  | 'message';

/**
 * The feature an AI job needs. Company research and interview prep are the
 * Pro-only jobs; the rest need only AI itself.
 */
export function featureForJob(job: GatedAiJob): Feature {
  if (job === 'research') return 'company_research';
  if (job === 'prep') return 'interview_prep';
  return 'ai';
}

/** What a function returns (HTTP 402) when the plan does not cover a call. */
export interface UpgradeRequired {
  error: string;
  code: 'upgrade_required';
  feature: Feature;
  plan: string;
}

export function upgradeRequired(
  e: Entitlements,
  feature: Feature,
): UpgradeRequired {
  return {
    error: upgradeMessage(feature),
    code: 'upgrade_required',
    feature,
    plan: e.plan,
  };
}

/** What a function returns (HTTP 403) to a suspended account. */
export const SUSPENDED = {
  error: 'This account is suspended. Write to Jobbotix support to sort it out.',
  code: 'suspended',
} as const;

/** True for the 402 body above, however it reached the caller. */
export function isUpgradeRequired(v: unknown): v is UpgradeRequired {
  return (
    !!v &&
    typeof v === 'object' &&
    (v as { code?: unknown }).code === 'upgrade_required' &&
    typeof (v as { feature?: unknown }).feature === 'string'
  );
}

/**
 * The plan in a few words for the Plan card: "Free", "Pro", "Pro until
 * 12 Dec 2026", "Pro, renews 12 Dec 2026", "Pro, payment overdue".
 */
export function planLine(e: Entitlements, locale = 'en-GB'): string {
  if (e.status === 'none' || e.plan === 'free') return e.planName;
  const date = e.periodEnd
    ? new Date(e.periodEnd).toLocaleDateString(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '';
  if (e.status === 'past_due') return `${e.planName}, payment overdue`;
  if (e.status === 'canceled' || e.cancelAtPeriodEnd)
    return date ? `${e.planName} until ${date}` : e.planName;
  if (e.source === 'polar' && date) return `${e.planName}, renews ${date}`;
  return date ? `${e.planName} until ${date}` : e.planName;
}
