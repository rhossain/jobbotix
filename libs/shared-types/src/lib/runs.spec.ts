import { describe, expect, it } from 'vitest';
import { summariseRuns } from './runs';

const now = new Date('2026-11-07T06:00:00Z');
const ev = (at: string, p: Record<string, unknown>) => ({
  payload: { at, ...p },
  created_at: at,
});

describe('summariseRuns', () => {
  it('sums every run in the last 24 hours and ignores digest markers', () => {
    expect(
      summariseRuns(
        [
          ev('2026-11-07T05:50:00Z', { searched: 40, added: 2, excluded: 3 }),
          ev('2026-11-06T23:50:00Z', { searched: 130, added: 1, excluded: 1 }),
          ev('2026-11-07T00:05:00Z', { digest: true, roles: 3 }),
          ev('2026-11-05T05:00:00Z', { searched: 999, added: 9, excluded: 9 }),
        ],
        now,
      ),
    ).toEqual({
      at: '2026-11-07T05:50:00Z',
      searched: 170,
      added: 3,
      excluded: 4,
      runs: 2,
    });
  });

  it('falls back to the latest run when none is recent, and to null when there is none', () => {
    expect(
      summariseRuns(
        [ev('2026-11-01T06:45:00Z', { searched: 47, added: 3, excluded: 21 })],
        now,
      ),
    ).toEqual({
      at: '2026-11-01T06:45:00Z',
      searched: 47,
      added: 3,
      excluded: 21,
      runs: 1,
    });
    expect(
      summariseRuns([ev('2026-11-07T00:05:00Z', { digest: true })], now),
    ).toBeNull();
    expect(summariseRuns([], now)).toBeNull();
  });

  it('adds up what the matcher reports about the listings it passed over', () => {
    const r = summariseRuns(
      [
        ev('2026-11-07T05:50:00Z', {
          searched: 400,
          added: 5,
          excluded: 30,
          notRelevant: 350,
          lowMatch: 8,
        }),
        ev('2026-11-07T04:50:00Z', {
          searched: 100,
          added: 1,
          excluded: 4,
          notRelevant: 90,
          lowMatch: 0,
        }),
        // an older reporter that does not count them
        ev('2026-11-07T03:50:00Z', { searched: 10, added: 0, excluded: 1 }),
      ],
      now,
    );
    expect(r?.notRelevant).toBe(440);
    expect(r?.lowMatch).toBe(8);
    expect(r?.searched).toBe(510);
  });
  it('reports what the AI check did, and runs where the AI step failed', () => {
    const r = summariseRuns(
      [
        ev('2026-11-07T05:50:00Z', {
          searched: 400,
          added: 5,
          excluded: 30,
          aiJudged: 12,
          aiRejected: 3,
          aiRescued: 1,
          aiConfirmed: 4,
        }),
        ev('2026-11-07T04:50:00Z', {
          searched: 100,
          added: 1,
          excluded: 4,
          aiJudged: 4,
          aiRejected: 0,
          aiRescued: 2,
        }),
        ev('2026-11-07T03:50:00Z', {
          searched: 10,
          added: 0,
          excluded: 1,
          aiFailed: 1,
          aiError: 'The provider is rate limiting',
        }),
      ],
      now,
    );
    expect(r?.aiCheck).toEqual({
      looked: 16,
      turnedDown: 3,
      confirmed: 6,
      broughtIn: 3,
    });
    expect(r?.aiTrouble).toEqual({
      runs: 1,
      reason: 'The provider is rate limiting',
    });
    const plain = summariseRuns(
      [ev('2026-11-07T05:50:00Z', { searched: 5, added: 0, excluded: 0 })],
      now,
    );
    expect(plain?.aiCheck).toBeUndefined();
    expect(plain?.aiTrouble).toBeUndefined();
  });
});
