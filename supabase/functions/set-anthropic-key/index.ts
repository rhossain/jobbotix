// POST   /functions/v1/set-anthropic-key   { "key": "sk-ant-..." }   stores the key
// DELETE /functions/v1/set-anthropic-key                              removes it
//   Authorization: Bearer <user JWT>
//
// The key goes into Supabase Vault under a per-user secret name; profiles
// only ever holds that name (anthropic_key_ref). The key is checked against
// the Anthropic API once before it is stored so a typo is caught here.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, serviceClient } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'DELETE')
    return json(405, { error: 'POST or DELETE' });
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
  const userId = userData.user.id;
  const secretName = `anthropic_key_${userId}`;
  const admin = serviceClient();

  if (req.method === 'DELETE') {
    const { error } = await admin.rpc('vault_delete_secret', {
      p_name: secretName,
    });
    if (error) return json(500, { error: error.message });
    await admin
      .from('profiles')
      .update({ anthropic_key_ref: null })
      .eq('id', userId);
    return json(200, { stored: false });
  }

  const { key } = (await req.json().catch(() => ({}))) as { key?: string };
  const trimmed = (key ?? '').trim();
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(trimmed))
    return json(400, {
      error:
        'That does not look like an Anthropic API key (they start with sk-ant-).',
    });

  // Verify once with the cheapest possible request.
  const probe = await fetch('https://api.anthropic.com/v1/models?limit=1', {
    headers: { 'x-api-key': trimmed, 'anthropic-version': '2023-06-01' },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!probe || probe.status === 401 || probe.status === 403)
    return json(422, {
      error: 'Anthropic rejected that key. Check it in the Anthropic console.',
    });

  const { error } = await admin.rpc('vault_upsert_secret', {
    p_name: secretName,
    p_secret: trimmed,
  });
  if (error) return json(500, { error: error.message });
  const { error: pErr } = await admin
    .from('profiles')
    .update({ anthropic_key_ref: secretName })
    .eq('id', userId);
  if (pErr) return json(500, { error: pErr.message });
  return json(200, { stored: true, last4: trimmed.slice(-4) });
});
