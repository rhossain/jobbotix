import { describe, expect, it } from 'vitest';
import {
  MODEL_ID,
  PROVIDERS,
  PROVIDER_ORDER,
  connectionView,
  isLimited,
  isProviderId,
  limitMessage,
  modelOptions,
  parseModelChoice,
  providerName,
  resolveModel,
  waitWords,
} from './providers';

describe('the catalog', () => {
  it('lists every provider once, free ones first', () => {
    expect([...PROVIDER_ORDER].sort()).toEqual(Object.keys(PROVIDERS).sort());
    expect(PROVIDERS[PROVIDER_ORDER[0]].free).toBe(true);
  });

  it('every entry is complete and consistent', () => {
    for (const p of Object.values(PROVIDERS)) {
      expect(p.name).toBeTruthy();
      expect(p.dataNote.length).toBeGreaterThan(20);
      expect(p.keyUrl).toMatch(/^https:\/\//);
      expect(MODEL_ID.test(p.defaultModel)).toBe(true);
      expect(MODEL_ID.test(p.fastModel)).toBe(true);
      expect(p.models.some((m) => m.id === p.defaultModel)).toBe(true);
      expect(p.models.some((m) => m.id === p.fastModel)).toBe(true);
      if (p.kind === 'openai') {
        expect(p.baseUrl).toMatch(/^https:\/\/[^ ]+[^/]$/); // no trailing slash
        expect(p.webSearch).toBe(false);
      } else expect(p.baseUrl).toBe('');
    }
  });

  it('a provider whose free tier may train on prompts needs consent', () => {
    expect(PROVIDERS.gemini.needsConsent).toBe(true);
    expect(PROVIDERS.gemini.dataNote).toMatch(/improve its products/);
    expect(PROVIDERS.groq.needsConsent).toBe(false);
    expect(PROVIDERS.anthropic.needsConsent).toBe(false);
  });

  it('key shapes: each accepts its own kind of key and not the others', () => {
    const ant = 'sk-ant-api03-' + 'a'.repeat(40);
    const groq = 'gsk_' + 'B7'.repeat(26);
    const gem = 'AIza' + 'Sy0-_'.repeat(7);
    expect(PROVIDERS.anthropic.keyPattern.test(ant)).toBe(true);
    expect(PROVIDERS.anthropic.keyPattern.test(groq)).toBe(false);
    expect(PROVIDERS.groq.keyPattern.test(groq)).toBe(true);
    expect(PROVIDERS.groq.keyPattern.test(ant)).toBe(false);
    expect(PROVIDERS.gemini.keyPattern.test(gem)).toBe(true);
    expect(PROVIDERS.gemini.keyPattern.test('short')).toBe(false);
    expect(
      PROVIDERS.gemini.keyPattern.test('has spaces in the key value'),
    ).toBe(false);
  });

  it('knows its ids and names', () => {
    expect(isProviderId('gemini')).toBe(true);
    expect(isProviderId('openai')).toBe(false);
    expect(isProviderId('constructor')).toBe(false);
    expect(isProviderId(null)).toBe(false);
    expect(providerName('groq')).toBe('Groq');
    expect(providerName('mystery')).toBe('mystery');
  });
});

describe('parseModelChoice', () => {
  it('reads "provider:model"', () => {
    expect(parseModelChoice('gemini:gemini-3.8-flash')).toEqual({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
    });
    expect(parseModelChoice('groq:openai/gpt-oss-120b')).toEqual({
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
    });
  });

  it('treats a bare Claude id as Anthropic (older app versions send those)', () => {
    expect(parseModelChoice('claude-haiku-5-5')).toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
    });
  });

  it('rejects everything else', () => {
    for (const bad of [
      '',
      '  ',
      null,
      7,
      'gpt-4o',
      'openai:gpt-4o',
      'gemini:',
      'gemini:has space',
      'gemini:' + 'x'.repeat(200),
      'groq:"; drop table',
    ])
      expect(parseModelChoice(bad)).toBeNull();
  });
});

describe('resolveModel', () => {
  it("uses the model picked for this generation when it is this provider's", () => {
    expect(
      resolveModel('gemini', 'gemini-3.5-flash-lite', {
        choice: 'gemini:gemini-3.8-flash',
      }),
    ).toBe('gemini-3.8-flash');
  });

  it('ignores a pick meant for another provider', () => {
    expect(
      resolveModel('groq', '', { choice: 'gemini:gemini-3.8-flash' }),
    ).toBe('openai/gpt-oss-120b');
  });

  it('falls back to the saved model, then the provider default', () => {
    expect(resolveModel('anthropic', 'claude-opus-5-5')).toBe(
      'claude-opus-5-5',
    );
    expect(resolveModel('anthropic', '')).toBe('claude-sonnet-5-5');
    expect(resolveModel('anthropic', 'not a model id')).toBe(
      'claude-sonnet-5-5',
    );
  });

  it('scoring runs use the fast model whatever is saved', () => {
    expect(resolveModel('gemini', 'gemini-3.8-flash', { fast: true })).toBe(
      'gemini-3.5-flash-lite',
    );
    expect(
      resolveModel('anthropic', 'claude-opus-5-5', {
        fast: true,
        fastModel: 'claude-haiku-4-5',
      }),
    ).toBe('claude-haiku-4-5');
  });
});

describe('connections', () => {
  const row = {
    id: 'c1',
    provider: 'gemini',
    key_hint: 'a1b2',
    model: '',
    position: 2,
    status: 'ok',
    last_error: '',
    last_checked_at: '2026-11-10T10:00:00Z',
    limited_until: null,
  };

  it('reads a row into a view', () => {
    expect(connectionView(row)).toEqual({
      id: 'c1',
      provider: 'gemini',
      keyHint: 'a1b2',
      model: '',
      position: 2,
      status: 'ok',
      lastError: '',
      lastCheckedAt: '2026-11-10T10:00:00Z',
      limitedUntil: null,
    });
  });

  it('drops rows it cannot place and repairs an odd status', () => {
    expect(connectionView({ ...row, provider: 'mystery' })).toBeNull();
    expect(connectionView({ ...row, id: 5 })).toBeNull();
    expect(connectionView(null)).toBeNull();
    expect(connectionView({ ...row, status: 'weird' })?.status).toBe(
      'untested',
    );
  });

  it('never carries a key or its Vault name into the view', () => {
    const v = connectionView({ ...row, key_ref: 'ai_key_gemini_1', key: 'x' });
    expect(JSON.stringify(v)).not.toMatch(/ai_key_gemini_1|"key"/);
  });

  it('knows when a rate limit still holds', () => {
    const now = Date.parse('2026-11-10T12:00:00Z');
    expect(isLimited({ limitedUntil: '2026-11-10T12:05:00Z' }, now)).toBe(true);
    expect(isLimited({ limitedUntil: '2026-11-10T11:59:00Z' }, now)).toBe(
      false,
    );
    expect(isLimited({ limitedUntil: null }, now)).toBe(false);
  });
});

describe('rate-limit wording', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  it('says how long in plain words', () => {
    expect(waitWords(now + 20_000, now)).toBe('in under a minute');
    expect(waitWords(now + 12 * 60_000, now)).toBe('in about 12 minutes');
    expect(waitWords(now + 3 * 3_600_000, now)).toBe('in about 3 hours');
    expect(waitWords(now - 5_000, now)).toBe('in under a minute');
  });
  it('names the provider', () => {
    expect(limitMessage('gemini', now + 12 * 60_000, now)).toBe(
      'Google Gemini has reached its rate limit; it should work again in about 12 minutes.',
    );
  });
});

describe('modelOptions', () => {
  it("groups each connection's models as picker values", () => {
    const groups = modelOptions([
      { provider: 'gemini', model: '' },
      { provider: 'anthropic', model: 'claude-old-1' },
    ]);
    expect(groups.map((g) => g.name)).toEqual([
      'Google Gemini',
      'Anthropic (Claude)',
    ]);
    expect(groups[0].models[0]).toEqual({
      id: 'gemini:gemini-3.8-flash',
      label: 'Gemini 3.8 Flash (default)',
    });
    // a saved model that is not a suggestion stays selectable
    // (a Claude model goes as its bare id, which older functions read too)
    expect(groups[1].models.at(-1)).toEqual({
      id: 'claude-old-1',
      label: 'claude-old-1',
    });
  });

  it('every option parses back to its provider and model', () => {
    const groups = modelOptions([
      { provider: 'gemini', model: '' },
      { provider: 'groq', model: '' },
      { provider: 'anthropic', model: 'Custom.Model' },
    ]);
    for (const g of groups)
      for (const m of g.models)
        expect(parseModelChoice(m.id)?.provider).toBe(g.provider);
    expect(groups[2].models.at(-1)?.id).toBe('anthropic:Custom.Model');
  });

  it('uses the live Claude list when the key could fetch one', () => {
    const [g] = modelOptions(
      [{ provider: 'anthropic', model: '' }],
      [{ id: 'claude-sonnet-6', label: 'Sonnet 6 (default)' }],
    );
    expect(g.models).toEqual([
      { id: 'claude-sonnet-6', label: 'Sonnet 6 (default)' },
    ]);
  });
});
