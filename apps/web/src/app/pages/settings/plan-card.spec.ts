import { describe, expect, it } from 'vitest';
import { normaliseEntitlements } from '@jobbotix/shared-types';
import { planCardView } from './plan-card';

const answer = {
  enforced: true,
  plan: 'free',
  plan_name: 'Free',
  status: 'none',
  features: ['ai'],
  limits: { search_profiles: 1 },
  monthly_credits: 0,
  credits: 0,
};

describe('planCardView', () => {
  it('Free under enforced billing: AI is included, the rest is marked Pro', () => {
    const v = planCardView(normaliseEntitlements(answer));
    expect(v.line).toBe('Free');
    expect(v.paid).toBe(false);
    expect(v.included).toEqual(['AI drafting and scoring']);
    expect(v.notIncluded).toEqual([
      'Interview prep',
      'Company research',
      'Unlimited resume reviews',
      'Several search profiles',
      'Instant alerts',
      'Outcome insights',
      'Extra resume templates',
      'Word (.docx) export',
    ]);
    expect(v.open).toBe(false);
    expect(v.early).toBe(false);
  });

  it('an early Free account keeps what was free for it, and the card says so', () => {
    const v = planCardView(
      normaliseEntitlements({
        ...answer,
        early: true,
        features: ['ai', 'instant_alerts', 'interview_prep', 'resume_review'],
      }),
    );
    expect(v.early).toBe(true);
    expect(v.included).toEqual([
      'AI drafting and scoring',
      'Interview prep',
      'Unlimited resume reviews',
      'Instant alerts',
    ]);
    expect(v.notIncluded).toContain('Company research');
    expect(v.notIncluded).not.toContain('Interview prep');
  });

  it('Pro: everything live is included and the end date shows', () => {
    const v = planCardView(
      normaliseEntitlements({
        ...answer,
        plan: 'pro',
        plan_name: 'Pro',
        status: 'active',
        source: 'admin',
        period_end: '2026-12-10T00:00:00Z',
        features: [
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
        ],
        credits: 480,
        early: true, // said only on Free
      }),
    );
    expect(v.line).toBe('Pro until 10 Dec 2026');
    expect(v.paid).toBe(true);
    expect(v.credits).toBe(480);
    expect(v.included).toHaveLength(9);
    expect(v.included.slice(0, 3)).toEqual([
      'AI drafting and scoring',
      'Interview prep',
      'Company research',
    ]);
    expect(v.notIncluded).toEqual([]);
    expect(v.early).toBe(false);
  });

  it('billing off: nothing is marked as missing, and the card says plans are not enforced', () => {
    const v = planCardView(
      normaliseEntitlements({
        ...answer,
        enforced: false,
        features: ['ai', 'company_research'],
        credits: 20,
      }),
    );
    expect(v.open).toBe(true);
    expect(v.notIncluded).toEqual([]);
    expect(v.credits).toBe(20);
  });
});
