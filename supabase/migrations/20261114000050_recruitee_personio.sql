-- Company careers: two more careers systems, Recruitee and Personio.
--
-- Apply links on both were already recognised (detectAts) but the companies
-- table only took the four polled systems, so those companies were dropped.
-- Both publish every open job of a company on one public feed:
--
--   recruitee  GET https://<slug>.recruitee.com/api/offers/         (JSON)
--   personio   GET https://<slug>.jobs.personio.de/xml?language=en  (XML)

alter table public.companies drop constraint companies_ats_kind_check;
alter table public.companies add constraint companies_ats_kind_check
  check (ats_kind in ('greenhouse', 'lever', 'ashby', 'workable', 'recruitee', 'personio'));

-- Pool postings whose apply link names a polled system register their company.
create or replace function public.postings_discover_company()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ats_kind in ('greenhouse', 'lever', 'ashby', 'workable', 'recruitee', 'personio')
     and new.ats_slug ~ '^[a-z0-9][a-z0-9_.%-]{0,99}$' then
    insert into public.companies (ats_kind, ats_slug, name)
    values (new.ats_kind, new.ats_slug, left(new.company, 200))
    on conflict (ats_kind, ats_slug) do nothing;
  end if;
  return new;
end $$;

-- Companies on the two systems that are already in the pool.
insert into public.companies (ats_kind, ats_slug, name, last_kept_at)
select distinct on (ats_kind, ats_slug) ats_kind, ats_slug, left(company, 200), now()
from public.postings
where ats_kind in ('recruitee', 'personio')
  and ats_slug ~ '^[a-z0-9][a-z0-9_.%-]{0,99}$'
order by ats_kind, ats_slug, first_seen_at
on conflict (ats_kind, ats_slug) do nothing;

update public.source_catalog
   set notes = 'Public job-board feeds of Greenhouse, Lever, Ashby, Workable, Recruitee and Personio. Followed companies are polled hourly, companies that gave a matching role daily, the rest weekly.'
 where id = 'ats';

-- Following a company accepts the two new systems (otherwise as in 0022).
create or replace function public.follow_company(p_kind text, p_slug text, p_name text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_slug text := lower(trim(p_slug));
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if p_kind not in ('greenhouse', 'lever', 'ashby', 'workable', 'recruitee', 'personio') then
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
