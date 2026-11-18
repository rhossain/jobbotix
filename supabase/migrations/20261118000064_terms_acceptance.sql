-- Terms acceptance, recorded. Until now the Terms page said "by creating an
-- account you agree", and nothing kept a record that anyone did.
--
--   profiles.terms_version       which Terms the person agreed to
--   profiles.terms_accepted_at   when
--
-- Recorded by the database only:
--   * at sign-up, from the box ticked on the Sign up page: it travels in the
--     new user's metadata (email and password), or with the invite code
--     handed in ahead of a LinkedIn sign-up (signup_tickets);
--   * otherwise through accept_terms(), which the app calls from a one-time
--     page shown to an account with no record (accounts from before, and a
--     sign-up through LinkedIn that came in another way).
-- The two columns cannot be changed by a user directly.

alter table public.profiles
  add column terms_version text,
  add column terms_accepted_at timestamptz;

alter table public.signup_tickets
  add column terms_version text;

-- Which Terms count: a short label such as '2026-11-13'.
create or replace function public.valid_terms_version(p text)
returns boolean language sql immutable as $$
  select p ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
$$;

create or replace function public.accept_terms(p_version text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.valid_terms_version(p_version) then
    raise exception 'Unknown terms version' using errcode = '22023';
  end if;
  -- the guard below lets this function, and only it, write the two columns
  perform set_config('jobbotix.accepting_terms', 'on', true);
  update public.profiles
     set terms_version = p_version, terms_accepted_at = now()
   where id = auth.uid();
  perform set_config('jobbotix.accepting_terms', 'off', true);
end $$;
revoke execute on function public.accept_terms(text) from public, anon;
grant execute on function public.accept_terms(text) to authenticated;

-- As in migration 0046, plus the two terms columns.
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
    if (new.terms_version is distinct from old.terms_version
        or new.terms_accepted_at is distinct from old.terms_accepted_at)
       and coalesce(current_setting('jobbotix.accepting_terms', true), 'off') <> 'on' then
      raise exception 'Terms acceptance is recorded by accept_terms() only' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- As in migration 0062, plus a terms version handed in with the code. The
-- three-argument form goes: two forms that both accept three named
-- arguments would leave the API unable to choose. An app still calling with
-- three reaches this one, the fourth taking its default.
drop function public.reserve_linkedin_signup(text, text, text);
create function public.reserve_linkedin_signup(
  p_code text,
  p_email text,
  p_timezone text default 'UTC',
  p_terms_version text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_zone text := left(coalesce(nullif(btrim(p_timezone), ''), 'UTC'), 64);
  v_terms text := case when public.valid_terms_version(p_terms_version) then p_terms_version end;
begin
  if length(v_email) > 320 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter the email address your LinkedIn account uses' using errcode = '22023';
  end if;
  if not public.invite_code_is_valid(v_code) then
    raise exception 'A valid invite code is required to sign up' using errcode = 'P0001';
  end if;
  delete from public.signup_tickets where created_at < now() - interval '30 minutes';
  if (select count(*) from public.signup_tickets) >= 500 then
    raise exception 'Too many sign-ups are waiting. Try again in a few minutes.' using errcode = '54000';
  end if;
  insert into public.signup_tickets (email, invite_code, timezone, terms_version)
  values (v_email, v_code, v_zone, v_terms)
  on conflict (email) do update
    set invite_code = excluded.invite_code, timezone = excluded.timezone,
        terms_version = excluded.terms_version, created_at = now();
end $$;
revoke execute on function public.reserve_linkedin_signup(text, text, text, text) from public;
grant execute on function public.reserve_linkedin_signup(text, text, text, text) to anon, authenticated;

-- As in migration 0062, plus the terms version from the metadata or the ticket.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_code text := nullif(btrim(new.raw_user_meta_data ->> 'invite_code'), '');
  v_zone text := nullif(btrim(new.raw_user_meta_data ->> 'timezone'), '');
  v_terms text := new.raw_user_meta_data ->> 'terms_version';
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
      v_terms := coalesce(v_terms, v_ticket.terms_version);
    end if;
  end if;
  if not public.valid_terms_version(v_terms) then
    v_terms := null;
  end if;

  if not v_first and not v_open then
    if v_code is null or not public.invite_code_is_valid(v_code) then
      raise exception 'A valid invite code is required to sign up' using errcode = 'P0001';
    end if;
    update public.invite_codes set uses = uses + 1 where code = v_code;
  end if;

  insert into public.profiles (id, email, name, timezone, invite_code, is_admin, terms_version, terms_accepted_at)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      ''
    ),
    coalesce(v_zone, 'UTC'),
    v_code,
    v_first,                               -- the first account is the admin
    v_terms,
    case when v_terms is not null then now() end
  );
  return new;
end $$;
