-- Market signals: what postings across every user asked for in the last 30
-- days. Aggregates only, never a row that could point at a person or a
-- single posting: a signal needs at least 3 roles from at least 2 users
-- before it is returned, so a solo user sees only their own picture (and is
-- told so).
create or replace function public.market_signals()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_since timestamptz := now() - interval '30 days';
  v_users int;
  v_roles int;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select count(distinct user_id), count(*) into v_users, v_roles
    from public.roles where found_at >= v_since;

  return jsonb_build_object(
    'since', v_since,
    'users', v_users,
    'roles', v_roles,
    'enough', (v_users >= 2 and v_roles >= 3),
    'stacks', (
      select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', c) order by c desc), '[]'::jsonb)
      from (
        select lower(trim(s)) as name, count(*) as c
          from public.roles r, unnest(r.stack) s
         where r.found_at >= v_since
         group by lower(trim(s))
        having count(*) >= 2
         order by c desc
         limit 15
      ) t
    ),
    'remote', (
      select coalesce(jsonb_agg(jsonb_build_object('scope', scope, 'count', c) order by c desc), '[]'::jsonb)
      from (
        select case
                 when remote_scope ilike '%worldwide%' or remote_scope ilike '%anywhere%' then 'Worldwide'
                 when remote_scope ilike '%overlap%' or remote_scope ~* '(utc|gmt|est|pst|cet|time ?zone)' then 'Timezone overlap'
                 when remote_scope ilike '%remote%' then 'Remote, region-limited'
                 when remote_scope = '' then 'Unstated'
                 else 'Other'
               end as scope, count(*) as c
          from public.roles where found_at >= v_since
         group by 1
      ) t
    ),
    'ai_share', (
      select coalesce(round(100.0 * count(*) filter (where ai_match) / nullif(count(*), 0)), 0)
        from public.roles where found_at >= v_since
    ),
    'contract_share', (
      select coalesce(round(100.0 * count(*) filter (where type = 'contract') / nullif(count(*), 0)), 0)
        from public.roles where found_at >= v_since
    ),
    'median_score', (
      select coalesce(percentile_cont(0.5) within group (order by score), 0)
        from public.roles where found_at >= v_since
    )
  );
end $$;
revoke execute on function public.market_signals() from public, anon;
grant execute on function public.market_signals() to authenticated;
