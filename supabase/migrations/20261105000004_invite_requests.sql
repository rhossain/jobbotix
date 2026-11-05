-- Invite requests from the public landing page. Anonymous callers can only
-- add a row through the RPC (rate-limited per address); admins read them.

create table public.invite_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  invited_code text references public.invite_codes (code) on delete set null
);
create index invite_requests_email on public.invite_requests (lower(email));
alter table public.invite_requests enable row level security;
create policy "invite_requests: admin only" on public.invite_requests
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.request_invite(p_email text, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid email address is required' using errcode = '22023';
  end if;
  -- one request per address per day
  if exists (select 1 from public.invite_requests where lower(email) = lower(p_email) and created_at > now() - interval '1 day') then
    return;
  end if;
  insert into public.invite_requests (email, note) values (lower(trim(p_email)), left(coalesce(p_note, ''), 300));
end $$;
grant execute on function public.request_invite(text, text) to anon, authenticated;
