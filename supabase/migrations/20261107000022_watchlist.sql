-- Sourcing, phase 4: the company watchlist.
--
-- companies         every company whose applicant-tracking system (ATS) and
--                   board slug Jobbotix knows, shared by all users; found
--                   automatically from pool postings' apply links, or added
--                   when a user follows one
-- company_follows   which users follow which companies (own rows only)
--
-- The "ats" source polls followed companies every hour and, within its
-- budget, discovered ones four times a day, straight from each company's
-- public job-board feed: new roles arrive hours or days before boards copy
-- them. search_profiles.alert_min_score turns on an email the moment a new
-- role scores at least that much.

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  ats_kind text not null check (ats_kind in ('greenhouse', 'lever', 'ashby', 'workable')),
  ats_slug text not null check (ats_slug ~ '^[a-z0-9][a-z0-9_.%-]{0,99}$'),
  name text not null default '',
  first_seen_at timestamptz not null default now(),
  last_polled_at timestamptz,
  last_error text,
  open_roles int not null default 0,
  unique (ats_kind, ats_slug)
);
alter table public.companies enable row level security;
create policy "companies: signed-in read" on public.companies
  for select to authenticated using (true);

create table public.company_follows (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, company_id)
);
create index company_follows_company on public.company_follows (company_id);
alter table public.company_follows enable row level security;
create policy "company_follows: own rows read" on public.company_follows
  for select using (user_id = auth.uid());
create policy "company_follows: own rows delete" on public.company_follows
  for delete using (user_id = auth.uid());
-- inserts go through follow_company(), which also registers the company

-- Pool postings whose apply link names an ATS register their company.
create or replace function public.postings_discover_company()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ats_kind in ('greenhouse', 'lever', 'ashby', 'workable')
     and new.ats_slug ~ '^[a-z0-9][a-z0-9_.%-]{0,99}$' then
    insert into public.companies (ats_kind, ats_slug, name)
    values (new.ats_kind, new.ats_slug, left(new.company, 200))
    on conflict (ats_kind, ats_slug) do nothing;
  end if;
  return new;
end $$;
create trigger postings_discover_company after insert or update of ats_kind, ats_slug
  on public.postings for each row execute function public.postings_discover_company();

insert into public.companies (ats_kind, ats_slug, name)
select distinct on (ats_kind, ats_slug) ats_kind, ats_slug, left(company, 200)
from public.postings
where ats_kind in ('greenhouse', 'lever', 'ashby', 'workable')
  and ats_slug ~ '^[a-z0-9][a-z0-9_.%-]{0,99}$'
order by ats_kind, ats_slug, first_seen_at
on conflict (ats_kind, ats_slug) do nothing;

-- Follow a company by its ATS and slug (read from a role's apply link or a
-- careers URL the user pasted). Registers the company if it is new.
create or replace function public.follow_company(p_kind text, p_slug text, p_name text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_slug text := lower(trim(p_slug));
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if p_kind not in ('greenhouse', 'lever', 'ashby', 'workable') then
    raise exception 'unsupported careers system %', p_kind using errcode = '22023';
  end if;
  if v_slug !~ '^[a-z0-9][a-z0-9_.%-]{0,99}$' then
    raise exception 'not a company board name: %', p_slug using errcode = '22023';
  end if;
  insert into public.companies (ats_kind, ats_slug, name)
  values (p_kind, v_slug, left(coalesce(trim(p_name), ''), 200))
  on conflict (ats_kind, ats_slug) do update
    set name = case when public.companies.name = '' then excluded.name else public.companies.name end
  returning id into v_id;
  insert into public.company_follows (user_id, company_id)
  values (auth.uid(), v_id)
  on conflict do nothing;
  return v_id;
end $$;
revoke execute on function public.follow_company(text, text, text) from public, anon;
grant execute on function public.follow_company(text, text, text) to authenticated;

-- One poll's results per company (service only).
create or replace function public.record_company_polls(p jsonb)
returns void language sql security definer set search_path = public as $$
  update public.companies c set
    last_polled_at = now(),
    last_error = left(x.error, 500),
    open_roles = coalesce(x.open_roles, c.open_roles),
    name = case when c.name = '' and coalesce(x.name, '') <> '' then left(x.name, 200) else c.name end
  from jsonb_to_recordset(coalesce(p, '[]'::jsonb)) as x(id uuid, error text, open_roles int, name text)
  where c.id = x.id;
$$;
revoke execute on function public.record_company_polls(jsonb) from public, anon, authenticated;

insert into public.source_catalog
  (id, name, kind, access, homepage, enabled, max_requests_per_run, attribution, notes)
values
  ('ats', 'Company careers', 'ats', 'public_api', 'https://jobbotix.com/sources', true, 40,
   'Straight from each company''s own careers page.',
   'Public job-board feeds of Greenhouse, Lever, Ashby and Workable. Followed companies are polled hourly; companies found in the pool four times a day, oldest first.')
on conflict (id) do nothing;

alter table public.search_profiles
  add column alert_min_score int check (alert_min_score between 0 and 100);

-- Followed companies every hour (between the :17 fetches and the :50 match).
select cron.schedule(
  'fetch-watchlist', '37 * * * *',
  $$select public.call_edge_function('fetch-sources', '{"sources":["ats"],"followedOnly":true}'::jsonb)$$
);
