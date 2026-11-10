-- The Pro AI route: AI work on Jobbotix's own Anthropic key, paid for with
-- the account's credits instead of the user's own key.
--
-- A call holds its credits first, so two calls at once cannot spend the same
-- credits; the hold becomes a spend when the model answers and is released
-- when it does not. Everything about the route lives in settings.pro_ai and
-- is off until an admin switches it on (and the Edge Functions have a
-- platform key): nothing here changes what anyone sees today.
--
--   ai_usage.route         'own' (the user's key) or 'platform' (credits)
--   profiles.ai_route      'auto', or 'own' to never spend credits
--   credit_holds           credits set aside for a call in flight
--   ai_reserve_credits()   hold credits for one job, or say why not
--   ai_settle_credits()    the call answered: spend the hold, log the usage
--   ai_release_credits()   the call failed: give the hold back
--   grant_trial_credits()  the one-time trial grant
--   admin_set_pro_ai()     switch and limits, for admins
--   admin_pro_ai()         the settings plus this month's spend

alter table public.ai_usage
  add column route text not null default 'own' check (route in ('own', 'platform'));
create index ai_usage_platform_created on public.ai_usage (created_at) where route = 'platform';

alter table public.profiles
  add column ai_route text not null default 'auto' check (ai_route in ('auto', 'own'));

-- ---------------------------------------------------------------------------
-- Settings. Credit prices are per call; 0 means the job is not metered.
-- Model prices are USD per million tokens, used to cost platform calls
-- against the monthly budget.
-- ---------------------------------------------------------------------------
insert into public.settings (key, value)
values ('pro_ai', '{
  "enabled": false,
  "trial_credits": 20,
  "daily_credit_cap": 150,
  "daily_unmetered_calls": 300,
  "monthly_budget_usd": 50,
  "hold_minutes": 15,
  "credit_prices": {
    "score": 0, "extract": 0, "letter": 3, "tailor": 5, "prep": 5,
    "research": 15, "answer": 2, "import": 5, "thank_you": 1, "message": 1
  },
  "models": {"fast": "claude-haiku-5-5", "writing": "claude-sonnet-5-5"},
  "fast_jobs": ["score", "extract"],
  "model_prices": {
    "claude-haiku-5-5": {"in": 0.1, "out": 0.5},
    "claude-sonnet-5-5": {"in": 2, "out": 10}
  },
  "web_search_usd": 0.01
}')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Holds
-- ---------------------------------------------------------------------------
create table public.credit_holds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  job public.ai_job not null,
  credits int not null check (credits >= 0),
  model text not null,
  status text not null default 'held' check (status in ('held', 'settled', 'released')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed_at timestamptz
);
create index credit_holds_user_open on public.credit_holds (user_id) where status = 'held';
alter table public.credit_holds enable row level security;
-- No policy: only the service role and the functions below touch holds.
revoke all on public.credit_holds from anon, authenticated;

-- One trial grant per account, whatever happens.
create unique index credit_ledger_one_trial on public.credit_ledger (user_id) where kind = 'trial';

-- What an account can spend now: the ledger, less credits held for calls in
-- flight. (Replaces the ledger-only sum of migration 0033, so entitlements
-- and the admin adjustments see holds too.)
create or replace function public.credit_balance(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select (
    coalesce((select sum(delta) from public.credit_ledger where user_id = p_user), 0)
    - coalesce((select sum(credits) from public.credit_holds
                 where user_id = p_user and status = 'held' and expires_at > now()), 0)
  )::int;
$$;
revoke execute on function public.credit_balance(uuid) from public, anon, authenticated;
grant execute on function public.credit_balance(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Trial credits: granted once per account while the Pro route is on (at
-- sign-up, and to every existing account when an admin switches it on).
-- ---------------------------------------------------------------------------
create or replace function public.grant_trial_credits(p_user uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_amount int := coalesce((select (value ->> 'trial_credits')::int from public.settings where key = 'pro_ai'), 0);
begin
  if v_amount <= 0 then return 0; end if;
  insert into public.credit_ledger (user_id, delta, kind, reason)
  values (p_user, v_amount, 'trial', 'Trial credits')
  on conflict do nothing;
  return case when found then v_amount else 0 end;
end $$;
revoke execute on function public.grant_trial_credits(uuid) from public, anon, authenticated;
grant execute on function public.grant_trial_credits(uuid) to service_role;

create or replace function public.grant_trial_on_signup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce((select (value ->> 'enabled')::boolean from public.settings where key = 'pro_ai'), false) then
    perform public.grant_trial_credits(new.id);
  end if;
  return new;
end $$;
create trigger profiles_trial_credits
  after insert on public.profiles
  for each row execute function public.grant_trial_on_signup();

-- ---------------------------------------------------------------------------
-- Reserve. Answers with a hold, or with why there is none:
--   off          the Pro route is switched off
--   own_only     the account chose to use only its own key
--   budget       this month's platform budget is used up
--   no_credits   not enough credits for this job
--   daily_cap    the account reached its daily limit
-- `first` says whether credits should be tried before the account's own
-- connections: yes on a paid plan, no on Free (where trial credits are the
-- fallback for an account without a working key).
-- ---------------------------------------------------------------------------
create or replace function public.ai_reserve_credits(p_user uuid, p_job public.ai_job)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cfg jsonb := coalesce((select value from public.settings where key = 'pro_ai'), '{}'::jsonb);
  v_price int := coalesce((v_cfg -> 'credit_prices' ->> p_job::text)::int, -1);
  v_model text := case
    when coalesce(v_cfg -> 'fast_jobs', '[]'::jsonb) ? p_job::text then v_cfg -> 'models' ->> 'fast'
    else v_cfg -> 'models' ->> 'writing' end;
  v_route text;
  v_paid boolean;
  v_balance int;
  v_spent_today int;
  v_calls_today int;
  v_month_usd numeric;
  v_day timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_hold uuid;
  v_refuse jsonb;
begin
  if p_user is null or p_job is null then
    raise exception 'A user and a job are required' using errcode = '22004';
  end if;
  if not coalesce((v_cfg ->> 'enabled')::boolean, false) or v_price < 0 or v_model is null then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;

  -- One reservation at a time per account: the checks below then hold.
  select ai_route into v_route from public.profiles where id = p_user for update;
  if not found then
    raise exception 'Unknown user' using errcode = '22023';
  end if;

  v_paid := (public.entitlements_for(p_user) ->> 'plan') <> 'free';
  if v_route = 'own' then
    return jsonb_build_object('ok', false, 'reason', 'own_only', 'first', false);
  end if;

  -- Holds whose call never came back are given back.
  update public.credit_holds set status = 'released', closed_at = now()
   where user_id = p_user and status = 'held' and expires_at <= now();

  select coalesce(sum(cost_usd), 0) into v_month_usd from public.ai_usage
   where route = 'platform' and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_balance := public.credit_balance(p_user);

  if v_month_usd >= coalesce((v_cfg ->> 'monthly_budget_usd')::numeric, 0) then
    v_refuse := jsonb_build_object('reason', 'budget');
  elsif v_price > 0 then
    select coalesce(-sum(delta), 0) into v_spent_today from public.credit_ledger
     where user_id = p_user and kind = 'spend' and created_at >= v_day;
    v_spent_today := v_spent_today + coalesce((select sum(credits) from public.credit_holds
      where user_id = p_user and status = 'held'), 0);
    if v_balance < v_price then
      v_refuse := jsonb_build_object('reason', 'no_credits');
    elsif v_spent_today + v_price > coalesce((v_cfg ->> 'daily_credit_cap')::int, 0) then
      v_refuse := jsonb_build_object('reason', 'daily_cap', 'resets_at', v_day + interval '1 day');
    end if;
  else
    -- Not metered: for paying accounts, and for others while they still hold
    -- credits; a daily count keeps a runaway loop from running up a bill.
    select count(*) into v_calls_today from public.ai_usage
     where user_id = p_user and route = 'platform' and job = p_job and created_at >= v_day;
    if not v_paid and v_balance <= 0 then
      v_refuse := jsonb_build_object('reason', 'no_credits');
    elsif v_calls_today >= coalesce((v_cfg ->> 'daily_unmetered_calls')::int, 0) then
      v_refuse := jsonb_build_object('reason', 'daily_cap', 'resets_at', v_day + interval '1 day');
    end if;
  end if;

  if v_refuse is not null then
    return v_refuse || jsonb_build_object(
      'ok', false, 'first', v_paid, 'needed', v_price, 'balance', v_balance);
  end if;

  insert into public.credit_holds (user_id, job, credits, model, expires_at)
  values (p_user, p_job, v_price, v_model,
          now() + make_interval(mins => greatest(1, coalesce((v_cfg ->> 'hold_minutes')::int, 15))))
  returning id into v_hold;
  return jsonb_build_object(
    'ok', true, 'hold', v_hold, 'credits', v_price, 'model', v_model,
    'first', v_paid, 'balance', v_balance - v_price);
end $$;
revoke execute on function public.ai_reserve_credits(uuid, public.ai_job) from public, anon, authenticated;
grant execute on function public.ai_reserve_credits(uuid, public.ai_job) to service_role;

-- ---------------------------------------------------------------------------
-- Settle: the model answered. Logs the call (with its cost, for the budget),
-- turns the hold into a spend, and returns the balance. Safe to call twice.
-- ---------------------------------------------------------------------------
create or replace function public.ai_settle_credits(
  p_hold uuid, p_tokens_in int, p_tokens_out int, p_web_searches int default 0
) returns int language plpgsql security definer set search_path = public as $$
declare
  v_cfg jsonb := coalesce((select value from public.settings where key = 'pro_ai'), '{}'::jsonb);
  v_h public.credit_holds%rowtype;
  v_price jsonb;
  v_cost numeric;
  v_usage uuid;
  v_charge int;
begin
  select * into v_h from public.credit_holds where id = p_hold;
  if not found then
    raise exception 'Unknown hold' using errcode = '22023';
  end if;
  perform 1 from public.profiles where id = v_h.user_id for update;
  select * into v_h from public.credit_holds where id = p_hold;
  if v_h.status = 'settled' then
    return public.credit_balance(v_h.user_id);
  end if;

  v_price := v_cfg -> 'model_prices' -> v_h.model;
  v_cost := round((
      greatest(coalesce(p_tokens_in, 0), 0) * coalesce((v_price ->> 'in')::numeric, 0)
    + greatest(coalesce(p_tokens_out, 0), 0) * coalesce((v_price ->> 'out')::numeric, 0)
    ) / 1000000.0
    + greatest(coalesce(p_web_searches, 0), 0) * coalesce((v_cfg ->> 'web_search_usd')::numeric, 0), 5);

  insert into public.ai_usage (user_id, job, provider, route, model, tokens_in, tokens_out, web_searches, cost_usd)
  values (v_h.user_id, v_h.job, 'anthropic', 'platform', v_h.model,
          greatest(coalesce(p_tokens_in, 0), 0), greatest(coalesce(p_tokens_out, 0), 0),
          greatest(coalesce(p_web_searches, 0), 0), v_cost)
  returning id into v_usage;

  -- A live hold is spent in full. One that had expired (and so was given
  -- back) is still paid for as far as the credits are there, since the answer
  -- was delivered; the balance never goes below zero.
  v_charge := case
    when v_h.status = 'held' and v_h.expires_at > now() then v_h.credits
    else least(v_h.credits, greatest(public.credit_balance(v_h.user_id), 0)) end;
  if v_charge > 0 then
    insert into public.credit_ledger (user_id, delta, kind, reason, ref)
    values (v_h.user_id, -v_charge, 'spend', v_h.job::text, v_usage::text);
  end if;
  update public.credit_holds set status = 'settled', closed_at = now() where id = p_hold;
  return public.credit_balance(v_h.user_id);
end $$;
revoke execute on function public.ai_settle_credits(uuid, int, int, int) from public, anon, authenticated;
grant execute on function public.ai_settle_credits(uuid, int, int, int) to service_role;

-- Release: the call failed, the credits go back. Safe to call twice, and a
-- settled hold stays settled.
create or replace function public.ai_release_credits(p_hold uuid)
returns void language sql security definer set search_path = public as $$
  update public.credit_holds set status = 'released', closed_at = now()
   where id = p_hold and status = 'held';
$$;
revoke execute on function public.ai_release_credits(uuid) from public, anon, authenticated;
grant execute on function public.ai_release_credits(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Admin: the switch, the limits, and how the month is going.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_pro_ai(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := coalesce((select value from public.settings where key = 'pro_ai'), '{}'::jsonb);
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
    if v_key not in ('enabled', 'trial_credits', 'daily_credit_cap', 'daily_unmetered_calls',
                     'monthly_budget_usd', 'credit_prices', 'models') then
      raise exception 'Unknown setting: %', v_key using errcode = '22023';
    end if;
  end loop;
  if p_patch ? 'enabled' and jsonb_typeof(p_patch -> 'enabled') <> 'boolean' then
    raise exception 'enabled must be true or false' using errcode = '22023';
  end if;
  for v_key in select unnest(array['trial_credits', 'daily_credit_cap', 'daily_unmetered_calls', 'monthly_budget_usd']) loop
    if p_patch ? v_key and (jsonb_typeof(p_patch -> v_key) <> 'number'
        or (p_patch ->> v_key)::numeric < 0 or (p_patch ->> v_key)::numeric > 100000
        or (v_key <> 'monthly_budget_usd' and (p_patch ->> v_key)::numeric % 1 <> 0)) then
      raise exception '% must be a number from 0 to 100000 (whole, except the budget)', v_key using errcode = '22023';
    end if;
  end loop;
  if p_patch ? 'credit_prices' and (jsonb_typeof(p_patch -> 'credit_prices') <> 'object' or exists (
       select 1 from jsonb_each(p_patch -> 'credit_prices') e
        where jsonb_typeof(e.value) <> 'number' or (e.value #>> '{}')::numeric < 0
           or (e.value #>> '{}')::numeric > 1000 or (e.value #>> '{}')::numeric % 1 <> 0
           or e.key not in (select unnest(enum_range(null::public.ai_job))::text))) then
    raise exception 'Credit prices are whole numbers from 0 to 1000, one per AI job' using errcode = '22023';
  end if;
  -- A model without a price would run unseen by the budget.
  if p_patch ? 'models' and (jsonb_typeof(p_patch -> 'models') <> 'object' or exists (
       select 1 from jsonb_each(p_patch -> 'models') e
        where e.key not in ('fast', 'writing') or jsonb_typeof(e.value) <> 'string'
           or not coalesce(v_old -> 'model_prices', '{}'::jsonb) ? (e.value #>> '{}'))) then
    raise exception 'Models are "fast" and "writing", each a model with a price in model_prices' using errcode = '22023';
  end if;

  v_new := v_old || (p_patch - 'credit_prices' - 'models');
  if p_patch ? 'credit_prices' then
    v_new := jsonb_set(v_new, '{credit_prices}', coalesce(v_old -> 'credit_prices', '{}'::jsonb) || (p_patch -> 'credit_prices'));
  end if;
  if p_patch ? 'models' then
    v_new := jsonb_set(v_new, '{models}', coalesce(v_old -> 'models', '{}'::jsonb) || (p_patch -> 'models'));
  end if;
  update public.settings set value = v_new where key = 'pro_ai';

  -- Switching the route on gives every account its trial credits.
  if coalesce((v_new ->> 'enabled')::boolean, false) and not coalesce((v_old ->> 'enabled')::boolean, false) then
    perform public.grant_trial_credits(id) from public.profiles;
  end if;
  return v_new;
end $$;
revoke execute on function public.admin_set_pro_ai(jsonb) from public, anon;
grant execute on function public.admin_set_pro_ai(jsonb) to authenticated;

create or replace function public.admin_pro_ai()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cfg jsonb := coalesce((select value from public.settings where key = 'pro_ai'), '{}'::jsonb);
  v_month timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_spend numeric;
  v_budget numeric := coalesce((v_cfg ->> 'monthly_budget_usd')::numeric, 0);
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  select coalesce(sum(cost_usd), 0) into v_spend from public.ai_usage
   where route = 'platform' and created_at >= v_month;
  return jsonb_build_object(
    'settings', v_cfg,
    'month_spend_usd', v_spend,
    'month_calls', (select count(*) from public.ai_usage where route = 'platform' and created_at >= v_month),
    'month_credits', (select coalesce(-sum(delta), 0) from public.credit_ledger where kind = 'spend' and created_at >= v_month),
    'budget_used', case when v_budget > 0 then round(v_spend / v_budget, 4) else null end,
    'budget_warning', v_budget > 0 and v_spend >= v_budget * 0.8,
    'open_holds', (select count(*) from public.credit_holds where status = 'held' and expires_at > now())
  );
end $$;
revoke execute on function public.admin_pro_ai() from public, anon;
grant execute on function public.admin_pro_ai() to authenticated;
