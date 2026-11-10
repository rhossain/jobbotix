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
  return error ? error.message : null;
}
