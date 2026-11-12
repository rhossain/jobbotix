-- Company research shared for 30 days (subscription TODO, section 5).
--
-- Research with web search is the dearest AI job: several searches and a
-- long answer. What it finds is about the company, not about the person who
-- asked, so one search can serve everyone who looks at that company for a
-- while. This table keeps the result of a research paid for from Jobbotix's
-- own key, under the company's normalised name.
--
-- A row holds what was found about the company, the pages it came from, the
-- model and the date. It does not hold who asked or which posting they were
-- looking at. Only the Edge Functions (service role) read and write it;
-- there are no policies.

create table public.company_research_cache (
  -- the company name as normaliseCompany() writes it: lower case, no legal suffix
  company_key text primary key check (length(company_key) between 2 and 120),
  research jsonb not null check (jsonb_typeof(research) = 'object'),
  model text not null default '',
  researched_at timestamptz not null default now()
);
create index company_research_cache_at on public.company_research_cache (researched_at);
alter table public.company_research_cache enable row level security;
