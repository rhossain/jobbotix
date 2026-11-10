// Saving, testing, ordering and removing a user's AI connections. Used by
// the set-ai-connection function (and by set-anthropic-key, kept for app
// versions that still call it). A key goes into Vault under a per-user,
// per-provider name; ai_connections holds that name and never the key.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { probe, type AiAnswer } from './ai.ts';
import { goldenSummary, runGolden, type GoldenResult } from './golden.ts';
import {
  isProviderId,
  MODEL_ID,
  PROVIDERS,
  resolveModel,
  type ProviderId,
} from './providers.ts';
import { readVaultSecret } from './vault.ts';

/** The columns a user may see. */
export const VIEW_COLUMNS =
  'id, provider, key_hint, model, position, status, last_error, last_checked_at, limited_until';

export type Outcome =
  | { ok: true; message?: string; results?: GoldenResult[] }
  | { ok: false; status: number; error: string };

const refuse = (status: number, error: string): Outcome => ({
  ok: false,
  status,
  error,
});

/** The Vault name for a user's key. Anthropic keeps the name it always had. */
export function secretName(provider: ProviderId, userId: string): string {
  return provider === 'anthropic'
    ? `anthropic_key_${userId}`
    : `ai_key_${provider}_${userId}`;
}

/** What a probe's answer means for a key being saved or tested. */
export function probeVerdict(
  provider: ProviderId,
  model: string,
  a: AiAnswer,
):
  | { usable: true; limitedUntil: string | null }
  | { usable: false; status: number; error: string } {
  const name = PROVIDERS[provider].name;
  if (a.ok) return { usable: true, limitedUntil: null };
  switch (a.kind) {
    case 'rate_limited':
      // The key was accepted; the provider is only busy or out of quota.
      return {
        usable: true,
        limitedUntil: new Date(a.retryAt ?? Date.now() + 60_000).toISOString(),
      };
    case 'auth':
      return {
        usable: false,
        status: 422,
        error: `${name} rejected that key. Check it where you created it.`,
      };
    case 'timeout':
      return {
        usable: false,
        status: 504,
        error: `${name} took too long to answer. Try again.`,
      };
    default:
      return {
        usable: false,
        status: a.status === 0 ? 502 : 422,
        error:
          a.status === 404 || /model/i.test(a.message)
            ? `${name} could not run the model "${model}": ${a.message}`
            : `${name} could not be reached${a.status ? ` (${a.status})` : ''}: ${a.message}`,
      };
  }
}

export async function listConnections(admin: SupabaseClient, userId: string) {
  const { data } = await admin
    .from('ai_connections')
    .select(VIEW_COLUMNS)
    .eq('user_id', userId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  return data ?? [];
}

export interface SaveInput {
  provider?: unknown;
  key?: unknown;
  model?: unknown;
  consent?: unknown;
}

/** Checks a key against the provider, stores it, and records the connection. */
export async function saveConnection(
  admin: SupabaseClient,
  userId: string,
  input: SaveInput,
): Promise<Outcome> {
  if (!isProviderId(input.provider)) return refuse(400, 'Unknown AI provider');
  const provider = input.provider;
  const info = PROVIDERS[provider];
  const key = typeof input.key === 'string' ? input.key.trim() : '';
  if (!info.keyPattern.test(key))
    return refuse(
      400,
      `That does not look like a ${info.name} API key (expected something like ${info.keyPlaceholder}).`,
    );
  if (info.needsConsent && input.consent !== true)
    return refuse(
      400,
      `Confirm that you accept ${info.name}'s data terms first.`,
    );
  const saved = typeof input.model === 'string' ? input.model.trim() : '';
  if (saved && !MODEL_ID.test(saved))
    return refuse(400, 'That is not a valid model name');

  const model = resolveModel(provider, saved);
  const verdict = probeVerdict(
    provider,
    model,
    await probe(provider, key, model),
  );
  if (!verdict.usable) return refuse(verdict.status, verdict.error);

  const name = secretName(provider, userId);
  const { error: vErr } = await admin.rpc('vault_upsert_secret', {
    p_name: name,
    p_secret: key,
  });
  if (vErr) return refuse(500, vErr.message);

  const { data: existing } = await admin
    .from('ai_connections')
    .select('id, position, consented_at')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle();
  const now = new Date().toISOString();
  const values = {
    key_ref: name,
    key_hint: key.slice(-4),
    model: saved,
    status: 'ok' as const,
    last_error: '',
    last_checked_at: now,
    limited_until: verdict.limitedUntil,
    consented_at:
      input.consent === true ? now : (existing?.consented_at ?? null),
  };
  if (existing) {
    const { error } = await admin
      .from('ai_connections')
      .update(values)
      .eq('id', existing.id);
    if (error) return refuse(500, error.message);
  } else {
    const { data: last } = await admin
      .from('ai_connections')
      .select('position')
      .eq('user_id', userId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await admin.from('ai_connections').insert({
      ...values,
      user_id: userId,
      provider,
      position: (last?.position ?? -1) + 1,
    });
    if (error) return refuse(500, error.message);
  }
  // Older app versions and account deletion still read this column.
  if (provider === 'anthropic')
    await admin
      .from('profiles')
      .update({ anthropic_key_ref: name })
      .eq('id', userId);
  return {
    ok: true,
    message: verdict.limitedUntil
      ? `Saved. ${info.name} accepted the key but is rate limited right now.`
      : undefined,
  };
}

async function ownRow(admin: SupabaseClient, userId: string, id: unknown) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await admin
    .from('ai_connections')
    .select('id, provider, key_ref, model')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  return data && isProviderId(data.provider)
    ? (data as {
        id: string;
        provider: ProviderId;
        key_ref: string;
        model: string;
      })
    : null;
}

/** Runs the tiny check again and records how it went; optionally on a new model. */
export async function testConnection(
  admin: SupabaseClient,
  userId: string,
  id: unknown,
  newModel?: unknown,
): Promise<Outcome> {
  const row = await ownRow(admin, userId, id);
  if (!row) return refuse(404, 'Connection not found');
  let saved = row.model;
  if (newModel !== undefined) {
    saved = typeof newModel === 'string' ? newModel.trim() : '';
    if (saved && !MODEL_ID.test(saved))
      return refuse(400, 'That is not a valid model name');
  }
  const info = PROVIDERS[row.provider];
  const key = await readVaultSecret(admin, row.key_ref);
  const now = new Date().toISOString();
  if (!key) {
    await admin
      .from('ai_connections')
      .update({
        status: 'error',
        last_error: 'The saved key could not be read. Add it again.',
        last_checked_at: now,
      })
      .eq('id', row.id);
    return refuse(
      422,
      `The saved ${info.name} key could not be read. Add it again.`,
    );
  }
  const model = resolveModel(row.provider, saved);
  const verdict = probeVerdict(
    row.provider,
    model,
    await probe(row.provider, key, model),
  );
  if (!verdict.usable) {
    // A model that does not work is not saved; the connection keeps its old one.
    if (newModel === undefined)
      await admin
        .from('ai_connections')
        .update({
          status: 'error',
          last_error: verdict.error.slice(0, 500),
          last_checked_at: now,
        })
        .eq('id', row.id);
    return refuse(verdict.status, verdict.error);
  }
  const { error } = await admin
    .from('ai_connections')
    .update({
      model: saved,
      status: 'ok',
      last_error: '',
      last_checked_at: now,
      limited_until: verdict.limitedUntil,
    })
    .eq('id', row.id);
  if (error) return refuse(500, error.message);
  return {
    ok: true,
    message: verdict.limitedUntil
      ? `${info.name} accepted the key but is rate limited right now.`
      : `${info.name} answered on ${model}.`,
  };
}

/**
 * The full check (golden.ts): the four core jobs once each on this
 * connection, metered like any other call. Resolves with one result per job.
 */
export async function checkConnection(
  admin: SupabaseClient,
  userId: string,
  id: unknown,
): Promise<Outcome> {
  const row = await ownRow(admin, userId, id);
  if (!row) return refuse(404, 'Connection not found');
  const info = PROVIDERS[row.provider];
  const key = await readVaultSecret(admin, row.key_ref);
  if (!key)
    return refuse(
      422,
      `The saved ${info.name} key could not be read. Add it again.`,
    );
  let retryAt: number | undefined;
  let rejected = '';
  const results = await runGolden(row.provider, key, row.model, {
    onAnswer: async (job, a) => {
      if (a.ok)
        await admin.from('ai_usage').insert({
          user_id: userId,
          job,
          provider: a.provider,
          model: a.model,
          tokens_in: a.tokensIn,
          tokens_out: a.tokensOut,
          cost_usd: 0,
        });
      else if (a.kind === 'rate_limited')
        retryAt = a.retryAt ?? Date.now() + 60_000;
      else if (a.kind === 'auth') rejected = a.message;
    },
  });
  const now = new Date().toISOString();
  await admin
    .from('ai_connections')
    .update(
      rejected
        ? {
            status: 'error',
            last_error: `${info.name} rejected the key: ${rejected}`.slice(
              0,
              500,
            ),
            last_checked_at: now,
          }
        : {
            status: 'ok',
            last_error: '',
            last_checked_at: now,
            limited_until: retryAt ? new Date(retryAt).toISOString() : null,
          },
    )
    .eq('id', row.id);
  return { ok: true, message: goldenSummary(results), results };
}

/** Sets the order connections are tried in; `ids` must be all of the user's. */
export async function reorderConnections(
  admin: SupabaseClient,
  userId: string,
  ids: unknown,
): Promise<Outcome> {
  const { data } = await admin
    .from('ai_connections')
    .select('id')
    .eq('user_id', userId);
  const own = new Set((data ?? []).map((r: { id: string }) => r.id));
  if (
    !Array.isArray(ids) ||
    ids.length !== own.size ||
    new Set(ids).size !== ids.length ||
    !ids.every((id) => typeof id === 'string' && own.has(id))
  )
    return refuse(400, 'The order must list each of your connections once');
  for (const [position, id] of (ids as string[]).entries()) {
    const { error } = await admin
      .from('ai_connections')
      .update({ position })
      .eq('id', id);
    if (error) return refuse(500, error.message);
  }
  return { ok: true };
}

/** Removes the key from Vault and the connection with it. */
export async function removeConnection(
  admin: SupabaseClient,
  userId: string,
  target: { id?: unknown; provider?: ProviderId },
): Promise<Outcome> {
  let row =
    target.id !== undefined ? await ownRow(admin, userId, target.id) : null;
  if (!row && target.provider) {
    const { data } = await admin
      .from('ai_connections')
      .select('id, provider, key_ref, model')
      .eq('user_id', userId)
      .eq('provider', target.provider)
      .maybeSingle();
    row = data as typeof row;
  }
  if (!row)
    return target.provider ? { ok: true } : refuse(404, 'Connection not found');
  const { error: vErr } = await admin.rpc('vault_delete_secret', {
    p_name: row.key_ref,
  });
  if (vErr) return refuse(500, vErr.message);
  const { error } = await admin
    .from('ai_connections')
    .delete()
    .eq('id', row.id);
  if (error) return refuse(500, error.message);
  if (row.provider === 'anthropic')
    await admin
      .from('profiles')
      .update({ anthropic_key_ref: null })
      .eq('id', userId);
  return { ok: true };
}
