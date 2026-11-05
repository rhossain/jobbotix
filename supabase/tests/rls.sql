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

\echo RLS tests passed
