-- Freelance gigs a user adds from Upwork by pasting the job post.
--
-- A gig is a row of roles like any job, so the pipeline, notes, letters,
-- screening answers and the row-level security already in place all apply.
-- Two columns tell it apart and carry what only a gig has:
--
--   entry_kind  'job' (everything so far) or 'gig'
--   gig         budget type, rate or budget, Connects cost, client country,
--               payment verified, experience level, duration (GigDetails in
--               libs/shared-types/src/lib/gig.ts); {} on a job
--
-- Jobbotix never reads Upwork itself: the text is what the user pasted, and
-- the row is theirs alone ("roles: own rows").

alter table public.roles
  add column entry_kind text not null default 'job'
    constraint roles_entry_kind check (entry_kind in ('job', 'gig')),
  add column gig jsonb not null default '{}'::jsonb,
  add constraint roles_gig_only_on_gigs
    check (entry_kind = 'gig' or gig = '{}'::jsonb),
  add constraint roles_gig_is_object
    check (jsonb_typeof(gig) = 'object');

-- Upwork clients are not named in a job post, so many gigs share the company
-- "Upwork client" and two of them may carry the same title. The one-role-per-
-- company-and-title rule therefore covers jobs only; a gig is still unique by
-- its link (user_id, url).
drop index public.roles_user_company_title;
create unique index roles_user_company_title
  on public.roles (user_id, lower(company), lower(title))
  where entry_kind = 'job';

create index roles_user_kind on public.roles (user_id, entry_kind);
