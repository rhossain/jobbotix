import { describe, expect, it } from 'vitest';
import {
  CREDIT_PRICES,
  PRICING,
  creditsFor,
  monthlyCovers,
  quarterlySaving,
  usd,
} from './pricing';

describe('pricing', () => {
  it('holds the decided prices', () => {
    expect(PRICING.pro).toEqual({
      monthlyUsd: 15,
      quarterlyUsd: 36,
      monthlyCredits: 500,
    });
    expect(PRICING.founding).toEqual({
      monthlyUsd: 10,
      quarterlyUsd: 27,
      seats: 50,
    });
    expect(PRICING.topUp).toEqual({ credits: 200, usd: 5 });
    expect(PRICING.trialCredits).toBe(20);
  });

  it('prices every AI job once; scoring and reading a posting are free', () => {
    const jobs = CREDIT_PRICES.map((p) => p.job);
    expect(new Set(jobs).size).toBe(jobs.length);
    expect(jobs).toHaveLength(10);
    expect(creditsFor('score')).toBe(0);
    expect(creditsFor('extract')).toBe(0);
    expect(creditsFor('research')).toBe(15);
    expect(creditsFor('letter')).toBe(3);
  });

  it('the trial covers one company research and still leaves a letter', () => {
    expect(PRICING.trialCredits).toBeGreaterThanOrEqual(
      creditsFor('research') + creditsFor('letter'),
    );
  });

  it('works out the saving and what a month covers', () => {
    expect(quarterlySaving()).toBe(20);
    expect(quarterlySaving(PRICING.founding)).toBe(10);
    expect(monthlyCovers('tailor')).toBe(100);
    expect(monthlyCovers('research')).toBe(33);
    expect(monthlyCovers('score')).toBe(0);
    expect(usd(15)).toBe('$15');
    expect(usd(4.5)).toBe('$4.50');
  });
});
