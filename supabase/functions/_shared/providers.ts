// The AI providers a user can connect with their own key, and everything
// the app and the Edge Functions need to know about each: where requests go,
// which models to offer, what its key looks like, and what the user should
// know before sending their resume there.
//
// Anthropic is called through its own Messages API. Every other provider is
// reached through the OpenAI-compatible chat completions API it offers, so a
// new one is a catalog entry, not new code. Model ids and limits were checked
// against each provider's documentation on 10 Nov 2026; providers rename and
// retire models, so "Test connection" is the source of truth for a user.
//
// Copy of libs/shared-types/src/lib/providers.ts for the Edge runtime; keep
// the two in step.

export type ProviderId = 'anthropic' | 'gemini' | 'groq';

export interface ProviderModel {
  id: string;
  label: string;
}

export interface ProviderInfo {
  id: ProviderId;
  /** Full name: "Google Gemini". */
  name: string;
  /** How requests are sent. */
  kind: 'anthropic' | 'openai';
  /** Base URL of the OpenAI-compatible API ('' for Anthropic). */
  baseUrl: string;
  /** Writing, extraction, research: used unless the user picks another. */
  defaultModel: string;
  /** Scoring many postings in a run: fast and cheap. */
  fastModel: string;
  /** Suggestions for the model field; any id the provider serves works. */
  models: ProviderModel[];
  /** Has a free tier that needs no card. */
  free: boolean;
  /** Where the user creates a key. */
  keyUrl: string;
  keyPlaceholder: string;
  /** A loose shape check that catches a pasted-wrong value before any call. */
  keyPattern: RegExp;
  /** What the user should know about their data, shown before a key is saved. */
  dataNote: string;
  /** The terms may allow training on prompts: the user must tick a box. */
  needsConsent: boolean;
  /** Can search the web during company research. */
  webSearch: boolean;
  /**
   * The four AI jobs have passed the golden tests against the live API with
   * a real key (tools/ai-golden). Until then the app labels the provider
   * "beta".
   */
  verified: boolean;
  /** Name of the output-limit field in the request body (OpenAI kind). */
  tokenParam: 'max_tokens' | 'max_completion_tokens';
  /**
   * Models that think before answering and count that against the output
   * limit: ask for little thinking and leave room for it.
   */
  reasoning?: { models: RegExp; effort: 'low' | 'none'; headroom: number };
  /** Largest reply to ask for, where the free tier's per-minute budget is small. */
  maxOutput?: number;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    kind: 'anthropic',
    baseUrl: '',
    defaultModel: 'claude-sonnet-5-5',
    fastModel: 'claude-haiku-5-5',
    models: [
      { id: 'claude-haiku-5-5', label: 'Haiku 5.5 (fast, cheapest)' },
      { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 (default)' },
      { id: 'claude-opus-5-5', label: 'Opus 5.5 (very strong)' },
      { id: 'claude-fable-5-1', label: 'Fable 5.1 (most capable)' },
    ],
    free: false,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyPlaceholder: 'sk-ant-…',
    keyPattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
    dataNote:
      'Paid by you per call. Anthropic does not train on API prompts by default.',
    needsConsent: false,
    webSearch: true,
    verified: true,
    tokenParam: 'max_tokens',
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.8-flash',
    fastModel: 'gemini-3.5-flash-lite',
    models: [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (default)' },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (fastest)' },
    ],
    free: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'Your Gemini API key',
    keyPattern: /^[A-Za-z0-9._-]{20,200}$/,
    dataNote:
      "Free tier with daily limits. On the free tier Google may use what you send, including your resume, to improve its products (not for users in the EU, UK or EEA). Google's paid tier does not.",
    needsConsent: true,
    webSearch: false,
    verified: false,
    tokenParam: 'max_tokens',
    // Gemini 3 models cannot switch thinking off.
    reasoning: { models: /^gemini-/, effort: 'low', headroom: 4000 },
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'openai/gpt-oss-120b',
    fastModel: 'openai/gpt-oss-20b',
    models: [
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (default)' },
      { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B (fastest)' },
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
    ],
    free: true,
    keyUrl: 'https://console.groq.com/keys',
    keyPlaceholder: 'gsk_…',
    keyPattern: /^gsk_[A-Za-z0-9]{20,200}$/,
    dataNote:
      'Free tier with per-minute and daily limits, running open models. Groq says it does not train on what you send.',
    needsConsent: false,
    webSearch: false,
    verified: false,
    tokenParam: 'max_completion_tokens',
    reasoning: { models: /^openai\/gpt-oss/, effort: 'low', headroom: 1500 },
    // The free tier allows about 8,000 tokens a minute per model, prompt and
    // reply together.
    maxOutput: 4000,
  },
};

/** In the order the app lists them: free ones first. */
export const PROVIDER_ORDER: ProviderId[] = ['gemini', 'groq', 'anthropic'];

export function isProviderId(v: unknown): v is ProviderId {
  return (
    typeof v === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, v)
  );
}

export function providerOf(id: string): ProviderInfo | null {
  return isProviderId(id) ? PROVIDERS[id] : null;
}

/** "Google Gemini" for a known id, the id itself otherwise. */
export function providerName(id: string): string {
  return providerOf(id)?.name ?? id;
}

/** A model id any provider could plausibly serve; keeps junk out of requests. */
export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._/:-]{0,118}$/;

/**
 * A model chosen for one generation. The picker sends "provider:model";
 * a bare "claude-…" id (older app versions) means Anthropic.
 */
export function parseModelChoice(
  v: unknown,
): { provider: ProviderId; model: string } | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const s = v.trim();
  const at = s.indexOf(':');
  const head = at > 0 ? s.slice(0, at) : '';
  if (isProviderId(head)) {
    const model = s.slice(at + 1);
    return MODEL_ID.test(model) ? { provider: head, model } : null;
  }
  return /^claude-[a-z0-9-]+$/.test(s)
    ? { provider: 'anthropic', model: s }
    : null;
}

export const modelChoice = (provider: ProviderId, model: string) =>
  `${provider}:${model}`;

/**
 * The model one call uses on a connection:
 *  1. the model picked for this generation, when it is this provider's;
 *  2. for scoring runs, the provider's fast model;
 *  3. the model saved on the connection;
 *  4. the provider's default.
 */
export function resolveModel(
  provider: ProviderId,
  saved: string,
  opts: { choice?: unknown; fast?: boolean; fastModel?: string } = {},
): string {
  const picked = parseModelChoice(opts.choice);
  if (picked && picked.provider === provider) return picked.model;
  const info = PROVIDERS[provider];
  if (opts.fast) return opts.fastModel || info.fastModel;
  return saved && MODEL_ID.test(saved) ? saved : info.defaultModel;
}

/** A connection as the app sees it (never the key). */
export interface AiConnectionView {
  id: string;
  provider: ProviderId;
  /** Last four characters of the key, for telling keys apart. */
  keyHint: string;
  /** '' means the provider's default model. */
  model: string;
  position: number;
  status: 'untested' | 'ok' | 'error';
  lastError: string;
  lastCheckedAt: string | null;
  /** The provider's rate limit holds until this ISO time, or null. */
  limitedUntil: string | null;
}

/** Reads an ai_connections row (or the function's reply) into a view. */
export function connectionView(row: unknown): AiConnectionView | null {
  if (!row || typeof row !== 'object') return null;
  const o = row as Record<string, unknown>;
  if (typeof o['id'] !== 'string' || !isProviderId(o['provider'])) return null;
  const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '');
  const status = o['status'];
  return {
    id: o['id'],
    provider: o['provider'],
    keyHint: str('key_hint'),
    model: str('model'),
    position: typeof o['position'] === 'number' ? o['position'] : 0,
    status: status === 'ok' || status === 'error' ? status : 'untested',
    lastError: str('last_error'),
    lastCheckedAt: str('last_checked_at') || null,
    limitedUntil: str('limited_until') || null,
  };
}

/** True while the provider's rate limit still holds. */
export function isLimited(
  c: Pick<AiConnectionView, 'limitedUntil'>,
  now: number = Date.now(),
): boolean {
  return !!c.limitedUntil && Date.parse(c.limitedUntil) > now;
}

/** "in under a minute", "in about 12 minutes", "in about 3 hours". */
export function waitWords(untilMs: number, now: number = Date.now()): string {
  const mins = Math.ceil((untilMs - now) / 60_000);
  if (mins <= 1) return 'in under a minute';
  if (mins < 90) return `in about ${mins} minutes`;
  const hours = Math.round(mins / 60);
  return `in about ${hours} hours`;
}

/** One sentence for a provider that is rate limited right now. */
export function limitMessage(
  provider: string,
  untilMs: number,
  now: number = Date.now(),
): string {
  return `${providerName(provider)} has reached its rate limit; it should work again ${waitWords(untilMs, now)}.`;
}

/**
 * The value the picker sends for a model: "provider:model", except a Claude
 * model, which goes as its bare id so functions deployed before connections
 * existed read it too.
 */
export const pickerValue = (provider: ProviderId, model: string) =>
  provider === 'anthropic' && /^claude-[a-z0-9-]+$/.test(model)
    ? model
    : modelChoice(provider, model);

/**
 * The model picker's options for a set of connections: each connection's
 * suggested models, grouped by provider, as picker values.
 */
export function modelOptions(
  connections: Pick<AiConnectionView, 'provider' | 'model'>[],
  anthropicModels: ProviderModel[] = [],
): { provider: ProviderId; name: string; models: ProviderModel[] }[] {
  return connections.map((c) => {
    const info = PROVIDERS[c.provider];
    const base =
      c.provider === 'anthropic' && anthropicModels.length
        ? anthropicModels
        : info.models;
    const models = [...base];
    if (c.model && !models.some((m) => m.id === c.model))
      models.push({ id: c.model, label: c.model });
    return {
      provider: c.provider,
      name: info.name,
      models: models.map((m) => ({
        id: pickerValue(c.provider, m.id),
        label: m.label,
      })),
    };
  });
}
