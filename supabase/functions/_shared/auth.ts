// Resolves the bearer ingest key on a request to its owner. Shared by the
// functions a user's scheduled task calls (ingest-roles, list-roles).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const json = (status: number, body: unknown, extra: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  });

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    {
      auth: { persistSession: false },
    },
  );
}

/** Returns the user id for a valid ingest key, or a ready-made error Response. */
export async function resolveIngestKey(
  req: Request,
  admin: SupabaseClient,
): Promise<string | Response> {
  const bearer = req.headers
    .get('authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim();
  if (!bearer || !bearer.startsWith('jbx_'))
    return json(401, { error: 'Missing ingest key' });
  const { data: userId, error } = await admin.rpc('resolve_ingest_key', {
    p_key: bearer,
  });
  if (error) return json(500, { error: error.message });
  if (!userId) return json(401, { error: 'Unknown or revoked ingest key' });
  return userId as string;
}

/**
 * Scheduled callers (pg_cron through call_edge_function) send the cron secret
 * as a bearer token. CRON_SECRET is the name to use; DIGEST_CRON_SECRET, set
 * for send-digest, is accepted so one secret serves every job.
 */
export function requireCronSecret(req: Request): Response | null {
  const secret =
    Deno.env.get('CRON_SECRET') || Deno.env.get('DIGEST_CRON_SECRET') || '';
  const bearer = req.headers
    .get('authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim();
  if (!secret || bearer !== secret) return json(401, { error: 'Not allowed' });
  return null;
}
