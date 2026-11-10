-- What the signed-in account needs to know about AI on credits, so the app
-- can show what a generation will cost before it runs: whether the Pro route
-- is on, the credit price of each job, whether credits go before the
-- account's own keys, and how much of today's limit is left.

create or replace function public.ai_route_info()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_cfg jsonb := coalesce((select value from public.settings where key = 'pro_ai'), '{}'::jsonb);
  v_day timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_cap int := coalesce((v_cfg ->> 'daily_credit_cap')::int, 0);
  v_spent int;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if not coalesce((v_cfg ->> 'enabled')::boolean, false) then
    return jsonb_build_object('enabled', false);
  end if;
  select coalesce(-sum(delta), 0) into v_spent from public.credit_ledger
   where user_id = v_uid and kind = 'spend' and created_at >= v_day;
  return jsonb_build_object(
    'enabled', true,
    'prices', coalesce(v_cfg -> 'credit_prices', '{}'::jsonb),
    'credits_first', (public.entitlements_for(v_uid) ->> 'plan') <> 'free',
    'own_only', coalesce((select ai_route = 'own' from public.profiles where id = v_uid), false),
    'credits', public.credit_balance(v_uid),
    'daily_left', greatest(v_cap - v_spent, 0)
  );
end $$;
revoke execute on function public.ai_route_info() from public, anon;
grant execute on function public.ai_route_info() to authenticated;
