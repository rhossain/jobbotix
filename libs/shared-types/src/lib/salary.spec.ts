import { describe, expect, it } from 'vitest';
import {
  convert,
  formatYearly,
  meetsMinimum,
  parseSalary,
  salaryFrom,
  salarySortKey,
  yearlyIn,
} from './salary';

describe('parseSalary', () => {
  it.each([
    ['$100k–140k', 100_000, 140_000, 'USD', 'year'],
    ['$95-130k', 95_000, 130_000, 'USD', 'year'],
    ['USD 80k–120k', 80_000, 120_000, 'USD', 'year'],
    ['€60,000 - €75,000 per year', 60_000, 75_000, 'EUR', 'year'],
    ['€60.000 – 75.000 brutto p.a.', 60_000, 75_000, 'EUR', 'year'],
    ['£500/day', 500, null, 'GBP', 'day'],
    ['$55/h', 55, null, 'USD', 'hour'],
    ['$40 - $60 per hour', 40, 60, 'USD', 'hour'],
    ['$4,000–6,000/month', 4_000, 6_000, 'USD', 'month'],
    ['CA$110k', 110_000, null, 'CAD', 'year'],
    ['A$140,000', 140_000, null, 'AUD', 'year'],
    ['80,000 - 100,000 GBP', 80_000, 100_000, 'GBP', 'year'],
    ['BDT 250,000 monthly', 250_000, null, 'BDT', 'month'],
    ['$120k+', 120_000, null, 'USD', 'year'],
  ])('%s', (text, min, max, currency, period) => {
    expect(parseSalary(text)).toEqual({ min, max, currency, period });
  });

  it('reads "up to" as a top end', () => {
    expect(parseSalary('USD up to 150k')).toEqual({
      min: null,
      max: 150_000,
      currency: 'USD',
      period: 'year',
    });
  });

  it('treats a small bare number as hourly', () => {
    expect(parseSalary('45')?.period).toBe('hour');
  });

  it('returns null for lines with no amount', () => {
    expect(parseSalary('Competitive')).toBeNull();
    expect(parseSalary('')).toBeNull();
    expect(parseSalary(null)).toBeNull();
    expect(parseSalary('Founded 2019')).toBeNull();
  });
});

describe('salaryFrom', () => {
  it('prefers structured yearly fields', () => {
    expect(
      salaryFrom(
        { salary_min: 90_000, salary_max: null, salary_currency: 'eur' },
        '$1/h',
      ),
    ).toEqual({ min: 90_000, max: null, currency: 'EUR', period: 'year' });
  });
  it('falls back to the text', () => {
    expect(salaryFrom({}, '$55/h')?.period).toBe('hour');
  });
});

describe('conversion and yearly figures', () => {
  it('converts through the dollar', () => {
    expect(convert(100, 'USD', 'USD')).toBe(100);
    expect(convert(87, 'EUR', 'USD')).toBeCloseTo(100);
    expect(convert(100, 'XXX', 'USD')).toBeNull();
  });

  it('annualises hourly pay at 2080 hours', () => {
    expect(
      yearlyIn({ min: 50, max: 60, currency: 'USD', period: 'hour' }, 'USD'),
    ).toEqual({ min: 104_000, max: 124_800 });
  });

  it('assumes the target currency when the line names none', () => {
    expect(
      yearlyIn({ min: 5000, max: null, currency: '', period: 'month' }, 'EUR'),
    ).toEqual({ min: 60_000, max: null });
  });

  it('gives up on an unknown currency', () => {
    expect(
      yearlyIn({ min: 1, max: 2, currency: 'XXX', period: 'year' }, 'USD'),
    ).toBeNull();
  });
});

describe('meetsMinimum', () => {
  const r = parseSalary('$40k–55k');
  it('compares the top end', () => {
    expect(meetsMinimum(r, 50_000, 'USD')).toBe(true);
    expect(meetsMinimum(r, 60_000, 'USD')).toBe(false);
  });
  it('converts the minimum currency', () => {
    expect(meetsMinimum(r, 45_000, 'EUR')).toBe(true);
    expect(meetsMinimum(r, 60_000, 'EUR')).toBe(false);
  });
  it('has no opinion without a range or a minimum', () => {
    expect(meetsMinimum(null, 50_000, 'USD')).toBeNull();
    expect(meetsMinimum(r, 0, 'USD')).toBeNull();
  });
});

describe('formatting and sorting', () => {
  it('formats yearly figures', () => {
    expect(formatYearly(95_400, 'USD')).toBe('USD 95k');
    expect(formatYearly(1_250_000, 'BDT')).toBe('BDT 1.3m');
  });
  it('sorts unknown pay last', () => {
    expect(salarySortKey(null)).toBe(-1);
    expect(salarySortKey(parseSalary('$100k–140k'))).toBe(140_000);
    expect(salarySortKey(parseSalary('$55/h'))).toBe(114_400);
  });

  it('reads a structured figure under 500 as an hourly rate', () => {
    // seen live: "$82" on a contract role was taken as USD 82 a year
    const hourly = salaryFrom(
      { salary_min: 70, salary_max: 82, salary_currency: 'USD' },
      null,
    );
    expect(hourly?.period).toBe('hour');
    expect(hourly && meetsMinimum(hourly, 60000, 'USD')).toBe(true);
    expect(
      salaryFrom(
        { salary_min: 90000, salary_max: 120000, salary_currency: 'USD' },
        null,
      )?.period,
    ).toBe('year');
  });
});
