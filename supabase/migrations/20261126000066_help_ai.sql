-- AI answers in the Help chat.
--
-- A question goes to the person's own AI connection when they have one, and
-- otherwise to Jobbotix's own Anthropic key, free to them. Help has its own
-- switch, daily limits and monthly budget in settings.help_ai, apart from the
-- Pro credits (settings.pro_ai), so it works while Pro is still closed:
--
--   enabled             false stops answers on Jobbotix's key at once
--   monthly_budget_usd  Jobbotix's spend on help in a calendar month (UTC);
--                       once reached, the chat shows articles until the 1st
--   daily_free          answers a day on Jobbotix's key, Free accounts
--   daily_pro           the same, paying accounts
--   daily_own           answers a day on the person's own key
--   model               the model on Jobbotix's key
--
-- Days are UTC days. Every answer is kept in help_messages for 30 days, so
-- the admin can see which questions went unanswered, then deleted.
--
--   help_messages       question, answer, the articles used, the route, yes/no
--   help_ai_check()     may this person have an AI answer on this route now
--   help_ai_log()       cost an answer on Jobbotix's key into ai_usage
--   purge_help_messages()  daily: delete what is older than 30 days

alter type public.ai_job add value if not exists 'help';

insert into public.settings (key, value)
values ('help_ai', '{
  "enabled": true,
  "monthly_budget_usd": 5,
  "daily_free": 10,
  "daily_pro": 100,
  "daily_own": 30,
  "model": "claude-haiku-5-5"
}')
on conflict (key) do nothing;

create table public.help_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  question text not null check (char_length(btrim(question)) between 1 and 500),
  -- the page they were on, e.g. /jobs/new
  page text not null default '' check (char_length(page) <= 300),
  answer text not null default '' check (char_length(answer) <= 2000),
  -- help article ids the answer was written from (or shown, without AI)
  articles text[] not null default '{}',
  -- own: their key; platform: Jobbotix's key; articles: no AI answer
  route text not null check (route in ('own', 'platform', 'articles')),
  -- false: the articles did not answer it (the questions to write articles for)
  found boolean not null default true,
  model text not null default '',
  feedback text check (feedback in ('yes', 'no')),
  created_at timestamptz not null default now()
);

create index help_messages_user_created
  on public.help_messages (user_id, created_at desc);
create index help_messages_created on public.help_messages (created_at);

alter table public.help_messages enable row level security;

create policy "help_messages: read own" on public.help_messages
  for select using (auth.uid() = user_id);

grant select on public.help_messages to authenticated;

-- ---------------------------------------------------------------------------
-- May this person have an AI answer on this route now?
--   {"ok": true, "model": "...", "left": n}
--   {"ok": false, "reason": "off" | "budget" | "daily_limit", "limit": n}
-- ---------------------------------------------------------------------------
create or replace function public.help_ai_check(p_user uuid, p_route text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cfg jsonb := coalesce((select value from public.settings where key = 'help_ai'), '{}'::jsonb);
  v_day timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_month timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_limit int;
  v_used int;
  v_spent numeric;
begin
  if p_user is null or p_route not in ('own', 'platform') then
    raise exception 'A user and a route (own or platform) are required' using errcode = '22023';
  end if;

  if p_route = 'own' then
    v_limit := coalesce((v_cfg ->> 'daily_own')::int, 30);
  else
    if not coalesce((v_cfg ->> 'enabled')::boolean, false) then
      return jsonb_build_object('ok', false, 'reason', 'off');
    end if;
    select coalesce(sum(cost_usd), 0) into v_spent from public.ai_usage
     where job = 'help' and route = 'platform' and created_at >= v_month;
    if v_spent >= coalesce((v_cfg ->> 'monthly_budget_usd')::numeric, 0) then
      return jsonb_build_object('ok', false, 'reason', 'budget');
    end if;
    v_limit := case
      when (public.entitlements_for(p_user) ->> 'plan') <> 'free'
        then coalesce((v_cfg ->> 'daily_pro')::int, 100)
      else coalesce((v_cfg ->> 'daily_free')::int, 10) end;
  end if;

  select count(*) into v_used from public.help_messages
   where user_id = p_user and route = p_route and created_at >= v_day;
  if v_used >= v_limit then
    return jsonb_build_object('ok', false, 'reason', 'daily_limit', 'limit', v_limit);
  end if;
  return jsonb_build_object(
    'ok', true,
    'model', coalesce(v_cfg ->> 'model', 'claude-haiku-5-5'),
    'left', v_limit - v_used - 1);
end $$;
revoke execute on function public.help_ai_check(uuid, text) from public, anon, authenticated;
grant execute on function public.help_ai_check(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- An answer on Jobbotix's key: logged in ai_usage at the model's price (from
-- settings.pro_ai.model_prices), so it counts against both the help budget
-- and the platform's monthly budget. No credits are spent.
-- ---------------------------------------------------------------------------
create or replace function public.help_ai_log(
  p_user uuid, p_model text, p_tokens_in int, p_tokens_out int,
  p_cache_read int default 0, p_cache_write int default 0
) returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_price jsonb := coalesce(
    (select value -> 'model_prices' -> p_model from public.settings where key = 'pro_ai'),
    '{"in": 0.1, "out": 0.5}'::jsonb);
  v_in int := greatest(coalesce(p_tokens_in, 0), 0);
  v_out int := greatest(coalesce(p_tokens_out, 0), 0);
  v_read int := least(greatest(coalesce(p_cache_read, 0), 0), greatest(coalesce(p_tokens_in, 0), 0));
  v_write int;
  v_cost numeric;
begin
  v_write := least(greatest(coalesce(p_cache_write, 0), 0), v_in - v_read);
  v_cost := round((
      ( (v_in - v_read - v_write)
        + v_write * 1.25
        + v_read * coalesce((v_price ->> 'cache_read_x')::numeric, 0.1)
      ) * coalesce((v_price ->> 'in')::numeric, 0.1)
    + v_out * coalesce((v_price ->> 'out')::numeric, 0.5)
    ) / 1000000.0, 5);
  insert into public.ai_usage (user_id, job, provider, route, model, tokens_in, tokens_out,
                               cache_read_tokens, cache_write_tokens, cost_usd)
  values (p_user, 'help', 'anthropic', 'platform', p_model, v_in, v_out, v_read, v_write, v_cost);
  return v_cost;
end $$;
revoke execute on function public.help_ai_log(uuid, text, int, int, int, int) from public, anon, authenticated;
grant execute on function public.help_ai_log(uuid, text, int, int, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- Help answers are kept for 30 days.
-- ---------------------------------------------------------------------------
create or replace function public.purge_help_messages()
returns void language sql security definer set search_path = public as $$
  delete from public.help_messages where created_at < now() - interval '30 days';
$$;
revoke execute on function public.purge_help_messages() from public, anon, authenticated;

select cron.schedule('purge-help-messages', '55 2 * * *', $$select public.purge_help_messages()$$);
