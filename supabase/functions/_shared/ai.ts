// One way to ask a model for text, whichever provider the user connected.
//
//   callProvider()  one request to one provider; the answer or what went wrong
//   runAi()         the user's connections in order: a rate-limited or broken
//                   one is skipped for the next, the reply is checked by the
//                   caller's parser and asked for once more when unreadable,
//                   and every call is written to ai_usage
//
// A call can carry `context`: material that stays the same from one call to
// the next (the person's resume). It is sent ahead of the prompt, and on
// Anthropic it is marked cacheable, so a second job for the same person
// within a few minutes reads it at a fraction of the input price.
//
// Anthropic goes through its Messages API (anthropic.ts); every other
// provider through the OpenAI-compatible chat completions API it offers.
// Keys are read from Vault only at the moment a connection is tried.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { callMessages } from './anthropic.ts';
import {
  isProviderId,
  limitMessage,
  parseModelChoice,
  PROVIDERS,
  resolveModel,
  type ProviderId,
  type ProviderInfo,
} from './providers.ts';
import {
  creditNote,
  platformKey,
  release,
  reserve,
  settle,
  type Reservation,
} from './credits.ts';
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
  /**
   * Material the task works from that repeats across calls, sent ahead of the
   * prompt. Calls share a cached copy only when this text (and `system`) is
   * the same to the character, so build it one way everywhere.
   */
  context?: string;
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
      /** All input tokens, the cached ones included. */
      tokensIn: number;
      tokensOut: number;
      /** Of tokensIn: read from the provider's prompt cache (cheaper). */
      cacheRead?: number;
      /** Of tokensIn: written to the prompt cache by this call (dearer). */
      cacheWrite?: number;
      provider: ProviderId;
      model: string;
      /** Why the model stopped ("stop", "length"), when the provider says. */
      finish?: string;
      /** The model reasoned but wrote no answer: the reply text is empty. */
      thoughtOnly?: boolean;
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
      // The context goes first, so a provider that caches prompt prefixes on
      // its own finds the same opening on the next call.
      {
        role: 'user',
        content: call.context
          ? `${call.context}\n\n${call.prompt}`
          : call.prompt,
      },
    ],
    [info.tokenParam]: reply + (reasoning?.headroom ?? 0),
    ...(typeof call.temperature === 'number'
      ? { temperature: call.temperature }
      : {}),
    ...(reasoning ? { reasoning_effort: reasoning.effort } : {}),
  };
}

/**
 * The user turn for Anthropic. With a context, the context is its own block
 * with a cache breakpoint after it: everything up to there is stored for five
 * minutes and read back at a fraction of the price by the next call that
 * starts the same way. Too short a context is simply not cached.
 */
export function anthropicContent(call: AiCall): unknown {
  if (!call.context) return call.prompt;
  return [
    {
      type: 'text',
      text: call.context,
      cache_control: { type: 'ephemeral' },
    },
    { type: 'text', text: call.prompt },
  ];
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
          messages: [{ role: 'user', content: anthropicContent(call) }],
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
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
      } | null;
      // Anthropic's input_tokens leaves the cached part out; add it back so
      // tokensIn is the whole prompt, and say how much of it was cached.
      const cacheRead = Number(p?.usage?.cache_read_input_tokens ?? 0);
      const cacheWrite = Number(p?.usage?.cache_creation_input_tokens ?? 0);
      return {
        ok: true,
        text: Array.isArray(p?.content)
          ? p.content.map((c) => c.text ?? '').join('')
          : '',
        tokensIn: Number(p?.usage?.input_tokens ?? 0) + cacheRead + cacheWrite,
        tokensOut: Number(p?.usage?.output_tokens ?? 0),
        ...(cacheRead ? { cacheRead } : {}),
        ...(cacheWrite ? { cacheWrite } : {}),
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
    const text = openAiText(json);
    const choice = (
      json as {
        choices?: {
          finish_reason?: unknown;
          message?: { reasoning?: unknown; reasoning_content?: unknown };
        }[];
      } | null
    )?.choices?.[0];
    const thought =
      choice?.message?.reasoning ?? choice?.message?.reasoning_content;
    return {
      ok: true,
      text,
      tokensIn: Number(usage?.prompt_tokens ?? 0),
      tokensOut: Number(usage?.completion_tokens ?? 0),
      provider,
      model,
      ...(typeof choice?.finish_reason === 'string'
        ? { finish: choice.finish_reason }
        : {}),
      ...(!text.trim() && typeof thought === 'string' && thought.trim()
        ? { thoughtOnly: true }
        : {}),
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
  /** false: never use Jobbotix's own key and the account's credits. */
  platform?: boolean;
  now?: () => number;
}

export type RunResult<T> =
  | {
      ok: true;
      value: T;
      text: string;
      provider: ProviderId;
      model: string;
      /** Whose key answered: the account's own, or Jobbotix's (on credits). */
      route: 'own' | 'platform';
      /** Credits the call cost (platform route). */
      credits?: number;
      /** Credits left after it, when known. */
      balance?: number | null;
    }
  | {
      ok: false;
      /**
       * no_connection: nothing to try. no_credits, daily_cap, budget: the
       * account has no key of its own and credits could not be used.
       * Otherwise every route that was tried failed.
       */
      reason:
        | 'no_connection'
        | 'rate_limited'
        | 'bad_output'
        | 'failed'
        | 'no_credits'
        | 'daily_cap'
        | 'budget';
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
/**
 * One AI job for one account. A paying account's credits go first (on
 * Jobbotix's own key), then the account's own connections in order, then
 * credits as the fallback of an account that has no working key (a Free
 * account's trial credits). A model picked for this generation is the
 * account's own, so its connection goes before any credits.
 */
export async function runAi<T = string>(
  admin: Admin,
  userId: string,
  call: AiCall,
  opts: RunOptions<T>,
): Promise<RunResult<T>> {
  const key = opts.platform === false ? '' : platformKey();
  if (!key) return await runOwn(admin, userId, call, opts);

  const picked = parseModelChoice(opts.choice);
  const notes: string[] = [];
  let refused: Reservation | null = null;
  let triedCredits = false;

  if (!picked) {
    const r = await reserve(admin, userId, opts.job, true);
    if (r.ok) {
      triedCredits = true;
      const res = await runPlatform(admin, key, r, call, opts);
      if (res.ok) return res;
      notes.push(res.message);
    } else if (r.reason !== 'fallback') {
      // Asked and refused: asking again after the own keys changes nothing.
      triedCredits = true;
      refused = r;
    }
  }

  const own = await runOwn(admin, userId, call, opts);
  if (own.ok) return own;

  if (!triedCredits) {
    const r = await reserve(admin, userId, opts.job);
    if (r.ok) {
      const res = await runPlatform(admin, key, r, call, opts);
      if (res.ok) return res;
      notes.push(res.message);
    } else refused = r;
  }

  const credit = refused ? creditNote(refused) : '';
  if (own.reason === 'no_connection') {
    // No key of its own: what happened to the credits is the whole story.
    if (notes.length)
      return { ok: false, reason: 'failed', message: notes.join(' ') };
    if (credit && refused && !refused.ok)
      return {
        ok: false,
        reason: refused.reason as 'no_credits' | 'daily_cap' | 'budget',
        message: credit,
      };
    return own;
  }
  return {
    ...own,
    message: [...notes, own.message, credit].filter(Boolean).join(' '),
  };
}

/** The call on Jobbotix's own key, against a hold of the account's credits. */
async function runPlatform<T>(
  admin: Admin,
  key: string,
  hold: Extract<Reservation, { ok: true }>,
  call: AiCall,
  opts: RunOptions<T>,
): Promise<RunResult<T>> {
  const now = opts.now ?? Date.now;
  const used = { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 };
  for (let attempt = 0; attempt < 2; attempt++) {
    const answer = await callProvider(
      'anthropic',
      key,
      hold.model,
      attempt === 0 ? call : { ...call, prompt: call.prompt + RETRY_NOTE },
      now(),
    );
    if (!answer.ok) {
      // What went wrong with Jobbotix's own key is for the logs, not the user.
      console.error(
        `platform ${opts.job} on ${hold.model} failed (${answer.kind} ${answer.status}): ${answer.message}`,
      );
      if (used.tokensIn || used.tokensOut)
        await settle(admin, hold.hold, used, false);
      else await release(admin, hold.hold);
      return {
        ok: false,
        reason: 'failed',
        message: 'Jobbotix AI could not answer just now; no credits were used.',
      };
    }
    used.tokensIn += answer.tokensIn;
    used.tokensOut += answer.tokensOut;
    used.cacheRead += answer.cacheRead ?? 0;
    used.cacheWrite += answer.cacheWrite ?? 0;
    const value = opts.parse
      ? opts.parse(answer.text)
      : (answer.text as unknown as T);
    if (value !== null && value !== undefined && value !== '') {
      const balance = await settle(admin, hold.hold, used);
      return {
        ok: true,
        value: value as T,
        text: answer.text,
        provider: 'anthropic',
        model: hold.model,
        route: 'platform',
        credits: hold.credits,
        balance,
      };
    }
  }
  await settle(admin, hold.hold, used, false);
  return {
    ok: false,
    reason: 'bad_output',
    message:
      'Jobbotix AI did not answer in a form that could be used; no credits were used.',
  };
}

/** The account's own connections, in order. */
async function runOwn<T>(
  admin: Admin,
  userId: string,
  call: AiCall,
  opts: RunOptions<T>,
): Promise<RunResult<T>> {
  const now = opts.now ?? Date.now;
  const all = opts.connections ?? (await loadConnections(admin, userId));
  // A model picked for this generation puts its provider first; the others
  // stay behind it as fallbacks, in the user's order.
  const picked = parseModelChoice(opts.choice)?.provider;
  const conns = all
    .filter((c) => !opts.skip?.includes(c.provider))
    .sort(
      (a, b) => Number(b.provider === picked) - Number(a.provider === picked),
    );
  if (!conns.length) return { ok: false, reason: 'no_connection', message: '' };

  // Saved on the row, and on the row object too: a caller making several
  // calls with one loaded list (a scoring run) must not retry a parked key.
  const patch = (
    conn: ConnectionRow,
    values: Partial<ConnectionRow> & Record<string, unknown>,
  ) => {
    Object.assign(conn, values);
    return admin.from('ai_connections').update(values).eq('id', conn.id);
  };
  const log = (a: Extract<AiAnswer, { ok: true }>) =>
    admin.from('ai_usage').insert({
      user_id: userId,
      job: opts.job,
      provider: a.provider,
      model: a.model,
      tokens_in: a.tokensIn,
      tokens_out: a.tokensOut,
      // Only sent when there is something to say, so a call without caching
      // is logged the same way as before.
      ...(a.cacheRead ? { cache_read_tokens: a.cacheRead } : {}),
      ...(a.cacheWrite ? { cache_write_tokens: a.cacheWrite } : {}),
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
          await patch(conn, { limited_until: new Date(at).toISOString() });
          retryAt = Math.min(retryAt ?? at, at);
        } else {
          failed = true;
          if (answer.kind === 'auth')
            await patch(conn, {
              status: 'error',
              last_error: failureMessage(answer, now()),
              last_checked_at: new Date(now()).toISOString(),
            });
        }
        break;
      }

      await log(answer);
      if (conn.status !== 'ok' || conn.limited_until)
        await patch(conn, {
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
          route: 'own',
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
  timeoutMs = 20_000,
): Promise<AiAnswer> {
  return callProvider(provider, apiKey, model, {
    prompt: 'Reply with the single word: ready',
    maxTokens: 16,
    timeoutMs,
  });
}

/**
 * Whether the provider accepts a key, asked without generating anything (its
 * list of models). For when a provider is too slow to answer the probe: a
 * free tier can take half a minute over one word, which says nothing about
 * the key. 'unknown' when the provider did not give a clear answer.
 */
export async function checkKey(
  provider: ProviderId,
  apiKey: string,
  timeoutMs = 8_000,
): Promise<'accepted' | 'rejected' | 'unknown'> {
  const info = PROVIDERS[provider];
  try {
    const res =
      info.kind === 'anthropic'
        ? await fetch('https://api.anthropic.com/v1/models?limit=1', {
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
            signal: AbortSignal.timeout(timeoutMs),
          })
        : await fetch(`${info.baseUrl}/models`, {
            headers: { authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(timeoutMs),
          });
    if (res.ok) {
      await res.body?.cancel();
      return 'accepted';
    }
    const { json } = await readBody(res);
    return failureKind(res.status, errorDetail(json, res.statusText)) === 'auth'
      ? 'rejected'
      : 'unknown';
  } catch {
    return 'unknown';
  }
}
