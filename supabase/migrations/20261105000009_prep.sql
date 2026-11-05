-- Interview prep sheet per role, generated from the resume and the posting
-- and then edited by the user (notes, practised ticks). Shape in
-- libs/shared-types prep.ts.
alter table public.roles add column prep jsonb not null default '{}'::jsonb;
alter type public.ai_job add value if not exists 'prep';
