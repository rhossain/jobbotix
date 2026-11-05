import { describe, expect, it } from 'vitest';
import type { RoleEventRow, RoleRow } from './database.types';
import { computeInsights } from './insights';

const now = new Date('2026-11-05T12:00:00Z'); // a Thursday
const d = (daysAgo: number) =>
  new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
const role = (
  id: string,
  status: RoleRow['status'],
  score: number,
  foundDaysAgo: number,
  changedDaysAgo = foundDaysAgo,
): RoleRow =>
  ({
    id,
    user_id: 'u',
    company: id,
    title: 't',
    url: '',
    source: '',
    location: '',
    remote_scope: '',
    type: 'full_time',
    salary: '',
    posted_at: null,
    found_at: d(foundDaysAgo),
    stack: [],
    score,
    score_breakdown: {},
    reasons: [],
    gaps: [],
    ai_match: false,
    status,
    cover_letter: '',
    notes: '',
    posting_text: '',
    posting_hash: '',
    status_changed_at: d(changedDaysAgo),
    follow_up_days: 0,
    created_at: d(foundDaysAgo),
    updated_at: d(changedDaysAgo),
  }) as RoleRow;
const ev = (
  role_id: string,
  from: string,
  to: string,
  daysAgo: number,
): RoleEventRow => ({
  id: `${role_id}-${to}`,
  user_id: 'u',
  role_id,
  kind: 'status_change',
  payload: { from, to },
  created_at: d(daysAgo),
});

describe('computeInsights', () => {
  const roles = [
    role('a', 'interview', 88, 20),
    role('b', 'rejected', 72, 15),
    role('c', 'applied', 65, 9),
    role('d', 'new', 40, 1),
    role('e', 'applied', 90, 30, 2), // applied with no event: dated by status_changed_at
  ];
  const events = [
    ev('a', 'new', 'shortlist', 18),
    ev('a', 'shortlist', 'applied', 16),
    ev('a', 'applied', 'interview', 10),
    ev('b', 'new', 'applied', 14),
    ev('b', 'applied', 'rejected', 7),
    ev('c', 'new', 'applied', 8),
  ];
  const i = computeInsights(roles, events, { now, weeks: 4 });

  it('counts applications per ISO week, newest week last', () => {
    expect(i.weeks.map((w) => w.weekStart)).toEqual([
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
      '2026-11-02',
    ]);
    expect(i.weeks.map((w) => w.applied)).toEqual([0, 2, 1, 1]);
    expect(i.weeks.map((w) => w.found)).toEqual([1, 1, 1, 1]);
  });

  it('measures the funnel and the response rate', () => {
    expect(i.applied).toBe(4);
    expect(i.responded).toBe(2);
    expect(i.responseRate).toBe(0.5);
    expect(i.interviews).toBe(1);
    expect(i.medianDaysToResponse).toBe(6.5);
    expect(i.funnel.find((f) => f.status === 'applied')?.count).toBe(2);
  });

  it('averages days spent in each status and bands the scores', () => {
    expect(i.dwell).toEqual([
      { status: 'new', meanDays: 1.3, samples: 3 },
      { status: 'shortlist', meanDays: 2, samples: 1 },
      { status: 'applied', meanDays: 6.5, samples: 2 },
    ]);
    expect(i.scores.map((s) => s.count)).toEqual([1, 1, 1, 2]);
  });

  it('handles an empty tracker', () => {
    const e = computeInsights([], [], { now, weeks: 2 });
    expect(e.responseRate).toBeNull();
    expect(e.medianDaysToResponse).toBeNull();
    expect(e.weeks).toHaveLength(2);
  });
});
