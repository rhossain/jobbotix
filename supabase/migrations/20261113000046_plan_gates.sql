-- More of Jobbotix moves to Pro (decided 13 Nov 2026):
--   interview prep        Pro only (feature interview_prep)
--   AI resume review      Free gets one, to try it; Pro is not counted
--                         (feature resume_review, limit resume_reviews)
--   instant alerts        Pro only (already in the plans; now enforced)
-- Accounts opened before the change keep what was free for them: the "early"
-- rule below. As before, none of this applies to an account until billing is
-- switched on for it.

-- ---------------------------------------------------------------------------
-- plans: the new features and the Free allowance of resume reviews.
-- ---------------------------------------------------------------------------
update public.plans
   set limits = limits || '{"resume_reviews": 1}'::jsonb
 where id = 'free';

update public.plans
   set features = (
     select array_agg(f order by ord)
       from (select f, min(ord) as ord
               from unnest(features || array['interview_prep', 'resume_review'])
                    with ordinality as t (f, ord)
              group by f) u)
 where id = 'pro';

-- ---------------------------------------------------------------------------
-- feature_uses: how often an account has used something a plan limits by
-- count. One row per account and key; never reset, so an allowance such as
-- "one resume review" is given once and not each month. Users read their own
-- rows; only the service role (the Edge Functions) counts.
-- ---------------------------------------------------------------------------
create table public.feature_uses (
  user_id uuid not null references public.profiles (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  uses int not null default 0 check (uses >= 0),
  first_used_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.feature_uses enable row level security;
create policy "feature_uses: own rows" on public.feature_uses
  for select using (user_id = auth.uid());

-- Counts one use and returns the new total.
create or replace function public.count_feature_use(p_user uuid, p_key text)
returns int language plpgsql security definer set search_path = public as $$
declare v_uses int;
begin
  if p_user is null or p_key is null then
    raise exception 'A user and a key are required' using errcode = '22004';
  end if;
  insert into public.feature_uses (user_id, key, uses)
  values (p_user, p_key, 1)
  on conflict (user_id, key)
  do update set uses = public.feature_uses.uses + 1, last_used_at = now()
  returning uses into v_uses;
  return v_uses;
end $$;
revoke execute on function public.count_feature_use(uuid, text) from public, anon, authenticated;
grant execute on function public.count_feature_use(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Early accounts. settings.billing.early names a moment and the features an
-- account opened before it keeps on the Free plan. It is data: move the date
-- or change the list with an UPDATE.
-- ---------------------------------------------------------------------------
update public.settings
   set value = value || jsonb_build_object('early', jsonb_build_object(
         'before', '2026-11-15T00:00:00Z',
         'features', jsonb_build_array('interview_prep', 'resume_review', 'instant_alerts')))
 where key = 'billing' and not value ? 'early';

-- The early rule reads profiles.created_at, and a user may edit their own
-- profile row, so the date they joined becomes a guarded column: as in
-- migration 0037, plus created_at.
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    if new.created_at is distinct from old.created_at then
      raise exception 'The date an account was opened cannot be changed' using errcode = '42501';
    end if;
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

-- ---------------------------------------------------------------------------
-- entitlements_for: as in migration 0037, plus
--   early   the account keeps the early features on Free
--   used    the account's use counts, by key
-- ---------------------------------------------------------------------------
create or replace function public.entitlements_for(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_billing jsonb := coalesce((select value from public.settings where key = 'billing'), '{}'::jsonb);
  v_early jsonb := coalesce(v_billing -> 'early', '{}'::jsonb);
  v_enforced boolean;
  v_sub public.subscriptions%rowtype;
  v_plan public.plans%rowtype;
  v_live boolean := false;
  v_features text[];
  v_is_early boolean := false;
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

  if (v_early ->> 'before') is not null then
    v_is_early := exists (
      select 1 from public.profiles
       where id = p_user and created_at < (v_early ->> 'before')::timestamptz);
  end if;

  if v_enforced then
    v_features := v_plan.features;
    if v_is_early and jsonb_typeof(v_early -> 'features') = 'array' then
      select coalesce(array_agg(distinct f order by f), '{}') into v_features
        from unnest(v_features || array(select jsonb_array_elements_text(v_early -> 'features'))) f;
    end if;
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
    'used', coalesce((select jsonb_object_agg(key, uses) from public.feature_uses where user_id = p_user), '{}'::jsonb),
    'early', v_is_early,
    'monthly_credits', v_plan.monthly_credits,
    'credits', public.credit_balance(p_user),
    'suspended', coalesce((select suspended_at is not null from public.profiles where id = p_user), false)
  );
end $$;
