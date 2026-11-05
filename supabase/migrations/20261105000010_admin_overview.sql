-- Admin overview: every user with activity counts, plus totals against the
-- free-tier limits. One RPC, SECURITY DEFINER, admin only.
create or replace function public.admin_overview()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_users jsonb;
  v_totals jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(u order by u.created_at), '[]'::jsonb) into v_users
  from (
    select p.id, p.email, p.name, p.is_admin, p.created_at, p.timezone,
           (p.anthropic_key_ref is not null) as has_ai_key,
           (select count(*) from public.roles r where r.user_id = p.id) as roles,
           (select count(*) from public.roles r where r.user_id = p.id and r.status in ('applied', 'interview', 'offer', 'rejected')) as applied,
           (select max(e.created_at) from public.role_events e where e.user_id = p.id and e.kind = 'run') as last_run,
           (select count(*) from public.role_events e where e.user_id = p.id and e.kind = 'run' and e.created_at > now() - interval '30 days') as runs_30d,
           (select count(*) from public.ai_usage a where a.user_id = p.id and a.created_at > now() - interval '30 days') as ai_calls_30d,
           (select count(*) from public.ingest_keys k where k.user_id = p.id and k.revoked_at is null) as ingest_keys
      from public.profiles p
  ) u;

  select jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'roles', (select count(*) from public.roles),
    'events', (select count(*) from public.role_events),
    'runs_30d', (select count(*) from public.role_events where kind = 'run' and created_at > now() - interval '30 days'),
    'ai_calls_30d', (select count(*) from public.ai_usage where created_at > now() - interval '30 days'),
    'db_bytes', pg_database_size(current_database()),
    'open_requests', (select count(*) from public.invite_requests where invited_code is null),
    'open_codes', (select count(*) from public.invite_codes where revoked_at is null and uses < max_uses and (expires_at is null or expires_at > now()))
  ) into v_totals;

  return jsonb_build_object('users', v_users, 'totals', v_totals);
end $$;
revoke execute on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;
