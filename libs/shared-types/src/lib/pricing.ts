// What Jobbotix costs and what a credit buys: one place for the pricing
// page, the Terms and the upgrade prompts. Prices are the ones decided in the
// subscription plan (10 Nov 2026); the amounts charged live in Polar, and the
// credit price of each job will live in `settings` once the Pro AI gateway
// ships (section 5), with these as its defaults.

import type { GatedAiJob } from './entitlements';

export const PRICING = {
  pro: {
    monthlyUsd: 15,
    /** One payment for three months. */
    quarterlyUsd: 36,
    /** AI credits included each month. */
    monthlyCredits: 500,
  },
  /**
   * What the plans limit by count. The plans table decides (migrations 0033
   * and 0046); these say the same on the pricing page and in the Terms.
   */
  limits: {
    free: { searchProfiles: 1, resumeReviews: 1 },
    pro: { searchProfiles: 5 },
  },
  /**
   * Accounts opened before this day keep, on Free, what was free for them
   * when interview prep, resume reviews and instant alerts moved to Pro
   * (settings.billing.early, migration 0046).
   */
  earlyBefore: '15 November 2026',
  /** For the first customers, for as long as they stay subscribed. */
  founding: { monthlyUsd: 10, quarterlyUsd: 27, seats: 50 },
  topUp: { credits: 200, usd: 5 },
  /** Given once to every new account, to try Pro AI without a key. */
  trialCredits: 20,
  /** Days Pro stays on after a payment fails. */
  graceDays: 7,
} as const;

export interface CreditPrice {
  job: GatedAiJob;
  label: string;
  /** 0 = not metered. */
  credits: number;
}

/**
 * Credits per AI job on Pro credits (a call on the user's own key costs no
 * credits). Roughly one credit per $0.012 of model cost at list prices.
 */
export const CREDIT_PRICES: CreditPrice[] = [
  { job: 'score', label: 'Scoring a posting', credits: 0 },
  {
    job: 'extract',
    label: 'Reading a posting you add',
    credits: 0,
  },
  { job: 'letter', label: 'Cover letter', credits: 3 },
  { job: 'tailor', label: 'Tailored resume', credits: 5 },
  { job: 'prep', label: 'Interview prep sheet', credits: 5 },
  {
    job: 'research',
    label: 'Company research with web search',
    credits: 15,
  },
  {
    job: 'answer',
    label: 'Screening answers for a role',
    credits: 2,
  },
  {
    job: 'import',
    label: 'Reading a resume file with AI',
    credits: 5,
  },
  { job: 'thank_you', label: 'Thank-you note', credits: 1 },
  {
    job: 'message',
    label: 'Message to a contact',
    credits: 1,
  },
];

/** Credits one call of `job` costs; 0 when it is not metered or unknown. */
export function creditsFor(job: GatedAiJob): number {
  return CREDIT_PRICES.find((p) => p.job === job)?.credits ?? 0;
}

/** "$15", "$4.50". */
export function usd(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/** What the 3-month pass saves against three monthly payments, in percent. */
export function quarterlySaving(
  p: { monthlyUsd: number; quarterlyUsd: number } = PRICING.pro,
): number {
  return Math.round((1 - p.quarterlyUsd / (p.monthlyUsd * 3)) * 100);
}

/** What a month's credits cover, for the pricing page: "about 100 tailored resumes". */
export function monthlyCovers(job: GatedAiJob): number {
  const c = creditsFor(job);
  return c > 0 ? Math.floor(PRICING.pro.monthlyCredits / c) : 0;
}
