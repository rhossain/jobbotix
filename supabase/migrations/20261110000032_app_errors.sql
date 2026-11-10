-- Error monitoring without a third-party service: the app reports uncaught
-- errors here through report_error(), grouped by fingerprint per day, and
-- admins read them on /admin. Users can write (through the function) but
-- never read. Rows older than 30 days are purged weekly.

create table public.app_errors (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null check (length(fingerprint) <= 200),
  day date not null default current_date,
  user_id uuid references public.profiles (id) on delete cascade,
  source text not null default 'web' check (source in ('web', 'function')),
  name text not null default '' check (length(name) <= 200),
  message text not null default '' check (length(message) <= 2000),
  stack text not null default '' check (length(stack) <= 8000),
  path text not null default '' check (length(path) <= 500),
  user_agent text not null default '' check (length(user_agent) <= 400),
  count int not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
-- one row per error per user per day; anonymous reports share the null user
create unique index app_errors_group on public.app_errors
  (fingerprint, day, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index app_errors_last_seen on public.app_errors (last_seen desc);
alter table public.app_errors enable row level security;
create policy "app_errors: admin read" on public.app_errors
  for select using (public.is_admin());

-- Records one error. Caps keep a broken page from filling the free database:
-- 30 distinct errors per user per day, 500 distinct errors per day in all.
create or replace function public.report_error(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_fp text := left(coalesce(p ->> 'fingerprint', ''), 200);
  v_nil uuid := '00000000-0000-0000-0000-000000000000';
begin
  if v_fp = '' then return; end if;

  update public.app_errors
     set count = count + 1, last_seen = now()
   where fingerprint = v_fp and day = current_date
     and coalesce(user_id, v_nil) = coalesce(v_user, v_nil);
  if found then return; end if;

  if (select count(*) from public.app_errors
       where day = current_date and coalesce(user_id, v_nil) = coalesce(v_user, v_nil)) >= 30
     or (select count(*) from public.app_errors where day = current_date) >= 500 then
    return;
  end if;

  insert into public.app_errors (fingerprint, user_id, source, name, message, stack, path, user_agent)
  values (
    v_fp, v_user,
    case when p ->> 'source' = 'function' then 'function' else 'web' end,
    left(coalesce(p ->> 'name', ''), 200),
    left(coalesce(p ->> 'message', ''), 2000),
    left(coalesce(p ->> 'stack', ''), 8000),
    left(coalesce(p ->> 'path', ''), 500),
    left(coalesce(p ->> 'userAgent', ''), 400))
  on conflict do nothing;
end $$;
revoke execute on function public.report_error(jsonb) from public;
grant execute on function public.report_error(jsonb) to anon, authenticated;

create or replace function public.purge_app_errors()
returns void language sql security definer set search_path = public as $$
  delete from public.app_errors where last_seen < now() - interval '30 days';
$$;
revoke execute on function public.purge_app_errors() from public, anon, authenticated;

select cron.schedule('purge-app-errors', '50 2 * * 0', $$select public.purge_app_errors()$$);
