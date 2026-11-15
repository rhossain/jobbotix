-- Himalayas: with the free API key in the HIMALAYAS_API_KEY function secret
-- the source has its own allowance (60 requests a minute, 10,000 a day), so
-- the run budget goes up. Without the key the adapter still stops at 30.

update public.source_catalog
   set max_requests_per_run = 60,
       notes = 'Public API. Works without a key on a shared allowance (30 requests a run); with the free key in the HIMALAYAS_API_KEY secret it reads up to 60 requests a run and deeper pages per search.'
 where id = 'himalayas';
