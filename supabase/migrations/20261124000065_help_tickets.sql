-- Questions sent from the Help chat to the support team.
--
-- The contact-support Edge Function writes a row and emails it to
-- support@jobbotix.com, with the person's own address as the reply-to, so
-- a reply goes straight back to them. The row is the record: the email can
-- fail and the question is still there.
--
-- A person can read their own requests. Nobody writes from the browser:
-- only the function (service role) inserts, and it limits each account to
-- a few requests a day. Rows go with the account when it is deleted.

create table public.help_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  message text not null check (char_length(btrim(message)) between 1 and 2000),
  -- the page they were on, e.g. /jobs/new
  page text not null default '' check (char_length(page) <= 300),
  -- the chat before the request, as plain lines (questions, articles shown)
  conversation text not null default '' check (char_length(conversation) <= 4000),
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);

create index help_tickets_user_created
  on public.help_tickets (user_id, created_at desc);

alter table public.help_tickets enable row level security;

create policy "help_tickets: read own" on public.help_tickets
  for select using (auth.uid() = user_id);

grant select on public.help_tickets to authenticated;
