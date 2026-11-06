-- Edge Functions could never read a user's Anthropic key: they queried
-- vault.decrypted_secrets through the REST API, which exposes only the
-- public schema, so every lookup came back empty and every model call fell
-- back to local templates. This returns one secret by name to the service
-- role only; users and the anon key cannot call it.

create or replace function public.vault_read_secret(p_name text)
returns text language sql stable security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1;
$$;
revoke execute on function public.vault_read_secret(text) from public, anon, authenticated;
grant execute on function public.vault_read_secret(text) to service_role;
