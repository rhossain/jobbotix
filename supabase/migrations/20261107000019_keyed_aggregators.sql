-- Sourcing, phase 3: country-scoped aggregators with free keys.
--
-- Disabled until their keys are set as Edge Function secrets (an admin then
-- flips `enabled`). Budgets keep each inside its free tier at four runs a day:
-- Adzuna's ~1,000 calls a month is ~33 a day, so 8 a run.

insert into public.source_catalog
  (id, name, kind, access, homepage, enabled, max_requests_per_run, attribution, notes)
values
  ('adzuna', 'Adzuna', 'aggregator', 'keyed_api', 'https://www.adzuna.com', false, 8,
   'Jobs by Adzuna (adzuna.com).',
   'Free key (developer.adzuna.com): set ADZUNA_APP_ID and ADZUNA_APP_KEY. 19 countries; searches the countries users can work in. Predicted salaries are not shown.'),
  ('jooble', 'Jooble', 'aggregator', 'keyed_api', 'https://jooble.org', false, 6,
   'Jobs from Jooble (jooble.org).',
   'Free key on request (jooble.org/api/about): set JOOBLE_API_KEY. 60+ countries, Bangladesh included; links route through Jooble.'),
  ('reed', 'Reed', 'board', 'keyed_api', 'https://www.reed.co.uk', false, 3,
   'Jobs from Reed (reed.co.uk).',
   'Free key (reed.co.uk/developers): set REED_API_KEY. United Kingdom only; runs only when a user can work in GB.')
on conflict (id) do nothing;

update public.source_catalog set country = 'GB' where id = 'reed';
