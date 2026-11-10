// POST /functions/v1/list-models     (signed-in user)
//   Authorization: Bearer <user JWT>
//
// The Claude models to offer in the app: the newest active model of each
// family that the user's Anthropic key can use (GET /v1/models), plus the
// model saved on their Anthropic connection if it is older. Without an
// Anthropic connection, or when Anthropic cannot be reached, the built-in
// list (models.ts). Other providers' models come from the catalog.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, serviceClient } from '../_shared/auth.ts';
import { withCors } from '../_shared/cors.ts';
import {
  FALLBACK_MODELS,
  pickModelChoices,
  type ApiModel,
} from '../_shared/models.ts';
import { readVaultSecret } from '../_shared/vault.ts';

Deno.serve(
  withCors(async (req) => {
    if (req.method !== 'POST' && req.method !== 'GET')
      return json(405, { error: 'POST or GET only' });
    const jwt = req.headers
      .get('authorization')
      ?.replace(/^Bearer\s+/i, '')
      .trim();
    if (!jwt) return json(401, { error: 'Sign in first' });

    const asUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false },
      },
    );
    const { data: userData } = await asUser.auth.getUser();
    if (!userData?.user)
      return json(401, { error: 'Session expired; sign in again' });

    const admin = serviceClient();
    const { data: conn } = await admin
      .from('ai_connections')
      .select('key_ref, model')
      .eq('user_id', userData.user.id)
      .eq('provider', 'anthropic')
      .maybeSingle();
    const keep = [conn?.model];
    const fallback = (why: string) =>
      json(200, {
        models: withKept(FALLBACK_MODELS, keep),
        source: 'built-in',
        why,
      });

    const apiKey = conn?.key_ref
      ? await readVaultSecret(admin, conn.key_ref)
      : null;
    if (!apiKey) return fallback('no key');

    try {
      const all: ApiModel[] = [];
      let after: string | null = null;
      for (let page = 0; page < 3; page++) {
        const url = new URL('https://api.anthropic.com/v1/models');
        url.searchParams.set('limit', '100');
        if (after) url.searchParams.set('after_id', after);
        const res = await fetch(url, {
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return fallback(`Anthropic ${res.status}`);
        const body = await res.json();
        all.push(...((body?.data ?? []) as ApiModel[]));
        if (!body?.has_more || !body?.last_id) break;
        after = body.last_id;
      }
      return json(200, {
        models: pickModelChoices(all, keep),
        source: 'anthropic',
      });
    } catch (e) {
      return fallback((e as Error).message || 'lookup failed');
    }
  }),
);

/** The built-in list plus the user's own default when it is not on it. */
function withKept(
  list: { id: string; label: string }[],
  keep: (string | null | undefined)[],
) {
  const out = [...list];
  for (const id of keep)
    if (id && !out.some((m) => m.id === id))
      out.push({ id, label: `${id} (older)` });
  return out;
}
