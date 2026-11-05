-- Row-level security test. Runs against a scratch Postgres (see tools/db-test.sh)
-- where the Supabase auth schema is stubbed; every assertion raises on failure,
-- so a clean exit means the policies hold.

\set ON_ERROR_STOP on
\set QUIET on

-- ---------------------------------------------------------------------------
-- Sign-up: first user needs no invite and becomes admin; second needs a code
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data)
values ('11111111-1111-1111-1111-111111111111', 'a@example.com', '{"name":"A"}');

do $$ begin
  insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222', 'b@example.com');
  raise exception 'FAIL: sign-up without invite code was accepted';
exception when others then
  if sqlerrm not like '%invite code%' then raise; end if;
end $$;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.admin_create_invite('for B') as code \gset
reset role; reset request.jwt.claim.sub;
select set_config('test.code', :'code', false);

insert into auth.users (id, email, raw_user_meta_data)
values ('22222222-2222-2222-2222-222222222222', 'b@example.com',
        jsonb_build_object('invite_code', :'code', 'name', 'B'));

do $$ begin
  if (select is_admin from public.profiles where email = 'a@example.com') is not true then
    raise exception 'FAIL: first user is not admin';
  end if;
  if (select is_admin from public.profiles where email = 'b@example.com') is true then
    raise exception 'FAIL: second user is admin';
  end if;
  if (select uses from public.invite_codes where code = current_setting('test.code')) <> 1 then
    raise exception 'FAIL: invite use was not counted';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Each user writes and reads only their own rows
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.roles (user_id, company, title, url, score)
values ('11111111-1111-1111-1111-111111111111', 'Acme', 'Senior Angular', 'https://a.example/1', 80);
update public.roles set status = 'shortlist' where company = 'Acme';

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
insert into public.roles (user_id, company, title, url, score)
values ('22222222-2222-2222-2222-222222222222', 'Beta', 'Frontend', 'https://b.example/1', 60);

do $$ begin
  insert into public.roles (user_id, company, title, url)
  values ('11111111-1111-1111-1111-111111111111', 'Evil', 'X', 'https://x/1');
  raise exception 'FAIL: cross-user insert was accepted';
exception when insufficient_privilege or check_violation then null;
end $$;

do $$ begin
  if (select count(*) from public.roles) <> 1 then raise exception 'FAIL: B sees % roles', (select count(*) from public.roles); end if;
  if (select count(*) from public.role_events) <> 0 then raise exception 'FAIL: B sees A''s events'; end if;
  if (select count(*) from public.profiles) <> 1 then raise exception 'FAIL: B sees other profiles'; end if;
  if (select count(*) from public.invite_codes) <> 0 then raise exception 'FAIL: non-admin sees invite codes'; end if;
end $$;

do $$ begin
  perform public.admin_create_invite('x');
  raise exception 'FAIL: non-admin created an invite';
exception when insufficient_privilege then null;
end $$;

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  if (select count(*) from public.roles) <> 1 then raise exception 'FAIL: A sees % roles', (select count(*) from public.roles); end if;
  if (select count(*) from public.role_events where kind = 'status_change') <> 1 then raise exception 'FAIL: status change not logged'; end if;
  if left(public.create_ingest_key('test'), 4) <> 'jbx_' then raise exception 'FAIL: ingest key format'; end if;
  if (select count(*) from public.invite_codes) <> 1 then raise exception 'FAIL: admin cannot see invite codes'; end if;
end $$;

-- B's write to A's row must affect nothing
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
update public.roles set notes = 'tampered' where company = 'Acme';
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  if (select notes from public.roles where company = 'Acme') <> '' then raise exception 'FAIL: cross-user update applied'; end if;
end $$;

reset role; reset request.jwt.claim.sub;

-- ---------------------------------------------------------------------------
-- Anonymous sees nothing; a bogus ingest key resolves to nobody
-- ---------------------------------------------------------------------------
set role anon;
do $$ begin
  if (select count(*) from public.roles) <> 0 then raise exception 'FAIL: anon sees roles'; end if;
end $$;
reset role;

do $$ begin
  if public.resolve_ingest_key('jbx_nope') is not null then raise exception 'FAIL: bogus key resolved'; end if;
end $$;


-- ---------------------------------------------------------------------------
-- Vault helpers: service role only, upsert then delete
-- ---------------------------------------------------------------------------
select public.vault_upsert_secret('anthropic_key_test', 'sk-ant-one');
select public.vault_upsert_secret('anthropic_key_test', 'sk-ant-two');
do $$ begin
  if (select decrypted_secret from vault.decrypted_secrets where name = 'anthropic_key_test') <> 'sk-ant-two' then
    raise exception 'FAIL: vault upsert did not update';
  end if;
end $$;
select public.vault_delete_secret('anthropic_key_test');
do $$ begin
  if exists (select 1 from vault.secrets where name = 'anthropic_key_test') then raise exception 'FAIL: vault delete'; end if;
end $$;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  perform public.vault_upsert_secret('x', 'y');
  raise exception 'FAIL: authenticated user could call vault_upsert_secret';
exception when insufficient_privilege then null;
end $$;
reset role; reset request.jwt.claim.sub;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  perform public.resolve_ingest_key('jbx_x');
  raise exception 'FAIL: authenticated user could call resolve_ingest_key';
exception when insufficient_privilege then null;
end $$;
reset role; reset request.jwt.claim.sub;

-- ---------------------------------------------------------------------------
-- Cover letters: a voice sample needs no role; a draft does; one draft per role
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.cover_letters (user_id, body, voice_sample)
  values ('11111111-1111-1111-1111-111111111111', 'A letter I wrote myself.', true);
do $$ begin
  insert into public.cover_letters (user_id, body) values ('11111111-1111-1111-1111-111111111111', 'orphan draft');
  raise exception 'FAIL: draft without a role was accepted';
exception when check_violation then null;
end $$;
do $$
declare v_role uuid;
begin
  select id into v_role from public.roles where user_id = '11111111-1111-1111-1111-111111111111' limit 1;
  insert into public.cover_letters (user_id, role_id, body) values ('11111111-1111-1111-1111-111111111111', v_role, 'draft one');
  begin
    insert into public.cover_letters (user_id, role_id, body) values ('11111111-1111-1111-1111-111111111111', v_role, 'draft two');
    raise exception 'FAIL: second draft for the same role was accepted';
  exception when unique_violation then null;
  end;
end $$;
reset role; reset request.jwt.claim.sub;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  if exists (select 1 from public.cover_letters where voice_sample) then
    raise exception 'FAIL: user 2 can see user 1 voice samples';
  end if;
end $$;
reset role; reset request.jwt.claim.sub;

-- ---------------------------------------------------------------------------
-- Follow-up reminders: 7 and 14 days after applying, once each, dismiss sticks
-- ---------------------------------------------------------------------------
update public.roles set status = 'applied' where company = 'Acme';
update public.roles set status_changed_at = now() - interval '8 days' where company = 'Acme';
select public.flag_follow_ups();
select public.flag_follow_ups();
do $$ begin
  if (select count(*) from public.role_events where kind = 'reminder' and payload->>'reason' = 'follow_up') <> 1 then
    raise exception 'FAIL: expected exactly one 7-day follow-up, got %', (select count(*) from public.role_events where kind = 'reminder' and payload->>'reason' = 'follow_up');
  end if;
end $$;
delete from public.role_events where kind = 'reminder' and payload->>'reason' = 'follow_up';
select public.flag_follow_ups();
do $$ begin
  if (select count(*) from public.role_events where kind = 'reminder' and payload->>'reason' = 'follow_up') <> 0 then
    raise exception 'FAIL: dismissed follow-up was re-flagged';
  end if;
end $$;
update public.roles set status_changed_at = now() - interval '15 days' where company = 'Acme';
select public.flag_follow_ups();
do $$ begin
  if (select payload->>'days' from public.role_events where kind = 'reminder' and payload->>'reason' = 'follow_up') <> '14' then
    raise exception 'FAIL: expected the 14-day follow-up';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- admin_overview: admins get totals, others are refused
-- ---------------------------------------------------------------------------
update public.profiles set is_admin = true where id = '11111111-1111-1111-1111-111111111111';
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
declare v jsonb;
begin
  v := public.admin_overview();
  if (v->'totals'->>'users')::int < 2 then raise exception 'FAIL: admin_overview users'; end if;
  if jsonb_array_length(v->'users') < 2 then raise exception 'FAIL: admin_overview user list'; end if;
end $$;
reset role; reset request.jwt.claim.sub;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  perform public.admin_overview();
  raise exception 'FAIL: non-admin could call admin_overview';
exception when insufficient_privilege then null;
end $$;
reset role; reset request.jwt.claim.sub;
update public.profiles set is_admin = false where id = '11111111-1111-1111-1111-111111111111';

-- ---------------------------------------------------------------------------
-- Open sign-up switch: anon can read it, only an admin can flip it
-- ---------------------------------------------------------------------------
set role anon;
do $$ begin
  if public.signup_is_open() then raise exception 'FAIL: signup open by default'; end if;
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  perform public.admin_set_open_signup(true);
  raise exception 'FAIL: non-admin flipped open signup';
exception when insufficient_privilege then null;
end $$;
reset role; reset request.jwt.claim.sub;
update public.profiles set is_admin = true where id = '11111111-1111-1111-1111-111111111111';
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.admin_set_open_signup(true);
reset role; reset request.jwt.claim.sub;
set role anon;
do $$ begin
  if not public.signup_is_open() then raise exception 'FAIL: signup not open after admin flip'; end if;
end $$;
reset role;
update public.settings set value = '{"open_signup": false}' where key = 'signup';
update public.profiles set is_admin = false where id = '11111111-1111-1111-1111-111111111111';

-- ---------------------------------------------------------------------------
-- Share links: anon reads through the token only; revoke stops it; no notes leak
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.shares (user_id, kind) values ('11111111-1111-1111-1111-111111111111', 'board');
reset role; reset request.jwt.claim.sub;
do $$
declare v_token text; v jsonb;
begin
  select token into v_token from public.shares limit 1;
  set role anon;
  v := public.shared_view(v_token);
  if v->>'kind' <> 'board' or jsonb_array_length(v->'roles') < 1 then raise exception 'FAIL: shared board empty'; end if;
  if v::text like '%tampered%' or v->'roles'->0 ? 'notes' then raise exception 'FAIL: notes leaked through share'; end if;
  if public.shared_view('nope') is not null then raise exception 'FAIL: bad token returned data'; end if;
  reset role;
  update public.shares set revoked_at = now();
  set role anon;
  if public.shared_view(v_token) is not null then raise exception 'FAIL: revoked share still readable'; end if;
  reset role;
end $$;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  if (select count(*) from public.shares) <> 0 then raise exception 'FAIL: user 2 sees user 1 shares'; end if;
end $$;
reset role; reset request.jwt.claim.sub;

-- ---------------------------------------------------------------------------
-- Market signals: aggregates only, hidden until 2 users / 3 roles, anon refused
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
declare v jsonb;
begin
  v := public.market_signals();
  if (v->>'users')::int < 1 then raise exception 'FAIL: market_signals users'; end if;
  if v::text ilike '%1111-1111%' or v::text ilike '%2222-2222%' then raise exception 'FAIL: market_signals leaks user ids'; end if;
  if v ? 'enough' = false then raise exception 'FAIL: market_signals shape'; end if;
end $$;
reset role; reset request.jwt.claim.sub;
set role anon;
do $$ begin
  perform public.market_signals();
  raise exception 'FAIL: anon could call market_signals';
exception when insufficient_privilege then null;
end $$;
reset role;

\echo RLS tests passed
