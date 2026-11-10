// One way to ask a model for text, whichever provider the user connected.
//
//   callProvider()  one request to one provider; the answer or what went wrong
//   runAi()         the user's connections in order: a rate-limited or broken
//                   one is skipped for the next, the reply is checked by the
//                   caller's parser and asked for once more when unreadable,
//                   and every call is written to ai_usage
//
// Anthropic goes through its Messages API (anthropic.ts); every other
// provider through the OpenAI-compatible chat completions API it offers.
// Keys are read from Vault only at the moment a connection is tried.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { callMessages } from './anthropic.ts';
import {
  isProviderId,
  limitMessage,
  PROVIDERS,
  resolveModel,
  type ProviderId,
  type ProviderInfo,
} from './providers.ts';
import { readVaultSecret } from './vault.ts';

export type AiJobName =
  | 'extract'
  | 'score'
  | 'tailor'
  | 'letter'
  | 'answer'
  | 'prep'
  | 'import'
  | 'research'
  | 'thank_you'
  | 'message';

export interface AiCall {
  prompt: string;
  system?: string;
  /** Room the reply itself needs; thinking headroom is added per model. */
  maxTokens: number;
  timeoutMs: number;
  temperature?: number;
}

export type AiFailureKind =
  'rate_limited' | 'auth' | 'too_large' | 'timeout' | 'error';

export type AiAnswer =
  | {
      ok: true;
      text: string;
      tokensIn: number;
      tokensOut: number;
      provider: ProviderId;
      model: string;
    }
  | {
      ok: false;
      kind: AiFailureKind;
      status: number;
      /** What the provider said, trimmed; never contains the key. */
      message: string;
      /** For rate limits: when to try again (ms since epoch). */
      retryAt?: number;
      provider: ProviderId;
      model: string;
    };

const DAY = 86_400_000;

/** "2m59.56s", "7.66s", "1h2m3s", "250ms" → milliseconds; null when not a duration. */
export function parseDuration(v: string): number | null {
  const s = v.trim();
  if (!/^(\d+(\.\d+)?(ms|h|m|s))+$/.test(s)) return null;
  let ms = 0;
  for (const [, n, unit] of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    const x = Number(n);
    ms +=
      unit === 'h'
        ? x * 3_600_000
        : unit === 'm'
          ? x * 60_000
          : unit === 's'
            ? x * 1000
            : x;
  }
  return ms;
}

/**
 * When a rate-limited call may be retried: the Retry-After header (seconds or
 * a date), a provider's reset header, or the delay named in the error body
 * ("Please retry in 34.2s", "retryDelay": "34s"). A minute when nothing says.
 * Never more than a day ahead, so one odd header cannot park a connection.
 */
export function retryAtFrom(
  headers: Headers,
  body: string,
  now: number = Date.now(),
): number {
  const waits: number[] = [];
  const ra = headers.get('retry-after')?.trim();
  if (ra) {
    if (/^\d+(\.\d+)?$/.test(ra)) waits.push(Number(ra) * 1000);
    else if (!Number.isNaN(Date.parse(ra))) waits.push(Date.parse(ra) - now);
  }
  if (!waits.length)
    for (const h of [
      'x-ratelimit-reset-requests',
      'x-ratelimit-reset-tokens',
    ]) {
      const d = parseDuration(headers.get(h) ?? '');
      // These are sent on every reply; only one that is still ahead matters.
      if (d !== null && d > 0) waits.push(d);
    }
  const inBody =
    body.match(/retry(?:ing)? (?:in|after) (\d+(?:\.\d+)?)\s*s/i)?.[1] ??
    body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/)?.[1];
  if (inBody) waits.push(Number(inBody) * 1000);
  const wait = waits.length ? Math.max(...waits) : 60_000;
  return now + Math.min(Math.max(wait, 1000), DAY);
}

/** The provider's own words for an error, whatever shape the body has. */
export function errorDetail(payload: unknown, fallback: string): string {
  const first = Array.isArray(payload) ? payload[0] : payload;
  const err = (first as { error?: unknown } | null)?.error;
  const msg =
    typeof err === 'string'
      ? err
      : ((err as { message?: unknown } | undefined)?.message ??
        (first as { message?: unknown } | null)?.message);
  return String(msg || fallback || 'Request failed')
    .replace(/\s+/g, ' ')
    .slice(0, 300);
}

function failureKind(status: number, detail: string): AiFailureKind {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'auth';
  // Gemini answers a bad key with 400.
  if (status === 400 && /api[ _-]?key/i.test(detail)) return 'auth';
  if (
    status === 413 ||
    /request too large|context length|too many tokens/i.test(detail)
  )
    return 'too_large';
  if (status === 408 || status === 504) return 'timeout';
  return 'error';
}

/** Text of an OpenAI-style reply: a string, or parts with text in them. */
function openAiText(payload: unknown): string {
  const content = (
    payload as { choices?: { message?: { content?: unknown } }[] } | null
  )?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .map((c) => (typeof c?.text === 'string' ? c.text : ''))
      .join('');
  return '';
}

/** The request body for an OpenAI-compatible provider. */
export function openAiBody(
  info: ProviderInfo,
  model: string,
  call: AiCall,
  withReasoning = true,
): Record<string, unknown> {
  const reasoning =
    withReasoning && info.reasoning?.models.test(model) ? info.reasoning : null;
  const reply = Math.min(call.maxTokens, info.maxOutput ?? call.maxTokens);
  return {
    model,
    messages: [
      ...(call.system ? [{ role: 'system', content: call.system }] : []),
      { role: 'user', content: call.prompt },
    ],
    [info.tokenParam]: reply + (reasoning?.headroom ?? 0),
    ...(typeof call.temperature === 'number'
      ? { temperature: call.temperature }
      : {}),
    ...(reasoning ? { reasoning_effort: reasoning.effort } : {}),
  };
}

async function readBody(
  res: Response,
): Promise<{ raw: string; json: unknown }> {
  const raw = await res.text().catch(() => '');
  try {
    return { raw, json: JSON.parse(raw) };
  } catch {
    return { raw, json: null };
  }
}

/** One request to one provider. Never throws. */
export async function callProvider(
  provider: ProviderId,
  apiKey: string,
  model: string,
  call: AiCall,
  now: number = Date.now(),
): Promise<AiAnswer> {
  const info = PROVIDERS[provider];
  const fail = (
    kind: AiFailureKind,
    status: number,
    message: string,
    retryAt?: number,
  ): AiAnswer => ({
    ok: false,
    kind,
    status,
    message,
    retryAt,
    provider,
    model,
  });

  try {
    if (info.kind === 'anthropic') {
      const res = await callMessages(
        apiKey,
        {
          model,
          max_tokens: call.maxTokens,
          ...(call.system ? { system: call.system } : {}),
          ...(typeof call.temperature === 'number'
            ? { temperature: call.temperature }
            : {}),
          messages: [{ role: 'user', content: call.prompt }],
        },
        call.timeoutMs,
      );
      const { raw, json } = await readBody(res);
      if (!res.ok) {
        const detail = errorDetail(json, res.statusText);
        const kind = failureKind(res.status, detail);
        return fail(
          kind,
          res.status,
          detail,
          kind === 'rate_limited'
            ? retryAtFrom(res.headers, raw, now)
            : undefined,
        );
      }
      const p = json as {
        content?: { text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      } | null;
      return {
        ok: true,
        text: Array.isArray(p?.content)
          ? p.content.map((c) => c.text ?? '').join('')
          : '',
        tokensIn: Number(p?.usage?.input_tokens ?? 0),
        tokensOut: Number(p?.usage?.output_tokens ?? 0),
        provider,
        model,
      };
    }

    const send = (body: Record<string, unknown>) =>
      fetch(`${info.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(call.timeoutMs),
      });
    let res = await send(openAiBody(info, model, call));
    let { raw, json } = await readBody(res);
    // A model that does not take the thinking setting: once more without it.
    if (
      res.status === 400 &&
      info.reasoning?.models.test(model) &&
      /reasoning|thinking/i.test(raw)
    ) {
      res = await send(openAiBody(info, model, call, false));
      ({ raw, json } = await readBody(res));
    }
    if (!res.ok) {
      const detail = errorDetail(json, res.statusText);
      const kind = failureKind(res.status, detail);
      return fail(
        kind,
        res.status,
        detail,
        kind === 'rate_limited'
          ? retryAtFrom(res.headers, raw, now)
          : undefined,
      );
    }
    const usage = (
      json as {
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      } | null
    )?.usage;
    return {
      ok: true,
      text: openAiText(json),
      tokensIn: Number(usage?.prompt_tokens ?? 0),
      tokensOut: Number(usage?.completion_tokens ?? 0),
      provider,
      model,
    };
  } catch (e) {
    const err = e as Error;
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return fail(
      timedOut ? 'timeout' : 'error',
      0,
      timedOut
        ? `${info.name} took too long to answer`
        : `Could not reach ${info.name}: ${String(err?.message ?? err).slice(0, 200)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// The user's connections
// ---------------------------------------------------------------------------

export interface ConnectionRow {
  id: string;
  provider: ProviderId;
  key_ref: string;
  model: string;
  position: number;
  status: 'untested' | 'ok' | 'error';
  limited_until: string | null;
}

type Admin = Pick<SupabaseClient, 'from' | 'rpc'>;

/** The user's connections in the order they are tried. No keys. */
export async function loadConnections(
  admin: Admin,
  userId: string,
): Promise<ConnectionRow[]> {
  const { data, error } = await admin
    .from('ai_connections')
    .select('id, provider, key_ref, model, position, status, limited_until')
    .eq('user_id', userId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    console.warn(`ai_connections lookup failed: ${error.message}`);
    return [];
  }
  return ((data ?? []) as ConnectionRow[]).filter((c) =>
    isProviderId(c.provider),
  );
}

export interface RunOptions<T> {
  job: AiJobName;
  /** The model picked for this generation ("provider:model"), if any. */
  choice?: unknown;
  /** A scoring run: use each provider's fast model. */
  fast?: boolean;
  /** Overrides Anthropic's fast model (the admin's triage model setting). */
  anthropicFastModel?: string;
  /** Turns the reply into what the caller needs; null when it is unreadable. */
  parse?: (text: string) => T | null | undefined;
  /** Leave these providers out (research tries Anthropic its own way first). */
  skip?: ProviderId[];
  /** Connections loaded earlier in the request, to save a query. */
  connections?: ConnectionRow[];
  now?: () => number;
}

export type RunResult<T> =
  | {
      ok: true;
      value: T;
      text: string;
      provider: ProviderId;
      model: string;
    }
  | {
      ok: false;
      /** no_connection: nothing to try. Otherwise every connection failed. */
      reason: 'no_connection' | 'rate_limited' | 'bad_output' | 'failed';
      /** One plain sentence for the user; '' when there is no connection. */
      message: string;
      retryAt?: number;
    };

const RETRY_NOTE =
  '\n\nYour previous reply could not be read. Answer again in exactly the format asked for above, with nothing before or after it.';

/** One sentence for a failed call, without the provider's raw wording for auth. */
function failureMessage(
  a: Extract<AiAnswer, { ok: false }>,
  now: number,
): string {
  const name = PROVIDERS[a.provider].name;
  switch (a.kind) {
    case 'rate_limited':
      return limitMessage(a.provider, a.retryAt ?? now + 60_000, now);
    case 'auth':
      return `${name} rejected your key. Check it in Settings.`;
    case 'too_large':
      return `This was too long for ${name}'s limits on ${a.model}.`;
    case 'timeout':
      return `${name} took too long to answer.`;
    default:
      return `${name} could not answer${a.status ? ` (${a.status})` : ''}: ${a.message}`;
  }
}

/**
 * Asks the user's connections in order until one gives a usable reply.
 * Never throws; a caller without a usable reply falls back to its local
 * draft and can show `message`.
 */
export async function runAi<T = string>(
  admin: Admin,
  userId: string,
  call: AiCall,
  opts: RunOptions<T>,
): Promise<RunResult<T>> {
  const now = opts.now ?? Date.now;
  const all = opts.connections ?? (await loadConnections(admin, userId));
  const conns = all.filter((c) => !opts.skip?.includes(c.provider));
  if (!conns.length) return { ok: false, reason: 'no_connection', message: '' };

  const patch = (id: string, values: Record<string, unknown>) =>
    admin.from('ai_connections').update(values).eq('id', id);
  const log = (a: Extract<AiAnswer, { ok: true }>) =>
    admin.from('ai_usage').insert({
      user_id: userId,
      job: opts.job,
      provider: a.provider,
      model: a.model,
      tokens_in: a.tokensIn,
      tokens_out: a.tokensOut,
      cost_usd: 0,
    });

  // What went wrong on the way, in the order it happened, for the user.
  const notes: string[] = [];
  const note = (m: string) => {
    if (m && !notes.includes(m)) notes.push(m);
  };
  let retryAt: number | undefined;
  let failed = false;
  let unreadable = false;

  for (const conn of conns) {
    const info = PROVIDERS[conn.provider];
    const until = conn.limited_until ? Date.parse(conn.limited_until) : 0;
    if (until > now()) {
      note(limitMessage(conn.provider, until, now()));
      retryAt = Math.min(retryAt ?? until, until);
      continue;
    }
    const apiKey = await readVaultSecret(admin as SupabaseClient, conn.key_ref);
    if (!apiKey) {
      note(
        `The saved ${info.name} key could not be read. Add it again in Settings.`,
      );
      failed = true;
      continue;
    }
    const model = resolveModel(conn.provider, conn.model, {
      choice: opts.choice,
      fast: opts.fast,
      fastModel:
        conn.provider === 'anthropic' ? opts.anthropicFastModel : undefined,
    });

    // The reply is asked for once more when the parser cannot read it.
    for (let attempt = 0; attempt < 2; attempt++) {
      const answer = await callProvider(
        conn.provider,
        apiKey,
        model,
        attempt === 0 ? call : { ...call, prompt: call.prompt + RETRY_NOTE },
        now(),
      );
      if (!answer.ok) {
        note(failureMessage(answer, now()));
        if (answer.kind === 'rate_limited') {
          const at = answer.retryAt ?? now() + 60_000;
          await patch(conn.id, { limited_until: new Date(at).toISOString() });
          retryAt = Math.min(retryAt ?? at, at);
        } else {
          failed = true;
          if (answer.kind === 'auth')
            await patch(conn.id, {
              status: 'error',
              last_error: failureMessage(answer, now()),
              last_checked_at: new Date(now()).toISOString(),
            });
        }
        break;
      }

      await log(answer);
      if (conn.status !== 'ok' || conn.limited_until)
        await patch(conn.id, {
          status: 'ok',
          last_error: '',
          limited_until: null,
          last_checked_at: new Date(now()).toISOString(),
        });
      const value = opts.parse
        ? opts.parse(answer.text)
        : (answer.text as unknown as T);
      if (value !== null && value !== undefined && value !== '')
        return {
          ok: true,
          value: value as T,
          text: answer.text,
          provider: answer.provider,
          model: answer.model,
        };
      if (attempt === 1) {
        unreadable = true;
        note(
          `${info.name} (${model}) did not answer in a form Jobbotix could read.`,
        );
      }
    }
  }

  return {
    ok: false,
    reason: unreadable ? 'bad_output' : failed ? 'failed' : 'rate_limited',
    message: notes.join(' ') || 'The model could not be reached.',
    ...(retryAt && !failed && !unreadable ? { retryAt } : {}),
  };
}

/**
 * What to tell the user when AI was tried and the local draft stands
 * instead; undefined when there was simply no connection.
 */
export function aiNote(
  r: RunResult<unknown>,
  fallback: string,
): string | undefined {
  if (r.ok || r.reason === 'no_connection') return undefined;
  return `${r.message} ${fallback}`.trim();
}

/**
 * A tiny call that proves a key and model work: used when a key is saved and
 * by "Test connection".
 */
export function probe(
  provider: ProviderId,
  apiKey: string,
  model: string,
): Promise<AiAnswer> {
  return callProvider(provider, apiKey, model, {
    prompt: 'Reply with the single word: ready',
    maxTokens: 16,
    timeoutMs: 20_000,
  });
}
