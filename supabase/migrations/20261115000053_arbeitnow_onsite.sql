-- Arbeitnow: on-site and hybrid jobs are kept, not only remote ones.
-- They are marked as work in their country (Germany when the board gives
-- only a city), so only users who allow on-site work there see them.

update public.source_catalog
   set notes = 'Free public API, no key. Europe-focused, mostly Germany. Remote jobs, plus on-site and hybrid jobs for users who allow work in that country.'
 where id = 'arbeitnow';
