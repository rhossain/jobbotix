-- Prompt caching (subscription TODO, section 5).
--
-- A resume job now sends the person's resume ahead of the task and marks it
-- cacheable on Anthropic. A call can then have three kinds of input tokens,
-- each with its own price:
--   plain         the usual input price
--   cache write   stored for the next call: 1.25 times the input price
--   cache read    read back from the store: a small share of the input price
--                 (0.1 by default; a model can name its own share as
--                 "cache_read_x" in pro_ai.model_prices)
-- ai_usage keeps the two cached counts beside tokens_in (which stays the
-- whole prompt), and ai_settle_credits costs a platform call part by part.

alter table public.ai_usage
  add column cache_read_tokens int not null default 0 check (cache_read_tokens >= 0),
  add column cache_write_tokens int not null default 0 check (cache_write_tokens >= 0);

-- Sonnet 5.5 reads its cache at 0.05 of the input price (Anthropic's price
-- list, November 2026); Haiku 5.5 uses the default 0.1.
update public.settings
   set value = jsonb_set(value, '{model_prices,claude-sonnet-5-5,cache_read_x}', '0.05')
 where key = 'pro_ai'
   and value #> '{model_prices,claude-sonnet-5-5}' is not null;

-- The same function as before with the two cached counts added at the end,
-- so a caller that does not name them gets the old sum.
drop function public.ai_settle_credits(uuid, int, int, int, boolean);
create function public.ai_settle_credits(
  p_hold uuid, p_tokens_in int, p_tokens_out int, p_web_searches int default 0,
  p_charge boolean default true, p_cache_read int default 0, p_cache_write int default 0
) returns int language plpgsql security definer set search_path = public as $$
declare
  v_cfg jsonb := coalesce((select value from public.settings where key = 'pro_ai'), '{}'::jsonb);
  v_h public.credit_holds%rowtype;
  v_price jsonb;
  v_cost numeric;
  v_usage uuid;
  v_charge int;
  v_in int := greatest(coalesce(p_tokens_in, 0), 0);
  v_out int := greatest(coalesce(p_tokens_out, 0), 0);
  -- The cached counts are parts of the prompt: never more than the whole.
  v_read int := least(greatest(coalesce(p_cache_read, 0), 0), greatest(coalesce(p_tokens_in, 0), 0));
  v_write int;
begin
  v_write := least(greatest(coalesce(p_cache_write, 0), 0), v_in - v_read);
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
      ( (v_in - v_read - v_write)
        + v_write * 1.25
        + v_read * coalesce((v_price ->> 'cache_read_x')::numeric, 0.1)
      ) * coalesce((v_price ->> 'in')::numeric, 0)
    + v_out * coalesce((v_price ->> 'out')::numeric, 0)
    ) / 1000000.0
    + greatest(coalesce(p_web_searches, 0), 0) * coalesce((v_cfg ->> 'web_search_usd')::numeric, 0), 5);

  insert into public.ai_usage (user_id, job, provider, route, model, tokens_in, tokens_out,
                               cache_read_tokens, cache_write_tokens, web_searches, cost_usd)
  values (v_h.user_id, v_h.job, 'anthropic', 'platform', v_h.model, v_in, v_out,
          v_read, v_write, greatest(coalesce(p_web_searches, 0), 0), v_cost)
  returning id into v_usage;

  -- A live hold is spent in full. One that had expired (and so was given
  -- back) is still paid for as far as the credits are there, since the answer
  -- was delivered; the balance never goes below zero.
  v_charge := case
    when not coalesce(p_charge, true) then 0
    when v_h.status = 'held' and v_h.expires_at > now() then v_h.credits
    else least(v_h.credits, greatest(public.credit_balance(v_h.user_id), 0)) end;
  if v_charge > 0 then
    insert into public.credit_ledger (user_id, delta, kind, reason, ref)
    values (v_h.user_id, -v_charge, 'spend', v_h.job::text, v_usage::text);
  end if;
  update public.credit_holds set status = 'settled', closed_at = now() where id = p_hold;
  return public.credit_balance(v_h.user_id);
end $$;
revoke execute on function public.ai_settle_credits(uuid, int, int, int, boolean, int, int) from public, anon, authenticated;
grant execute on function public.ai_settle_credits(uuid, int, int, int, boolean, int, int) to service_role;
