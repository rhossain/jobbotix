-- A new account saved its resume and job preferences and then saw no jobs:
-- matching only ran on the hour, and a new profile was caught up with the
-- pool 800 postings an hour, oldest first, so the first screen stayed empty
-- for hours. match-postings can now be started by the signed-in user for
-- their own account (the app does it when preferences are saved), and it
-- reads the whole backlog in one go.
--
-- That makes two callers for one profile (the hourly schedule and the user),
-- so a run claims the profile first. The claim is a token only the run that
-- made it knows:
--   - a second run finds the profile claimed and leaves it alone;
--   - a claim older than a few minutes belongs to a run that died, and the
--     next one takes it over;
--   - when the user changes what they are looking for mid-run, the claim is
--     cleared with the watermark, so the run in flight can no longer write
--     its watermark over the cleared one (which would skip the re-match
--     under the new rules) and the next run starts at once.

alter table public.search_profiles
  add column if not exists match_claim uuid,
  add column if not exists match_claimed_at timestamptz;

comment on column public.search_profiles.match_claim is
  'Set while a match-postings run is working on this profile; cleared when it finishes or when the search rules change.';
comment on column public.search_profiles.match_claimed_at is
  'When match_claim was made: a claim a few minutes old belongs to a run that died.';

-- Returns the claim's token, or null when another run holds the profile.
create or replace function public.claim_profile_match(
  p_profile uuid,
  p_stale_seconds integer default 240
) returns uuid
language sql security definer set search_path = public as $$
  update public.search_profiles
     set match_claim = gen_random_uuid(),
         match_claimed_at = clock_timestamp()
   where id = p_profile
     and (match_claim is null
          or match_claimed_at is null
          or match_claimed_at < clock_timestamp() - make_interval(secs => p_stale_seconds))
  returning match_claim;
$$;

revoke all on function public.claim_profile_match(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_profile_match(uuid, integer) to service_role;

-- The rules changed: judge the pool again (migration 0017), and take the
-- profile away from any run still working under the old rules.
create or replace function public.search_profiles_rematch()
returns trigger language plpgsql as $$
begin
  if new.home_country is distinct from old.home_country
     or new.allowed_countries is distinct from old.allowed_countries
     or new.remote_only is distinct from old.remote_only
     or new.target_roles is distinct from old.target_roles
     or new.stacks is distinct from old.stacks
     or new.languages is distinct from old.languages
     or new.employment_types is distinct from old.employment_types
     or new.exclusions is distinct from old.exclusions
     or new.remote_rules is distinct from old.remote_rules
     or new.scoring_weights is distinct from old.scoring_weights
  then
    new.last_matched_at := null;
    new.match_claim := null;
    new.match_claimed_at := null;
  end if;
  return new;
end $$;
