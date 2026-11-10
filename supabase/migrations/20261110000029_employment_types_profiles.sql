-- Until 0028 "contract" meant "contract or freelance", so every profile that
-- accepted contract work keeps accepting freelance work. Part-time stays
-- opt-in. New profiles accept full-time, contract and freelance.
update public.search_profiles
   set employment_types = employment_types || '{freelance}'::public.employment_type[]
 where 'contract' = any (employment_types)
   and not 'freelance' = any (employment_types);

alter table public.search_profiles
  alter column employment_types set default '{full_time,contract,freelance}';
