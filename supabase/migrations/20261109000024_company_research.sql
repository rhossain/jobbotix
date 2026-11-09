-- Company research per role (research-company Edge Function). Shape in
-- libs/shared-types company.ts; '{}' until the user asks for it.
alter table public.roles
  add column company_research jsonb not null default '{}'::jsonb;
alter type public.ai_job add value if not exists 'research';
