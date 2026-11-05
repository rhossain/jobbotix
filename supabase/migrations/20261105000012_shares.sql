-- Read-only share links: one role, or the whole board, for a mentor. The
-- token is the only credential; anyone with it can read the public RPC
-- below until the owner revokes it. Notes and screening answers are never
-- included; the cover letter is, because that is what a mentor reviews.
create table public.shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null unique default translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_'),
  kind text not null check (kind in ('role', 'board')),
  role_id uuid references public.roles (id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  views int not null default 0,
  constraint shares_role_needs_role check (kind <> 'role' or role_id is not null)
);
create index shares_user on public.shares (user_id);
alter table public.shares enable row level security;
create policy "shares: own rows" on public.shares
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.shared_view(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.shares;
  v_owner text;
  v_roles jsonb;
begin
  select * into s from public.shares where token = p_token and revoked_at is null;
  if s.id is null then
    return null;
  end if;
  update public.shares set views = views + 1 where id = s.id;
  select coalesce(nullif(name, ''), 'A Jobbotix user') into v_owner from public.profiles where id = s.user_id;

  if s.kind = 'role' then
    select jsonb_build_object(
      'kind', 'role', 'owner', v_owner, 'created_at', s.created_at,
      'role', jsonb_build_object(
        'company', r.company, 'title', r.title, 'url', r.url, 'location', r.location,
        'remote_scope', r.remote_scope, 'type', r.type, 'salary', r.salary,
        'stack', to_jsonb(r.stack), 'score', r.score, 'reasons', to_jsonb(r.reasons),
        'gaps', to_jsonb(r.gaps), 'ai_match', r.ai_match, 'status', r.status,
        'cover_letter', r.cover_letter, 'found_at', r.found_at, 'posting_text', left(r.posting_text, 4000)
      )) into v_roles
      from public.roles r where r.id = s.role_id and r.user_id = s.user_id;
    return v_roles;
  end if;

  select jsonb_build_object(
    'kind', 'board', 'owner', v_owner, 'created_at', s.created_at,
    'roles', coalesce(jsonb_agg(jsonb_build_object(
      'company', r.company, 'title', r.title, 'url', r.url, 'score', r.score,
      'status', r.status, 'type', r.type, 'remote_scope', r.remote_scope,
      'status_changed_at', r.status_changed_at
    ) order by r.score desc), '[]'::jsonb)) into v_roles
    from public.roles r where r.user_id = s.user_id and r.status <> 'skipped';
  return v_roles;
end $$;
grant execute on function public.shared_view(text) to anon, authenticated;
