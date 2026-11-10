-- The admin console: what an admin can see and do about an account, and a
-- record of every time they do.
--
--   profiles.suspended_at        set by an admin; the account's AI calls and
--                                scheduled matching stop (sign-in is blocked
--                                by the admin function, at the auth level)
--   profiles.support_access_until  set by the user: until then an admin may
--                                see their roles and resume, to help them
--   admin_audit                  one row per admin view or action
--   admin_users_list()           the users table: search, plan and AI filters
--   admin_user_detail()          one account: profile, billing, AI usage,
--                                activity; content only with support access
--   admin_money()                revenue, subscriptions, AI spend
--   admin_audit_write()          how the admin function records what it did
--
-- The three reads and the audit write are for the service role: the
-- admin-users Edge Function checks the caller is an admin, calls them and
-- writes the audit row. Changes made through the existing admin functions
-- (plans, credits, switches) are audited here by triggers, whoever calls them.

alter table public.profiles
  add column suspended_at timestamptz,
  add column suspended_reason text not null default '' check (length(suspended_reason) <= 500),
  add column support_access_until timestamptz;

-- A user edits their own profile row, so two columns need guarding: nobody
-- lifts their own suspension, and support access is at most 7 days ahead.
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    if new.suspended_at is distinct from old.suspended_at
       or new.suspended_reason is distinct from old.suspended_reason then
      raise exception 'Only the admin console changes a suspension' using errcode = '42501';
    end if;
    if new.support_access_until is distinct from old.support_access_until then
      if new.id <> auth.uid() then
        raise exception 'Support access is the account owner''s to give' using errcode = '42501';
      end if;
      -- (null closes it; least() would skip the null and reopen it)
      if new.support_access_until is not null then
        new.support_access_until := least(new.support_access_until, now() + interval '7 days');
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- ---------------------------------------------------------------------------
-- entitlements_for: as in migration 0033, plus `suspended`.
-- ---------------------------------------------------------------------------
create or replace function public.entitlements_for(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_billing jsonb := coalesce((select value from public.settings where key = 'billing'), '{}'::jsonb);
  v_enforced boolean;
  v_sub public.subscriptions%rowtype;
  v_plan public.plans%rowtype;
  v_live boolean := false;
  v_features text[];
begin
  if p_user is null then
    raise exception 'A user is required' using errcode = '22004';
  end if;

  v_enforced := coalesce((v_billing ->> 'enabled')::boolean, false)
    or coalesce(v_billing -> 'preview_users', '[]'::jsonb) ? p_user::text;

  select * into v_sub from public.subscriptions where user_id = p_user;
  if found then
    v_live := case v_sub.status
      -- two days of slack past the period end, so a late renewal notice from
      -- the payment provider does not drop a paying account to Free
      when 'active' then v_sub.current_period_end is null or v_sub.current_period_end + interval '2 days' > now()
      when 'trialing' then v_sub.current_period_end is null or v_sub.current_period_end > now()
      when 'past_due' then v_sub.grace_until is not null and v_sub.grace_until > now()
      when 'canceled' then v_sub.current_period_end is not null and v_sub.current_period_end > now()
    end;
  end if;

  select * into v_plan from public.plans
   where id = case when v_live then v_sub.plan_id else 'free' end;

  if v_enforced then
    v_features := v_plan.features;
  else
    select coalesce(array_agg(distinct f order by f), '{}') into v_features
      from public.plans p, unnest(p.features) f;
  end if;

  return jsonb_build_object(
    'enforced', v_enforced,
    'plan', v_plan.id,
    'plan_name', v_plan.name,
    'status', case when v_live then v_sub.status::text else 'none' end,
    'source', case when v_live then v_sub.source end,
    'period_end', case when v_live then v_sub.current_period_end end,
    'cancel_at_period_end', coalesce(v_live and v_sub.cancel_at_period_end, false),
    'features', to_jsonb(v_features),
    'limits', case when v_enforced then v_plan.limits else '{}'::jsonb end,
    'monthly_credits', v_plan.monthly_credits,
    'credits', public.credit_balance(p_user),
    'suspended', coalesce((select suspended_at is not null from public.profiles where id = p_user), false)
  );
end $$;

-- ---------------------------------------------------------------------------
-- The audit trail. target_user is not a foreign key and the email is copied,
-- so the record outlives the account it is about.
-- ---------------------------------------------------------------------------
create table public.admin_audit (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles (id) on delete set null,
  admin_email text not null default '',
  action text not null check (length(action) between 1 and 60),
  target_user uuid,
  target_email text not null default '',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_audit_created on public.admin_audit (created_at desc);
create index admin_audit_target on public.admin_audit (target_user, created_at desc);
alter table public.admin_audit enable row level security;
create policy "admin_audit: admins read" on public.admin_audit
  for select using (public.is_admin());
revoke insert, update, delete on public.admin_audit from anon, authenticated;

-- Records one view or action. With p_quiet_minutes, a repeat of the same
-- view by the same admin inside that window is not recorded again.
create or replace function public.admin_audit_write(
  p_admin uuid, p_action text, p_target uuid default null,
  p_detail jsonb default '{}'::jsonb, p_quiet_minutes int default 0
) returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_quiet_minutes, 0) > 0 and exists (
    select 1 from public.admin_audit
     where admin_id = p_admin and action = p_action
       and target_user is not distinct from p_target
       and created_at > now() - make_interval(mins => p_quiet_minutes)) then
    return;
  end if;
  insert into public.admin_audit (admin_id, admin_email, action, target_user, target_email, detail)
  values (
    p_admin,
    coalesce((select email from public.profiles where id = p_admin), ''),
    left(p_action, 60),
    p_target,
    coalesce((select email from public.profiles where id = p_target), ''),
    coalesce(p_detail, '{}'::jsonb));
end $$;
revoke execute on function public.admin_audit_write(uuid, text, uuid, jsonb, int) from public, anon, authenticated;
grant execute on function public.admin_audit_write(uuid, text, uuid, jsonb, int) to service_role;

-- Changes made through the admin functions of earlier migrations.
create or replace function public.audit_admin_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'credit_ledger' then
    if new.kind = 'admin' then
      perform public.admin_audit_write(coalesce(new.created_by, auth.uid()), 'add_credits', new.user_id,
        jsonb_build_object('credits', new.delta, 'reason', new.reason));
    end if;
  elsif tg_table_name = 'subscriptions' then
    if new.source = 'admin' and auth.uid() is not null then
      perform public.admin_audit_write(auth.uid(), 'set_plan', new.user_id,
        jsonb_build_object('plan', new.plan_id, 'status', new.status,
                           'until', new.current_period_end, 'reason', new.note));
    end if;
  elsif tg_table_name = 'settings' then
    if auth.uid() is not null and new.key in ('billing', 'pro_ai', 'signup')
       and new.value is distinct from old.value then
      perform public.admin_audit_write(auth.uid(), 'settings:' || new.key, null,
        case new.key
          when 'pro_ai' then jsonb_build_object(
            'enabled', new.value -> 'enabled', 'monthly_budget_usd', new.value -> 'monthly_budget_usd',
            'daily_credit_cap', new.value -> 'daily_credit_cap')
          else new.value end);
    end if;
  end if;
  return new;
end $$;
create trigger credit_ledger_audit after insert on public.credit_ledger
  for each row execute function public.audit_admin_change();
create trigger subscriptions_audit after insert or update on public.subscriptions
  for each row execute function public.audit_admin_change();
create trigger settings_audit after update on public.settings
  for each row execute function public.audit_admin_change();

-- ---------------------------------------------------------------------------
-- The users table.
--   p_plan   'free' | 'pro' | null
--   p_route  how the account's AI is paid for:
--            'credits' (a paying account while the Pro route is on, unless it
--            chose its own key only), 'own' (it connected a key), 'none'
-- ---------------------------------------------------------------------------
create or replace function public.admin_users_list(
  p_query text default '', p_plan text default null, p_route text default null,
  p_limit int default 50, p_offset int default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_pro_on boolean := coalesce((select (value ->> 'enabled')::boolean from public.settings where key = 'pro_ai'), false);
  v_q text := lower(trim(coalesce(p_query, '')));
  v_out jsonb;
begin
  with base as (
    select p.id, p.email, p.name, p.created_at, p.is_admin, p.suspended_at,
           p.support_access_until > now() as support_access,
           public.entitlements_for(p.id) as ent,
           coalesce((select array_agg(c.provider order by c.position, c.created_at)
                       from public.ai_connections c where c.user_id = p.id), '{}') as providers,
           p.ai_route
      from public.profiles p
     where v_q = '' or lower(p.email) like '%' || v_q || '%' or lower(p.name) like '%' || v_q || '%'
  ), shaped as (
    select b.*, b.ent ->> 'plan' as plan,
           case
             when v_pro_on and b.ent ->> 'plan' <> 'free' and b.ai_route <> 'own' then 'credits'
             when cardinality(b.providers) > 0 then 'own'
             else 'none' end as route
      from base b
  ), filtered as (
    select * from shaped s
     where (p_plan is null or s.plan = p_plan)
       and (p_route is null or s.route = p_route)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'users', coalesce((
      select jsonb_agg(u order by u ->> 'created_at' desc) from (
        select jsonb_build_object(
          'id', f.id, 'email', f.email, 'name', f.name, 'created_at', f.created_at,
          'is_admin', f.is_admin, 'suspended', f.suspended_at is not null,
          'support_access', coalesce(f.support_access, false),
          'plan', f.plan, 'plan_name', f.ent ->> 'plan_name', 'status', f.ent ->> 'status',
          'credits', (f.ent ->> 'credits')::int,
          'route', f.route, 'providers', to_jsonb(f.providers),
          'roles', (select count(*) from public.roles r where r.user_id = f.id),
          'ai_calls_30d', (select count(*) from public.ai_usage a
                            where a.user_id = f.id and a.created_at > now() - interval '30 days'),
          'last_active', (select max(r.status_changed_at) from public.roles r where r.user_id = f.id)
        ) as u
          from filtered f
         order by f.created_at desc
         limit greatest(1, least(coalesce(p_limit, 50), 500)) offset greatest(0, coalesce(p_offset, 0))
      ) page), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke execute on function public.admin_users_list(text, text, text, int, int) from public, anon, authenticated;
grant execute on function public.admin_users_list(text, text, text, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- One account. Never the resume, letters, notes or posting text, unless the
-- owner has opened support access; then `content` carries the roles list and
-- the master resume.
-- ---------------------------------------------------------------------------
create or replace function public.admin_user_detail(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_p public.profiles%rowtype;
  v_month timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_open boolean;
begin
  select * into v_p from public.profiles where id = p_user;
  if not found then
    return null;
  end if;
  v_open := v_p.support_access_until is not null and v_p.support_access_until > now();

  return jsonb_build_object(
    'account', jsonb_build_object(
      'id', v_p.id, 'email', v_p.email, 'name', v_p.name, 'timezone', v_p.timezone,
      'is_admin', v_p.is_admin, 'created_at', v_p.created_at, 'invite_code', v_p.invite_code,
      'suspended_at', v_p.suspended_at, 'suspended_reason', v_p.suspended_reason,
      'support_access_until', case when v_open then v_p.support_access_until end,
      'ai_route', v_p.ai_route,
      'has_resume', exists (select 1 from public.resumes r where r.user_id = p_user and r.is_master),
      'has_search_profile', exists (select 1 from public.search_profiles s where s.user_id = p_user),
      'ingest_keys', (select count(*) from public.ingest_keys k where k.user_id = p_user and k.revoked_at is null)
    ),
    'billing', jsonb_build_object(
      'entitlements', public.entitlements_for(p_user),
      'subscription', (select jsonb_build_object(
          'plan', s.plan_id, 'status', s.status, 'source', s.source,
          'period_start', s.current_period_start, 'period_end', s.current_period_end,
          'cancel_at_period_end', s.cancel_at_period_end, 'grace_until', s.grace_until,
          'provider_customer_id', s.provider_customer_id, 'note', s.note)
        from public.subscriptions s where s.user_id = p_user),
      'payments', coalesce((select jsonb_agg(x) from (
          select jsonb_build_object('kind', y.kind, 'product', y.product, 'amount_cents', y.amount_cents,
                                    'currency', y.currency, 'status', y.status, 'paid_at', y.paid_at) as x
            from public.payments y where y.user_id = p_user order by y.paid_at desc limit 20) z), '[]'::jsonb),
      'ledger', coalesce((select jsonb_agg(x) from (
          select jsonb_build_object('delta', l.delta, 'kind', l.kind, 'reason', l.reason, 'created_at', l.created_at) as x
            from public.credit_ledger l where l.user_id = p_user order by l.created_at desc limit 30) z), '[]'::jsonb)
    ),
    'ai', jsonb_build_object(
      'connections', coalesce((select jsonb_agg(jsonb_build_object(
          'provider', c.provider, 'model', c.model, 'status', c.status, 'last_error', c.last_error,
          'limited_until', c.limited_until, 'last_checked_at', c.last_checked_at) order by c.position)
        from public.ai_connections c where c.user_id = p_user), '[]'::jsonb),
      'month', coalesce((select jsonb_agg(x) from (
          select jsonb_build_object('job', a.job, 'provider', a.provider, 'model', a.model, 'route', a.route,
                                    'calls', count(*), 'tokens_in', sum(a.tokens_in), 'tokens_out', sum(a.tokens_out),
                                    'web_searches', sum(a.web_searches), 'cost_usd', sum(a.cost_usd)) as x
            from public.ai_usage a where a.user_id = p_user and a.created_at >= v_month
           group by a.job, a.provider, a.model, a.route order by count(*) desc) z), '[]'::jsonb),
      'trend', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'calls', d.calls) order by d.day) from (
          select (a.created_at at time zone 'utc')::date as day, count(*) as calls
            from public.ai_usage a where a.user_id = p_user and a.created_at > now() - interval '30 days'
           group by 1) d), '[]'::jsonb),
      'credits_spent_month', (select coalesce(-sum(l.delta), 0) from public.credit_ledger l
                               where l.user_id = p_user and l.kind = 'spend' and l.created_at >= v_month),
      'platform_cost_month', (select coalesce(sum(a.cost_usd), 0) from public.ai_usage a
                               where a.user_id = p_user and a.route = 'platform' and a.created_at >= v_month)
    ),
    'activity', jsonb_build_object(
      'roles_by_status', coalesce((select jsonb_object_agg(s.status, s.n) from (
          select r.status::text as status, count(*) as n from public.roles r where r.user_id = p_user group by 1) s), '{}'::jsonb),
      'last_run', (select max(e.created_at) from public.role_events e where e.user_id = p_user and e.kind = 'run'),
      'runs_30d', (select count(*) from public.role_events e
                    where e.user_id = p_user and e.kind = 'run' and e.created_at > now() - interval '30 days'),
      'events_30d', coalesce((select jsonb_object_agg(k.kind, k.n) from (
          select e.kind::text as kind, count(*) as n from public.role_events e
           where e.user_id = p_user and e.created_at > now() - interval '30 days' group by 1) k), '{}'::jsonb),
      'audit', coalesce((select jsonb_agg(x) from (
          select jsonb_build_object('action', a.action, 'admin_email', a.admin_email,
                                    'detail', a.detail, 'created_at', a.created_at) as x
            from public.admin_audit a where a.target_user = p_user order by a.created_at desc limit 30) z), '[]'::jsonb)
    ),
    'content', case when v_open then jsonb_build_object(
      'roles', coalesce((select jsonb_agg(x) from (
          select jsonb_build_object('company', r.company, 'title', r.title, 'status', r.status,
                                    'score', r.score, 'found_at', r.found_at) as x
            from public.roles r where r.user_id = p_user order by r.found_at desc limit 50) z), '[]'::jsonb),
      'resume', (select r.sections from public.resumes r where r.user_id = p_user and r.is_master limit 1)
    ) end
  );
end $$;
revoke execute on function public.admin_user_detail(uuid) from public, anon, authenticated;
grant execute on function public.admin_user_detail(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Money: what came in, who is subscribed, and what AI on credits cost.
-- ---------------------------------------------------------------------------
create or replace function public.admin_money()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_month timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_prev timestamptz := v_month - interval '1 month';
  v_rev numeric;
  v_spend numeric;
begin
  select coalesce(sum(amount_cents), 0) / 100.0 into v_rev from public.payments
   where status <> 'failed' and paid_at >= v_month;
  select coalesce(sum(cost_usd), 0) into v_spend from public.ai_usage
   where route = 'platform' and created_at >= v_month;
  return jsonb_build_object(
    'revenue_month_usd', v_rev,
    'revenue_last_month_usd', (select coalesce(sum(amount_cents), 0) / 100.0 from public.payments
                                where status <> 'failed' and paid_at >= v_prev and paid_at < v_month),
    'refunds_month_usd', (select coalesce(-sum(amount_cents), 0) / 100.0 from public.payments
                           where kind = 'refund' and paid_at >= v_month),
    'active_paid', (select count(*) from public.subscriptions s
                     where s.source = 'polar' and s.status in ('active', 'trialing')
                       and (s.current_period_end is null or s.current_period_end > now())),
    'active_granted', (select count(*) from public.subscriptions s
                        where s.source = 'admin' and s.plan_id <> 'free' and s.status = 'active'
                          and (s.current_period_end is null or s.current_period_end > now())),
    'cancelling', (select count(*) from public.subscriptions s
                    where s.cancel_at_period_end and s.current_period_end > now()),
    'cancelled_30d', (select count(*) from public.subscriptions s
                       where s.status = 'canceled' and s.updated_at > now() - interval '30 days'),
    'past_due', (select count(*) from public.subscriptions s where s.status = 'past_due'),
    'ai_spend_month_usd', v_spend,
    'ai_share_of_revenue', case when v_rev > 0 then round(v_spend / v_rev, 4) end,
    -- accounts whose AI on credits cost more this month than they paid
    'over_cost', coalesce((select jsonb_agg(x order by (x ->> 'cost_usd')::numeric desc) from (
        select jsonb_build_object('id', p.id, 'email', p.email, 'cost_usd', c.cost,
                 'paid_usd', coalesce(m.paid, 0)) as x
          from (select user_id, sum(cost_usd) as cost from public.ai_usage
                 where route = 'platform' and created_at >= v_month group by 1) c
          join public.profiles p on p.id = c.user_id
          left join (select user_id, sum(amount_cents) / 100.0 as paid from public.payments
                      where status <> 'failed' and paid_at >= v_month group by 1) m on m.user_id = c.user_id
         where c.cost > coalesce(m.paid, 0) and c.cost >= 0.5
         limit 20) z), '[]'::jsonb)
  );
end $$;
revoke execute on function public.admin_money() from public, anon, authenticated;
grant execute on function public.admin_money() to service_role;
