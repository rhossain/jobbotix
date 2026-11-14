-- Sourcing: three more free boards, no key needed.
--
-- Each adapter was written against the board's live feed on 2026-11-14.
-- Every role links to the board's own page for the job.

insert into public.source_catalog
  (id, name, kind, access, homepage, enabled, max_requests_per_run, attribution, notes)
values
  ('fourdayweek', '4 Day Week', 'board', 'public_api', 'https://4dayweek.io', true, 1,
   'Jobs from 4 Day Week (4dayweek.io).',
   'Public API, no key. Remote, hybrid and on-site jobs at companies with a shorter working week; one page a run. Link back to the 4 Day Week page.'),
  ('realworkfromanywhere', 'Real Work From Anywhere', 'board', 'rss', 'https://www.realworkfromanywhere.com', true, 1,
   'Jobs from Real Work From Anywhere (realworkfromanywhere.com).',
   'Public RSS feed of every job on the board; all of them can be done from any country. Link back to the board page.'),
  ('remotefirstjobs', 'Remote First Jobs', 'board', 'rss', 'https://remotefirstjobs.com', true, 3,
   'Jobs from Remote First Jobs (remotefirstjobs.com).',
   'Public RSS feeds per skill; the full-time feed every run, skill feeds when a search term names one. The feed does not say which countries a job is open to.')
on conflict (id) do nothing;
