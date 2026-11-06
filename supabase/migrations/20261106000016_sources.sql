-- Sourcing, phase 1: Jobbotix fetches postings itself.
--
--   source_catalog   one row per adapter (board, aggregator, ATS, ...) with
--                    its budget and health; readable by every signed-in user
--   source_runs      one row per adapter run; admin-only
--   postings         the shared pool: each public posting stored once for all
--                    users, keyed by a hash of company and title
--   posting_sources  where each posting was seen ("also on Remotive")
--
-- Judgement stays private: scores, letters, status and notes live in the
-- per-user roles table exactly as before. roles gains a link to the pool and
-- the location fields the country filter needs; search_profiles gains where
-- the user can work.
--
-- The pool is written only by Edge Functions (service role) through
-- ingest_postings(); users may read it because every row comes from a public
-- feed. Postings a user captures by hand never enter the pool.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.remote_policy as enum
  ('worldwide', 'region_locked', 'hybrid', 'onsite', 'unknown');

create type public.source_kind as enum
  ('board', 'aggregator', 'ats', 'community', 'capture');

create type public.source_access as enum
  ('public_api', 'keyed_api', 'rss', 'manual');

-- ISO 3166-1 alpha-2 codes, upper case. Immutable so it can sit in a check.
create or replace function public.valid_country_codes(p text[])
returns boolean language sql immutable as $$
  select coalesce(bool_and(c ~ '^[A-Z]{2}$'), true) from unnest(p) c;
$$;

-- ---------------------------------------------------------------------------
-- source_catalog
-- ---------------------------------------------------------------------------
create table public.source_catalog (
  id text primary key check (id ~ '^[a-z0-9_-]{2,40}$'),
  name text not null,
  kind public.source_kind not null,
  access public.source_access not null,
  homepage text not null default '',
  country text check (country ~ '^[A-Z]{2}$'),   -- null = worldwide board
  enabled boolean not null default false,
  max_requests_per_run int not null default 20 check (max_requests_per_run between 1 and 200),
  attribution text not null default '',
  notes text not null default '',
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_fetched int not null default 0,
  last_new int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger source_catalog_updated_at before update on public.source_catalog
  for each row execute function public.set_updated_at();
alter table public.source_catalog enable row level security;
create policy "source_catalog: signed-in read" on public.source_catalog
  for select to authenticated using (true);
create policy "source_catalog: admin write" on public.source_catalog
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.source_catalog
  (id, name, kind, access, homepage, enabled, max_requests_per_run, attribution, notes)
values
  ('himalayas', 'Himalayas', 'board', 'public_api', 'https://himalayas.app', true, 30,
   'Jobs from Himalayas (himalayas.app); apply on the original posting.',
   'Public JSON API, no key. Link back to the Himalayas URL; never re-post to other job sites.');

-- ---------------------------------------------------------------------------
-- source_runs
-- ---------------------------------------------------------------------------
create table public.source_runs (
  id bigint generated always as identity primary key,
  source_id text not null references public.source_catalog (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  requests int not null default 0,
  fetched int not null default 0,
  inserted int not null default 0,
  updated int not null default 0,
  error text
);
create index source_runs_source_started on public.source_runs (source_id, started_at desc);
alter table public.source_runs enable row level security;
create policy "source_runs: admin read" on public.source_runs
  for select using (public.is_admin());

-- ---------------------------------------------------------------------------
-- postings: the shared pool
-- ---------------------------------------------------------------------------
create table public.postings (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  company text not null,
  title text not null,
  url text not null,                          -- apply link from the first source
  location text not null default '',          -- as the source wrote it
  remote_policy public.remote_policy not null default 'unknown',
  hiring_countries text[] not null default '{}' check (public.valid_country_codes(hiring_countries)),
  hiring_regions text[] not null default '{}',  -- 'Europe', 'Americas', ... when no country list
  timezones text not null default '',
  source_country text check (source_country ~ '^[A-Z]{2}$'),
  employment_type public.employment_type not null default 'full_time',
  seniority text not null default '',
  salary_min int,
  salary_max int,
  salary_currency text not null default '',
  salary_text text not null default '',
  tags text[] not null default '{}',
  description text not null default '',
  company_logo text not null default '',
  ats_kind text,
  ats_slug text,
  posted_at timestamptz,
  expires_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index postings_first_seen on public.postings (first_seen_at desc);
create index postings_ats on public.postings (ats_kind, ats_slug) where ats_kind is not null;
alter table public.postings enable row level security;
create policy "postings: signed-in read" on public.postings
  for select to authenticated using (true);

create table public.posting_sources (
  source_id text not null references public.source_catalog (id) on delete cascade,
  external_id text not null,
  posting_id uuid not null references public.postings (id) on delete cascade,
  url text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (source_id, external_id)
);
create index posting_sources_posting on public.posting_sources (posting_id);
alter table public.posting_sources enable row level security;
create policy "posting_sources: signed-in read" on public.posting_sources
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- roles and search_profiles: link to the pool, location fields
-- ---------------------------------------------------------------------------
alter table public.roles
  add column posting_id uuid references public.postings (id) on delete set null,
  add column source_id text references public.source_catalog (id) on delete set null,
  add column remote_policy public.remote_policy not null default 'unknown',
  add column hiring_countries text[] not null default '{}'
    check (public.valid_country_codes(hiring_countries));
create index roles_posting on public.roles (posting_id) where posting_id is not null;

alter table public.search_profiles
  add column home_country text check (home_country ~ '^[A-Z]{2}$'),
  add column allowed_countries text[] not null default '{}'
    check (public.valid_country_codes(allowed_countries)),
  add column remote_only boolean not null default true,
  add column last_matched_at timestamptz;

-- ---------------------------------------------------------------------------
-- ingest_postings: one adapter run's postings into the pool (service only)
--
-- p_rows is a JSON array; each element carries the postings columns plus
-- external_id and source_url. A posting already in the pool keeps its first
-- URL and first_seen_at; fields it lacked are filled, a longer description
-- wins, and last_seen_at moves on.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_postings(p_source text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_id uuid;
  v_new boolean;
  v_inserted int := 0;
  v_updated int := 0;
begin
  if not exists (select 1 from public.source_catalog where id = p_source) then
    raise exception 'unknown source %', p_source using errcode = '22023';
  end if;

  for r in
    select * from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(
      dedupe_key text, external_id text, source_url text,
      company text, title text, url text, location text,
      remote_policy public.remote_policy, hiring_countries text[], hiring_regions text[],
      timezones text, source_country text, employment_type public.employment_type,
      seniority text, salary_min int, salary_max int, salary_currency text, salary_text text,
      tags text[], description text, company_logo text, ats_kind text, ats_slug text,
      posted_at timestamptz, expires_at timestamptz)
  loop
    continue when r.dedupe_key is null or r.company is null or r.title is null or r.url is null;

    insert into public.postings as p (
      dedupe_key, company, title, url, location, remote_policy, hiring_countries,
      hiring_regions, timezones, source_country, employment_type, seniority,
      salary_min, salary_max, salary_currency, salary_text, tags, description,
      company_logo, ats_kind, ats_slug, posted_at, expires_at)
    values (
      r.dedupe_key, left(r.company, 200), left(r.title, 200), left(r.url, 1000),
      left(coalesce(r.location, ''), 300), coalesce(r.remote_policy, 'unknown'),
      coalesce(r.hiring_countries, '{}'), coalesce(r.hiring_regions, '{}'),
      left(coalesce(r.timezones, ''), 200), r.source_country,
      coalesce(r.employment_type, 'full_time'), left(coalesce(r.seniority, ''), 40),
      r.salary_min, r.salary_max, left(coalesce(r.salary_currency, ''), 8),
      left(coalesce(r.salary_text, ''), 100), coalesce(r.tags[1:40], '{}'),
      left(coalesce(r.description, ''), 50000), left(coalesce(r.company_logo, ''), 1000),
      r.ats_kind, r.ats_slug, r.posted_at, r.expires_at)
    on conflict (dedupe_key) do update set
      last_seen_at = now(),
      description = case when length(excluded.description) > length(p.description)
                         then excluded.description else p.description end,
      remote_policy = case when p.remote_policy = 'unknown' then excluded.remote_policy else p.remote_policy end,
      hiring_countries = case when cardinality(p.hiring_countries) = 0 then excluded.hiring_countries else p.hiring_countries end,
      hiring_regions = case when cardinality(p.hiring_regions) = 0 then excluded.hiring_regions else p.hiring_regions end,
      salary_min = coalesce(p.salary_min, excluded.salary_min),
      salary_max = coalesce(p.salary_max, excluded.salary_max),
      salary_currency = case when p.salary_currency = '' then excluded.salary_currency else p.salary_currency end,
      salary_text = case when p.salary_text = '' then excluded.salary_text else p.salary_text end,
      tags = case when cardinality(p.tags) = 0 then excluded.tags else p.tags end,
      company_logo = case when p.company_logo = '' then excluded.company_logo else p.company_logo end,
      ats_kind = coalesce(p.ats_kind, excluded.ats_kind),
      ats_slug = coalesce(p.ats_slug, excluded.ats_slug),
      posted_at = least(p.posted_at, excluded.posted_at),
      expires_at = greatest(p.expires_at, excluded.expires_at)
    returning p.id, (p.xmax = 0) into v_id, v_new;

    if v_new then v_inserted := v_inserted + 1; else v_updated := v_updated + 1; end if;

    insert into public.posting_sources (source_id, external_id, posting_id, url)
    values (p_source, left(coalesce(r.external_id, r.dedupe_key), 300), v_id,
            left(coalesce(r.source_url, r.url), 1000))
    on conflict (source_id, external_id) do update set
      posting_id = excluded.posting_id, url = excluded.url, last_seen_at = now();
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
end $$;
revoke execute on function public.ingest_postings(text, jsonb) from public, anon, authenticated;

-- One adapter run's bookkeeping (service only).
create or replace function public.record_source_run(
  p_source text, p_started timestamptz, p_requests int, p_fetched int,
  p_inserted int, p_updated int, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.source_runs (source_id, started_at, finished_at, requests, fetched, inserted, updated, error)
  values (p_source, p_started, now(), p_requests, p_fetched, p_inserted, p_updated, left(p_error, 2000));
  update public.source_catalog set
    last_run_at = now(),
    last_success_at = case when p_error is null then now() else last_success_at end,
    last_error = left(p_error, 2000),
    last_fetched = p_fetched,
    last_new = p_inserted
  where id = p_source;
end $$;
revoke execute on function public.record_source_run(text, timestamptz, int, int, int, int, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Housekeeping: drop pool rows nobody has seen for 90 days (roles keep their
-- own copy; their posting_id goes null) and run logs older than 60 days.
-- ---------------------------------------------------------------------------
create or replace function public.purge_stale_postings()
returns void language sql security definer set search_path = public as $$
  delete from public.postings where last_seen_at < now() - interval '90 days';
  delete from public.source_runs where started_at < now() - interval '60 days';
$$;
revoke execute on function public.purge_stale_postings() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Settings for the match and score step
-- ---------------------------------------------------------------------------
insert into public.settings (key, value) values
  ('sourcing', '{
    "max_new_per_user_per_run": 40,
    "ai_scored_per_user_per_run": 10,
    "ai_min_heuristic_score": 40,
    "triage_model": "claude-haiku-4-5",
    "lookback_days": 3
  }')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Schedules. One helper posts to an Edge Function with the cron secret; it
-- reads project_url and cron_secret (or the older digest_cron_secret) from
-- Vault, the same values send-digest uses.
-- ---------------------------------------------------------------------------
create or replace function public.call_edge_function(p_name text, p_body jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select coalesce(
           (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
           (select decrypted_secret from vault.decrypted_secrets where name = 'digest_cron_secret'))
    into v_secret;
  if v_url is null or v_secret is null then
    raise notice '% skipped: project_url or cron secret missing from Vault', p_name;
    return;
  end if;
  perform net.http_post(
    url := v_url || '/functions/v1/' || p_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    body := coalesce(p_body, '{}'::jsonb),
    timeout_milliseconds := 120000
  );
end $$;
revoke execute on function public.call_edge_function(text, jsonb) from public, anon, authenticated;

-- Fetch every six hours; match every hour, ahead of the hourly digest at :05.
select cron.schedule('fetch-sources', '17 */6 * * *', $$select public.call_edge_function('fetch-sources')$$);
select cron.schedule('match-postings', '50 * * * *', $$select public.call_edge_function('match-postings')$$);
select cron.schedule('purge-stale-postings', '40 2 * * 0', $$select public.purge_stale_postings()$$);
