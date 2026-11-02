-- Minimal stand-in for the parts of a Supabase project the migrations rely on,
-- so they can be applied to a plain PostgreSQL 16 for testing.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- pg_cron is not installed on a plain Postgres; stub the scheduler.
create schema cron;
create or replace function cron.schedule(name text, sched text, cmd text)
returns bigint language sql as $$ select 1::bigint $$;

-- Supabase grants these through default privileges.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated;
