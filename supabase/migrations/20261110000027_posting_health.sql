-- Posting health: what the shared pool knows about how long a role's posting
-- has been up, whether it was relisted under a new id, and whether the
-- company's own careers page has dropped it. The app turns these facts into
-- badges (libs/shared-types/src/lib/posting-health.ts); nothing here scores.
--
-- "Gone" is claimed only for careers-page listings (source 'ats'): Greenhouse,
-- Lever, Ashby and Workable feeds list every open job, so a listing missing
-- from a clean poll a day after we last saw it has closed. Job boards return
-- only their newest posts, so a board listing that drops off says nothing.

create or replace function public.posting_health()
returns table (
  role_id uuid,
  first_seen_at timestamptz,
  posted_at timestamptz,
  expires_at timestamptz,
  listings int,
  boards int,
  gone_since timestamptz
)
language sql stable security invoker set search_path = public as $$
  select
    r.id,
    p.first_seen_at,
    p.posted_at,
    p.expires_at,
    count(ps.*)::int,
    count(distinct ps.source_id)::int,
    (
      select max(a.last_seen_at)
      from public.posting_sources a
      join public.companies c on c.ats_kind = p.ats_kind and c.ats_slug = p.ats_slug
      where a.posting_id = p.id and a.source_id = 'ats'
      having bool_and(c.last_error is null
                      and c.last_polled_at > a.last_seen_at + interval '1 day')
    )
  from public.roles r
  join public.postings p on p.id = r.posting_id
  left join public.posting_sources ps on ps.posting_id = p.id
  where r.user_id = auth.uid()
  group by r.id, p.id;
$$;
revoke execute on function public.posting_health() from public, anon;
grant execute on function public.posting_health() to authenticated;
