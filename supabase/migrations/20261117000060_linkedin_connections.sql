-- LinkedIn connections, from the archive a member downloads from LinkedIn
-- ("Get a copy of your data") and uploads to Jobbotix themselves. Jobbotix
-- never contacts LinkedIn. The list answers one question: "who do I know at
-- this company?"
--
-- These rows are about other people, so the table is kept small on purpose:
-- a name, where the person works, their job title, the link to their public
-- profile and the day the two connected. There is no column for an email
-- address or a phone number, so one can never be stored, and the rows are
-- visible to their owner alone. They are not contacts: a person is copied
-- into contacts only when the user chooses "Add to contacts". Deleting the
-- account (or pressing "Delete my LinkedIn data") removes them.
create table public.linkedin_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  company text not null default '' check (length(company) <= 200),
  -- their job title ("Engineering Manager")
  title text not null default '' check (length(title) <= 200),
  profile_url text not null default ''
    check (profile_url = '' or (length(profile_url) <= 500 and profile_url ~ '^https://www\.linkedin\.com/in/[^/?#]+$')),
  connected_on date,
  created_at timestamptz not null default now()
);
-- one row per person per account
create unique index linkedin_connections_person
  on public.linkedin_connections (user_id, lower(name), lower(company), profile_url);
-- "who do I know at <company>?"
create index linkedin_connections_company
  on public.linkedin_connections (user_id, lower(company));
alter table public.linkedin_connections enable row level security;
create policy "linkedin_connections: own rows" on public.linkedin_connections
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- LinkedIn allows 30,000 connections; no account needs more rows than that.
create or replace function public.linkedin_connections_cap()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from (select distinct user_id from added) u
     where (select count(*) from public.linkedin_connections c where c.user_id = u.user_id) > 30000
  ) then
    raise exception 'No more than 30000 LinkedIn connections can be kept'
      using errcode = 'check_violation';
  end if;
  return null;
end $$;
create trigger linkedin_connections_cap
  after insert on public.linkedin_connections
  referencing new table as added
  for each statement execute function public.linkedin_connections_cap();
