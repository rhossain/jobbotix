-- When a user changes what they are looking for (their country, roles,
-- stacks, exclusions...), the next match-postings run should judge the
-- recent pool again under the new rules, not only postings that arrive
-- later. Clearing last_matched_at does that: match-postings falls back to
-- its lookback window (settings.sourcing.lookback_days). Roles already filed
-- are skipped as usual, and an exclusion is never stored twice.

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
  end if;
  return new;
end $$;

create trigger search_profiles_rematch before update on public.search_profiles
  for each row execute function public.search_profiles_rematch();
