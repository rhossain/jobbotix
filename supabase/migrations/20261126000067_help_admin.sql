-- Admin: what people ask the Help chat.
--
--   admin_help(p_days)        the questions of the last p_days days (no names),
--                             the most asked, the ones the articles did not
--                             answer or that got a No, this month's cost, the
--                             help settings, and the support requests (these
--                             do carry the sender: they asked to be answered)
--   admin_set_help_ai(patch)  the switch, the monthly budget and the daily
--                             limits in settings.help_ai
--
-- Both are for admins only (is_admin()).

create or replace function public.admin_help(p_days int default 14)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cfg jsonb := coalesce((select value from public.settings where key = 'help_ai'), '{}'::jsonb);
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 30));
  v_month timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_spend numeric;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  select coalesce(sum(cost_usd), 0) into v_spend from public.ai_usage
   where job = 'help' and route = 'platform' and created_at >= v_month;

  return jsonb_build_object(
    'settings', v_cfg,
    'month_spend_usd', v_spend,
    'month_answers', (select count(*) from public.ai_usage
                       where job = 'help' and route = 'platform' and created_at >= v_month),
    'totals', (
      select jsonb_build_object(
        'asked', count(*),
        'own', count(*) filter (where m.route = 'own'),
        'platform', count(*) filter (where m.route = 'platform'),
        'articles', count(*) filter (where m.route = 'articles'),
        'not_found', count(*) filter (where not m.found),
        'yes', count(*) filter (where m.feedback = 'yes'),
        'no', count(*) filter (where m.feedback = 'no'),
        'people', count(distinct m.user_id))
        from public.help_messages m where m.created_at >= v_since),
    -- The same question asked in different case or spacing counts once.
    'most_asked', coalesce((
      select jsonb_agg(t order by t.times desc, t.last desc)
        from (select min(m.question) as question,
                     count(*) as times,
                     count(*) filter (where not m.found) as not_found,
                     count(*) filter (where m.feedback = 'no') as no,
                     max(m.created_at) as last
                from public.help_messages m
               where m.created_at >= v_since
               group by lower(regexp_replace(btrim(m.question), '\s+', ' ', 'g'))
              having count(*) > 1
               order by count(*) desc, max(m.created_at) desc
               limit 15) t), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(q order by q.created_at desc)
        from (select m.id, m.question, m.page, m.route, m.found, m.feedback, m.articles,
                     m.model, m.created_at
                from public.help_messages m
               where m.created_at >= v_since
               order by m.created_at desc
               limit 200) q), '[]'::jsonb),
    'tickets', coalesce((
      select jsonb_agg(t order by t.created_at desc)
        from (select h.id, h.user_id, p.email, h.message, h.page, h.created_at, h.emailed_at
                from public.help_tickets h
                left join public.profiles p on p.id = h.user_id
               where h.created_at >= v_since
               order by h.created_at desc
               limit 50) t), '[]'::jsonb)
  );
end $$;
revoke execute on function public.admin_help(int) from public, anon;
grant execute on function public.admin_help(int) to authenticated;

create or replace function public.admin_set_help_ai(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := coalesce((select value from public.settings where key = 'help_ai'), '{}'::jsonb);
  v_new jsonb;
  v_key text;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Send the settings to change' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('enabled', 'monthly_budget_usd', 'daily_free', 'daily_pro', 'daily_own') then
      raise exception 'Unknown setting: %', v_key using errcode = '22023';
    end if;
  end loop;
  if p_patch ? 'enabled' and jsonb_typeof(p_patch -> 'enabled') <> 'boolean' then
    raise exception 'enabled must be true or false' using errcode = '22023';
  end if;
  for v_key in select unnest(array['monthly_budget_usd', 'daily_free', 'daily_pro', 'daily_own']) loop
    if p_patch ? v_key and (jsonb_typeof(p_patch -> v_key) <> 'number'
        or (p_patch ->> v_key)::numeric < 0 or (p_patch ->> v_key)::numeric > 10000
        or (v_key <> 'monthly_budget_usd' and (p_patch ->> v_key)::numeric % 1 <> 0)) then
      raise exception '% must be a number from 0 to 10000 (whole, except the budget)', v_key using errcode = '22023';
    end if;
  end loop;

  v_new := v_old || p_patch;
  insert into public.settings (key, value) values ('help_ai', v_new)
  on conflict (key) do update set value = excluded.value;
  return v_new;
end $$;
revoke execute on function public.admin_set_help_ai(jsonb) from public, anon;
grant execute on function public.admin_set_help_ai(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- A person's set-up, in brief, for the Help chat to answer "why" questions
-- ("why do I get no jobs?") about their own account. Counts and switches
-- only: nothing from the resume, the jobs, the notes or the job titles.
-- For the help-chat function (service role) only.
-- ---------------------------------------------------------------------------
create or replace function public.help_setup(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_sp public.search_profiles;
  v_profiles int;
begin
  select * into v_sp from public.search_profiles
   where user_id = p_user and active order by updated_at desc limit 1;
  select count(*) into v_profiles from public.search_profiles where user_id = p_user;
  return jsonb_build_object(
    'plan', coalesce(public.entitlements_for(p_user) ->> 'plan_name', 'Free'),
    'timezone', (select timezone from public.profiles where id = p_user),
    'resume_saved', exists (select 1 from public.resumes
                             where user_id = p_user and is_master and sections <> '{}'::jsonb),
    'preferences_saved', v_sp.id is not null,
    'searches', v_profiles,
    'job_titles', coalesce(cardinality(v_sp.target_roles), 0),
    'skills', coalesce(cardinality(v_sp.stacks), 0),
    'home_country', v_sp.home_country,
    'other_countries', coalesce(cardinality(v_sp.allowed_countries), 0),
    'remote_only', v_sp.remote_only,
    'daily_email', v_sp.digest_enabled,
    'daily_email_time', to_char(v_sp.digest_time, 'HH24:MI'),
    'last_search', v_sp.last_matched_at,
    'jobs', (select count(*) from public.roles where user_id = p_user),
    'jobs_last_7_days', (select count(*) from public.roles
                          where user_id = p_user and found_at > now() - interval '7 days'),
    'filtered_out_last_7_days', (select count(*) from public.excluded_roles
                                  where user_id = p_user and found_at > now() - interval '7 days'),
    'own_ai', exists (select 1 from public.ai_connections where user_id = p_user)
  );
end $$;
revoke execute on function public.help_setup(uuid) from public, anon, authenticated;
grant execute on function public.help_setup(uuid) to service_role;
