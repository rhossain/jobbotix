-- Several search profiles per account (feature multiple_profiles, Pro).
--
-- Until now an account had one row in search_profiles, marked active. From
-- here an account can hold several, and every row is searched each hour:
--   active = true    the main profile: one per account (the unique index
--                    search_profiles_one_active stays). Its email settings
--                    (digest time, days, minimum score) are the account's.
--   active = false   a further profile: its own roles, stacks, rules, country
--                    and alert score.
-- How many an account may hold is the plan's limits.search_profiles (Free 1,
-- Pro 5). A profile beyond the limit, left over after a plan ends, is kept
-- and shown but not searched (match-postings applies the limit too).

-- Every row is searched from now on, so a row that is not active must be one
-- somebody made on purpose. The app has never made one; stop if the data
-- says otherwise, so it is looked at before it starts being searched.
do $$ begin
  if exists (select 1 from public.search_profiles where not active) then
    raise exception 'search_profiles holds inactive rows; decide what they are before this migration runs';
  end if;
end $$;

-- Which profile filed a role, for "found by" in the app. Kept when the
-- profile is deleted, without the link.
alter table public.roles
  add column search_profile_id uuid references public.search_profiles (id) on delete set null;

-- A new profile: the account's first is the main one and any other is not,
-- whatever the caller sent, and the plan's limit is checked here so it holds
-- for every way of writing the row. While billing is off for the account the
-- largest limit any plan has applies.
create or replace function public.search_profiles_place()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_have int;
  v_limit int;
begin
  select count(*) into v_have from public.search_profiles where user_id = new.user_id;
  v_limit := coalesce(
    (public.entitlements_for(new.user_id) -> 'limits' ->> 'search_profiles')::int,
    (select max((limits ->> 'search_profiles')::int) from public.plans),
    1);
  if v_have >= greatest(v_limit, 1) then
    raise exception 'Your plan allows % search profile(s)', greatest(v_limit, 1)
      using errcode = 'P0001', hint = 'search_profiles_limit';
  end if;
  new.active := v_have = 0;
  return new;
end $$;
create trigger search_profiles_place before insert on public.search_profiles
  for each row execute function public.search_profiles_place();

-- Which profile is the main one is not the user's to flip by hand: the unique
-- index allows one, and the rows around it rely on there being exactly one.
-- (The promotion below runs from inside a trigger, one level down, and is
-- let through.)
create or replace function public.search_profiles_keep_main()
returns trigger language plpgsql as $$
begin
  if new.active is distinct from old.active and auth.uid() is not null
     and pg_trigger_depth() < 2 then
    new.active := old.active;
  end if;
  return new;
end $$;
create trigger search_profiles_keep_main before update on public.search_profiles
  for each row execute function public.search_profiles_keep_main();

-- If the main profile is deleted while others remain, the oldest of them
-- becomes the main one, so the account always has one. (When the whole
-- account is deleted the other rows are already gone and nothing happens.)
create or replace function public.search_profiles_promote()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.active then
    update public.search_profiles set active = true
     where id = (select id from public.search_profiles
                  where user_id = old.user_id
                  order by created_at, id limit 1);
  end if;
  return null;
end $$;
create trigger search_profiles_promote after delete on public.search_profiles
  for each row execute function public.search_profiles_promote();
