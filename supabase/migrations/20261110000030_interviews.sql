-- Interview rounds per role: when, what kind, with whom, where, and what
-- happened. The app shows upcoming rounds on Today and in the digest, offers
-- a calendar file, a debrief and a thank-you note per round.

alter type public.ai_job add value if not exists 'thank_you';

create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete cascade,
  kind text not null default 'screen'
    check (kind in ('screen', 'technical', 'take_home', 'system_design', 'behavioural', 'final', 'other')),
  -- the user's own label for the round ("Pairing with the CTO"); optional
  title text not null default '' check (length(title) <= 120),
  scheduled_at timestamptz,
  duration_min smallint not null default 45 check (duration_min between 5 and 600),
  -- a video link, a phone number or an address
  location text not null default '' check (length(location) <= 1000),
  interviewers text not null default '' check (length(interviewers) <= 500),
  status text not null default 'scheduled' check (status in ('scheduled', 'done', 'cancelled')),
  outcome text not null default '' check (outcome in ('', 'waiting', 'passed', 'rejected')),
  notes text not null default '' check (length(notes) <= 10000),
  debrief text not null default '' check (length(debrief) <= 20000),
  thank_you text not null default '' check (length(thank_you) <= 10000),
  thank_you_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index interviews_user_scheduled on public.interviews (user_id, scheduled_at);
create index interviews_role on public.interviews (role_id);
create trigger interviews_updated_at before update on public.interviews
  for each row execute function public.set_updated_at();

alter table public.interviews enable row level security;
create policy "interviews: own rows" on public.interviews
  for all using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.roles r where r.id = role_id and r.user_id = auth.uid())
  );

-- Scheduling a round moves a role that is still earlier in the pipeline to
-- Interview (the status trigger logs the change as usual).
create or replace function public.interviews_advance_role()
returns trigger language plpgsql set search_path = public as $$
begin
  update public.roles
     set status = 'interview'
   where id = new.role_id
     and user_id = new.user_id
     and status in ('new', 'shortlist', 'applied');
  return new;
end $$;

create trigger interviews_advance_role after insert on public.interviews
  for each row execute function public.interviews_advance_role();
