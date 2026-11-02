-- Scheduled database jobs.
-- pg_cron is available on hosted Supabase projects (enable it under Database >
-- Extensions if it is not already) and in the local stack.

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;

-- Keep-alive: the free tier pauses a project after 7 days without activity.
-- A daily write to settings counts as activity.
create or replace function public.keep_alive()
returns void language sql security definer set search_path = public as $$
  insert into public.settings (key, value)
  values ('keep_alive', jsonb_build_object('at', now()))
  on conflict (key) do update set value = excluded.value, updated_at = now();
$$;

select cron.schedule('keep-alive', '15 3 * * *', $$select public.keep_alive()$$);

-- Stale shortlist: flag roles left in "shortlist" for 3+ days. Phase 1 reads
-- these events on the Today screen; the job is harmless before then.
create or replace function public.flag_stale_shortlist()
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.role_events (user_id, role_id, kind, payload)
  select r.user_id, r.id, 'reminder',
         jsonb_build_object('reason', 'stale_shortlist', 'days', extract(day from now() - r.status_changed_at)::int)
    from public.roles r
   where r.status = 'shortlist'
     and r.status_changed_at < now() - interval '3 days'
     and not exists (
       select 1 from public.role_events e
        where e.role_id = r.id
          and e.kind = 'reminder'
          and e.created_at > now() - interval '3 days'
     );
end $$;

select cron.schedule('stale-shortlist', '0 1 * * *', $$select public.flag_stale_shortlist()$$);
