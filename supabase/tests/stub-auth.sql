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

-- pg_net and Vault exist on Supabase; stub them for a plain Postgres.
create schema if not exists net;
create or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$ select 1::bigint $$;
create schema if not exists vault;
create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
create or replace function vault.create_secret(new_secret text, new_name text) returns uuid language sql as $$
  insert into vault.secrets (name, secret) values (new_name, new_secret) returning id $$;
create or replace function vault.update_secret(secret_id uuid, new_secret text) returns void language sql as $$
  update vault.secrets set secret = new_secret where id = secret_id $$;
