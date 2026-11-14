-- Company careers: polling in tiers, and European Lever boards.
--
-- The careers source used to poll discovered companies oldest first, forty a
-- run, whatever they had to offer. With a larger company list that wastes the
-- budget on boards that never carry a role any user wants. Now:
--
--   followed companies              every hour (as before)
--   companies that gave a kept role once a day
--   every other company             once a week
--
-- kept_roles     how many of the company's roles the last poll kept for the pool
-- last_kept_at   when a poll last kept at least one
-- ats_region     'eu' for boards on the system's European host (Lever keeps
--                EU customers on api.eu.lever.co), '' otherwise

alter table public.companies
  add column kept_roles int not null default 0,
  add column last_kept_at timestamptz,
  add column ats_region text not null default '' check (ats_region in ('', 'eu'));

create index companies_poll_order on public.companies (last_polled_at nulls first);
create index companies_last_kept on public.companies (last_kept_at) where last_kept_at is not null;

-- Companies whose roles are already in the pool have given a kept role.
update public.companies c
   set last_kept_at = now()
 where exists (
   select 1 from public.postings p
    where p.ats_kind = c.ats_kind and p.ats_slug = c.ats_slug
 );

-- One poll's results per company (service only).
create or replace function public.record_company_polls(p jsonb)
returns void language sql security definer set search_path = public as $$
  update public.companies c set
    last_polled_at = now(),
    last_error = left(x.error, 500),
    open_roles = coalesce(x.open_roles, c.open_roles),
    kept_roles = case when x.error is null then coalesce(x.kept, 0) else c.kept_roles end,
    last_kept_at = case when coalesce(x.kept, 0) > 0 then now() else c.last_kept_at end,
    ats_region = case when x.region in ('', 'eu') then x.region else c.ats_region end,
    name = case when c.name = '' and coalesce(x.name, '') <> '' then left(x.name, 200) else c.name end
  from jsonb_to_recordset(coalesce(p, '[]'::jsonb))
    as x(id uuid, error text, open_roles int, kept int, region text, name text)
  where c.id = x.id;
$$;
revoke execute on function public.record_company_polls(jsonb) from public, anon, authenticated;

update public.source_catalog
   set notes = 'Public job-board feeds of Greenhouse, Lever, Ashby and Workable. Followed companies are polled hourly, companies that gave a matching role daily, the rest weekly.'
 where id = 'ats';

-- The hourly run now also takes the daily and weekly tiers, within the same
-- budget: followed companies still go first.
select cron.schedule(
  'fetch-watchlist', '37 * * * *',
  $$select public.call_edge_function('fetch-sources', '{"sources":["ats"]}'::jsonb)$$
);
