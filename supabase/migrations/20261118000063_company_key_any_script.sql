-- company_key() kept only a-z and 0-9, so a company written in another
-- script (Japanese, Arabic, Bengali, Cyrillic…) had an empty key and could
-- never be matched, and accented letters were cut out of a name. Seen in a
-- real LinkedIn archive on 2026-11-18.
--
-- Now: A-Z is lowered (nothing else is, so the result is the same in every
-- database locale), ASCII punctuation and a few common Unicode spaces,
-- dashes, quotes and CJK punctuation become spaces, and every other
-- character is kept. companyKey() in shared-types (linkedin-links.ts) is
-- the same rule; the two are tested on the same names.
create or replace function public.company_key(p_name text)
returns text language plpgsql immutable set search_path = public as $$
declare
  s text;
  w text[];
  legal constant text[] := array[
    'inc', 'incorporated', 'llc', 'llp', 'lp', 'ltd', 'limited', 'corp',
    'corporation', 'co', 'company', 'gmbh', 'ag', 'plc', 'pvt', 'private',
    'pte', 'pty', 'sa', 'sas', 'srl', 'bv', 'nv', 'oy', 'ab', 'aps', 'kk',
    'sdn', 'bhd'];
begin
  s := translate(coalesce(p_name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
  s := replace(regexp_replace(s, '\([^)]*\)', ' ', 'g'), '&', ' and ');
  -- ASCII punctuation, spacing and control characters
  s := regexp_replace(s, '[\x01-\x2f\x3a-\x40\x5b-\x60\x7b-\x7f]', ' ', 'g');
  -- the Unicode ones companyKey() also treats as spaces
  s := translate(s, ' ·‐‑‒–—―‘’‚‛“”„‟•…　、。・（），．＆／：', '                             ');
  w := regexp_split_to_array(btrim(regexp_replace(s, ' +', ' ', 'g')), ' ');
  if w = array[''] then
    return '';
  end if;
  if array_length(w, 1) > 1 and w[1] = 'the' then
    w := w[2:];
  end if;
  while array_length(w, 1) > 1 and w[array_length(w, 1)] = any (legal) loop
    w := w[1:array_length(w, 1) - 1];
  end loop;
  return array_to_string(w, ' ');
end $$;

-- The stored keys were worked out with the old rule; work them out again.
update public.linkedin_connections set company = company;
