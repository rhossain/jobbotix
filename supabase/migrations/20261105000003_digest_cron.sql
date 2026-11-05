-- Hourly call to the send-digest Edge Function. The function itself decides
-- which users are due (their digest hour in their timezone) so one schedule
-- serves every timezone.
--
-- Before this runs on the hosted project, store two values in Vault:
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<DIGEST_CRON_SECRET>', 'digest_cron_secret');
-- and set DIGEST_CRON_SECRET, RESEND_API_KEY, DIGEST_FROM and APP_URL as
-- secrets on the function (supabase secrets set ...).

create extension if not exists pg_net with schema extensions;

create or replace function public.call_send_digest()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'digest_cron_secret';
  if v_url is null or v_secret is null then
    raise notice 'send-digest skipped: project_url or digest_cron_secret missing from Vault';
    return;
  end if;
  perform net.http_post(
    url := v_url || '/functions/v1/send-digest',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end $$;

select cron.schedule('send-digest-hourly', '5 * * * *', $$select public.call_send_digest()$$);
