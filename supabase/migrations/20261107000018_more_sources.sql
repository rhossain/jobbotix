-- Sourcing, phase 2: seven more free sources, and one fetch per source.
--
-- Each row's max_requests_per_run keeps the board inside its published fair
-- use at four runs a day (Remotive asks for about four requests a day, so it
-- gets one a run). Attribution and notes say what each board asks of anyone
-- showing its jobs; the app links every role to the board page it came from.

insert into public.source_catalog
  (id, name, kind, access, homepage, enabled, max_requests_per_run, attribution, notes)
values
  ('jobicy', 'Jobicy', 'board', 'public_api', 'https://jobicy.com', true, 6,
   'Jobs from Jobicy (jobicy.com).',
   'Public API, no key. Credit Jobicy and send applicants to the Jobicy page; poll a few times a day at most.'),
  ('remoteok', 'Remote OK', 'board', 'public_api', 'https://remoteok.com', true, 1,
   'Jobs from Remote OK (remoteok.com).',
   'Public API, no key. Link back to the Remote OK page and name Remote OK as the source.'),
  ('workingnomads', 'Working Nomads', 'board', 'public_api', 'https://www.workingnomads.com', true, 1,
   'Jobs from Working Nomads (workingnomads.com).',
   'Public feed, no key. Link back to the Working Nomads page.'),
  ('arbeitnow', 'Arbeitnow', 'board', 'public_api', 'https://www.arbeitnow.com', true, 3,
   'Jobs from Arbeitnow (arbeitnow.com).',
   'Public API, no key; Europe-focused, remote-flagged jobs only. Arbeitnow may withdraw access at any time.'),
  ('remotive', 'Remotive', 'board', 'public_api', 'https://remotive.com', true, 1,
   'Jobs from Remotive (remotive.com).',
   'Public API, no key; about four requests a day at most; listings run 24 h behind. Link back; never re-post to other job sites.'),
  ('weworkremotely', 'We Work Remotely', 'board', 'rss', 'https://weworkremotely.com', true, 2,
   'Jobs from We Work Remotely (weworkremotely.com).',
   'Category RSS feeds (front-end, full-stack). Link back; never re-post to other job sites.'),
  ('hn', 'Hacker News', 'community', 'public_api', 'https://news.ycombinator.com', true, 2,
   'From the Hacker News "Who is hiring?" thread.',
   'Algolia HN API, no key. Each top-level comment is parsed from its "Company | Role | Location" header; roles link to the comment.')
on conflict (id) do nothing;

-- One Edge Function call per enabled source, so a slow or failing board never
-- holds up the others and each stays inside the function's time limits.
create or replace function public.fetch_all_sources()
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from public.source_catalog where enabled order by id loop
    perform public.call_edge_function('fetch-sources', jsonb_build_object('sources', jsonb_build_array(r.id)));
  end loop;
end $$;
revoke execute on function public.fetch_all_sources() from public, anon, authenticated;

-- Same name, so pg_cron replaces the phase 1 job's command.
select cron.schedule('fetch-sources', '17 5,11,17,23 * * *', $$select public.fetch_all_sources()$$);
