-- Jooble issues one API key per country site (jooble.org is the US,
-- uk.jooble.org Britain, bd.jooble.org Bangladesh...), and a key only sees
-- its own country. The adapter reads them all from one secret.
update public.source_catalog
set notes = 'Free key per country site (<cc>.jooble.org/api/about): set JOOBLE_KEYS as "BD=key1,AE=key2". A key only sees its own country; links route through Jooble.'
where id = 'jooble';
