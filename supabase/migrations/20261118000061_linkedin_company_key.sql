-- "Who do I know at this company?" needs a job's company and a connection's
-- company to meet under one name: "Acme", "ACME, Inc." and "The Acme Company"
-- are the same place. company_key() is that name, and each LinkedIn
-- connection now carries it, kept by the database itself, so the question is
-- one indexed lookup.
--
-- The rule is the same as companyKey() in shared-types (linkedin-links.ts):
-- lower case, "&" as "and", anything in brackets gone, punctuation as
-- spaces, a leading "the" and trailing legal words dropped. The two are
-- tested on the same names and must stay in step.
create or replace function public.company_key(p_name text)
returns text language plpgsql immutable set search_path = public as $$
declare
  w text[];
  legal constant text[] := array[
    'inc', 'incorporated', 'llc', 'llp', 'lp', 'ltd', 'limited', 'corp',
    'corporation', 'co', 'company', 'gmbh', 'ag', 'plc', 'pvt', 'private',
    'pte', 'pty', 'sa', 'sas', 'srl', 'bv', 'nv', 'oy', 'ab', 'aps', 'kk',
    'sdn', 'bhd'];
begin
  w := regexp_split_to_array(
    btrim(regexp_replace(
      replace(regexp_replace(lower(coalesce(p_name, '')), '\([^)]*\)', ' ', 'g'), '&', ' and '),
      '[^a-z0-9]+', ' ', 'g')),
    ' ');
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

alter table public.linkedin_connections
  add column company_key text generated always as (public.company_key(company)) stored;
create index linkedin_connections_company_key
  on public.linkedin_connections (user_id, company_key);
