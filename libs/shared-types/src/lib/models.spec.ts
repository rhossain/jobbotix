import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL,
  FALLBACK_MODELS,
  modelLine,
  pickModelChoices,
  type ApiModel,
} from './models';

const api: ApiModel[] = [
  {
    id: 'claude-haiku-5-5',
    display_name: 'Claude Haiku 5.5',
    created_at: '2026-09-01T00:00:00Z',
    lifecycle: 'active',
    line: 'haiku',
  },
  {
    id: 'claude-sonnet-5-5',
    display_name: 'Claude Sonnet 5.5',
    created_at: '2026-09-01T00:00:00Z',
    lifecycle: 'active',
    line: 'sonnet',
  },
  {
    id: 'claude-sonnet-5',
    display_name: 'Claude Sonnet 5',
    created_at: '2026-05-01T00:00:00Z',
    lifecycle: 'active',
    line: 'sonnet',
  },
  {
    id: 'claude-opus-5-5',
    display_name: 'Claude Opus 5.5',
    created_at: '2026-09-01T00:00:00Z',
    lifecycle: 'active',
    line: 'opus',
  },
  {
    id: 'claude-fable-5-1',
    display_name: 'Claude Fable 5.1',
    created_at: '2026-08-01T00:00:00Z',
    lifecycle: 'active',
    line: 'fable',
  },
  {
    id: 'claude-sonnet-4-5',
    display_name: 'Claude Sonnet 4.5',
    created_at: '2025-09-29T00:00:00Z',
    lifecycle: 'deprecated',
    line: 'sonnet',
  },
  {
    id: 'claude-haiku-6',
    display_name: 'Claude Haiku 6',
    created_at: '2027-01-01T00:00:00Z',
    lifecycle: 'deprecated',
    line: 'haiku',
  },
];

describe('pickModelChoices', () => {
  it('offers the newest active model of each family, in picker order', () => {
    const out = pickModelChoices(api);
    expect(out.map((m) => m.id)).toEqual([
      'claude-haiku-5-5',
      'claude-sonnet-5-5',
      'claude-opus-5-5',
      'claude-fable-5-1',
    ]);
    expect(out[1].label).toBe('Sonnet 5.5 (default)');
    expect(out[0].label).toBe('Haiku 5.5 (fast, cheapest)');
  });

  it('picks up a new release without a code change', () => {
    const out = pickModelChoices([
      ...api,
      {
        id: 'claude-opus-6',
        display_name: 'Claude Opus 6',
        created_at: '2027-02-01T00:00:00Z',
        lifecycle: 'active',
        line: 'opus',
      },
    ]);
    expect(out.find((m) => m.label.startsWith('Opus'))?.id).toBe(
      'claude-opus-6',
    );
  });

  it("keeps the user's older default so the select can show it", () => {
    const out = pickModelChoices(api, ['claude-sonnet-4-5']);
    expect(out[out.length - 1]).toEqual({
      id: 'claude-sonnet-4-5',
      label: 'Sonnet 4.5 (older)',
    });
  });

  it('falls back to the built-in list when the API gives nothing usable', () => {
    expect(pickModelChoices([])).toEqual(FALLBACK_MODELS);
    expect(FALLBACK_MODELS.some((m) => m.id === DEFAULT_MODEL)).toBe(true);
  });
});

describe('modelLine', () => {
  it('uses the API line, and reads older ids without one', () => {
    expect(modelLine({ id: 'x', line: 'opus' })).toBe('opus');
    expect(modelLine({ id: 'claude-3-5-sonnet-20241022' })).toBe('sonnet');
    expect(modelLine({ id: 'claude-haiku-5-5' })).toBe('haiku');
  });
});
