-- The first account never needs an invite code (handle_new_user() admits it
-- and makes it the admin). Report that from signup_is_open() so the sign-up
-- page does not demand a code nobody can have yet.
create or replace function public.signup_is_open()
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles)
      or coalesce((select (value ->> 'open_signup')::boolean from public.settings where key = 'signup'), false);
$$;
