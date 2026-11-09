-- Web searches made during a call (company research), for the Usage page's
-- cost estimate: Anthropic bills them per search on top of tokens.
alter table public.ai_usage
  add column web_searches int not null default 0;
