// GET /functions/v1/list-roles
//   Authorization: Bearer jbx_<ingest key>
//
// What a search run needs to deduplicate before it spends effort on a posting:
// every URL the user already has, the (company, title) pairs, and the URLs it
// excluded in the last 45 days. Nothing else leaves the account through this
// endpoint: no notes, letters or posting text.

import { json, resolveIngestKey, serviceClient } from '../_shared/auth.ts';
import { buildDedupeIndex } from '../_shared/dedupe.ts';

Deno.serve(async (req) => {
  if (req.method !== 'GET') return json(405, { error: 'GET only' });

  const admin = serviceClient();
  const userId = await resolveIngestKey(req, admin);
  if (userId instanceof Response) return userId;

  const since = new Date(Date.now() - 45 * 86_400_000).toISOString();
  const [roles, excluded] = await Promise.all([
    admin
      .from('roles')
      .select('url, company, title, status')
      .eq('user_id', userId)
      .limit(5000),
    admin
      .from('excluded_roles')
      .select('url')
      .eq('user_id', userId)
      .gte('found_at', since)
      .limit(5000),
  ]);
  if (roles.error) return json(500, { error: roles.error.message });

  return json(200, buildDedupeIndex(roles.data ?? [], excluded.data ?? []), {
    'cache-control': 'no-store',
  });
});
