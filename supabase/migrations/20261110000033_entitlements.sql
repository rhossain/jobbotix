-- Plans and entitlements: what each account may use, before any payment
-- exists. Four tables (plans, subscriptions, payments, credit_ledger), one
-- question the rest of the system asks (entitlements), and the admin actions
-- that change the answer by hand.
--
-- Billing is OFF by default. While it is off, entitlements() reports every
-- feature for everyone, so nothing changes for existing accounts. An admin
-- can switch it on for single accounts (preview) to test the gates on the
-- live project without touching anyone else.
--
-- Users read their own rows and never write them: only the service role
-- (Edge Functions, later the payment webhook) and the admin functions below
-- change a subscription, a payment or a credit balance.

-- ---------------------------------------------------------------------------
-- plans: what Free and Pro include. Data, not code, so a feature moves between
-- plans with an UPDATE. Readable by anyone; the pricing page shows it.
-- ---------------------------------------------------------------------------
create table public.plans (
  id text primary key check (id ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  position int not null default 0,
  monthly_credits int not null default 0 check (monthly_credits >= 0),
  features text[] not null default '{}',
  limits jsonb not null default '{}'::jsonb
);
alter table public.plans enable row level security;
create policy "plans: anyone reads" on public.plans
  for select using (true);

insert into public.plans (id, name, position, monthly_credits, features, limits) values
  ('free', 'Free', 0, 0,
   array['ai'],
   '{"search_profiles": 1}'),
  ('pro', 'Pro', 1, 500,
   array['ai', 'company_research', 'multiple_profiles', 'instant_alerts',
         'outcome_insights', 'extra_templates', 'docx_export', 'credit_topup'],
   '{"search_profiles": 5}');

-- ---------------------------------------------------------------------------
-- subscriptions: one row per account that has ever had a plan set. No row
-- means Free. `source` says who controls the row: an admin grant or Polar.
-- ---------------------------------------------------------------------------
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'canceled');

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  plan_id text not null references public.plans (id),
  status public.subscription_status not null default 'active',
  source text not null default 'admin' check (source in ('admin', 'polar')),
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz,            -- null: no end date (an open admin grant)
  cancel_at_period_end boolean not null default false,
  grace_until timestamptz,                   -- past_due keeps the plan until then
  provider_customer_id text,
  provider_subscription_id text unique,
  granted_by uuid references public.profiles (id) on delete set null,
  note text not null default '' check (length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();
alter table public.subscriptions enable row level security;
create policy "subscriptions: own row" on public.subscriptions
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- payments: what the payment provider reported, one row per order or refund.
-- Card details never reach Jobbotix; the provider holds them.
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null default 'polar' check (provider in ('polar')),
  provider_ref text not null,                -- the order or refund id at the provider
  kind text not null check (kind in ('subscription', 'topup', 'refund')),
  product text not null default '' check (length(product) <= 200),
  amount_cents int not null,                 -- negative for a refund
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  status text not null default 'paid' check (status in ('paid', 'refunded', 'failed')),
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (provider, provider_ref)
);
create index payments_user_paid on public.payments (user_id, paid_at desc);
alter table public.payments enable row level security;
create policy "payments: own rows" on public.payments
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- credit_ledger: every change to an account's AI credits, never edited. The
-- balance is the sum of delta. Positive rows grant, negative rows spend.
-- ---------------------------------------------------------------------------
create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  delta int not null check (delta <> 0),
  kind text not null check (kind in ('trial', 'monthly', 'topup', 'admin', 'spend', 'refund', 'expire')),
  reason text not null default '' check (length(reason) <= 500),
  ref text check (ref is null or length(ref) <= 200),  -- an ai_usage id, a payment ref
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index credit_ledger_user_created on public.credit_ledger (user_id, created_at desc);
alter table public.credit_ledger enable row level security;
create policy "credit_ledger: own rows" on public.credit_ledger
  for select using (user_id = auth.uid());

create or replace function public.credit_balance(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(delta), 0)::int from public.credit_ledger where user_id = p_user;
$$;
revoke execute on function public.credit_balance(uuid) from public, anon, authenticated;
grant execute on function public.credit_balance(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The billing switch. `enabled` gates everyone; `preview_users` gates single
-- accounts while it is off.
-- ---------------------------------------------------------------------------
insert into public.settings (key, value)
values ('billing', '{"enabled": false, "preview_users": []}')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- entitlements: the one answer to "what may this account use?".
--   enforced   false while billing is off for this account: every feature is on
--   plan       the plan in force now (free when a subscription lapsed)
--   features   feature keys the account may use
--   limits     numeric limits of the plan; empty when not enforced
--   credits    AI credits left
-- entitlements_for(user) is for the service role; entitlements() answers for
-- the signed-in caller.
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
    'credits', public.credit_balance(p_user)
  );
end $$;
revoke execute on function public.entitlements_for(uuid) from public, anon, authenticated;
grant execute on function public.entitlements_for(uuid) to service_role;

create or replace function public.entitlements()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  return public.entitlements_for(auth.uid());
end $$;
revoke execute on function public.entitlements() from public, anon;
grant execute on function public.entitlements() to authenticated;

-- ---------------------------------------------------------------------------
-- Admin actions. Each needs a reason, kept on the row it writes.
-- ---------------------------------------------------------------------------

-- Puts an account on a plan by hand. p_until null means no end date. A
-- subscription billed through the payment provider is not touched here, so
-- the two can never disagree about what the customer is paying for.
create or replace function public.admin_set_plan(
  p_user uuid, p_plan text, p_reason text, p_until timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Give a reason' using errcode = '22023';
  end if;
  if not exists (select 1 from public.plans where id = p_plan) then
    raise exception 'Unknown plan' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Unknown user' using errcode = '22023';
  end if;
  if exists (select 1 from public.subscriptions where user_id = p_user and source = 'polar') then
    raise exception 'This subscription is billed through Polar; change it there' using errcode = '22023';
  end if;

  insert into public.subscriptions
    (user_id, plan_id, status, source, current_period_start, current_period_end, granted_by, note)
  values (p_user, p_plan, 'active', 'admin', now(), p_until, auth.uid(), left(trim(p_reason), 500))
  on conflict (user_id) do update set
    plan_id = excluded.plan_id, status = 'active', source = 'admin',
    current_period_start = now(), current_period_end = excluded.current_period_end,
    cancel_at_period_end = false, grace_until = null,
    granted_by = excluded.granted_by, note = excluded.note;

  return public.entitlements_for(p_user);
end $$;
revoke execute on function public.admin_set_plan(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.admin_set_plan(uuid, text, text, timestamptz) to authenticated;

-- Adds (or, with a negative amount, takes back) credits. Returns the balance.
create or replace function public.admin_add_credits(p_user uuid, p_amount int, p_reason text)
returns int language plpgsql security definer set search_path = public as $$
declare v_balance int;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Give a reason' using errcode = '22023';
  end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 10000 then
    raise exception 'Amount must be between 1 and 10000 credits' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Unknown user' using errcode = '22023';
  end if;
  -- one adjustment at a time per account, so the balance check below holds
  perform 1 from public.profiles where id = p_user for update;
  v_balance := public.credit_balance(p_user) + p_amount;
  if v_balance < 0 then
    raise exception 'That would take the balance below zero' using errcode = '22023';
  end if;
  insert into public.credit_ledger (user_id, delta, kind, reason, created_by)
  values (p_user, p_amount, 'admin', left(trim(p_reason), 500), auth.uid());
  return v_balance;
end $$;
revoke execute on function public.admin_add_credits(uuid, int, text) from public, anon;
grant execute on function public.admin_add_credits(uuid, int, text) to authenticated;

create or replace function public.admin_set_billing(p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  update public.settings
     set value = jsonb_set(value, '{enabled}', to_jsonb(coalesce(p_enabled, false)))
   where key = 'billing';
end $$;
revoke execute on function public.admin_set_billing(boolean) from public, anon;
grant execute on function public.admin_set_billing(boolean) to authenticated;

-- Turns the gates on or off for one account while billing is off for the rest.
create or replace function public.admin_set_billing_preview(p_user uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_list jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Unknown user' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(u), '[]'::jsonb) into v_list
    from jsonb_array_elements_text(
           coalesce((select value -> 'preview_users' from public.settings where key = 'billing'), '[]'::jsonb)) u
   where u <> p_user::text;
  if coalesce(p_on, false) then
    v_list := v_list || to_jsonb(p_user::text);
  end if;
  update public.settings set value = jsonb_set(value, '{preview_users}', v_list) where key = 'billing';
end $$;
revoke execute on function public.admin_set_billing_preview(uuid, boolean) from public, anon;
grant execute on function public.admin_set_billing_preview(uuid, boolean) to authenticated;

-- Plan, credits and the billing switch for every account, for /admin.
create or replace function public.admin_plans()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_billing jsonb := coalesce((select value from public.settings where key = 'billing'), '{}'::jsonb);
  v_users jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(
           public.entitlements_for(p.id) || jsonb_build_object(
             'id', p.id,
             'note', coalesce(s.note, ''),
             'preview', coalesce(v_billing -> 'preview_users', '[]'::jsonb) ? p.id::text)
           order by p.created_at), '[]'::jsonb)
    into v_users
    from public.profiles p
    left join public.subscriptions s on s.user_id = p.id;
  return jsonb_build_object(
    'enabled', coalesce((v_billing ->> 'enabled')::boolean, false),
    'users', v_users);
end $$;
revoke execute on function public.admin_plans() from public, anon;
grant execute on function public.admin_plans() to authenticated;
