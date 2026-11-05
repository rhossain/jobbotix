-- The open sign-up switch: readable by anyone (the sign-up page needs it),
-- flipped only by an admin. handle_new_user() already honours it.
create or replace function public.signup_is_open()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (value ->> 'open_signup')::boolean from public.settings where key = 'signup'), false);
$$;
grant execute on function public.signup_is_open() to anon, authenticated;

create or replace function public.admin_set_open_signup(p_open boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  insert into public.settings (key, value) values ('signup', jsonb_build_object('open_signup', p_open))
  on conflict (key) do update set value = jsonb_build_object('open_signup', p_open);
end $$;
revoke execute on function public.admin_set_open_signup(boolean) from public, anon;
grant execute on function public.admin_set_open_signup(boolean) to authenticated;
