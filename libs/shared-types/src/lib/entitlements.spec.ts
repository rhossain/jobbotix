import { describe, expect, it } from 'vitest';
import {
  FEATURES,
  OPEN_ENTITLEMENTS,
  can,
  featureForJob,
  isPaidPlan,
  isUpgradeRequired,
  limitOf,
  normaliseEntitlements,
  planLine,
  reviewsLeft,
  upgradeMessage,
  upgradeRequired,
  type Entitlements,
} from './entitlements';

/** What entitlements() returns for a Free account with billing enforced. */
const free = {
  enforced: true,
  plan: 'free',
  plan_name: 'Free',
  status: 'none',
  source: null,
  period_end: null,
  cancel_at_period_end: false,
  features: ['ai'],
  limits: { search_profiles: 1 },
  monthly_credits: 0,
  credits: 12,
};
const pro = {
  ...free,
  plan: 'pro',
  plan_name: 'Pro',
  status: 'active',
  source: 'admin',
  features: ['ai', 'company_research', 'multiple_profiles', 'docx_export'],
  limits: { search_profiles: 5 },
  monthly_credits: 500,
  credits: 480,
};

describe('normaliseEntitlements', () => {
  it('reads the database answer', () => {
    const e = normaliseEntitlements(pro);
    expect(e.enforced).toBe(true);
    expect(e.plan).toBe('pro');
    expect(e.planName).toBe('Pro');
    expect(e.status).toBe('active');
    expect(e.source).toBe('admin');
    expect(e.limits).toEqual({ search_profiles: 5 });
    expect(e.monthlyCredits).toBe(500);
    expect(e.credits).toBe(480);
  });

  it('falls back to open (everything on) when the answer is missing or malformed', () => {
    for (const bad of [null, undefined, 'pro', 7, [], {}, { plan: 'pro' }])
      expect(normaliseEntitlements(bad)).toEqual(OPEN_ENTITLEMENTS);
    expect(OPEN_ENTITLEMENTS.enforced).toBe(false);
    expect(OPEN_ENTITLEMENTS.features).toEqual([...FEATURES]);
  });

  it('drops feature keys it does not know and repairs odd values', () => {
    const e = normaliseEntitlements({
      ...free,
      features: ['ai', 'time_travel', 7],
      status: 'weird',
      source: 'stripe',
      credits: -4,
      monthly_credits: '500',
      limits: { search_profiles: 2.9, other: 3 },
    });
    expect(e.features).toEqual(['ai']);
    expect(e.status).toBe('none');
    expect(e.source).toBeNull();
    expect(e.credits).toBe(0);
    expect(e.monthlyCredits).toBe(500);
    expect(e.limits).toEqual({ search_profiles: 2 });
  });
});

describe('can and limitOf', () => {
  it('Free with billing enforced has AI but not the Pro features', () => {
    const e = normaliseEntitlements(free);
    expect(can(e, 'ai')).toBe(true);
    expect(can(e, 'company_research')).toBe(false);
    expect(limitOf(e, 'search_profiles')).toBe(1);
    expect(isPaidPlan(e)).toBe(false);
  });

  it('Pro has its features', () => {
    const e = normaliseEntitlements(pro);
    expect(can(e, 'company_research')).toBe(true);
    expect(can(e, 'instant_alerts')).toBe(false); // not in this answer
    expect(isPaidPlan(e)).toBe(true);
  });

  it('billing off: every feature, no limits, whatever the plan', () => {
    const e = normaliseEntitlements({
      ...free,
      enforced: false,
      features: [...FEATURES],
      limits: {},
    });
    for (const f of FEATURES) expect(can(e, f)).toBe(true);
    expect(limitOf(e, 'search_profiles')).toBeNull();
  });

  it('billing off: a feature the database does not list yet still counts as on', () => {
    // The app can be newer than the database it talks to.
    const e = normaliseEntitlements({
      ...free,
      enforced: false,
      features: ['ai', 'company_research'],
      limits: {},
    });
    expect(can(e, 'interview_prep')).toBe(true);
    expect(reviewsLeft(e)).toBeNull();
  });

  it('reads the use counts and whether the account is an early one', () => {
    const e = normaliseEntitlements({
      ...free,
      limits: { search_profiles: 1, resume_reviews: 1, other: 4 },
      used: { resume_reviews: 1, other: 9, bad: 'x' },
      early: true,
    });
    expect(e.limits).toEqual({ search_profiles: 1, resume_reviews: 1 });
    expect(e.used).toEqual({ resume_reviews: 1 });
    expect(e.early).toBe(true);
    const plain = normaliseEntitlements(free);
    expect(plain.used).toEqual({});
    expect(plain.early).toBe(false);
  });

  it('Free gets its allowance of resume reviews once; Pro and early accounts are not counted', () => {
    const limited = { ...free, limits: { resume_reviews: 1 } };
    expect(reviewsLeft(normaliseEntitlements(limited))).toBe(1);
    expect(
      reviewsLeft(
        normaliseEntitlements({ ...limited, used: { resume_reviews: 1 } }),
      ),
    ).toBe(0);
    expect(
      reviewsLeft(
        normaliseEntitlements({ ...limited, used: { resume_reviews: 5 } }),
      ),
    ).toBe(0);
    // No allowance named: none are free.
    expect(reviewsLeft(normaliseEntitlements(free))).toBe(0);
    expect(
      reviewsLeft(
        normaliseEntitlements({
          ...limited,
          features: ['ai', 'resume_review'],
          used: { resume_reviews: 40 },
        }),
      ),
    ).toBeNull();
    expect(reviewsLeft(null)).toBeNull();
  });

  it('unknown entitlements count as open, so nothing is hidden before the answer arrives', () => {
    expect(can(null, 'company_research')).toBe(true);
    expect(can(undefined, 'docx_export')).toBe(true);
    expect(limitOf(null, 'search_profiles')).toBeNull();
    expect(isPaidPlan(null)).toBe(false);
  });
});

describe('AI jobs', () => {
  it('company research and interview prep need a Pro feature; the rest need AI', () => {
    expect(featureForJob('research')).toBe('company_research');
    expect(featureForJob('prep')).toBe('interview_prep');
    for (const job of [
      'extract',
      'score',
      'tailor',
      'letter',
      'answer',
      'import',
      'thank_you',
      'message',
    ] as const)
      expect(featureForJob(job)).toBe('ai');
  });
});

describe('upgrade messages', () => {
  it('names the feature and the plan', () => {
    expect(upgradeMessage('company_research')).toBe(
      'Company research is part of Jobbotix Pro.',
    );
    expect(upgradeMessage('instant_alerts')).toBe(
      'Instant alerts are part of Jobbotix Pro.',
    );
  });

  it('builds and recognises the 402 body', () => {
    const body = upgradeRequired(
      normaliseEntitlements(free),
      'company_research',
    );
    expect(body).toEqual({
      error: 'Company research is part of Jobbotix Pro.',
      code: 'upgrade_required',
      feature: 'company_research',
      plan: 'free',
    });
    expect(isUpgradeRequired(body)).toBe(true);
    expect(isUpgradeRequired({ error: 'Sign in first' })).toBe(false);
    expect(isUpgradeRequired(null)).toBe(false);
  });
});

describe('planLine', () => {
  const e = (over: Partial<Entitlements>): Entitlements => ({
    ...normaliseEntitlements(pro),
    ...over,
  });

  it('says Free for a free or lapsed account', () => {
    expect(planLine(normaliseEntitlements(free))).toBe('Free');
  });

  it('an open admin grant is just the plan name', () => {
    expect(planLine(e({}))).toBe('Pro');
  });

  it('a grant with an end date says until when', () => {
    expect(planLine(e({ periodEnd: '2026-12-12T00:00:00Z' }))).toBe(
      'Pro until 12 Dec 2026',
    );
  });

  it('a paid subscription says when it renews, or ends once cancelled', () => {
    const paid = {
      source: 'polar' as const,
      periodEnd: '2026-12-12T00:00:00Z',
    };
    expect(planLine(e(paid))).toBe('Pro, renews 12 Dec 2026');
    expect(planLine(e({ ...paid, cancelAtPeriodEnd: true }))).toBe(
      'Pro until 12 Dec 2026',
    );
    expect(planLine(e({ ...paid, status: 'canceled' }))).toBe(
      'Pro until 12 Dec 2026',
    );
    expect(planLine(e({ ...paid, status: 'past_due' }))).toBe(
      'Pro, payment overdue',
    );
  });
});
