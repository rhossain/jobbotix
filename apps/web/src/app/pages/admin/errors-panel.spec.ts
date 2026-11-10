import { describe, expect, it } from 'vitest';
import type { AppErrorRow } from '@jobbotix/shared-types';
import { groupErrors } from './errors-panel';

const row = (p: Partial<AppErrorRow>): AppErrorRow => ({
  id: 'x',
  fingerprint: 'TypeError: a @ /today',
  day: '2026-11-10',
  user_id: 'u1',
  source: 'web',
  name: 'TypeError',
  message: 'a',
  stack: '',
  path: '/today',
  user_agent: 'UA',
  count: 1,
  first_seen: '2026-11-10T01:00:00Z',
  last_seen: '2026-11-10T01:00:00Z',
  ...p,
});

describe('groupErrors', () => {
  it('sums days and counts people, newest first', () => {
    const g = groupErrors([
      row({ count: 2 }),
      row({
        day: '2026-11-09',
        user_id: 'u2',
        count: 3,
        last_seen: '2026-11-09T05:00:00Z',
      }),
      row({
        user_id: null,
        count: 1,
        last_seen: '2026-11-10T03:00:00Z',
        message: 'newest',
      }),
      row({ fingerprint: 'other', last_seen: '2026-11-10T09:00:00Z' }),
    ]);
    expect(g.map((x) => x.fingerprint)).toEqual([
      'other',
      'TypeError: a @ /today',
    ]);
    expect(g[1]).toMatchObject({ total: 6, users: 3, message: 'newest' });
  });
});
