// What an account may use: the answer of the database's entitlements()
// function (migration 0033), read the same way by the app and by the Edge
// Functions. Billing is off by default; while it is off for an account
// (`enforced` false) every feature is on and no limit applies.
//
// Copied to supabase/functions/_shared/entitlements.ts for the Edge runtime; keep
// the two in step.

/** Feature keys as stored in plans.features. */
export const FEATURES = [
  'ai',
  'company_research',
  'multiple_profiles',
  'instant_alerts',
  'outcome_insights',
  'extra_templates',
  'docx_export',
  'credit_topup',
] as const;
export type Feature = (typeof FEATURES)[number];

/** Numeric limits a plan can set (plans.limits). */
export type LimitKey = 'search_profiles';

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
  /** Credits the plan grants each month. */
  monthlyCredits: number;
  /** AI credits left. */
  credits: number;
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
  monthlyCredits: 0,
  credits: 0,
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

/** Reads the jsonb entitlements() returns; anything malformed falls back to open. */
export function normaliseEntitlements(v: unknown): Entitlements {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return OPEN_ENTITLEMENTS;
  const o = v as Record<string, unknown>;
  if (typeof o['plan'] !== 'string' || !Array.isArray(o['features']))
    return OPEN_ENTITLEMENTS;
  const known = new Set<string>(FEATURES);
  const limits: Partial<Record<LimitKey, number>> = {};
  const rawLimits = o['limits'];
  if (rawLimits && typeof rawLimits === 'object' && !Array.isArray(rawLimits)) {
    const n = (rawLimits as Record<string, unknown>)['search_profiles'];
    if (typeof n === 'number' && Number.isFinite(n))
      limits.search_profiles = Math.max(0, Math.trunc(n));
  }
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
    monthlyCredits: Math.max(0, int(o['monthly_credits'])),
    credits: Math.max(0, int(o['credits'])),
  };
}

/** May this account use the feature? Unknown entitlements count as open. */
export function can(e: Entitlements | null | undefined, feature: Feature) {
  return (e ?? OPEN_ENTITLEMENTS).features.includes(feature);
}

/** The plan's limit for `key`, or null when nothing limits it. */
export function limitOf(
  e: Entitlements | null | undefined,
  key: LimitKey,
): number | null {
  const v = (e ?? OPEN_ENTITLEMENTS).limits[key];
  return typeof v === 'number' ? v : null;
}

export const isPaidPlan = (e: Entitlements | null | undefined) =>
  !!e && e.plan !== 'free';

/** What each feature is called, for upgrade prompts and the pricing table. */
export const FEATURE_LABELS: Record<Feature, string> = {
  ai: 'AI drafting and scoring',
  company_research: 'Company research',
  multiple_profiles: 'Several search profiles',
  instant_alerts: 'Instant alerts',
  outcome_insights: 'Outcome insights',
  extra_templates: 'Extra resume templates',
  docx_export: 'Word (.docx) export',
  credit_topup: 'Credit top-ups',
};

const PLURAL = new Set<Feature>([
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

/** The feature an AI job needs. Company research is the one Pro-only job. */
export function featureForJob(job: GatedAiJob): Feature {
  return job === 'research' ? 'company_research' : 'ai';
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
