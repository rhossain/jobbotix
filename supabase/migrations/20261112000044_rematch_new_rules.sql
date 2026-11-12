-- The new designation matching (role.ts) went live on 12 Nov, after
-- migration 43 had already cleared the match watermarks: the pool was
-- re-judged by the old rules in between. Clear them once more so every
-- active profile is judged by the rules now deployed. match-postings reads
-- 30 days of the pool for a profile with no watermark, 800 postings an hour.

update public.search_profiles set last_matched_at = null where active;
