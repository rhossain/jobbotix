import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/** Reads a secret stored in Supabase Vault by name (service role); null when absent. */
export async function readVaultSecret(
  admin: SupabaseClient,
  name: string,
): Promise<string | null> {
  const { data } = await admin
    .schema('vault')
    .from('decrypted_secrets')
    .select('decrypted_secret')
    .eq('name', name)
    .maybeSingle();
  return (
    (data as { decrypted_secret?: string } | null)?.decrypted_secret ?? null
  );
}
