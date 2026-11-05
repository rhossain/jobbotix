-- Digest settings beyond the hour: which weekdays (ISO 1=Mon … 7=Sun), the
-- minimum score a role needs to appear, and an off switch.
alter table public.search_profiles
  add column digest_days smallint[] not null default '{1,2,3,4,5,6,7}',
  add column digest_min_score smallint not null default 0,
  add column digest_enabled boolean not null default true;
alter table public.search_profiles
  add constraint search_profiles_digest_days_valid
  check (digest_days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  add constraint search_profiles_digest_min_score_range
  check (digest_min_score between 0 and 100);
