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
  it('Free under enforced billing: AI is included, company research is marked Pro', () => {
    const v = planCardView(normaliseEntitlements(answer));
    expect(v.line).toBe('Free');
    expect(v.paid).toBe(false);
    expect(v.included).toEqual(['AI drafting and scoring']);
    expect(v.notIncluded).toEqual(['Company research']);
    expect(v.open).toBe(false);
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
        features: ['ai', 'company_research', 'docx_export'],
        credits: 480,
      }),
    );
    expect(v.line).toBe('Pro until 10 Dec 2026');
    expect(v.paid).toBe(true);
    expect(v.credits).toBe(480);
    expect(v.included).toEqual(['AI drafting and scoring', 'Company research']);
    expect(v.notIncluded).toEqual([]);
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
