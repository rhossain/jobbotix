import { describe, expect, it } from 'vitest';
import { normaliseProAiAdmin } from '@jobbotix/shared-types';
import { proAiView } from './pro-ai-panel';

const answer = (over: Record<string, unknown>, settings = {}) =>
  normaliseProAiAdmin({
    settings: {
      enabled: true,
      trial_credits: 20,
      daily_credit_cap: 150,
      monthly_budget_usd: 50,
      ...settings,
    },
    month_spend_usd: 10,
    budget_used: 0.2,
    budget_warning: false,
    ...over,
  });

describe('proAiView', () => {
  it('shows the month against the budget', () => {
    const v = proAiView(answer({}));
    expect(v.state).toBe('On');
    expect(v.spend).toBe('$10.00 of $50.00 this month (20%)');
    expect(v.percent).toBe(20);
    expect(v.tone).toBe('good');
    expect(v.warning).toBe('');
  });

  it('warns from 80% and says when the budget is used up', () => {
    const near = proAiView(
      answer({
        month_spend_usd: 41.5,
        budget_used: 0.83,
        budget_warning: true,
      }),
    );
    expect(near.tone).toBe('warn');
    expect(near.warning).toMatch(/More than 80%/);
    const over = proAiView(
      answer({ month_spend_usd: 61, budget_used: 1.22, budget_warning: true }),
    );
    expect(over.tone).toBe('bad');
    expect(over.percent).toBe(100);
    expect(over.warning).toMatch(/paused/);
    expect(over.spend).toContain('(122%)');
  });

  it('says what off means, and flags a zero budget while on', () => {
    const off = proAiView(answer({}, { enabled: false }));
    expect(off.state).toBe('Off');
    expect(off.line).toMatch(/No AI work runs on the platform key/);
    const zero = proAiView(
      answer(
        { month_spend_usd: 0, budget_used: null },
        { monthly_budget_usd: 0 },
      ),
    );
    expect(zero.warning).toMatch(/Set a budget/);
  });
});
