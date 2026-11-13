import { describe, expect, it } from 'vitest';
import type { RoleEventRow, RoleRow } from './database.types';
import { applications, computeOutcomes, interviewRate } from './outcomes';

const now = new Date('2026-11-05T12:00:00Z');
const d = (daysAgo: number) =>
  new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
let n = 0;
const role = (over: Partial<RoleRow>): RoleRow =>
  ({
    id: `r${++n}`,
    source: 'Remotive',
    score: 80,
    status: 'applied',
    cover_letter: '',
    found_at: d(20),
    status_changed_at: d(10),
    ...over,
  }) as RoleRow;
const move = (
  roleId: string,
  to: RoleRow['status'],
  daysAgo: number,
): RoleEventRow =>
  ({
    id: `e${++n}`,
    role_id: roleId,
    kind: 'status_change',
    payload: { to },
    created_at: d(daysAgo),
  }) as RoleEventRow;

describe('applications', () => {
  it('dates an application by its first move to applied and finds the answer after it', () => {
    const r = role({ id: 'a', status: 'interview' });
    const [a] = applications(
      [r],
      [
        move('a', 'shortlist', 18),
        move('a', 'applied', 15),
        move('a', 'interview', 9),
      ],
    );
    expect(a.appliedAt).toBe(d(15));
    expect(a.respondedAt).toBe(d(9));
    expect(a.interview).toBe(true);
  });

  it('counts a rejection as an answer but not as an interview', () => {
    const r = role({ id: 'b', status: 'rejected' });
    const [a] = applications(
      [r],
      [move('b', 'applied', 15), move('b', 'rejected', 5)],
    );
    expect(a.respondedAt).toBe(d(5));
    expect(a.interview).toBe(false);
  });

  it('remembers an interview that later ended in a rejection', () => {
    const r = role({ id: 'c', status: 'rejected' });
    const [a] = applications(
      [r],
      [
        move('c', 'applied', 15),
        move('c', 'interview', 9),
        move('c', 'rejected', 2),
      ],
    );
    expect(a.respondedAt).toBe(d(9));
    expect(a.interview).toBe(true);
  });

  it('falls back to the last status change when no move was recorded', () => {
    const waiting = role({
      id: 'd',
      status: 'applied',
      status_changed_at: d(4),
    });
    const offer = role({ id: 'e', status: 'offer', status_changed_at: d(3) });
    const [a, b] = applications([waiting, offer], []);
    expect(a).toMatchObject({
      appliedAt: d(4),
      respondedAt: null,
      interview: false,
    });
    expect(b).toMatchObject({ respondedAt: d(3), interview: true });
  });

  it('leaves out roles that were never applied to', () => {
    expect(
      applications(
        [
          role({ status: 'new' }),
          role({ status: 'shortlist' }),
          role({ status: 'skipped' }),
        ],
        [],
      ),
    ).toEqual([]);
  });
});

describe('computeOutcomes', () => {
  /** `count` applications, `interviews` of which reached an interview. */
  const batch = (count: number, interviews: number, over: Partial<RoleRow>) =>
    Array.from({ length: count }, (_, i) =>
      role({ ...over, status: i < interviews ? 'interview' : 'applied' }),
    );

  it('splits applications by source, score, speed and cover letter', () => {
    const roles = [
      ...batch(5, 3, {
        source: 'Remotive',
        score: 90,
        found_at: d(10),
        status_changed_at: d(10),
        cover_letter: 'Dear team',
      }),
      ...batch(5, 0, {
        source: 'We Work Remotely',
        score: 60,
        found_at: d(30),
        status_changed_at: d(10),
      }),
      role({ source: '', status: 'new' }),
    ];
    const o = computeOutcomes(roles, []);
    expect(o.applied).toBe(10);
    expect(o.interviews).toBe(3);
    const rows = (key: string) => o.groups.find((g) => g.key === key)?.rows;
    expect(rows('source')).toEqual([
      { label: 'Remotive', applied: 5, responded: 3, interviews: 3 },
      { label: 'We Work Remotely', applied: 5, responded: 0, interviews: 0 },
    ]);
    expect(rows('score')?.map((r) => [r.label, r.applied])).toEqual([
      ['85+', 5],
      ['50–69', 5],
    ]);
    expect(
      rows('speed')?.map((r) => [r.label, r.applied, r.interviews]),
    ).toEqual([
      ['Same or next day', 5, 3],
      ['Later than a week', 5, 0],
    ]);
    expect(rows('letter')?.map((r) => [r.label, r.interviews])).toEqual([
      ['With a cover letter', 3],
      ['Without one', 0],
    ]);
    expect((rows('source') ?? []).map(interviewRate)).toEqual([60, 0]);
  });

  it('says what stands out once both sides hold enough applications', () => {
    const o = computeOutcomes(
      [
        ...batch(5, 3, {
          source: 'Remotive',
          score: 90,
          found_at: d(10),
          cover_letter: 'x',
        }),
        ...batch(5, 0, {
          source: 'We Work Remotely',
          score: 60,
          found_at: d(30),
        }),
      ],
      [],
    );
    expect(o.findings).toEqual([
      'Remotive leads to interviews most often: 3 of 5 (60%), against 0 of 5 (0%) from We Work Remotely.',
      'Roles scoring 85+ reach an interview more often than roles scoring 50–69: 3 of 5 (60%) against 0 of 5 (0%).',
      'Applying early pays: 3 of 5 (60%) when you applied same or next day, 0 of 5 (0%) later than a week.',
      'Applications with a cover letter do better: 3 of 5 (60%) against 0 of 5 (0%) without one.',
    ]);
  });

  it('draws no finding from a handful of applications or from a small gap', () => {
    const few = computeOutcomes(
      [
        ...batch(3, 3, { source: 'Remotive' }),
        ...batch(3, 0, { source: 'We Work Remotely' }),
      ],
      [],
    );
    expect(few.findings).toEqual([]);
    const close = computeOutcomes(
      [
        ...batch(20, 5, { source: 'Remotive' }),
        ...batch(20, 4, { source: 'We Work Remotely' }),
      ],
      [],
    );
    expect(close.findings).toEqual([]);
  });

  it('says so when higher scores or a cover letter are not paying off', () => {
    const o = computeOutcomes(
      [
        ...batch(4, 0, { score: 90, cover_letter: 'x' }),
        ...batch(4, 2, { score: 40 }),
      ],
      [],
    );
    expect(o.findings).toEqual([
      'Higher scores are not answering more often for you: 0 of 4 (0%) at 85+, 2 of 4 (50%) at under 50. The scoring weights on Search profile may need another look.',
      'A cover letter has not helped so far: 0 of 4 (0%) with one, 2 of 4 (50%) without.',
    ]);
  });

  it('is empty with nothing applied', () => {
    const o = computeOutcomes([role({ status: 'new' })], []);
    expect(o.applied).toBe(0);
    expect(o.groups.every((g) => g.rows.length === 0)).toBe(true);
    expect(o.findings).toEqual([]);
  });

  it('names roles with no source and keeps the eight busiest sources', () => {
    const o = computeOutcomes(
      [
        role({ source: '' }),
        ...Array.from({ length: 10 }, (_, i) => role({ source: `S${i}` })),
        role({ source: 'S0' }),
      ],
      [],
    );
    const rows = o.groups[0].rows;
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({ label: 'S0', applied: 2 });
    expect(rows.some((r) => r.label === 'Added by hand')).toBe(true);
  });
});
