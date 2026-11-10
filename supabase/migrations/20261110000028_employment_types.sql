-- Freelance and part-time become their own employment types instead of being
-- folded into contract and full-time. The values are used from migration
-- 0029 on: Postgres does not allow a new enum value to be used in the
-- transaction that adds it.
alter type public.employment_type add value if not exists 'freelance';
alter type public.employment_type add value if not exists 'part_time';
