-- AI connections: a user can connect more than one AI provider with their own
-- key (Anthropic, or a free tier such as Gemini or Groq), in the order they
-- want them tried. Each key lives in Vault; a row here holds only the Vault
-- secret's name, the last four characters for display, and how the last
-- check went.
--
-- Users read their own rows, except key_ref. Only the service role writes
-- (the set-ai-connection Edge Function), because a write goes with a Vault
-- change.

create table public.ai_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null check (provider ~ '^[a-z][a-z0-9_]{1,30}$'),
  key_ref text not null,                        -- Vault secret name, never the key
  key_hint text not null default '' check (length(key_hint) <= 8),
  model text not null default '' check (length(model) <= 120),  -- '' = the provider's default
  position int not null default 0,              -- lower is tried first
  status text not null default 'untested' check (status in ('untested', 'ok', 'error')),
  last_error text not null default '' check (length(last_error) <= 500),
  last_checked_at timestamptz,
  limited_until timestamptz,                    -- the provider's rate limit holds until then
  consented_at timestamptz,                     -- when the user accepted the provider's data terms
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);
create index ai_connections_user on public.ai_connections (user_id, position);
create trigger ai_connections_updated_at before update on public.ai_connections
  for each row execute function public.set_updated_at();

alter table public.ai_connections enable row level security;
create policy "ai_connections: own rows" on public.ai_connections
  for select using (user_id = auth.uid());
-- No write policies, and no read of key_ref: the columns a user may see are
-- granted one by one.
revoke all on public.ai_connections from anon, authenticated;
grant select (id, user_id, provider, key_hint, model, position, status, last_error,
              last_checked_at, limited_until, consented_at, created_at, updated_at)
  on public.ai_connections to authenticated;

-- Keys saved before this migration become the user's first connection, on
-- the model they had chosen as their default.
insert into public.ai_connections (user_id, provider, key_ref, model, status)
select p.id, 'anthropic', p.anthropic_key_ref, coalesce(p.default_model, ''), 'ok'
  from public.profiles p
 where p.anthropic_key_ref is not null
on conflict (user_id, provider) do nothing;

-- Which provider answered each call. Rows before this were all Anthropic.
alter table public.ai_usage
  add column provider text not null default 'anthropic'
    check (provider ~ '^[a-z][a-z0-9_]{1,30}$');

-- The admin overview counts any connection as "has an AI key" and names the
-- providers.
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
           exists (select 1 from public.ai_connections c where c.user_id = p.id) as has_ai_key,
           coalesce((select jsonb_agg(c.provider order by c.position, c.created_at)
                       from public.ai_connections c where c.user_id = p.id), '[]'::jsonb) as ai_providers,
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
