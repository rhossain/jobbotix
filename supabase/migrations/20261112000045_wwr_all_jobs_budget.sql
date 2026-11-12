-- We Work Remotely is now read from its all-jobs feed (one request), with
-- the two programming feeds as the fallback when that feed comes back empty.
-- The fallback needs room for all three requests in one run.

update public.source_catalog
   set max_requests_per_run = 3,
       notes = 'Public RSS: the all-jobs feed, every category; the front-end and full-stack feeds are the fallback. Attribute links back to We Work Remotely.'
 where id = 'weworkremotely' and max_requests_per_run < 3;

update public.source_catalog
   set notes = 'Public JSON API, all categories, one request a run. Remotive asks for at most 4 fetches a day and a link back; the feed runs 24 hours behind.'
 where id = 'remotive';
