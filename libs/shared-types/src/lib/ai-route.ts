// AI on credits, as the app sees it: the answer of ai_route_info()
// (migration 0036) and what one generation will cost before it runs, and the
// answer of admin_pro_ai() for the admin page.

import type { GatedAiJob } from './entitlements';

export interface AiRouteInfo {
  /** The Pro route is switched on. False: credits play no part anywhere. */
  enabled: boolean;
  /** Credits per call of each job; 0 = not metered. */
  prices: Partial<Record<GatedAiJob, number>>;
  /** A paying account: credits go before its own keys. */
  creditsFirst: boolean;
  /** The account chose to use only its own key. */
  ownOnly: boolean;
  credits: number;
  /** Credits still usable today under the daily limit. */
  dailyLeft: number;
}

export const NO_AI_ROUTE: AiRouteInfo = {
  enabled: false,
  prices: {},
  creditsFirst: false,
  ownOnly: false,
  credits: 0,
  dailyLeft: 0,
};

const int = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
};

/** Reads ai_route_info(); anything malformed means "no credits route". */
export function normaliseAiRoute(v: unknown): AiRouteInfo {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return NO_AI_ROUTE;
  const o = v as Record<string, unknown>;
  if (o['enabled'] !== true) return NO_AI_ROUTE;
  const prices: Partial<Record<GatedAiJob, number>> = {};
  const raw = o['prices'];
  if (raw && typeof raw === 'object' && !Array.isArray(raw))
    for (const [job, n] of Object.entries(raw))
      if (typeof n === 'number' && Number.isFinite(n))
        prices[job as GatedAiJob] = int(n);
  return {
    enabled: true,
    prices,
    creditsFirst: o['credits_first'] === true,
    ownOnly: o['own_only'] === true,
    credits: int(o['credits']),
    dailyLeft: int(o['daily_left']),
  };
}

export interface CreditQuote {
  /** Credits the next run of the job will cost. */
  credits: number;
  /** The account can pay it now. */
  affordable: boolean;
  /** Why not, in a few words; '' when affordable. */
  why: string;
}

/**
 * What the next run of `job` costs in credits, or null when it will not use
 * credits at all: the route is off, the account uses only its own key, a
 * model of its own was picked, the job is not metered, or the account is on
 * Free with a key of its own (its key goes first; credits are the fallback).
 */
export function creditQuote(
  route: AiRouteInfo,
  job: GatedAiJob,
  opts: { ownConnections: number; picked?: boolean },
): CreditQuote | null {
  if (!route.enabled || route.ownOnly || opts.picked) return null;
  const credits = route.prices[job] ?? 0;
  if (credits <= 0) return null;
  if (!route.creditsFirst && opts.ownConnections > 0) return null;
  if (route.credits < credits)
    return {
      credits,
      affordable: false,
      why: `you have ${route.credits}`,
    };
  if (route.dailyLeft < credits)
    return { credits, affordable: false, why: "today's limit is reached" };
  return { credits, affordable: true, why: '' };
}

/** "3 credits", "1 credit". */
export function creditsLabel(n: number): string {
  return `${n} ${n === 1 ? 'credit' : 'credits'}`;
}

/** The Pro route as the admin page shows it (admin_pro_ai()). */
export interface ProAiAdmin {
  enabled: boolean;
  trialCredits: number;
  dailyCreditCap: number;
  monthlyBudgetUsd: number;
  prices: Partial<Record<GatedAiJob, number>>;
  models: { fast: string; writing: string };
  monthSpendUsd: number;
  monthCalls: number;
  monthCredits: number;
  /** Share of the monthly budget used, 0 to 1 and beyond; null without a budget. */
  budgetUsed: number | null;
  /** 80% or more of the budget is used. */
  budgetWarning: boolean;
  openHolds: number;
}

export function normaliseProAiAdmin(v: unknown): ProAiAdmin {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const s = (
    o['settings'] && typeof o['settings'] === 'object' ? o['settings'] : {}
  ) as Record<string, unknown>;
  const num = (x: unknown) => {
    const n = typeof x === 'number' ? x : Number(x);
    return Number.isFinite(n) ? n : 0;
  };
  const prices: Partial<Record<GatedAiJob, number>> = {};
  const raw = s['credit_prices'];
  if (raw && typeof raw === 'object' && !Array.isArray(raw))
    for (const [job, n] of Object.entries(raw))
      if (typeof n === 'number') prices[job as GatedAiJob] = int(n);
  const models = (
    s['models'] && typeof s['models'] === 'object' ? s['models'] : {}
  ) as Record<string, unknown>;
  return {
    enabled: s['enabled'] === true,
    trialCredits: int(s['trial_credits']),
    dailyCreditCap: int(s['daily_credit_cap']),
    monthlyBudgetUsd: Math.max(0, num(s['monthly_budget_usd'])),
    prices,
    models: {
      fast: typeof models['fast'] === 'string' ? models['fast'] : '',
      writing: typeof models['writing'] === 'string' ? models['writing'] : '',
    },
    monthSpendUsd: Math.max(0, num(o['month_spend_usd'])),
    monthCalls: int(o['month_calls']),
    monthCredits: int(o['month_credits']),
    budgetUsed:
      o['budget_used'] === null || o['budget_used'] === undefined
        ? null
        : Math.max(0, num(o['budget_used'])),
    budgetWarning: o['budget_warning'] === true,
    openHolds: int(o['open_holds']),
  };
}
