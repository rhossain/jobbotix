import { describe, expect, it } from 'vitest';
import { OPEN_ENTITLEMENTS } from '@jobbotix/shared-types';
import type { AdminPlan } from '../../core/data/repos';
import { planChange, type PlanForm } from './plans-panel';

const account = (over: Partial<AdminPlan> = {}): AdminPlan => ({
  ...OPEN_ENTITLEMENTS,
  id: 'u1',
  note: '',
  preview: false,
  ...over,
});
const form = (over: Partial<PlanForm> = {}): PlanForm => ({
  plan: 'free',
  until: '',
  credits: 0,
  reason: 'beta tester',
  ...over,
});
const pro = account({ plan: 'pro', planName: 'Pro', status: 'active' });

describe('planChange', () => {
  it('does nothing when nothing changed', () => {
    const c = planChange(account(), form());
    expect(c).toEqual({
      setPlan: null,
      credits: 0,
      problem: 'Nothing to change',
    });
  });

  it('grants Pro with no end date', () => {
    const c = planChange(account(), form({ plan: 'pro' }));
    expect(c.setPlan).toEqual({ plan: 'pro', until: null });
    expect(c.problem).toBe('');
  });

  it('grants Pro until the end of the chosen day', () => {
    const c = planChange(account(), form({ plan: 'pro', until: '2099-12-10' }));
    expect(c.setPlan).toEqual({ plan: 'pro', until: '2099-12-10T23:59:59Z' });
    expect(c.problem).toBe('');
  });

  it('refuses an end date in the past', () => {
    const c = planChange(account(), form({ plan: 'pro', until: '2020-01-01' }));
    expect(c.problem).toBe('The end date is in the past');
  });

  it('removes Pro, and drops any end date with it', () => {
    const c = planChange(pro, form({ plan: 'free', until: '2099-12-10' }));
    expect(c.setPlan).toEqual({ plan: 'free', until: null });
  });

  it('changing only the end date of a Pro grant counts as a plan change', () => {
    const until = account({ ...pro, periodEnd: '2099-12-10T23:59:59Z' });
    expect(
      planChange(until, form({ plan: 'pro', until: '2099-12-10' })).setPlan,
    ).toBeNull();
    expect(
      planChange(until, form({ plan: 'pro', until: '2099-12-31' })).setPlan,
    ).toEqual({ plan: 'pro', until: '2099-12-31T23:59:59Z' });
    expect(planChange(until, form({ plan: 'pro', until: '' })).setPlan).toEqual(
      { plan: 'pro', until: null },
    );
  });

  it('adds credits without touching the plan', () => {
    const c = planChange(pro, form({ plan: 'pro', credits: 50 }));
    expect(c).toEqual({ setPlan: null, credits: 50, problem: '' });
  });

  it('needs a reason for any change', () => {
    expect(
      planChange(account(), form({ plan: 'pro', reason: '  ' })).problem,
    ).toBe('Give a reason');
    expect(
      planChange(account(), form({ credits: 5, reason: '' })).problem,
    ).toBe('Give a reason');
  });

  it('never takes a balance below zero, and caps one adjustment', () => {
    expect(
      planChange(account({ credits: 30 }), form({ credits: -31 })).problem,
    ).toBe('They only have 30 credits');
    expect(
      planChange(account({ credits: 30 }), form({ credits: -30 })).problem,
    ).toBe('');
    expect(planChange(account(), form({ credits: 10_001 })).problem).toBe(
      'At most 10,000 credits at a time',
    );
  });

  it('leaves a subscription billed through Polar alone, but still allows credits', () => {
    const paid = account({ ...pro, source: 'polar' });
    expect(planChange(paid, form({ plan: 'free' })).problem).toBe(
      'This subscription is billed through Polar; change it there',
    );
    expect(planChange(paid, form({ plan: 'pro', credits: 20 })).problem).toBe(
      '',
    );
  });

  it('ignores a non-numeric credits field', () => {
    const c = planChange(account(), form({ plan: 'pro', credits: NaN }));
    expect(c.credits).toBe(0);
    expect(c.problem).toBe('');
  });
});
