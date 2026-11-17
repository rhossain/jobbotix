-- A share link is public: anyone with the token reads it. For a gig added
-- from Upwork (migration 0057) the link must not republish the job post the
-- user pasted, because that text is Upwork's. The shared page keeps what the
-- user wrote (the proposal) and the link to the job on Upwork, and leaves
-- the post's text out. Jobs are shared exactly as before.
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
        'cover_letter', r.cover_letter, 'found_at', r.found_at,
        'posting_text', case when r.entry_kind = 'gig' then '' else left(r.posting_text, 4000) end
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
