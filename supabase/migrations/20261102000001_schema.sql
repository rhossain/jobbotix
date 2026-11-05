-- Jobbotix schema, phase 0.
-- Every user-owned table carries user_id and an RLS policy that lets a signed-in
-- user read and write only rows where user_id = auth.uid(). Nothing is readable
-- anonymously. Admin-only tables (invite_codes, settings) are reachable through
-- SECURITY DEFINER functions, never directly.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.role_status as enum
  ('new', 'shortlist', 'applied', 'interview', 'offer', 'rejected', 'skipped');

create type public.employment_type as enum ('full_time', 'contract');

create type public.role_event_kind as enum
  ('status_change', 'note', 'generated', 'reminder', 'run', 'ingested');

create type public.ai_job as enum ('extract', 'score', 'tailor', 'letter');

create type public.variant_status as enum ('draft', 'approved');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user (the plan's "users" table)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text not null default '',
  timezone text not null default 'UTC',
  invite_code text,
  anthropic_key_ref text,          -- Vault secret name, never the key itself
  default_model text not null default 'claude-sonnet-4-5',
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

alter table public.profiles enable row level security;
create policy "profiles: own row" on public.profiles
  for select using (id = auth.uid());
create policy "profiles: update own row" on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and is_admin = (select is_admin from public.profiles p where p.id = auth.uid()));

-- ---------------------------------------------------------------------------
-- invite_codes: admin creates, sign-up consumes through a function
-- ---------------------------------------------------------------------------
create table public.invite_codes (
  code text primary key,
  created_by uuid references public.profiles (id) on delete set null,
  note text not null default '',
  max_uses int not null default 1,
  uses int not null default 0,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.invite_codes enable row level security;
create policy "invite_codes: admin only" on public.invite_codes
  for all using (public.is_admin()) with check (public.is_admin());

-- Valid for sign-up: not revoked, not expired, uses left.
create or replace function public.invite_code_is_valid(p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.invite_codes
    where code = p_code
      and revoked_at is null
      and (expires_at is null or expires_at > now())
      and uses < max_uses
  );
$$;
grant execute on function public.invite_code_is_valid(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Profile creation on sign-up. The invite code travels in
-- auth.users.raw_user_meta_data->>'invite_code'; sign-up without a valid code
-- is rejected here, so the check cannot be bypassed from the client.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_code text := new.raw_user_meta_data ->> 'invite_code';
  v_open boolean := coalesce((select (value ->> 'open_signup')::boolean from public.settings where key = 'signup'), false);
  v_first boolean := not exists (select 1 from public.profiles);
begin
  if not v_first and not v_open then
    if v_code is null or not public.invite_code_is_valid(v_code) then
      raise exception 'A valid invite code is required to sign up' using errcode = 'P0001';
    end if;
    update public.invite_codes set uses = uses + 1 where code = v_code;
  end if;

  insert into public.profiles (id, email, name, timezone, invite_code, is_admin)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'timezone', 'UTC'),
    v_code,
    v_first                                -- the first account is the admin
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- settings: global defaults, admin-only
-- ---------------------------------------------------------------------------
create table public.settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create trigger settings_updated_at before update on public.settings
  for each row execute function public.set_updated_at();
alter table public.settings enable row level security;
create policy "settings: admin only" on public.settings
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.settings (key, value) values
  ('signup', '{"open_signup": false}'),
  ('scoring_defaults', '{
    "framework_primary": 30, "framework_other": 15, "fullstack": 10,
    "remote_worldwide": 25, "remote_overlap": 15, "remote_vague": 8,
    "ai_assisted": 20, "senior": 10,
    "backend_heavy": -10, "remote_unclear": -10, "short_project": -15
  }'),
  ('models', '{"default": "claude-sonnet-4-5", "choices": ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-1"]}');

-- ---------------------------------------------------------------------------
-- ingest_keys: bearer keys a user's scheduled task posts with
-- ---------------------------------------------------------------------------
create table public.ingest_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  key_hash text not null unique,        -- sha256 of the key; the key is shown once
  label text not null default 'Daily job search',
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index ingest_keys_user on public.ingest_keys (user_id);
alter table public.ingest_keys enable row level security;
create policy "ingest_keys: own rows" on public.ingest_keys
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- search_profiles
-- ---------------------------------------------------------------------------
create table public.search_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null default 'Default',
  target_roles text[] not null default '{}',      -- ordered, first = highest priority
  stacks text[] not null default '{}',
  remote_rules jsonb not null default '{"worldwide": true, "timezone_overlap_ok": true}'::jsonb,
  exclusions jsonb not null default '{}'::jsonb,
  languages text[] not null default '{english}',
  min_seniority text not null default 'senior',
  scoring_weights jsonb not null default '{}'::jsonb, -- empty = use settings.scoring_defaults
  employment_types public.employment_type[] not null default '{full_time,contract}',
  digest_time time not null default '06:45',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index search_profiles_user on public.search_profiles (user_id);
create unique index search_profiles_one_active on public.search_profiles (user_id) where active;
create trigger search_profiles_updated_at before update on public.search_profiles
  for each row execute function public.set_updated_at();
alter table public.search_profiles enable row level security;
create policy "search_profiles: own rows" on public.search_profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- roles: one row per posting per user
-- ---------------------------------------------------------------------------
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  company text not null,
  title text not null,
  url text not null,
  source text not null default '',
  location text not null default '',
  remote_scope text not null default '',
  type public.employment_type not null default 'full_time',
  salary text not null default '',
  posted_at date,
  found_at timestamptz not null default now(),
  stack text[] not null default '{}',
  score smallint not null default 0 check (score between 0 and 100),
  score_breakdown jsonb not null default '{}'::jsonb,
  reasons text[] not null default '{}',
  gaps text[] not null default '{}',
  ai_match boolean not null default false,
  status public.role_status not null default 'new',
  cover_letter text not null default '',
  notes text not null default '',
  posting_text text not null default '',
  posting_hash text not null default '',
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, url)
);
create unique index roles_user_company_title on public.roles (user_id, lower(company), lower(title));
create index roles_user_status on public.roles (user_id, status);
create index roles_user_found on public.roles (user_id, found_at desc);
create trigger roles_updated_at before update on public.roles
  for each row execute function public.set_updated_at();

create or replace function public.roles_track_status()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at = now();
    insert into public.role_events (user_id, role_id, kind, payload)
    values (new.user_id, new.id, 'status_change',
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end $$;

alter table public.roles enable row level security;
create policy "roles: own rows" on public.roles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- role_events: activity log
-- ---------------------------------------------------------------------------
create table public.role_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid references public.roles (id) on delete cascade,  -- null for run-level events
  kind public.role_event_kind not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index role_events_user_created on public.role_events (user_id, created_at desc);
create index role_events_role on public.role_events (role_id);
alter table public.role_events enable row level security;
create policy "role_events: own rows" on public.role_events
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger roles_status_change before update on public.roles
  for each row execute function public.roles_track_status();

-- ---------------------------------------------------------------------------
-- screening_answers: the tracker's qa[] array, one row per question
-- ---------------------------------------------------------------------------
create table public.screening_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete cascade,
  question text not null,
  answer text not null default '',
  position smallint not null default 0,
  created_at timestamptz not null default now()
);
create index screening_answers_role on public.screening_answers (role_id, position);
alter table public.screening_answers enable row level security;
create policy "screening_answers: own rows" on public.screening_answers
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- excluded_roles: what a run skipped and why (no posting text)
-- ---------------------------------------------------------------------------
create table public.excluded_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  company text not null default '',
  title text not null default '',
  url text not null default '',
  reason text not null,
  found_at timestamptz not null default now()
);
create index excluded_roles_user_found on public.excluded_roles (user_id, found_at desc);
alter table public.excluded_roles enable row level security;
create policy "excluded_roles: own rows" on public.excluded_roles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- resumes, resume_variants, cover_letters (phase 2 tables, created now so the
-- types and RLS are settled; the UI arrives later)
-- ---------------------------------------------------------------------------
create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null default 'Master',
  is_master boolean not null default false,
  sections jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index resumes_user on public.resumes (user_id);
create trigger resumes_updated_at before update on public.resumes
  for each row execute function public.set_updated_at();
alter table public.resumes enable row level security;
create policy "resumes: own rows" on public.resumes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.resume_variants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete cascade,
  base_resume_id uuid references public.resumes (id) on delete set null,
  sections jsonb not null default '{}'::jsonb,
  diff jsonb not null default '{}'::jsonb,
  keyword_report jsonb not null default '{}'::jsonb,
  pdf_path text,
  status public.variant_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index resume_variants_role on public.resume_variants (role_id);
create trigger resume_variants_updated_at before update on public.resume_variants
  for each row execute function public.set_updated_at();
alter table public.resume_variants enable row level security;
create policy "resume_variants: own rows" on public.resume_variants
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.cover_letters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete cascade,
  body text not null default '',
  word_count int generated always as (array_length(regexp_split_to_array(trim(body), '\s+'), 1)) stored,
  status public.variant_status not null default 'draft',
  voice_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cover_letters_role on public.cover_letters (role_id);
create trigger cover_letters_updated_at before update on public.cover_letters
  for each row execute function public.set_updated_at();
alter table public.cover_letters enable row level security;
create policy "cover_letters: own rows" on public.cover_letters
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- saved_views, ai_usage
-- ---------------------------------------------------------------------------
create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  sort text not null default 'score',
  created_at timestamptz not null default now()
);
create index saved_views_user on public.saved_views (user_id);
alter table public.saved_views enable row level security;
create policy "saved_views: own rows" on public.saved_views
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  job public.ai_job not null,
  model text not null,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  cost_usd numeric(10, 5) not null default 0,
  created_at timestamptz not null default now()
);
create index ai_usage_user_created on public.ai_usage (user_id, created_at desc);
alter table public.ai_usage enable row level security;
create policy "ai_usage: own rows" on public.ai_usage
  for select using (user_id = auth.uid());
-- Only Edge Functions (service role) insert usage rows.

-- ---------------------------------------------------------------------------
-- Admin RPCs (SECURITY DEFINER, guarded by is_admin())
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_invite(p_note text default '', p_max_uses int default 1, p_expires_at timestamptz default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 10));
  insert into public.invite_codes (code, created_by, note, max_uses, expires_at)
  values (v_code, auth.uid(), p_note, p_max_uses, p_expires_at);
  return v_code;
end $$;
grant execute on function public.admin_create_invite(text, int, timestamptz) to authenticated;

create or replace function public.admin_revoke_invite(p_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.invite_codes set revoked_at = now() where code = p_code;
end $$;
grant execute on function public.admin_revoke_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Ingest key RPC: returns the plain key once, stores only its hash
-- ---------------------------------------------------------------------------
create or replace function public.create_ingest_key(p_label text default 'Daily job search')
returns text language plpgsql security definer set search_path = public as $$
declare v_key text;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  v_key := 'jbx_' || encode(gen_random_bytes(24), 'hex');
  insert into public.ingest_keys (user_id, key_hash, label)
  values (auth.uid(), encode(digest(v_key, 'sha256'), 'hex'), p_label);
  return v_key;
end $$;
grant execute on function public.create_ingest_key(text) to authenticated;

-- Resolve a bearer key to its owner (called by the ingest Edge Function with the service role).
create or replace function public.resolve_ingest_key(p_key text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  update public.ingest_keys
     set last_used_at = now()
   where key_hash = encode(digest(p_key, 'sha256'), 'hex')
     and revoked_at is null
  returning user_id into v_user;
  return v_user;
end $$;
revoke execute on function public.resolve_ingest_key(text) from public, anon, authenticated;
