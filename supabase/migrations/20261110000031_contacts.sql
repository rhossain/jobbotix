-- People: recruiters, hiring managers and people who can refer you, linked
-- to the roles they relate to, with a log of every touch and a date to get
-- back to them. Today lists the people whose date has come.

alter type public.ai_job add value if not exists 'message';

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  company text not null default '' check (length(company) <= 200),
  -- their job title ("Engineering Manager")
  title text not null default '' check (length(title) <= 200),
  relation text not null default 'other'
    check (relation in ('recruiter', 'hiring_manager', 'referrer', 'peer', 'other')),
  email text not null default '' check (length(email) <= 320),
  linkedin_url text not null default '' check (length(linkedin_url) <= 500),
  -- how you know them, what they care about
  notes text not null default '' check (length(notes) <= 10000),
  next_touch_on date,
  last_touch_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contacts_user on public.contacts (user_id, next_touch_on);
create trigger contacts_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();
alter table public.contacts enable row level security;
create policy "contacts: own rows" on public.contacts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Which people relate to which roles (many to many).
create table public.role_contacts (
  role_id uuid not null references public.roles (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, contact_id)
);
create index role_contacts_contact on public.role_contacts (contact_id);
alter table public.role_contacts enable row level security;
create policy "role_contacts: own rows" on public.role_contacts
  for all using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.roles r where r.id = role_id and r.user_id = auth.uid())
    and exists (select 1 from public.contacts c where c.id = contact_id and c.user_id = auth.uid())
  );

-- Every message, call or reply, either way.
create table public.contact_touches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  role_id uuid references public.roles (id) on delete set null,
  at timestamptz not null default now(),
  channel text not null default 'email'
    check (channel in ('email', 'linkedin', 'call', 'message', 'meeting', 'other')),
  direction text not null default 'out' check (direction in ('out', 'in')),
  note text not null default '' check (length(note) <= 10000),
  created_at timestamptz not null default now()
);
create index contact_touches_contact on public.contact_touches (contact_id, at desc);
alter table public.contact_touches enable row level security;
create policy "contact_touches: own rows" on public.contact_touches
  for all using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.contacts c where c.id = contact_id and c.user_id = auth.uid())
    and (role_id is null
         or exists (select 1 from public.roles r where r.id = role_id and r.user_id = auth.uid()))
  );

-- A touch keeps the contact's last-touch time current.
create or replace function public.contact_touches_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  update public.contacts
     set last_touch_at = greatest(coalesce(last_touch_at, new.at), new.at)
   where id = new.contact_id and user_id = new.user_id;
  return new;
end $$;

create trigger contact_touches_stamp after insert on public.contact_touches
  for each row execute function public.contact_touches_stamp();
