-- Sourcing: Get on Board (getonbrd.com), a free public API with no key.
--
-- Latin American and remote jobs, many written in Spanish. Jobs are listed
-- per category; six of the eighteen categories are read each run, a window
-- that moves on every six hours, so every category is read at least daily.
-- The adapter was written against the live response on 2026-11-15.

insert into public.source_catalog
  (id, name, kind, access, homepage, enabled, max_requests_per_run, attribution, notes)
values
  ('getonboard', 'Get on Board', 'board', 'public_api', 'https://www.getonbrd.com', true, 6,
   'Jobs from Get on Board (getonbrd.com).',
   'Public API, no key. Latin American and remote jobs, many in Spanish; six of its eighteen categories a run. Salaries are US dollars a month. Link back to the Get on Board page.')
on conflict (id) do nothing;
