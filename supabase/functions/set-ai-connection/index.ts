// POST /functions/v1/set-ai-connection     (signed-in user)
//   Authorization: Bearer <user JWT>
//   { "action": "save", "provider": "gemini", "key": "...", "model"?: "...", "consent"?: true }
//   { "action": "test", "id": "<connection id>" }
//   { "action": "update", "id": "...", "model": "..." }     '' = the provider's default
//   { "action": "reorder", "ids": ["...", "..."] }          the order they are tried in
//   { "action": "remove", "id": "..." }
//
// A user's AI connections: their own key for Anthropic, or for a free tier
// such as Gemini or Groq. A key is checked against the provider with one tiny
// call before it is stored in Vault, and is never sent back. Every reply
// carries the user's connections as they now stand (no keys).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, serviceClient } from '../_shared/auth.ts';
import { withCors } from '../_shared/cors.ts';
import {
  listConnections,
  removeConnection,
  reorderConnections,
  saveConnection,
  testConnection,
  type Outcome,
} from '../_shared/connections.ts';

Deno.serve(
  withCors(async (req) => {
    if (req.method !== 'POST') return json(405, { error: 'POST only' });
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

    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      id?: unknown;
      ids?: unknown;
      provider?: unknown;
      key?: unknown;
      model?: unknown;
      consent?: unknown;
    };
    const admin = serviceClient();

    let outcome: Outcome;
    switch (body.action) {
      case 'save':
        outcome = await saveConnection(admin, userId, body);
        break;
      case 'test':
        outcome = await testConnection(admin, userId, body.id);
        break;
      case 'update':
        outcome = await testConnection(
          admin,
          userId,
          body.id,
          body.model ?? '',
        );
        break;
      case 'reorder':
        outcome = await reorderConnections(admin, userId, body.ids);
        break;
      case 'remove':
        outcome = await removeConnection(admin, userId, { id: body.id });
        break;
      default:
        return json(400, { error: 'Unknown action' });
    }

    const connections = await listConnections(admin, userId);
    if (!outcome.ok)
      return json(outcome.status, { error: outcome.error, connections });
    return json(200, { connections, message: outcome.message });
  }),
);
