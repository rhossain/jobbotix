import { describe, expect, it } from 'vitest';
import { readAdminHelp } from '../../core/data/admin-help';
import { helpSpend, needsWork } from './help';

const answer = (over: Record<string, unknown> = {}) =>
  readAdminHelp({
    settings: { enabled: true, monthly_budget_usd: 5, daily_free: 10 },
    month_spend_usd: '0.5',
    totals: { asked: 3 },
    questions: [
      {
        id: 'a',
        question: 'why no jobs',
        route: 'platform',
        found: true,
        feedback: 'yes',
      },
      { id: 'b', question: 'apply for me?', route: 'platform', found: false },
      {
        id: 'c',
        question: 'add a job',
        route: 'articles',
        found: true,
        feedback: 'no',
      },
      { id: 'd', question: 'bad', route: 'weird', articles: ['x', 3] },
    ],
    ...over,
  });

describe('readAdminHelp', () => {
  it('fills in what is missing and keeps only known values', () => {
    const h = answer();
    expect(h.settings).toEqual({
      enabled: true,
      monthly_budget_usd: 5,
      daily_free: 10,
      daily_pro: 100,
      daily_own: 30,
      model: '',
    });
    expect(h.monthSpendUsd).toBe(0.5);
    expect(h.totals.asked).toBe(3);
    expect(h.totals.no).toBe(0);
    expect(h.questions[3].route).toBe('articles');
    expect(h.questions[3].articles).toEqual(['x']);
    expect(h.mostAsked).toEqual([]);
    expect(readAdminHelp(null).questions).toEqual([]);
  });
});

describe('needsWork', () => {
  it('keeps the questions not answered and the answers that got a No', () => {
    expect(needsWork(answer().questions).map((q) => q.id)).toEqual(['b', 'c']);
  });
});

describe('helpSpend', () => {
  it('shows the month against the budget', () => {
    expect(helpSpend(answer())).toEqual({
      line: '$0.50 of $5.00 this month (10%)',
      percent: 10,
      tone: 'good',
    });
    expect(helpSpend(answer({ month_spend_usd: 4.2 })).tone).toBe('warn');
    expect(helpSpend(answer({ month_spend_usd: 6 })).percent).toBe(100);
    expect(
      helpSpend(answer({ settings: { monthly_budget_usd: 0 } })).tone,
    ).toBe('bad');
  });
});
