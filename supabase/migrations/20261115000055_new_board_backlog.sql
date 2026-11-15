-- Three boards added on 14 and 15 Nov ran cleanly but brought nothing in:
-- their first runs only looked three days back, and their newest jobs were
-- older than that. A source's first good run now reaches back two weeks
-- (fetch-sources), so clear these three's last good run to give them that
-- first run again.

update public.source_catalog
   set last_success_at = null
 where id in ('fourdayweek', 'realworkfromanywhere', 'getonboard');
