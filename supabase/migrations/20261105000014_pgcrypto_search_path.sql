-- On hosted Supabase pgcrypto lives in the `extensions` schema, and SECURITY
-- DEFINER functions pinned to search_path = public could not see digest() and
-- gen_random_bytes(). Found on first deploy: every ingest call returned
-- "function digest(text, unknown) does not exist". Same bodies, wider path.
create or replace function public.admin_create_invite(p_note text default '', p_max_uses int default 1, p_expires_at timestamptz default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_code text;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 10));
  insert into public.invite_codes (code, created_by, note, max_uses, expires_at)
  values (v_code, auth.uid(), coalesce(p_note, ''), greatest(p_max_uses, 1), p_expires_at);
  return v_code;
end $$;

create or replace function public.create_ingest_key(p_label text default 'Daily job search')
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_key text;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  v_key := 'jbx_' || encode(gen_random_bytes(24), 'hex');
  insert into public.ingest_keys (user_id, key_hash, label)
  values (auth.uid(), encode(digest(v_key, 'sha256'), 'hex'), p_label);
  return v_key;
end $$;

create or replace function public.resolve_ingest_key(p_key text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_user uuid;
begin
  update public.ingest_keys
     set last_used_at = now()
   where key_hash = encode(digest(p_key, 'sha256'), 'hex')
     and revoked_at is null
  returning user_id into v_user;
  return v_user;
end $$;
