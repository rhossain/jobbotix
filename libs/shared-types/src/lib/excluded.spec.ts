import { describe, expect, it } from 'vitest';
import {
  excludedCounts,
  excludedGroupId,
  excludedReasonLine,
  lowMatchParts,
} from './excluded';

describe('excluded postings', () => {
  it('puts every reason the matcher writes in its group', () => {
    const cases: [string, string][] = [
      ['Low match (score 24): no React', 'low'],
      ['A different job from your target roles (checked by AI)', 'ai'],
      ['Limited to Germany, Poland', 'place'],
      ['Hybrid role', 'onsite'],
      ['On-site role', 'onsite'],
      ['Junior role', 'level'],
      ['Junior or mid-level role', 'level'],
      ['Pay below your minimum', 'pay'],
      ['Pay below your minimum (about $40,000 a year)', 'pay'],
      ['Contract role; profile wants full-time', 'contract'],
      ['Requires German', 'language'],
      ['Requires local work authorisation', 'permit'],
      ['Agency reposting', 'other'],
    ];
    for (const [reason, group] of cases)
      expect(excludedGroupId(reason), reason).toBe(group);
  });

  it('reads the score out of a low match', () => {
    expect(lowMatchParts('Low match (score 24): no React')).toEqual({
      score: 24,
      detail: 'no React',
    });
    expect(lowMatchParts('Junior role')).toBeNull();
  });

  it('writes the line a person reads', () => {
    expect(excludedReasonLine('Low match (score 24): no React')).toBe(
      'Scored 24 of 100. No React',
    );
    expect(excludedReasonLine('Limited to Germany, Poland')).toBe(
      'Hires only in Germany, Poland',
    );
    expect(
      excludedReasonLine(
        'A different job from your target roles (checked by AI)',
      ),
    ).toBe('A different job from your target roles');
    expect(excludedReasonLine('Requires German')).toBe('Requires German');
  });

  it('counts groups in page order and leaves out empty ones', () => {
    const counts = excludedCounts([
      { reason: 'Limited to Germany' },
      { reason: 'Low match (score 20): few of your signals' },
      { reason: 'Limited to Poland' },
    ]);
    expect(counts.map((c) => [c.id, c.count])).toEqual([
      ['low', 1],
      ['place', 2],
    ]);
  });
});
