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
  if public.signup_is_open() then raise exception 'FAIL: signup open by default once accounts exist'; end if;
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

-- ---------------------------------------------------------------------------
-- Sourcing: the shared pool is written only through ingest_postings (service
-- role); signed-in users read it; the catalog is admin-written; run logs are
-- admin-only; a posting seen twice is stored once with two sources.
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  v := public.ingest_postings('himalayas', '[
    {"dedupe_key":"k1","external_id":"h-1","source_url":"https://himalayas.app/j/1","company":"Acme","title":"Senior Angular Engineer",
     "url":"https://acme.example/apply","remote_policy":"worldwide","hiring_countries":[],"tags":["Angular"],"description":"short"},
    {"dedupe_key":"k2","external_id":"h-2","company":"Beta","title":"Frontend Lead","url":"https://beta.example/apply",
     "remote_policy":"region_locked","hiring_countries":["DE","PL"]}
  ]'::jsonb);
  if (v->>'inserted')::int <> 2 then raise exception 'FAIL: ingest_postings inserted %', v; end if;

  insert into public.source_catalog (id, name, kind, access) values ('testboard', 'Test board', 'board', 'public_api');
  v := public.ingest_postings('testboard', '[
    {"dedupe_key":"k1","external_id":"t-9","company":"Acme","title":"Senior Angular Engineer",
     "url":"https://other.example/x","remote_policy":"unknown","description":"a much longer description than before"}
  ]'::jsonb);
  if (v->>'updated')::int <> 1 or (v->>'inserted')::int <> 0 then raise exception 'FAIL: repeat posting not merged %', v; end if;
  if (select url from public.postings where dedupe_key = 'k1') <> 'https://acme.example/apply' then
    raise exception 'FAIL: first URL was overwritten';
  end if;
  if (select remote_policy from public.postings where dedupe_key = 'k1') <> 'worldwide' then
    raise exception 'FAIL: known remote policy was overwritten by unknown';
  end if;
  if (select description from public.postings where dedupe_key = 'k1') not like 'a much longer%' then
    raise exception 'FAIL: longer description did not win';
  end if;
  if (select count(*) from public.posting_sources ps join public.postings p on p.id = ps.posting_id
       where p.dedupe_key = 'k1') <> 2 then
    raise exception 'FAIL: posting should be seen on two sources';
  end if;

  begin
    perform public.ingest_postings('nope', '[]'::jsonb);
    raise exception 'FAIL: unknown source accepted';
  exception when invalid_parameter_value then null;
  end;

  perform public.record_source_run('himalayas', now() - interval '1 minute', 3, 40, 2, 0, null);
  if (select last_new from public.source_catalog where id = 'himalayas') <> 2 then
    raise exception 'FAIL: record_source_run did not update the catalog';
  end if;

  begin
    insert into public.postings (dedupe_key, company, title, url, hiring_countries)
    values ('bad', 'X', 'Y', 'https://x', '{de}');
    raise exception 'FAIL: lower-case country code accepted';
  exception when check_violation then null;
  end;
end $$;

-- A non-admin reads the pool and the catalog, nothing more.
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  if (select count(*) from public.postings) < 2 then raise exception 'FAIL: user cannot read the pool'; end if;
  if (select count(*) from public.posting_sources) < 3 then raise exception 'FAIL: user cannot read posting sources'; end if;
  if (select count(*) from public.source_catalog where id = 'himalayas') <> 1 then raise exception 'FAIL: user cannot read the catalog'; end if;
  if (select count(*) from public.source_runs) <> 0 then raise exception 'FAIL: non-admin reads source_runs'; end if;
end $$;
do $$ begin
  insert into public.postings (dedupe_key, company, title, url) values ('evil', 'E', 'E', 'https://e');
  raise exception 'FAIL: user wrote to the pool';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  update public.source_catalog set enabled = false where id = 'himalayas';
  if not (select enabled from public.source_catalog where id = 'himalayas') then
    raise exception 'FAIL: non-admin disabled a source';
  end if;
end $$;
do $$ begin
  perform public.ingest_postings('himalayas', '[]'::jsonb);
  raise exception 'FAIL: user could call ingest_postings';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.call_edge_function('fetch-sources');
  raise exception 'FAIL: user could call call_edge_function';
exception when insufficient_privilege then null;
end $$;

-- A role can point at the pool and carry location fields; the admin reads run logs.
update public.roles set posting_id = (select id from public.postings where dedupe_key = 'k2'),
                        remote_policy = 'region_locked', hiring_countries = '{DE,PL}'
 where company = 'Beta';
update public.search_profiles set home_country = 'BD', allowed_countries = '{BD,AE}';
reset role; reset request.jwt.claim.sub;
update public.profiles set is_admin = true where id = '11111111-1111-1111-1111-111111111111';
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  if (select count(*) from public.source_runs) < 1 then raise exception 'FAIL: admin cannot read source_runs'; end if;
  if (select count(*) from public.roles where remote_policy = 'region_locked') <> 0 then
    raise exception 'FAIL: user 1 sees user 2 location fields';
  end if;
end $$;
reset role; reset request.jwt.claim.sub;
update public.profiles set is_admin = false where id = '11111111-1111-1111-1111-111111111111';
do $$ begin
  if (select posting_id from public.roles where company = 'Beta') is null then raise exception 'FAIL: role did not link to the pool'; end if;
end $$;

-- Changing what a user looks for clears the match watermark; a no-op save does not.
update public.search_profiles set last_matched_at = now();
update public.search_profiles set digest_min_score = digest_min_score;
do $$ begin
  if exists (select 1 from public.search_profiles where last_matched_at is null) then
    raise exception 'FAIL: a save that changed nothing reset the watermark';
  end if;
end $$;
update public.search_profiles set home_country = 'AE';
do $$ begin
  if exists (select 1 from public.search_profiles where last_matched_at is not null) then
    raise exception 'FAIL: changing the country did not reset the watermark';
  end if;
end $$;

-- Phase 2 sources are catalogued with budgets; the fan-out is service-only.
do $$ begin
  if (select count(*) from public.source_catalog where enabled) < 8 then
    raise exception 'FAIL: phase 2 sources missing from the catalog';
  end if;
  if exists (select 1 from public.source_catalog where id in ('adzuna', 'jooble', 'reed') and enabled) then
    raise exception 'FAIL: keyed sources must start disabled';
  end if;
  if (select max_requests_per_run from public.source_catalog where id = 'remotive') <> 1 then
    raise exception 'FAIL: Remotive budget is not one request a run';
  end if;
  perform public.fetch_all_sources();   -- as the owner: runs (pg_net is stubbed)
end $$;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  perform public.fetch_all_sources();
  raise exception 'FAIL: a user could call fetch_all_sources';
exception when insufficient_privilege then null;
end $$;
reset role; reset request.jwt.claim.sub;

-- vault_read_secret returns a secret to the service role and nobody else.
select public.vault_upsert_secret('test_key_ref', 'sk-test-123');
do $$ begin
  if public.vault_read_secret('test_key_ref') <> 'sk-test-123' then
    raise exception 'FAIL: vault_read_secret did not return the secret';
  end if;
  if public.vault_read_secret('no_such_secret') is not null then
    raise exception 'FAIL: a missing secret should read as null';
  end if;
end $$;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  perform public.vault_read_secret('test_key_ref');
  raise exception 'FAIL: a user could read a Vault secret';
exception when insufficient_privilege then null;
end $$;
reset role; reset request.jwt.claim.sub;

-- Watchlist: pool apply links register companies; users follow through
-- follow_company and see only their own follows; polls are service-only.
do $$ begin
  perform public.ingest_postings('himalayas', '[
    {"dedupe_key":"w1","external_id":"w-1","company":"Gamma","title":"Senior Angular Engineer",
     "url":"https://jobs.ashbyhq.com/gamma/1","ats_kind":"ashby","ats_slug":"gamma"}]'::jsonb);
  if not exists (select 1 from public.companies where ats_kind = 'ashby' and ats_slug = 'gamma' and name = 'Gamma') then
    raise exception 'FAIL: a pool posting did not register its company';
  end if;
end $$;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public.follow_company('lever', 'Delta', 'Delta Inc');
select public.follow_company('ashby', 'gamma', '');
do $$ begin
  if (select count(*) from public.company_follows) <> 2 then raise exception 'FAIL: user 2 should follow two companies'; end if;
  if (select name from public.companies where ats_slug = 'delta') <> 'Delta Inc' then raise exception 'FAIL: follow did not register the company'; end if;
  begin
    perform public.follow_company('workday', 'x', '');
    raise exception 'FAIL: unsupported ATS accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.follow_company('lever', '../evil', '');
    raise exception 'FAIL: bad slug accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    insert into public.company_follows (user_id, company_id)
    select '11111111-1111-1111-1111-111111111111', id from public.companies limit 1;
    raise exception 'FAIL: a user inserted a follow directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.record_company_polls('[]'::jsonb);
    raise exception 'FAIL: a user could record polls';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  if (select count(*) from public.company_follows) <> 0 then raise exception 'FAIL: user 1 sees user 2 follows'; end if;
  if (select count(*) from public.companies) < 2 then raise exception 'FAIL: companies should be readable'; end if;
end $$;
reset role; reset request.jwt.claim.sub;
do $$ begin
  perform public.record_company_polls(jsonb_build_array(jsonb_build_object(
    'id', (select id from public.companies where ats_slug = 'delta'), 'open_roles', 12)));
  if (select open_roles from public.companies where ats_slug = 'delta') <> 12 then
    raise exception 'FAIL: record_company_polls did not update the company';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Posting health: listings, boards, and "gone" only from a clean careers poll
-- a day after the listing was last seen; each user sees only their own roles.
-- ---------------------------------------------------------------------------
do $$
declare v_post uuid; v_open uuid;
begin
  insert into public.postings (dedupe_key, company, title, url, ats_kind, ats_slug, posted_at, first_seen_at)
  values ('ph-gone', 'Gonecorp', 'Angular Dev', 'https://gone.example/1', 'lever', 'gonecorp',
          now() - interval '70 days', now() - interval '65 days')
  returning id into v_post;
  insert into public.postings (dedupe_key, company, title, url, ats_kind, ats_slug)
  values ('ph-open', 'Opencorp', 'Angular Dev', 'https://open.example/1', 'lever', 'opencorp')
  returning id into v_open;
  insert into public.companies (ats_kind, ats_slug, name, last_polled_at)
  values ('lever', 'gonecorp', 'Gonecorp', now()), ('lever', 'opencorp', 'Opencorp', now())
  on conflict (ats_kind, ats_slug) do update set last_polled_at = excluded.last_polled_at, last_error = null;
  insert into public.posting_sources (source_id, external_id, posting_id, url, last_seen_at) values
    ('ats', 'lever:gonecorp:1', v_post, 'https://gone.example/1', now() - interval '3 days'),
    ('himalayas', 'h-gone-1', v_post, 'https://himalayas.app/g1', now()),
    ('himalayas', 'h-gone-2', v_post, 'https://himalayas.app/g2', now()),
    ('ats', 'lever:opencorp:1', v_open, 'https://open.example/1', now() - interval '2 hours');
  insert into public.roles (user_id, company, title, url, posting_id) values
    ('11111111-1111-1111-1111-111111111111', 'Gonecorp', 'Angular Dev', 'https://gone.example/1', v_post),
    ('11111111-1111-1111-1111-111111111111', 'Opencorp', 'Angular Dev', 'https://open.example/1', v_open);
end $$;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
declare h record;
begin
  select * into h from public.posting_health() ph
    join public.roles r on r.id = ph.role_id where r.company = 'Gonecorp';
  if h.listings <> 3 or h.boards <> 2 then
    raise exception 'FAIL: posting_health listings/boards = %/%', h.listings, h.boards;
  end if;
  if h.gone_since is null then raise exception 'FAIL: closed careers listing not reported gone'; end if;
  select * into h from public.posting_health() ph
    join public.roles r on r.id = ph.role_id where r.company = 'Opencorp';
  if h.gone_since is not null then raise exception 'FAIL: open careers listing reported gone'; end if;
end $$;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  if exists (select 1 from public.posting_health() ph join public.postings p on p.first_seen_at = ph.first_seen_at
             where p.dedupe_key in ('ph-gone', 'ph-open')) then
    raise exception 'FAIL: posting_health shows another user''s roles';
  end if;
end $$;
reset role; reset request.jwt.claim.sub;

-- Employment types: freelance and part-time exist; new profiles accept freelance.
do $$
declare v public.employment_type[];
begin
  insert into public.search_profiles (user_id, name, active)
  values ('22222222-2222-2222-2222-222222222222', 'types test', false)
  returning employment_types into v;
  if v <> '{full_time,contract,freelance}' then
    raise exception 'FAIL: new profile employment types are %', v;
  end if;
  update public.search_profiles set employment_types = '{part_time}' where name = 'types test';
  delete from public.search_profiles where name = 'types test';
end $$;

\echo RLS tests passed
