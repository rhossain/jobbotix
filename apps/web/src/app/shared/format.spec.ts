import {
  clockTime,
  dayMonth,
  longDate,
  relativeDay,
  shortDate,
  utcMonthShort,
} from './format';

describe('date formatting', () => {
  const d = new Date(2026, 10, 6, 6, 5); // Friday 6 November 2026, 06:05 local

  it('formats without Intl', () => {
    expect(shortDate(d)).toBe('6 Nov');
    expect(dayMonth(d)).toBe('6 November');
    expect(longDate(d)).toBe('Friday 6 November');
    expect(clockTime(d)).toBe('06:05');
    expect(utcMonthShort(new Date(Date.UTC(2026, 0, 31)))).toBe('Jan');
  });

  it('reads recent days relatively and older ones as a short date', () => {
    const now = new Date();
    const daysAgo = (n: number) =>
      new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - n,
        12,
      ).toISOString();
    expect(relativeDay(daysAgo(0))).toBe('today');
    expect(relativeDay(daysAgo(1))).toBe('yesterday');
    expect(relativeDay(daysAgo(3))).toBe('3 days ago');
    const old = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 30,
      12,
    );
    expect(relativeDay(old.toISOString())).toBe(shortDate(old));
    expect(relativeDay(null)).toBe('');
  });
});
