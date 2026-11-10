import { describe, expect, it } from 'vitest';
import {
  NO_AI_ROUTE,
  creditQuote,
  creditsLabel,
  normaliseAiRoute,
  normaliseProAiAdmin,
} from './ai-route';

const answer = {
  enabled: true,
  prices: { letter: 3, research: 15, score: 0 },
  credits_first: true,
  own_only: false,
  credits: 10,
  daily_left: 150,
};

describe('normaliseAiRoute', () => {
  it('reads the answer, and treats off or malformed as no route', () => {
    const r = normaliseAiRoute(answer);
    expect(r.enabled).toBe(true);
    expect(r.prices.research).toBe(15);
    expect(r.creditsFirst).toBe(true);
    expect(r.credits).toBe(10);
    expect(normaliseAiRoute({ enabled: false })).toBe(NO_AI_ROUTE);
    expect(normaliseAiRoute(null)).toBe(NO_AI_ROUTE);
    expect(normaliseAiRoute('yes')).toBe(NO_AI_ROUTE);
  });
});

describe('creditQuote', () => {
  const pro = normaliseAiRoute(answer);
  const free = normaliseAiRoute({ ...answer, credits_first: false });

  it('quotes a paying account, whether or not it has a key', () => {
    expect(creditQuote(pro, 'letter', { ownConnections: 1 })).toEqual({
      credits: 3,
      affordable: true,
      why: '',
    });
  });

  it('says when the balance or the daily limit does not cover it', () => {
    expect(creditQuote(pro, 'research', { ownConnections: 0 })).toEqual({
      credits: 15,
      affordable: false,
      why: 'you have 10',
    });
    const capped = normaliseAiRoute({ ...answer, daily_left: 2 });
    expect(creditQuote(capped, 'letter', { ownConnections: 0 })?.why).toBe(
      "today's limit is reached",
    );
  });

  it('quotes nothing when credits will not be used', () => {
    // off
    expect(
      creditQuote(NO_AI_ROUTE, 'letter', { ownConnections: 0 }),
    ).toBeNull();
    // own key only
    const own = normaliseAiRoute({ ...answer, own_only: true });
    expect(creditQuote(own, 'letter', { ownConnections: 1 })).toBeNull();
    // a model of the account's own was picked
    expect(
      creditQuote(pro, 'letter', { ownConnections: 1, picked: true }),
    ).toBeNull();
    // not metered, or a job without a price
    expect(creditQuote(pro, 'score', { ownConnections: 0 })).toBeNull();
    expect(creditQuote(pro, 'prep', { ownConnections: 0 })).toBeNull();
    // Free with its own key: the key goes first
    expect(creditQuote(free, 'letter', { ownConnections: 1 })).toBeNull();
  });

  it('quotes a Free account without a key: trial credits are what it has', () => {
    expect(creditQuote(free, 'letter', { ownConnections: 0 })?.credits).toBe(3);
  });

  it('labels credits', () => {
    expect(creditsLabel(1)).toBe('1 credit');
    expect(creditsLabel(15)).toBe('15 credits');
  });
});

describe('normaliseProAiAdmin', () => {
  it('reads the settings and the month so far', () => {
    const a = normaliseProAiAdmin({
      settings: {
        enabled: true,
        trial_credits: 20,
        daily_credit_cap: 150,
        monthly_budget_usd: 50,
        credit_prices: { letter: 3 },
        models: { fast: 'claude-haiku-5-5', writing: 'claude-sonnet-5-5' },
      },
      month_spend_usd: 41.5,
      month_calls: 900,
      month_credits: 3100,
      budget_used: 0.83,
      budget_warning: true,
      open_holds: 2,
    });
    expect(a.enabled).toBe(true);
    expect(a.monthlyBudgetUsd).toBe(50);
    expect(a.budgetUsed).toBe(0.83);
    expect(a.budgetWarning).toBe(true);
    expect(a.models.writing).toBe('claude-sonnet-5-5');
  });

  it('reads nothing as off, with no budget', () => {
    const a = normaliseProAiAdmin(null);
    expect(a.enabled).toBe(false);
    expect(a.budgetUsed).toBeNull();
    expect(a.monthSpendUsd).toBe(0);
  });
});
