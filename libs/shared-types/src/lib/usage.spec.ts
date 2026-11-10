import { describe, expect, it } from 'vitest';
import {
  estimateCost,
  formatTokens,
  formatUsd,
  summariseUsage,
  type UsageRow,
} from './usage';

const at = (iso: string) => iso;
const row = (over: Partial<UsageRow>): UsageRow => ({
  job: 'score',
  model: 'claude-haiku-5-5',
  tokens_in: 1000,
  tokens_out: 100,
  created_at: at('2026-11-09T06:45:00Z'),
  ...over,
});

describe('estimateCost', () => {
  it('prices tokens at the model list price', () => {
    // Sonnet 5.5: $2 in, $10 out per million
    expect(
      estimateCost(
        row({
          model: 'claude-sonnet-5-5',
          tokens_in: 1_000_000,
          tokens_out: 100_000,
        }),
      ),
    ).toBeCloseTo(3);
    // Haiku 4.5: $1 / $5
    expect(
      estimateCost(
        row({ model: 'claude-haiku-4-5', tokens_in: 2000, tokens_out: 200 }),
      ),
    ).toBeCloseTo(0.003);
  });

  it('uses the long-prompt rate for Haiku 5.5 above 100k tokens', () => {
    expect(
      estimateCost(row({ tokens_in: 100_000, tokens_out: 0 })),
    ).toBeCloseTo(0.01);
    expect(
      estimateCost(row({ tokens_in: 200_000, tokens_out: 0 })),
    ).toBeCloseTo(0.1);
  });

  it('adds a cent per web search', () => {
    const r = row({
      model: 'claude-sonnet-5-5',
      tokens_in: 0,
      tokens_out: 0,
      web_searches: 4,
    });
    expect(estimateCost(r)).toBeCloseTo(0.04);
  });

  it('prices dated snapshots like their family, and unknown models not at all', () => {
    expect(
      estimateCost(
        row({
          model: 'claude-sonnet-4-5-20250929',
          tokens_in: 1_000_000,
          tokens_out: 0,
        }),
      ),
    ).toBeCloseTo(3);
    expect(estimateCost(row({ model: 'claude-something-9' }))).toBeNull();
  });
});

describe('summariseUsage', () => {
  const now = new Date('2026-11-09T12:00:00Z');
  const rows: UsageRow[] = [
    row({ created_at: '2026-11-09T06:45:00Z' }),
    row({
      created_at: '2026-11-08T06:45:00Z',
      job: 'letter',
      model: 'claude-sonnet-5-5',
      tokens_in: 5000,
      tokens_out: 600,
    }),
    row({
      created_at: '2026-11-01T06:45:00Z',
      job: 'research',
      model: 'claude-sonnet-5-5',
      web_searches: 3,
    }),
    row({ created_at: '2026-09-01T06:45:00Z', model: 'claude-mystery-1' }),
  ];

  it('keeps only the period and groups by model and feature', () => {
    const s = summariseUsage(rows, 7, now);
    expect(s.total.calls).toBe(2);
    expect(s.byJob.map((j) => j.label)).toEqual([
      'Cover letters',
      'Match scoring',
    ]);
    expect(s.byModel[0].key).toBe('claude-sonnet-5-5');
    expect(s.bucket).toBe('day');
    expect(s.buckets).toHaveLength(7);
    expect(s.buckets[s.buckets.length - 1]).toMatchObject({
      start: '2026-11-09',
      calls: 1,
    });
  });

  it('buckets long periods by week and counts unpriced calls', () => {
    const s = summariseUsage(rows, null, now);
    expect(s.total.calls).toBe(4);
    expect(s.total.unpriced).toBe(1);
    expect(s.total.webSearches).toBe(3);
    expect(s.bucket).toBe('week');
    expect(s.buckets[0].start).toBe('2026-08-31'); // the Monday of 1 Sep
    expect(s.buckets.reduce((n, b) => n + b.calls, 0)).toBe(4);
  });
});

describe('providers', () => {
  it('counts free-tier calls at no cost, and old rows as Anthropic', () => {
    expect(
      estimateCost(
        row({ provider: 'gemini', model: 'gemini-3.8-flash', tokens_in: 9e6 }),
      ),
    ).toBe(0);
    expect(
      estimateCost(row({ provider: 'groq', model: 'openai/gpt-oss-120b' })),
    ).toBe(0);
    // An unknown Claude model is still unpriced, not free.
    expect(
      estimateCost(row({ provider: 'anthropic', model: 'claude-next' })),
    ).toBeNull();
    expect(estimateCost(row({ provider: null }))).toBeGreaterThan(0);
  });

  it('groups by provider, the paid one first', () => {
    const s = summariseUsage(
      [
        row({ provider: 'gemini', model: 'gemini-3.8-flash' }),
        row({ provider: 'gemini', model: 'gemini-3.5-flash-lite' }),
        row({}),
      ],
      7,
      new Date('2026-11-10T00:00:00Z'),
    );
    expect(s.byProvider.map((g) => [g.key, g.label, g.calls])).toEqual([
      ['anthropic', 'Anthropic (Claude)', 1],
      ['gemini', 'Google Gemini', 2],
    ]);
    expect(s.byProvider[1].cost).toBe(0);
    expect(s.total.unpriced).toBe(0);
  });
});

describe('formatting', () => {
  it('shows small costs and large token counts readably', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.0042)).toBe('$0.004');
    expect(formatUsd(0.0003)).toBe('<$0.001');
    expect(formatUsd(3.4)).toBe('$3.40');
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(1234)).toBe('1.2k');
    expect(formatTokens(2_500_000)).toBe('2.5M');
  });
});
