-- Designation search: a posting whose title is one of the user's target roles
-- now earns points of its own (score.ts, title_match). Until now only the
-- stack, remote scope, AI tooling and seniority scored, so an exact
-- "Product Manager" match for a product manager could fall under the filing
-- threshold. The code already defaults the weight; this keeps
-- settings.scoring_defaults in step with it and with
-- libs/shared-types/src/lib/scoring.ts.

update public.settings
   set value = jsonb_build_object('title_match', 20) || value
 where key = 'scoring_defaults'
   and not (value ? 'title_match');

-- Judge the recent pool again under the new matching rules.
update public.search_profiles set last_matched_at = null where active;
