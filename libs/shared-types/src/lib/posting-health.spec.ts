import { describe, expect, it } from 'vitest';
import { postingHealth, type PoolPostingFacts } from './posting-health';

const NOW = new Date('2026-11-10T12:00:00Z');
const ago = (d: number) =>
  new Date(NOW.getTime() - d * 86_400_000).toISOString();

const pool = (p: Partial<PoolPostingFacts> = {}): PoolPostingFacts => ({
  role_id: 'r1',
  first_seen_at: ago(1),
  posted_at: null,
  expires_at: null,
  listings: 1,
  boards: 1,
  gone_since: null,
  ...p,
});

describe('postingHealth', () => {
  it('has no badges for a fresh posting seen once', () => {
    const h = postingHealth({ posted_at: ago(3) }, pool(), NOW);
    expect(h.ageDays).toBe(3);
    expect(h.badges).toEqual([]);
  });

  it('dates age from the earliest of role, pool posted and first seen', () => {
    const h = postingHealth(
      { posted_at: ago(2) },
      pool({ first_seen_at: ago(45), posted_at: ago(40) }),
      NOW,
    );
    expect(h.ageDays).toBe(45);
    expect(h.badges).toMatchObject([
      { kind: 'age', tone: 'warn', label: 'Open 45 days' },
    ]);
  });

  it('turns the age badge red at 60 days', () => {
    const h = postingHealth({ posted_at: ago(61) }, null, NOW);
    expect(h.badges).toMatchObject([{ kind: 'age', tone: 'bad' }]);
  });

  it('ignores dates in the future', () => {
    const h = postingHealth({ posted_at: ago(-5) }, null, NOW);
    expect(h.ageDays).toBeNull();
  });

  it('works for a hand-added role with no pool row', () => {
    expect(postingHealth({ posted_at: null }, undefined, NOW)).toEqual({
      ageDays: null,
      badges: [],
    });
  });

  it('flags a relisting, counting extra listings beyond one per board', () => {
    expect(
      postingHealth({ posted_at: null }, pool({ listings: 2, boards: 2 }), NOW)
        .badges,
    ).toEqual([]);
    expect(
      postingHealth({ posted_at: null }, pool({ listings: 2, boards: 1 }), NOW)
        .badges[0],
    ).toMatchObject({ kind: 'repost', label: 'Reposted' });
    expect(
      postingHealth({ posted_at: null }, pool({ listings: 4, boards: 2 }), NOW)
        .badges[0],
    ).toMatchObject({ kind: 'repost', label: 'Reposted 2×' });
  });

  it('reports a passed closing date', () => {
    const h = postingHealth(
      { posted_at: null },
      pool({ expires_at: ago(1) }),
      NOW,
    );
    expect(h.badges[0]).toMatchObject({ kind: 'expired', tone: 'bad' });
  });

  it('reports a careers-page closure first and drops the closing date', () => {
    const h = postingHealth(
      { posted_at: ago(70) },
      pool({ gone_since: ago(3), expires_at: ago(2), listings: 2 }),
      NOW,
    );
    expect(h.badges.map((b) => b.kind)).toEqual(['gone', 'repost', 'age']);
    expect(h.badges[0].detail).toContain('7 Nov');
  });
});
