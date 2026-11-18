-- Sign in with LinkedIn (Supabase's linkedin_oidc provider, LinkedIn's own
-- "Sign In with LinkedIn using OpenID Connect").
--
-- An account that already exists needs nothing from this file: the auth
-- server attaches the LinkedIn sign-in to the account with the same confirmed
-- email address, and no row is added to auth.users.
--
-- A new account is different. The auth server adds the row itself, with what
-- LinkedIn sent in raw_user_meta_data, and an invite code cannot travel that
-- way. So the sign-up page hands the code in first, together with the email
-- address the person's LinkedIn account uses (reserve_linkedin_signup), and
-- handle_new_user() takes the code from there when a new account with that
-- email arrives without one. Without a code, in the row or reserved, sign-up
-- is refused exactly as before; LinkedIn opens no way round the invite rule.

create table public.signup_tickets (
  email text primary key,                  -- lower case
  invite_code text not null,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now()
);
-- Reached only through the functions below; no policy, so no role reads it.
alter table public.signup_tickets enable row level security;
revoke all on public.signup_tickets from anon, authenticated;

create or replace function public.reserve_linkedin_signup(
  p_code text,
  p_email text,
  p_timezone text default 'UTC'
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_zone text := left(coalesce(nullif(btrim(p_timezone), ''), 'UTC'), 64);
begin
  if length(v_email) > 320 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter the email address your LinkedIn account uses' using errcode = '22023';
  end if;
  if not public.invite_code_is_valid(v_code) then
    raise exception 'A valid invite code is required to sign up' using errcode = 'P0001';
  end if;
  -- A reservation lasts half an hour; old ones go whenever a new one is made.
  delete from public.signup_tickets where created_at < now() - interval '30 minutes';
  if (select count(*) from public.signup_tickets) >= 500 then
    raise exception 'Too many sign-ups are waiting. Try again in a few minutes.' using errcode = '54000';
  end if;
  insert into public.signup_tickets (email, invite_code, timezone)
  values (v_email, v_code, v_zone)
  on conflict (email) do update
    set invite_code = excluded.invite_code, timezone = excluded.timezone, created_at = now();
end $$;
revoke execute on function public.reserve_linkedin_signup(text, text, text) from public;
grant execute on function public.reserve_linkedin_signup(text, text, text) to anon, authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_code text := nullif(btrim(new.raw_user_meta_data ->> 'invite_code'), '');
  v_zone text := nullif(btrim(new.raw_user_meta_data ->> 'timezone'), '');
  v_open boolean := coalesce((select (value ->> 'open_signup')::boolean from public.settings where key = 'signup'), false);
  v_first boolean := not exists (select 1 from public.profiles);
  v_ticket public.signup_tickets;
begin
  -- A code handed in ahead of a LinkedIn sign-up for this email address.
  -- Taking it removes it; if the sign-up is refused below, that is undone
  -- with everything else.
  if v_code is null then
    delete from public.signup_tickets where email = lower(new.email)
    returning * into v_ticket;
    if found and v_ticket.created_at > now() - interval '30 minutes' then
      v_code := v_ticket.invite_code;
      v_zone := coalesce(v_zone, v_ticket.timezone);
    end if;
  end if;

  if not v_first and not v_open then
    if v_code is null or not public.invite_code_is_valid(v_code) then
      raise exception 'A valid invite code is required to sign up' using errcode = 'P0001';
    end if;
    update public.invite_codes set uses = uses + 1 where code = v_code;
  end if;

  insert into public.profiles (id, email, name, timezone, invite_code, is_admin)
  values (
    new.id,
    new.email,
    -- LinkedIn sends the member's name as "name"; some sign-in providers
    -- use "full_name".
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      ''
    ),
    coalesce(v_zone, 'UTC'),
    v_code,
    v_first                                -- the first account is the admin
  );
  return new;
end $$;
