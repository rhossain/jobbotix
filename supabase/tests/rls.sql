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

-- ---------------------------------------------------------------------------
-- Interviews: own rows only, never on another user's role; scheduling one
-- moves an early-pipeline role to Interview and logs the change.
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
declare v_role uuid; v_other uuid;
begin
  select id into v_role from public.roles where company = 'Opencorp';
  update public.roles set status = 'applied' where id = v_role;
  insert into public.interviews (user_id, role_id, kind, scheduled_at)
  values ('11111111-1111-1111-1111-111111111111', v_role, 'technical', now() + interval '2 days');
  if (select status from public.roles where id = v_role) <> 'interview' then
    raise exception 'FAIL: scheduling an interview did not move the role to Interview';
  end if;
  if not exists (select 1 from public.role_events where role_id = v_role and kind = 'status_change'
                   and payload->>'to' = 'interview') then
    raise exception 'FAIL: the move to Interview was not logged';
  end if;
  -- an offer stays an offer
  update public.roles set status = 'offer' where id = v_role;
  insert into public.interviews (user_id, role_id, kind) values ('11111111-1111-1111-1111-111111111111', v_role, 'final');
  if (select status from public.roles where id = v_role) <> 'offer' then
    raise exception 'FAIL: a later status was moved back to Interview';
  end if;
  begin
    insert into public.interviews (user_id, role_id, kind) values ('11111111-1111-1111-1111-111111111111', v_role, 'nonsense');
    raise exception 'FAIL: unknown interview kind accepted';
  exception when check_violation then null;
  end;
end $$;
reset role; reset request.jwt.claim.sub;
select set_config('test.opencorp', (select id::text from public.roles where company = 'Opencorp'), false);
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  if exists (select 1 from public.interviews) then raise exception 'FAIL: user 2 sees user 1 interviews'; end if;
  insert into public.interviews (user_id, role_id)
  values ('22222222-2222-2222-2222-222222222222', current_setting('test.opencorp')::uuid);
  raise exception 'FAIL: user 2 attached an interview to user 1''s role';
exception when insufficient_privilege then null;
end $$;
reset role; reset request.jwt.claim.sub;

-- ---------------------------------------------------------------------------
-- People: own rows only; links and touches only between your own rows; a
-- touch stamps the contact's last-touch time.
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
declare v_c uuid; v_role uuid;
begin
  insert into public.contacts (user_id, name, company, relation, next_touch_on)
  values ('11111111-1111-1111-1111-111111111111', 'Ana Ruiz', 'Opencorp', 'recruiter', current_date)
  returning id into v_c;
  select id into v_role from public.roles where company = 'Opencorp';
  insert into public.role_contacts (role_id, contact_id, user_id)
  values (v_role, v_c, '11111111-1111-1111-1111-111111111111');
  insert into public.contact_touches (user_id, contact_id, role_id, at, channel)
  values ('11111111-1111-1111-1111-111111111111', v_c, v_role, now() - interval '1 hour', 'linkedin');
  if (select last_touch_at from public.contacts where id = v_c) is null then
    raise exception 'FAIL: a touch did not stamp last_touch_at';
  end if;
  begin
    insert into public.contacts (user_id, name) values ('11111111-1111-1111-1111-111111111111', '  ');
    raise exception 'FAIL: blank contact name accepted';
  exception when check_violation then null;
  end;
  perform set_config('test.contact', v_c::text, false);
end $$;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  if exists (select 1 from public.contacts) or exists (select 1 from public.contact_touches)
     or exists (select 1 from public.role_contacts) then
    raise exception 'FAIL: user 2 sees user 1 people';
  end if;
end $$;
do $$ begin
  insert into public.contact_touches (user_id, contact_id)
  values ('22222222-2222-2222-2222-222222222222', current_setting('test.contact')::uuid);
  raise exception 'FAIL: user 2 logged a touch on user 1''s contact';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.role_contacts (role_id, contact_id, user_id)
  values (current_setting('test.opencorp')::uuid, current_setting('test.contact')::uuid,
          '22222222-2222-2222-2222-222222222222');
  raise exception 'FAIL: user 2 linked user 1''s contact to user 1''s role';
exception when insufficient_privilege then null;
end $$;
reset role; reset request.jwt.claim.sub;

-- ---------------------------------------------------------------------------
-- Account deletion: removing the auth user removes every row they own.
-- ---------------------------------------------------------------------------
do $$
declare v_role uuid; v_c uuid; t text; n int;
begin
  insert into public.roles (user_id, company, title, url)
  values ('22222222-2222-2222-2222-222222222222', 'Leaving Co', 'Dev', 'https://leaving.example/1')
  returning id into v_role;
  insert into public.contacts (user_id, name) values ('22222222-2222-2222-2222-222222222222', 'Bye')
  returning id into v_c;
  insert into public.role_contacts (role_id, contact_id, user_id)
  values (v_role, v_c, '22222222-2222-2222-2222-222222222222');
  insert into public.interviews (user_id, role_id) values ('22222222-2222-2222-2222-222222222222', v_role);
  insert into public.contact_touches (user_id, contact_id) values ('22222222-2222-2222-2222-222222222222', v_c);

  delete from auth.users where id = '22222222-2222-2222-2222-222222222222';

  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_name = c.table_name and tb.table_schema = c.table_schema
    where c.table_schema = 'public' and c.column_name = 'user_id' and tb.table_type = 'BASE TABLE'
  loop
    execute format('select count(*) from public.%I where user_id = %L', t, '22222222-2222-2222-2222-222222222222') into n;
    if n > 0 then raise exception 'FAIL: % still has % rows after account deletion', t, n; end if;
  end loop;
  if exists (select 1 from public.profiles where id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'FAIL: profile survived account deletion';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Error reports: anyone can report, repeats group, only admins read, caps hold.
-- ---------------------------------------------------------------------------
update public.profiles set is_admin = true where id = '11111111-1111-1111-1111-111111111111';
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  perform public.report_error('{"fingerprint":"TypeError:x@/today","name":"TypeError","message":"x is undefined","path":"/today"}');
  perform public.report_error('{"fingerprint":"TypeError:x@/today","name":"TypeError","message":"x is undefined","path":"/today"}');
  perform public.report_error('{"fingerprint":""}');
  if (select count(*) from public.app_errors) <> 1 then raise exception 'FAIL: admin should read one grouped error'; end if;
  if (select count from public.app_errors) <> 2 then raise exception 'FAIL: repeat was not counted'; end if;
  for i in 1..40 loop
    perform public.report_error(jsonb_build_object('fingerprint', 'flood-' || i));
  end loop;
  if (select count(*) from public.app_errors where user_id = '11111111-1111-1111-1111-111111111111') <> 30 then
    raise exception 'FAIL: per-user daily cap did not hold';
  end if;
end $$;
reset role; reset request.jwt.claim.sub;
update public.settings set value = '{"open_signup": true}' where key = 'signup';
insert into auth.users (id, email, raw_user_meta_data)
values ('33333333-3333-3333-3333-333333333333', 'c@example.com', '{}');
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$ begin
  perform public.report_error('{"fingerprint":"user3-error","message":"boom"}');
  if exists (select 1 from public.app_errors) then raise exception 'FAIL: a non-admin can read error reports'; end if;
end $$;
reset role; reset request.jwt.claim.sub;
set role anon;
do $$ begin
  perform public.report_error('{"fingerprint":"signed-out-error"}');
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.app_errors where fingerprint = 'signed-out-error' and user_id is null) then
    raise exception 'FAIL: a signed-out report was not stored';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Plans and entitlements (migration 0033). User 1 is the admin, user 3 is not.
-- ---------------------------------------------------------------------------
-- Billing is off: every feature is on for everyone, whatever the plan.
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$
declare e jsonb := public.entitlements();
begin
  if (e ->> 'enforced')::boolean then raise exception 'FAIL: billing is enforced by default'; end if;
  if e ->> 'plan' <> 'free' then raise exception 'FAIL: default plan is %', e ->> 'plan'; end if;
  if not (e -> 'features') ? 'company_research' then raise exception 'FAIL: features are gated while billing is off'; end if;
  if e -> 'limits' <> '{}'::jsonb then raise exception 'FAIL: limits apply while billing is off'; end if;
  if (e ->> 'credits')::int <> 0 then raise exception 'FAIL: a new account has credits'; end if;
  if (select count(*) from public.plans) <> 2 then raise exception 'FAIL: plans are not readable'; end if;
end $$;

-- A user cannot give themselves a plan, a payment or credits.
do $$ begin
  insert into public.subscriptions (user_id, plan_id) values ('33333333-3333-3333-3333-333333333333', 'pro');
  raise exception 'FAIL: a user created their own subscription';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.credit_ledger (user_id, delta, kind) values ('33333333-3333-3333-3333-333333333333', 500, 'topup');
  raise exception 'FAIL: a user granted themselves credits';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.payments (user_id, provider_ref, kind, amount_cents)
  values ('33333333-3333-3333-3333-333333333333', 'fake', 'subscription', 1500);
  raise exception 'FAIL: a user recorded their own payment';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  update public.plans set features = array_append(features, 'company_research') where id = 'free';
  if exists (select 1 from public.plans where id = 'free' and 'company_research' = any (features)) then
    raise exception 'FAIL: a user edited a plan';
  end if;
end $$;
do $$ begin
  perform public.admin_set_plan('33333333-3333-3333-3333-333333333333', 'pro', 'me');
  raise exception 'FAIL: a non-admin set a plan';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.admin_add_credits('33333333-3333-3333-3333-333333333333', 100, 'me');
  raise exception 'FAIL: a non-admin added credits';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.admin_set_billing(false);
  raise exception 'FAIL: a non-admin changed the billing switch';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.admin_plans();
  raise exception 'FAIL: a non-admin read every account''s plan';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.entitlements_for('11111111-1111-1111-1111-111111111111');
  raise exception 'FAIL: a user read another account''s entitlements';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.credit_balance('11111111-1111-1111-1111-111111111111');
  raise exception 'FAIL: a user read another account''s credit balance';
exception when insufficient_privilege then null;
end $$;
reset role; reset request.jwt.claim.sub;
set role anon;
do $$ begin
  if (select count(*) from public.plans) <> 2 then raise exception 'FAIL: the pricing page cannot read plans'; end if;
  perform public.entitlements();
  raise exception 'FAIL: entitlements answered a signed-out caller';
exception when insufficient_privilege then null;
end $$;
reset role;

-- Preview: the gates apply to one account while billing stays off for the rest.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.admin_set_billing_preview('33333333-3333-3333-3333-333333333333', true);
select public.admin_set_billing_preview('33333333-3333-3333-3333-333333333333', true);  -- twice: still listed once
do $$ begin
  if (public.entitlements() ->> 'enforced')::boolean then raise exception 'FAIL: preview leaked to another account'; end if;
end $$;
reset role; reset request.jwt.claim.sub;
do $$ begin
  if jsonb_array_length((select value -> 'preview_users' from public.settings where key = 'billing')) <> 1 then
    raise exception 'FAIL: preview list holds duplicates';
  end if;
end $$;
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$
declare e jsonb := public.entitlements();
begin
  if not (e ->> 'enforced')::boolean then raise exception 'FAIL: preview did not enforce billing'; end if;
  if (e -> 'features') ? 'company_research' then raise exception 'FAIL: Free has a Pro feature'; end if;
  if not (e -> 'features') ? 'ai' then raise exception 'FAIL: Free lost AI on its own key'; end if;
  if (e -> 'limits' ->> 'search_profiles')::int <> 1 then raise exception 'FAIL: Free limit missing'; end if;
end $$;

-- An admin grants Pro with a reason; the account sees it at once.
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  perform public.admin_set_plan('33333333-3333-3333-3333-333333333333', 'pro', '   ');
  raise exception 'FAIL: a plan was set without a reason';
exception when invalid_parameter_value then null;
end $$;
do $$ begin
  perform public.admin_set_plan('33333333-3333-3333-3333-333333333333', 'gold', 'x');
  raise exception 'FAIL: an unknown plan was accepted';
exception when invalid_parameter_value then null;
end $$;
select public.admin_set_plan('33333333-3333-3333-3333-333333333333', 'pro', 'beta tester');
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$
declare e jsonb := public.entitlements();
begin
  if e ->> 'plan' <> 'pro' or e ->> 'status' <> 'active' then raise exception 'FAIL: grant did not take: %', e; end if;
  if not (e -> 'features') ? 'company_research' then raise exception 'FAIL: Pro lacks its feature'; end if;
  if (e ->> 'monthly_credits')::int <> 500 then raise exception 'FAIL: Pro monthly credits'; end if;
  if (select count(*) from public.subscriptions) <> 1 then raise exception 'FAIL: user cannot read own subscription'; end if;
  if (select note from public.subscriptions) <> 'beta tester' then raise exception 'FAIL: reason not stored'; end if;
  update public.subscriptions set plan_id = 'free';
  delete from public.subscriptions;
  if (public.entitlements() ->> 'plan') <> 'pro' then raise exception 'FAIL: a user changed their own subscription'; end if;
end $$;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  if (select count(*) from public.subscriptions) <> 0 then raise exception 'FAIL: subscriptions leak across accounts'; end if;
end $$;

-- A grant with an end date lapses; cancelled and past-due follow their dates.
select public.admin_set_plan('33333333-3333-3333-3333-333333333333', 'pro', 'expired grant', now() - interval '3 days');
reset role; reset request.jwt.claim.sub;
do $$
declare u uuid := '33333333-3333-3333-3333-333333333333';
begin
  if public.entitlements_for(u) ->> 'plan' <> 'free' then raise exception 'FAIL: an expired grant still counts'; end if;
  if public.entitlements_for(u) ->> 'status' <> 'none' then raise exception 'FAIL: lapsed status'; end if;

  update public.subscriptions set current_period_end = now() - interval '1 day' where user_id = u;
  if public.entitlements_for(u) ->> 'plan' <> 'pro' then raise exception 'FAIL: no slack for a late renewal'; end if;

  update public.subscriptions set status = 'canceled', current_period_end = now() + interval '5 days' where user_id = u;
  if public.entitlements_for(u) ->> 'plan' <> 'pro' then raise exception 'FAIL: cancelled lost the paid period'; end if;
  update public.subscriptions set current_period_end = now() - interval '1 hour' where user_id = u;
  if public.entitlements_for(u) ->> 'plan' <> 'free' then raise exception 'FAIL: cancelled kept Pro past the period'; end if;

  update public.subscriptions set status = 'past_due', grace_until = now() + interval '2 days' where user_id = u;
  if public.entitlements_for(u) ->> 'plan' <> 'pro' then raise exception 'FAIL: past due lost its grace'; end if;
  update public.subscriptions set grace_until = now() - interval '1 hour' where user_id = u;
  if public.entitlements_for(u) ->> 'plan' <> 'free' then raise exception 'FAIL: past due kept Pro after grace'; end if;

  -- a subscription billed through the provider is not an admin's to change
  update public.subscriptions set source = 'polar', status = 'active', current_period_end = now() + interval '20 days' where user_id = u;
end $$;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  perform public.admin_set_plan('33333333-3333-3333-3333-333333333333', 'free', 'downgrade');
  raise exception 'FAIL: an admin overrode a provider-billed subscription';
exception when invalid_parameter_value then null;
end $$;
reset role; reset request.jwt.claim.sub;
update public.subscriptions set source = 'admin' where user_id = '33333333-3333-3333-3333-333333333333';

-- Credits: an admin adds them with a reason; the balance never goes below zero.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  if public.admin_add_credits('33333333-3333-3333-3333-333333333333', 50, 'beta') <> 50 then
    raise exception 'FAIL: balance after a grant';
  end if;
  if public.admin_add_credits('33333333-3333-3333-3333-333333333333', -20, 'correction') <> 30 then
    raise exception 'FAIL: balance after a correction';
  end if;
end $$;
do $$ begin
  perform public.admin_add_credits('33333333-3333-3333-3333-333333333333', -31, 'too much');
  raise exception 'FAIL: balance went below zero';
exception when invalid_parameter_value then null;
end $$;
do $$ begin
  perform public.admin_add_credits('33333333-3333-3333-3333-333333333333', 0, 'nothing');
  raise exception 'FAIL: a zero adjustment was accepted';
exception when invalid_parameter_value then null;
end $$;
do $$ begin
  perform public.admin_add_credits('33333333-3333-3333-3333-333333333333', 10, '');
  raise exception 'FAIL: credits were added without a reason';
exception when invalid_parameter_value then null;
end $$;
do $$
declare v jsonb := public.admin_plans(); u jsonb;
begin
  if (v ->> 'enabled')::boolean then raise exception 'FAIL: admin_plans reports billing on'; end if;
  select x into u from jsonb_array_elements(v -> 'users') x where x ->> 'id' = '33333333-3333-3333-3333-333333333333';
  if u is null then raise exception 'FAIL: admin_plans misses an account'; end if;
  if (u ->> 'credits')::int <> 30 or u ->> 'plan' <> 'pro' or not (u ->> 'preview')::boolean then
    raise exception 'FAIL: admin_plans row is wrong: %', u;
  end if;
  if (select count(*) from public.credit_ledger) <> 0 then raise exception 'FAIL: the ledger leaks across accounts'; end if;
end $$;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$ begin
  if (public.entitlements() ->> 'credits')::int <> 30 then raise exception 'FAIL: entitlements credits'; end if;
  if (select count(*) from public.credit_ledger) <> 2 then raise exception 'FAIL: user cannot read own ledger'; end if;
  update public.credit_ledger set delta = 9999;
  delete from public.credit_ledger;
  if (public.entitlements() ->> 'credits')::int <> 30 then raise exception 'FAIL: a user edited the ledger'; end if;
end $$;

-- Removing Pro keeps the reason; preview off and the global switch both work.
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.admin_set_plan('33333333-3333-3333-3333-333333333333', 'free', 'beta over');
select public.admin_set_billing_preview('33333333-3333-3333-3333-333333333333', false);
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$
declare e jsonb := public.entitlements();
begin
  if e ->> 'plan' <> 'free' then raise exception 'FAIL: Pro was not removed'; end if;
  if (e ->> 'enforced')::boolean then raise exception 'FAIL: preview was not switched off'; end if;
  if (select note from public.subscriptions) <> 'beta over' then raise exception 'FAIL: removal reason not stored'; end if;
end $$;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.admin_set_billing(true);
do $$ begin
  if not (public.entitlements() ->> 'enforced')::boolean then raise exception 'FAIL: the billing switch did not enforce'; end if;
  if (public.entitlements() -> 'features') ? 'company_research' then raise exception 'FAIL: billing on, Free still has Pro features'; end if;
end $$;
select public.admin_set_billing(false);
do $$ begin
  if (public.entitlements() ->> 'enforced')::boolean then raise exception 'FAIL: the billing switch did not switch off'; end if;
end $$;
reset role; reset request.jwt.claim.sub;

-- ---------------------------------------------------------------------------
-- AI connections (migration 0034). The service role writes; users read their
-- own rows without the Vault reference.
-- ---------------------------------------------------------------------------
insert into public.ai_connections (user_id, provider, key_ref, key_hint, model, position, status)
values ('11111111-1111-1111-1111-111111111111', 'anthropic', 'anthropic_key_1', 'aaaa', 'claude-sonnet-5-5', 0, 'ok'),
       ('33333333-3333-3333-3333-333333333333', 'gemini', 'ai_key_gemini_3', 'gggg', '', 0, 'ok'),
       ('33333333-3333-3333-3333-333333333333', 'groq', 'ai_key_groq_3', 'qqqq', '', 1, 'untested');
do $$ begin
  insert into public.ai_connections (user_id, provider, key_ref)
  values ('33333333-3333-3333-3333-333333333333', 'gemini', 'again');
  raise exception 'FAIL: two connections to one provider';
exception when unique_violation then null;
end $$;
do $$ begin
  insert into public.ai_connections (user_id, provider, key_ref)
  values ('33333333-3333-3333-3333-333333333333', 'Not A Provider', 'x');
  raise exception 'FAIL: a malformed provider name was accepted';
exception when check_violation then null;
end $$;

set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$
declare n int;
begin
  select count(*) into n from (select id, provider, key_hint, model, position, status, last_error, limited_until from public.ai_connections) c;
  if n <> 2 then raise exception 'FAIL: user sees % connections, expected own 2', n; end if;
  if (select provider from public.ai_connections order by position limit 1) <> 'gemini' then
    raise exception 'FAIL: connection order';
  end if;
end $$;
do $$ begin
  perform key_ref from public.ai_connections;
  raise exception 'FAIL: a user read the Vault reference of a key';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform * from public.ai_connections;
  raise exception 'FAIL: select * exposed every column';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.ai_connections (user_id, provider, key_ref)
  values ('33333333-3333-3333-3333-333333333333', 'openrouter', 'mine');
  raise exception 'FAIL: a user created a connection directly';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  update public.ai_connections set status = 'ok', position = 0 where provider = 'groq';
  raise exception 'FAIL: a user edited a connection directly';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  delete from public.ai_connections where provider = 'groq';
  raise exception 'FAIL: a user deleted a connection directly';
exception when insufficient_privilege then null;
end $$;
reset role; reset request.jwt.claim.sub;
set role anon;
do $$ begin
  perform id from public.ai_connections;
  raise exception 'FAIL: a signed-out caller read connections';
exception when insufficient_privilege then null;
end $$;
reset role;

-- The admin overview counts any provider as an AI key and names them.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
declare v jsonb := public.admin_overview(); u jsonb;
begin
  select x into u from jsonb_array_elements(v -> 'users') x where x ->> 'id' = '33333333-3333-3333-3333-333333333333';
  if not (u ->> 'has_ai_key')::boolean then raise exception 'FAIL: a Gemini-only user shows no AI key'; end if;
  if u -> 'ai_providers' <> '["gemini", "groq"]'::jsonb then raise exception 'FAIL: providers listed as %', u -> 'ai_providers'; end if;
  select x into u from jsonb_array_elements(v -> 'users') x where x ->> 'id' = '22222222-2222-2222-2222-222222222222';
  if (u ->> 'has_ai_key')::boolean then raise exception 'FAIL: a user without connections shows an AI key'; end if;
  if (select count(*) from (select id from public.ai_connections) c) <> 1 then
    raise exception 'FAIL: connections leak across accounts';
  end if;
end $$;
reset role; reset request.jwt.claim.sub;

-- Usage rows name the provider; older rows read as Anthropic.
insert into public.ai_usage (user_id, job, model, tokens_in, tokens_out)
values ('33333333-3333-3333-3333-333333333333', 'letter', 'claude-sonnet-5-5', 10, 10);
insert into public.ai_usage (user_id, job, model, provider, tokens_in, tokens_out)
values ('33333333-3333-3333-3333-333333333333', 'letter', 'gemini-3.8-flash', 'gemini', 10, 10);
do $$ begin
  if (select count(*) from public.ai_usage where user_id = '33333333-3333-3333-3333-333333333333' and provider = 'anthropic') <> 1 then
    raise exception 'FAIL: usage provider default';
  end if;
end $$;

-- Deleting the account takes its connections with it.
do $$ begin
  delete from public.ai_connections where user_id = '11111111-1111-1111-1111-111111111111';
end $$;

-- Test helper: patch settings.pro_ai from a block that runs as the service role.
create function public.admin_set_pro_ai_as_service(p jsonb) returns void language plpgsql as $$
begin
  update public.settings set value = value || (p - 'credit_prices')
    || case when p ? 'credit_prices'
         then jsonb_build_object('credit_prices', (value -> 'credit_prices') || (p -> 'credit_prices'))
         else '{}'::jsonb end
   where key = 'pro_ai';
end $$;

-- ---------------------------------------------------------------------------
-- The Pro AI route (0035): credits held, spent and given back.
--   333… is on Pro with 30 credits; 111… (the admin) is on Free with none.
-- ---------------------------------------------------------------------------
-- Off by default: nothing is held, nobody has trial credits.
do $$ declare r jsonb;
begin
  r := public.ai_reserve_credits('33333333-3333-3333-3333-333333333333', 'letter');
  if r <> '{"ok": false, "reason": "off"}'::jsonb then raise exception 'FAIL: the Pro route is not off by default: %', r; end if;
  if exists (select 1 from public.credit_holds) then raise exception 'FAIL: a hold while off'; end if;
  if exists (select 1 from public.credit_ledger where kind = 'trial') then raise exception 'FAIL: trial credits while off'; end if;
end $$;

-- None of it is a user's to call or read.
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$ begin
  perform public.ai_reserve_credits('33333333-3333-3333-3333-333333333333', 'letter');
  raise exception 'FAIL: a user reserved credits directly';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.ai_settle_credits(gen_random_uuid(), 1, 1);
  raise exception 'FAIL: a user settled a hold';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.ai_release_credits(gen_random_uuid());
  raise exception 'FAIL: a user released a hold';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.grant_trial_credits('33333333-3333-3333-3333-333333333333');
  raise exception 'FAIL: a user granted themselves trial credits';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform id from public.credit_holds;
  raise exception 'FAIL: a user read holds';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.admin_set_pro_ai('{"enabled": true}');
  raise exception 'FAIL: a non-admin switched the Pro route on';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.admin_pro_ai();
  raise exception 'FAIL: a non-admin read the Pro route settings';
exception when insufficient_privilege then null;
end $$;
reset role; reset request.jwt.claim.sub;

-- The admin switches it on: every account gets its trial credits, once.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ declare bad jsonb;
begin
  foreach bad in array array[
    '{"nonsense": 1}', '{"enabled": "yes"}', '{"daily_credit_cap": -1}', '{"trial_credits": 2.5}',
    '{"credit_prices": {"letter": 2.5}}', '{"credit_prices": {"poetry": 1}}',
    '{"models": {"writing": "some-model-without-a-price"}}', '{"models": {"big": "claude-sonnet-5-5"}}'
  ]::jsonb[] loop
    begin
      perform public.admin_set_pro_ai(bad);
      raise exception 'FAIL: accepted %', bad;
    exception when invalid_parameter_value then null;
    end;
  end loop;
end $$;
do $$ declare v jsonb;
begin
  perform public.admin_set_pro_ai('{"enabled": true, "daily_credit_cap": 40}');
  perform public.admin_set_pro_ai('{"credit_prices": {"message": 2}}');
  v := public.admin_pro_ai();
  if not (v -> 'settings' ->> 'enabled')::boolean or (v -> 'settings' ->> 'daily_credit_cap')::int <> 40 then
    raise exception 'FAIL: the admin patch did not take: %', v -> 'settings';
  end if;
  if (v -> 'settings' -> 'credit_prices' ->> 'research')::int <> 15
     or (v -> 'settings' -> 'credit_prices' ->> 'message')::int <> 2 then
    raise exception 'FAIL: a price patch replaced the other prices';
  end if;
  if (v ->> 'month_spend_usd')::numeric <> 0 or (v ->> 'budget_warning')::boolean then
    raise exception 'FAIL: spend before any call';
  end if;
end $$;
reset role; reset request.jwt.claim.sub;
do $$ begin
  if (select count(*) from public.credit_ledger where kind = 'trial') <> (select count(*) from public.profiles) then
    raise exception 'FAIL: trial credits were not granted once each';
  end if;
  if public.credit_balance('11111111-1111-1111-1111-111111111111') <> 20 then raise exception 'FAIL: Free trial balance'; end if;
  if public.credit_balance('33333333-3333-3333-3333-333333333333') <> 50 then raise exception 'FAIL: Pro balance with trial'; end if;
  if public.grant_trial_credits('11111111-1111-1111-1111-111111111111') <> 0 then raise exception 'FAIL: a second trial grant'; end if;
end $$;
-- A sign-up while the route is on gets them too.
insert into auth.users (id, email, raw_user_meta_data)
values ('44444444-4444-4444-4444-444444444444', 'd@example.com', '{}');
do $$ begin
  if public.credit_balance('44444444-4444-4444-4444-444444444444') <> 20 then raise exception 'FAIL: no trial credits at sign-up'; end if;
end $$;

-- Reserve, settle, release.
do $$
declare
  pro uuid := '33333333-3333-3333-3333-333333333333';
  free uuid := '11111111-1111-1111-1111-111111111111';
  r jsonb; r2 jsonb; h uuid; b int;
begin
  insert into public.subscriptions (user_id, plan_id, status, source, current_period_end)
  values (pro, 'pro', 'active', 'admin', now() + interval '20 days')
  on conflict (user_id) do update set plan_id = 'pro', status = 'active', source = 'admin',
    current_period_end = now() + interval '20 days';
  if public.entitlements_for(pro) ->> 'plan' <> 'pro' then raise exception 'FAIL: test account is not on Pro'; end if;

  -- Pro: credits go first, on the writing model; the hold lowers the balance.
  r := public.ai_reserve_credits(pro, 'letter');
  if not (r ->> 'ok')::boolean or (r ->> 'credits')::int <> 3 or r ->> 'model' <> 'claude-sonnet-5-5'
     or not (r ->> 'first')::boolean or (r ->> 'balance')::int <> 47 then
    raise exception 'FAIL: reserve for Pro: %', r;
  end if;
  h := (r ->> 'hold')::uuid;
  if public.credit_balance(pro) <> 47 then raise exception 'FAIL: a hold did not lower the balance'; end if;
  if (public.entitlements_for(pro) ->> 'credits')::int <> 47 then raise exception 'FAIL: entitlements ignore holds'; end if;

  -- The call failed: the credits come back, and releasing twice is harmless.
  perform public.ai_release_credits(h);
  perform public.ai_release_credits(h);
  if public.credit_balance(pro) <> 50 then raise exception 'FAIL: release did not give the credits back'; end if;
  if exists (select 1 from public.credit_ledger where user_id = pro and kind = 'spend') then
    raise exception 'FAIL: a failed call was charged';
  end if;

  -- The call answered: spent once, usage logged with its cost, settling twice is harmless.
  r := public.ai_reserve_credits(pro, 'letter');
  h := (r ->> 'hold')::uuid;
  b := public.ai_settle_credits(h, 5000, 600);
  if b <> 47 or public.ai_settle_credits(h, 5000, 600) <> 47 then raise exception 'FAIL: settle balance %', b; end if;
  if (select count(*) from public.credit_ledger where user_id = pro and kind = 'spend') <> 1
     or (select delta from public.credit_ledger where user_id = pro and kind = 'spend') <> -3 then
    raise exception 'FAIL: settle did not spend exactly once';
  end if;
  if (select count(*) from public.ai_usage where user_id = pro and route = 'platform') <> 1 then
    raise exception 'FAIL: settle logged usage % times', (select count(*) from public.ai_usage where user_id = pro and route = 'platform');
  end if;
  -- 5000 in at $2/M + 600 out at $10/M
  if (select cost_usd from public.ai_usage where user_id = pro and route = 'platform') <> 0.016 then
    raise exception 'FAIL: cost %', (select cost_usd from public.ai_usage where user_id = pro and route = 'platform');
  end if;
  -- a release after the settle changes nothing
  perform public.ai_release_credits(h);
  if public.credit_balance(pro) <> 47 then raise exception 'FAIL: release undid a settle'; end if;

  -- Scoring is not metered and runs on the fast model.
  r := public.ai_reserve_credits(pro, 'score');
  if not (r ->> 'ok')::boolean or (r ->> 'credits')::int <> 0 or r ->> 'model' <> 'claude-haiku-5-5' then
    raise exception 'FAIL: unmetered reserve: %', r;
  end if;
  if public.ai_settle_credits((r ->> 'hold')::uuid, 1500, 250) <> 47 then raise exception 'FAIL: an unmetered job cost credits'; end if;

  -- Never below zero: research (15) fits three times in 47, not four…
  perform public.admin_set_pro_ai_as_service('{"daily_credit_cap": 1000}');
  r := public.ai_reserve_credits(pro, 'research');
  r := public.ai_reserve_credits(pro, 'research');
  r := public.ai_reserve_credits(pro, 'research');
  if not (r ->> 'ok')::boolean or (r ->> 'balance')::int <> 2 then raise exception 'FAIL: third research: %', r; end if;
  r2 := public.ai_reserve_credits(pro, 'research');
  if (r2 ->> 'ok')::boolean or r2 ->> 'reason' <> 'no_credits' or (r2 ->> 'needed')::int <> 15 or (r2 ->> 'balance')::int <> 2 then
    raise exception 'FAIL: a fourth research was reserved on 2 credits: %', r2;
  end if;
  -- …and an admin cannot take away credits that are held.
  begin
    perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
    set local role authenticated;
    perform public.admin_add_credits(pro, -3, 'too much');
    raise exception 'FAIL: an adjustment went below what is held';
  exception when invalid_parameter_value then null;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  -- settle all three: the ledger lands on 2, never below
  perform public.ai_settle_credits(id, 60000, 2000, 3) from public.credit_holds where user_id = pro and status = 'held';
  if public.credit_balance(pro) <> 2 or (select sum(delta) from public.credit_ledger where user_id = pro) <> 2 then
    raise exception 'FAIL: balance after three researches: %', public.credit_balance(pro);
  end if;

  -- A hold whose call never came back expires and is given back; if the
  -- answer does arrive late it is paid for only as far as credits remain.
  r := public.ai_reserve_credits(pro, 'message');   -- 2 credits (price patched above)
  h := (r ->> 'hold')::uuid;
  update public.credit_holds set expires_at = now() - interval '1 minute' where id = h;
  if public.credit_balance(pro) <> 2 then raise exception 'FAIL: an expired hold still holds credits'; end if;
  perform public.admin_set_pro_ai_as_service('{"credit_prices": {"message": 1}}');
  r2 := public.ai_reserve_credits(pro, 'message');  -- sweeps the stale hold, holds 1
  if (select status from public.credit_holds where id = h) <> 'released' then raise exception 'FAIL: the stale hold was not swept'; end if;
  perform public.ai_settle_credits((r2 ->> 'hold')::uuid, 100, 100);
  if public.ai_settle_credits(h, 100, 100) <> 0 then raise exception 'FAIL: a late answer overdrew the account'; end if;
  if (select sum(delta) from public.credit_ledger where user_id = pro) <> 0 then raise exception 'FAIL: ledger below or above zero'; end if;

  -- An answer Jobbotix could not read: logged and costed, not charged.
  perform public.admin_set_pro_ai_as_service('{"credit_prices": {"message": 0}}');
  insert into public.credit_ledger (user_id, delta, kind, reason) values (pro, 10, 'admin', 'test');
  r := public.ai_reserve_credits(pro, 'letter');
  if public.ai_settle_credits((r ->> 'hold')::uuid, 900, 50, 0, false) <> 10 then raise exception 'FAIL: an unusable answer was charged'; end if;
  if (select count(*) from public.ai_usage where user_id = pro and route = 'platform' and tokens_in = 900 and cost_usd > 0) <> 1 then
    raise exception 'FAIL: an unusable answer was not costed';
  end if;
  insert into public.credit_ledger (user_id, delta, kind, reason) values (pro, -10, 'expire', 'test');

  -- Free: trial credits are the fallback, not the first choice.
  r := public.ai_reserve_credits(free, 'letter', true);
  if (r ->> 'ok')::boolean or r ->> 'reason' <> 'fallback' or exists (select 1 from public.credit_holds where user_id = free) then
    raise exception 'FAIL: a Free account was offered credits first: %', r;
  end if;
  r := public.ai_reserve_credits(pro, 'score', true);
  if not (r ->> 'ok')::boolean then raise exception 'FAIL: a Pro account was not offered credits first: %', r; end if;
  perform public.ai_release_credits((r ->> 'hold')::uuid);
  r := public.ai_reserve_credits(free, 'letter');
  if not (r ->> 'ok')::boolean or (r ->> 'first')::boolean then raise exception 'FAIL: Free reserve: %', r; end if;
  perform public.ai_release_credits((r ->> 'hold')::uuid);
  -- "My own key only" is respected.
  update public.profiles set ai_route = 'own' where id = free;
  r := public.ai_reserve_credits(free, 'letter');
  if (r ->> 'ok')::boolean or r ->> 'reason' <> 'own_only' then raise exception 'FAIL: own-key-only account was offered credits: %', r; end if;
  update public.profiles set ai_route = 'auto' where id = free;
  -- Free with no credits left gets no free scoring either.
  insert into public.credit_ledger (user_id, delta, kind, reason) values (free, -20, 'expire', 'test');
  r := public.ai_reserve_credits(free, 'score');
  if (r ->> 'ok')::boolean or r ->> 'reason' <> 'no_credits' then raise exception 'FAIL: unmetered scoring for an empty Free account: %', r; end if;
end $$;

-- What the app is told (0036): prices, who pays first, what is left.
set role anon;
do $$ begin
  perform public.ai_route_info();
  raise exception 'FAIL: a signed-out caller read the AI route';
exception when insufficient_privilege then null;
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$ declare v jsonb := public.ai_route_info();
begin
  if not (v ->> 'enabled')::boolean or not (v ->> 'credits_first')::boolean or (v ->> 'own_only')::boolean
     or (v -> 'prices' ->> 'research')::int <> 15 or (v ->> 'credits')::int <> 0 then
    raise exception 'FAIL: route info for Pro: %', v;
  end if;
  -- the account may switch to its own key only
  update public.profiles set ai_route = 'own' where id = auth.uid();
  if not (public.ai_route_info() ->> 'own_only')::boolean then raise exception 'FAIL: own-key-only not reported'; end if;
  update public.profiles set ai_route = 'auto' where id = auth.uid();
  begin
    update public.profiles set ai_route = 'credits-for-free' where id = auth.uid();
    raise exception 'FAIL: an unknown AI route was saved';
  exception when check_violation then null;
  end;
end $$;
reset role; reset request.jwt.claim.sub;
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
do $$ declare v jsonb := public.ai_route_info();
begin
  if (v ->> 'credits_first')::boolean or (v ->> 'credits')::int <> 20 then raise exception 'FAIL: route info for Free: %', v; end if;
end $$;
reset role; reset request.jwt.claim.sub;

-- The daily cap and the monthly budget.
do $$
declare u uuid := '44444444-4444-4444-4444-444444444444'; r jsonb; v jsonb;
begin
  perform public.admin_set_pro_ai_as_service('{"daily_credit_cap": 8}');
  r := public.ai_reserve_credits(u, 'tailor');                     -- 5 of 8
  perform public.ai_settle_credits((r ->> 'hold')::uuid, 4000, 1500);
  r := public.ai_reserve_credits(u, 'tailor');                     -- 10 > 8
  if (r ->> 'ok')::boolean or r ->> 'reason' <> 'daily_cap' or r ->> 'resets_at' is null then
    raise exception 'FAIL: the daily cap did not stop a call: %', r;
  end if;
  r := public.ai_reserve_credits(u, 'letter');                     -- 8 of 8 is allowed
  if not (r ->> 'ok')::boolean then raise exception 'FAIL: the daily cap stopped a call that fits: %', r; end if;
  perform public.ai_release_credits((r ->> 'hold')::uuid);

  -- Platform spend so far: 0.016 + 0.00028 + 3 x 0.17 + 2 x 0.0012 + 0.023 = about 0.55
  perform public.admin_set_pro_ai_as_service('{"daily_credit_cap": 1000, "monthly_budget_usd": 0.6}');
  r := public.ai_reserve_credits(u, 'letter');
  if not (r ->> 'ok')::boolean then raise exception 'FAIL: under budget but refused: %', r; end if;
  perform public.ai_release_credits((r ->> 'hold')::uuid);
  perform public.admin_set_pro_ai_as_service('{"monthly_budget_usd": 0.5}');
  r := public.ai_reserve_credits(u, 'letter');
  if (r ->> 'ok')::boolean or r ->> 'reason' <> 'budget' then raise exception 'FAIL: over budget but reserved: %', r; end if;
  -- last month's spend does not count against this month
  update public.ai_usage set created_at = now() - interval '40 days' where route = 'platform';
  r := public.ai_reserve_credits(u, 'letter');
  if not (r ->> 'ok')::boolean then raise exception 'FAIL: last month counted against the budget: %', r; end if;
  perform public.ai_release_credits((r ->> 'hold')::uuid);

  -- The kill switch.
  perform public.admin_set_pro_ai_as_service('{"enabled": false}');
  if public.ai_reserve_credits(u, 'letter') ->> 'reason' <> 'off' then raise exception 'FAIL: the kill switch did not stop reservations'; end if;
  perform set_config('request.jwt.claim.sub', u::text, true);
  if public.ai_route_info() <> '{"enabled": false}'::jsonb then raise exception 'FAIL: route info while off'; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  if exists (select 1 from public.credit_holds where status = 'held' and expires_at > now()) then
    raise exception 'FAIL: holds left open';
  end if;
  if exists (select 1 from (select user_id, sum(delta) s from public.credit_ledger group by 1) t where s < 0) then
    raise exception 'FAIL: an account went below zero';
  end if;
end $$;
drop function public.admin_set_pro_ai_as_service(jsonb);

-- ---------------------------------------------------------------------------
-- The admin console (0037).
--   111… admin, 333… on Pro with two AI connections, 444… on Free.
-- ---------------------------------------------------------------------------
-- What admins did earlier in this file was recorded by the triggers.
do $$ begin
  if not exists (select 1 from public.admin_audit where action = 'add_credits'
                  and target_email = 'c@example.com' and (detail ->> 'credits')::int = 50
                  and admin_email = 'a@example.com') then
    raise exception 'FAIL: adding credits was not audited';
  end if;
  if not exists (select 1 from public.admin_audit where action = 'set_plan' and detail ->> 'plan' = 'pro') then
    raise exception 'FAIL: granting a plan was not audited';
  end if;
  if not exists (select 1 from public.admin_audit where action = 'settings:pro_ai' and (detail ->> 'enabled')::boolean) then
    raise exception 'FAIL: switching the Pro route was not audited';
  end if;
  if not exists (select 1 from public.admin_audit where action = 'settings:billing') then
    raise exception 'FAIL: the billing switch was not audited';
  end if;
end $$;

-- The trail is for admins to read, and nobody's to write or tidy by hand.
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$ begin
  if exists (select 1 from public.admin_audit) then raise exception 'FAIL: a non-admin read the audit trail'; end if;
end $$;
do $$ begin
  insert into public.admin_audit (action) values ('forged');
  raise exception 'FAIL: a user wrote to the audit trail';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.admin_users_list();
  raise exception 'FAIL: a user listed the accounts';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.admin_user_detail('33333333-3333-3333-3333-333333333333');
  raise exception 'FAIL: a user read an account detail';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.admin_money();
  raise exception 'FAIL: a user read the money overview';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.admin_audit_write('33333333-3333-3333-3333-333333333333', 'forged');
  raise exception 'FAIL: a user wrote an audit row through the function';
exception when insufficient_privilege then null;
end $$;
reset role; reset request.jwt.claim.sub;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  if not exists (select 1 from public.admin_audit) then raise exception 'FAIL: an admin cannot read the audit trail'; end if;
end $$;
do $$ begin
  delete from public.admin_audit;
  raise exception 'FAIL: an admin deleted audit rows';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  update public.admin_audit set action = 'tidied';
  raise exception 'FAIL: an admin edited audit rows';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  -- the reads go through the admin function, which audits them
  perform public.admin_users_list();
  raise exception 'FAIL: an admin called the service read directly';
exception when insufficient_privilege then null;
end $$;
reset role; reset request.jwt.claim.sub;

-- A repeated view inside the quiet window is recorded once.
do $$ declare n int;
begin
  perform public.admin_audit_write('11111111-1111-1111-1111-111111111111', 'view_user', '33333333-3333-3333-3333-333333333333', '{}', 10);
  perform public.admin_audit_write('11111111-1111-1111-1111-111111111111', 'view_user', '33333333-3333-3333-3333-333333333333', '{}', 10);
  perform public.admin_audit_write('11111111-1111-1111-1111-111111111111', 'view_user', '44444444-4444-4444-4444-444444444444', '{}', 10);
  select count(*) into n from public.admin_audit where action = 'view_user';
  if n <> 2 then raise exception 'FAIL: quiet window recorded % views', n; end if;
  perform public.admin_audit_write('11111111-1111-1111-1111-111111111111', 'view_user', '33333333-3333-3333-3333-333333333333');
  if (select count(*) from public.admin_audit where action = 'view_user') <> 3 then raise exception 'FAIL: an unquiet view was dropped'; end if;
  if (select target_email from public.admin_audit where action = 'view_user' limit 1) = '' then raise exception 'FAIL: no email snapshot'; end if;
end $$;

-- Suspension is the console's to set; support access is the owner's, for a week at most.
update public.profiles set suspended_at = now(), suspended_reason = 'abuse'
 where id = '44444444-4444-4444-4444-444444444444';
do $$ begin
  if not (public.entitlements_for('44444444-4444-4444-4444-444444444444') ->> 'suspended')::boolean then
    raise exception 'FAIL: entitlements do not report the suspension';
  end if;
  if (public.entitlements_for('33333333-3333-3333-3333-333333333333') ->> 'suspended')::boolean then
    raise exception 'FAIL: an account in good standing reads as suspended';
  end if;
end $$;
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
do $$ begin
  update public.profiles set suspended_at = null where id = auth.uid();
  raise exception 'FAIL: a user lifted their own suspension';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  update public.profiles set suspended_reason = '' where id = auth.uid();
  raise exception 'FAIL: a user edited their suspension reason';
exception when insufficient_privilege then null;
end $$;
-- ordinary profile edits still work
update public.profiles set name = 'D' where id = auth.uid();
reset role; reset request.jwt.claim.sub;
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
update public.profiles set support_access_until = now() + interval '90 days' where id = auth.uid();
do $$ declare t timestamptz := (select support_access_until from public.profiles where id = auth.uid());
begin
  if t is null or t > now() + interval '7 days 1 minute' or t < now() + interval '6 days' then
    raise exception 'FAIL: support access was not held to 7 days: %', t;
  end if;
  -- and nobody opens someone else's account
  update public.profiles set support_access_until = now() + interval '1 day' where id = '44444444-4444-4444-4444-444444444444';
  if found then raise exception 'FAIL: a user opened support access on another account'; end if;
end $$;
update public.profiles set support_access_until = null where id = auth.uid();
do $$ begin
  if (select support_access_until from public.profiles where id = auth.uid()) is not null then
    raise exception 'FAIL: the owner could not close support access';
  end if;
end $$;
reset role; reset request.jwt.claim.sub;

-- The users table: search and the two filters.
insert into public.roles (user_id, company, title, url, notes, cover_letter, posting_text)
values ('33333333-3333-3333-3333-333333333333', 'Acme Secret Co', 'Engineer', 'https://example.com/secret-role',
        'SECRETNOTE', 'SECRETLETTER', 'SECRETPOSTING');
insert into public.resumes (user_id, is_master, sections)
values ('33333333-3333-3333-3333-333333333333', true, '{"summary": "SECRETRESUME"}')
on conflict do nothing;
update public.resumes set sections = '{"summary": "SECRETRESUME"}'
 where user_id = '33333333-3333-3333-3333-333333333333' and is_master;
do $$
declare v jsonb; u jsonb;
begin
  v := public.admin_users_list();
  if (v ->> 'total')::int <> 3 or jsonb_array_length(v -> 'users') <> 3 then raise exception 'FAIL: users list total: %', v ->> 'total'; end if;
  if v::text like '%SECRET%' or v::text like '%key_ref%' then raise exception 'FAIL: the users list carries content'; end if;
  select x into u from jsonb_array_elements(v -> 'users') x where x ->> 'email' = 'c@example.com';
  if u ->> 'plan' <> 'pro' or u ->> 'route' <> 'own' or u -> 'providers' <> '["gemini", "groq"]'::jsonb
     or (u ->> 'roles')::int < 1 or (u ->> 'suspended')::boolean then
    raise exception 'FAIL: the Pro account in the list: %', u;
  end if;
  select x into u from jsonb_array_elements(v -> 'users') x where x ->> 'email' = 'd@example.com';
  if u ->> 'plan' <> 'free' or u ->> 'route' <> 'none' or not (u ->> 'suspended')::boolean then
    raise exception 'FAIL: the suspended Free account in the list: %', u;
  end if;

  if (public.admin_users_list('C@EXAMPLE') ->> 'total')::int <> 1 then raise exception 'FAIL: search by email'; end if;
  if (public.admin_users_list('nobody-here') ->> 'total')::int <> 0 then raise exception 'FAIL: search with no match'; end if;
  if (public.admin_users_list('', 'pro') ->> 'total')::int <> 1 then raise exception 'FAIL: plan filter'; end if;
  if (public.admin_users_list('', 'free') ->> 'total')::int <> 2 then raise exception 'FAIL: plan filter, free'; end if;
  if (public.admin_users_list('', null, 'own') ->> 'total')::int <> 1 then raise exception 'FAIL: route filter, own'; end if;
  if (public.admin_users_list('', null, 'none') ->> 'total')::int <> 2 then raise exception 'FAIL: route filter, none'; end if;
  if (public.admin_users_list('', null, 'credits') ->> 'total')::int <> 0 then raise exception 'FAIL: credits route while the Pro route is off'; end if;
  -- paging
  v := public.admin_users_list('', null, null, 2, 2);
  if (v ->> 'total')::int <> 3 or jsonb_array_length(v -> 'users') <> 1 then raise exception 'FAIL: paging'; end if;

  -- with the Pro route on, a paying account is on credits unless it chose its own key
  update public.settings set value = value || '{"enabled": true}' where key = 'pro_ai';
  if (public.admin_users_list('', null, 'credits') -> 'users' -> 0 ->> 'email') <> 'c@example.com' then raise exception 'FAIL: credits route'; end if;
  update public.profiles set ai_route = 'own' where id = '33333333-3333-3333-3333-333333333333';
  if (public.admin_users_list('', null, 'credits') ->> 'total')::int <> 0 then raise exception 'FAIL: own-key-only still listed on credits'; end if;
  update public.profiles set ai_route = 'auto' where id = '33333333-3333-3333-3333-333333333333';
  update public.settings set value = value || '{"enabled": false}' where key = 'pro_ai';
end $$;

-- One account: everything about the account, nothing of its content.
do $$
declare v jsonb; pro uuid := '33333333-3333-3333-3333-333333333333';
begin
  if public.admin_user_detail(gen_random_uuid()) is not null then raise exception 'FAIL: detail for an unknown account'; end if;
  v := public.admin_user_detail(pro);
  if v -> 'account' ->> 'email' <> 'c@example.com' or not (v -> 'account' ->> 'has_resume')::boolean then
    raise exception 'FAIL: account tab: %', v -> 'account';
  end if;
  if v -> 'billing' -> 'entitlements' ->> 'plan' <> 'pro' or v -> 'billing' -> 'subscription' ->> 'source' <> 'admin'
     or jsonb_array_length(v -> 'billing' -> 'ledger') = 0 then
    raise exception 'FAIL: billing tab: %', v -> 'billing';
  end if;
  if jsonb_array_length(v -> 'ai' -> 'connections') <> 2 or v -> 'ai' -> 'connections' -> 0 ? 'key_ref' then
    raise exception 'FAIL: AI tab connections: %', v -> 'ai' -> 'connections';
  end if;
  if jsonb_array_length(v -> 'activity' -> 'audit') = 0 or (v -> 'activity' -> 'roles_by_status' ->> 'new')::int < 1 then
    raise exception 'FAIL: activity tab: %', v -> 'activity';
  end if;
  if v -> 'content' <> 'null'::jsonb or v::text like '%SECRET%' or v::text like '%Acme Secret%' then
    raise exception 'FAIL: the detail shows content without support access';
  end if;

  -- The owner opens support access: roles and the resume show, notes and letters never do.
  update public.profiles set support_access_until = now() + interval '3 days' where id = pro;
  v := public.admin_user_detail(pro);
  if v -> 'account' ->> 'support_access_until' is null
     or v -> 'content' -> 'roles' -> 0 ->> 'company' <> 'Acme Secret Co'
     or v -> 'content' -> 'resume' ->> 'summary' <> 'SECRETRESUME' then
    raise exception 'FAIL: support access did not open the content: %', v -> 'content';
  end if;
  if v::text like '%SECRETNOTE%' or v::text like '%SECRETLETTER%' or v::text like '%SECRETPOSTING%' then
    raise exception 'FAIL: support access shows notes, letters or posting text';
  end if;
  if not (public.admin_users_list('c@') -> 'users' -> 0 ->> 'support_access')::boolean then raise exception 'FAIL: list does not flag support access'; end if;
  -- and it closes by itself
  update public.profiles set support_access_until = now() - interval '1 minute' where id = pro;
  if public.admin_user_detail(pro) -> 'content' <> 'null'::jsonb then raise exception 'FAIL: expired support access still opens content'; end if;
end $$;

-- Money: revenue net of refunds, failed payments left out, and who costs more than they pay.
insert into public.payments (user_id, provider_ref, kind, product, amount_cents, status) values
  ('33333333-3333-3333-3333-333333333333', 'ord_1', 'subscription', 'Pro monthly', 1500, 'paid'),
  ('33333333-3333-3333-3333-333333333333', 'ref_1', 'refund', 'Pro monthly', -500, 'refunded'),
  ('33333333-3333-3333-3333-333333333333', 'ord_2', 'subscription', 'Pro monthly', 1500, 'failed');
insert into public.payments (user_id, provider_ref, kind, product, amount_cents, status, paid_at) values
  ('33333333-3333-3333-3333-333333333333', 'ord_0', 'subscription', 'Pro monthly', 1500, 'paid',
   date_trunc('month', now()) - interval '10 days');
insert into public.ai_usage (user_id, job, model, route, tokens_in, tokens_out, cost_usd) values
  ('44444444-4444-4444-4444-444444444444', 'research', 'claude-sonnet-5-5', 'platform', 300000, 20000, 0.8),
  ('33333333-3333-3333-3333-333333333333', 'letter', 'claude-sonnet-5-5', 'platform', 5000, 600, 0.016);
do $$ declare v jsonb := public.admin_money();
begin
  if (v ->> 'revenue_month_usd')::numeric <> 10 or (v ->> 'revenue_last_month_usd')::numeric <> 15
     or (v ->> 'refunds_month_usd')::numeric <> 5 then
    raise exception 'FAIL: revenue: %', v;
  end if;
  if (v ->> 'ai_spend_month_usd')::numeric <> 0.816 or (v ->> 'ai_share_of_revenue')::numeric <> 0.0816 then
    raise exception 'FAIL: AI spend against revenue: %', v;
  end if;
  if (v ->> 'active_granted')::int <> 1 or (v ->> 'active_paid')::int <> 0 then raise exception 'FAIL: subscriptions: %', v; end if;
  if jsonb_array_length(v -> 'over_cost') <> 1 or v -> 'over_cost' -> 0 ->> 'email' <> 'd@example.com'
     or (v -> 'over_cost' -> 0 ->> 'paid_usd')::numeric <> 0 then
    raise exception 'FAIL: over-cost accounts: %', v -> 'over_cost';
  end if;
end $$;
update public.profiles set suspended_at = null, suspended_reason = ''
 where id = '44444444-4444-4444-4444-444444444444';

-- 0038: the resume template is the account owner's own choice.
do $$ begin
  if (select resume_template from public.profiles where id = '33333333-3333-3333-3333-333333333333') <> 'classic' then
    raise exception 'FAIL: an account does not start on the classic template';
  end if;
end $$;
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
update public.profiles set resume_template = 'modern' where id = auth.uid();
do $$ begin
  if (select resume_template from public.profiles where id = auth.uid()) <> 'modern' then
    raise exception 'FAIL: a user could not choose a resume template';
  end if;
  update public.profiles set resume_template = 'serif' where id = '44444444-4444-4444-4444-444444444444';
  if found then raise exception 'FAIL: a user changed another account''s template'; end if;
  begin
    update public.profiles set resume_template = '<script>' where id = auth.uid();
    raise exception 'FAIL: a template name that is not a plain word was stored';
  exception when check_violation then null;
  end;
end $$;
reset role; reset request.jwt.claim.sub;

-- 0039: the resume photo is its owner's alone, small, and a JPEG.
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
insert into public.resume_photos (user_id, data)
values (auth.uid(), 'data:image/jpeg;base64,' || repeat('QUJD', 40));
do $$ begin
  begin
    insert into public.resume_photos (user_id, data)
    values ('44444444-4444-4444-4444-444444444444', 'data:image/jpeg;base64,' || repeat('QUJD', 40));
    raise exception 'FAIL: a user stored a photo on another account';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.resume_photos set data = 'data:text/html;base64,' || repeat('QUJD', 40) where user_id = auth.uid();
    raise exception 'FAIL: something that is not a JPEG was stored as a photo';
  exception when check_violation then null;
  end;
  begin
    update public.resume_photos set data = 'data:image/jpeg;base64,' || repeat('QUJD', 60000) where user_id = auth.uid();
    raise exception 'FAIL: an oversized photo was stored';
  exception when check_violation then null;
  end;
end $$;
reset role; reset request.jwt.claim.sub;
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
do $$ begin
  if exists (select 1 from public.resume_photos) then raise exception 'FAIL: a user read another account''s photo'; end if;
  delete from public.resume_photos where user_id = '33333333-3333-3333-3333-333333333333';
  if found then raise exception 'FAIL: a user deleted another account''s photo'; end if;
end $$;
reset role; reset request.jwt.claim.sub;
do $$ begin
  if (select count(*) from public.resume_photos where user_id = '33333333-3333-3333-3333-333333333333') <> 1 then
    raise exception 'FAIL: the owner''s photo is gone';
  end if;
  -- no admin view carries the photo
  if public.admin_user_detail('33333333-3333-3333-3333-333333333333')::text like '%data:image%' then
    raise exception 'FAIL: the admin detail carries the photo';
  end if;
end $$;
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
delete from public.resume_photos where user_id = auth.uid();
reset role; reset request.jwt.claim.sub;
do $$ begin
  if exists (select 1 from public.resume_photos) then raise exception 'FAIL: the owner could not remove the photo'; end if;
end $$;

-- 0039: a tailored resume can carry its own template, or none.
do $$ declare rid uuid; vid uuid;
begin
  select id into rid from public.roles where user_id = '33333333-3333-3333-3333-333333333333' limit 1;
  if rid is null then raise exception 'FAIL: test setup: no role for the Pro account'; end if;
  insert into public.resume_variants (user_id, role_id) values ('33333333-3333-3333-3333-333333333333', rid) returning id into vid;
  if (select template from public.resume_variants where id = vid) is not null then
    raise exception 'FAIL: a tailored resume does not start on the account''s template';
  end if;
  update public.resume_variants set template = 'photo' where id = vid;
  begin
    update public.resume_variants set template = 'Not A Name' where id = vid;
    raise exception 'FAIL: a template name that is not a plain word was stored';
  exception when check_violation then null;
  end;
  delete from public.resume_variants where id = vid;
end $$;

\echo RLS tests passed
