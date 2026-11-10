// POST   /functions/v1/set-anthropic-key   { "key": "sk-ant-..." }   stores the key
// DELETE /functions/v1/set-anthropic-key                              removes it
//   Authorization: Bearer <user JWT>
//
// Kept for app versions installed before AI connections existed: it saves or
// removes the user's Anthropic connection through the same code as
// set-ai-connection. New code calls set-ai-connection.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, serviceClient } from '../_shared/auth.ts';
import { withCors } from '../_shared/cors.ts';
import { removeConnection, saveConnection } from '../_shared/connections.ts';

Deno.serve(
  withCors(async (req) => {
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
    const admin = serviceClient();

    if (req.method === 'DELETE') {
      const removed = await removeConnection(admin, userId, {
        provider: 'anthropic',
      });
      if (!removed.ok) return json(removed.status, { error: removed.error });
      return json(200, { stored: false });
    }

    const { key } = (await req.json().catch(() => ({}))) as { key?: string };
    const saved = await saveConnection(admin, userId, {
      provider: 'anthropic',
      key,
    });
    if (!saved.ok) return json(saved.status, { error: saved.error });
    return json(200, { stored: true, last4: (key ?? '').trim().slice(-4) });
  }),
);
