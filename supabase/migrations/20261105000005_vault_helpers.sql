-- Vault helpers used by the set-anthropic-key function (service role only).
-- The vault schema exists on every Supabase project; the stub for local
-- plain-Postgres tests lives in supabase/tests/stub-auth.sql.

create or replace function public.vault_upsert_secret(p_name text, p_secret text)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then
    perform vault.create_secret(p_secret, p_name);
  else
    perform vault.update_secret(v_id, p_secret);
  end if;
end $$;
revoke execute on function public.vault_upsert_secret(text, text) from public, anon, authenticated;

create or replace function public.vault_delete_secret(p_name text)
returns void language sql security definer set search_path = public as $$
  delete from vault.secrets where name = p_name;
$$;
revoke execute on function public.vault_delete_secret(text) from public, anon, authenticated;

-- Admins may revoke; users manage their own keys through RLS on ingest_keys.
-- A revoked key keeps its row so the audit trail stays.
