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
});
