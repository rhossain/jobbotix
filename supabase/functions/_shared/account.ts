// Removing an account for good: its saved AI keys leave Vault, then the auth
// user goes, and the database cascades from the profile row. Used when a user
// deletes their own account and when an admin deletes one.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/** Deletes the account; resolves with what went wrong, or null when it is gone. */
export async function deleteAccount(
  admin: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const [{ data: profile }, { data: connections }] = await Promise.all([
    admin
      .from('profiles')
      .select('anthropic_key_ref')
      .eq('id', userId)
      .maybeSingle(),
    admin.from('ai_connections').select('key_ref').eq('user_id', userId),
  ]);
  // Every saved AI key leaves Vault with the account (the connections
  // themselves go with the profile).
  const secrets = new Set<string>(
    [
      profile?.anthropic_key_ref,
      ...(connections ?? []).map((c: { key_ref: string }) => c.key_ref),
    ].filter((n): n is string => !!n),
  );
  for (const name of secrets) {
    const { error } = await admin.rpc('vault_delete_secret', { p_name: name });
    if (error) return `Key: ${error.message}`;
  }
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return error.message;
  await tellBrowsers(userId);
  return null;
}

/**
 * Tells every browser signed in to this account to check its session now, so
 * a deleted or suspended account is signed out at once instead of at the
 * app's next routine check. A Realtime broadcast on the account's own
 * channel; the message carries nothing, and the browser decides by asking
 * the auth server, so a forged one only causes a harmless check. Best
 * effort: a failure here never fails the delete or the suspension.
 */
export async function tellBrowsers(userId: string): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return;
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ topic: `account:${userId}`, event: 'ended', payload: {} }],
      }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    /* the app's own check catches it within a minute */
  }
}
