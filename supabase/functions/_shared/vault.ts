import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * Reads a secret stored in Supabase Vault by name; null when absent. Goes
 * through vault_read_secret() (migration 0020, service role only): the REST
 * API exposes only the public schema, so querying vault.decrypted_secrets
 * directly always came back empty.
 */
export async function readVaultSecret(
  admin: SupabaseClient,
  name: string,
): Promise<string | null> {
  const { data, error } = await admin.rpc('vault_read_secret', {
    p_name: name,
  });
  if (error) {
    console.warn(`vault_read_secret failed: ${error.message}`);
    return null;
  }
  return typeof data === 'string' && data ? data : null;
}
