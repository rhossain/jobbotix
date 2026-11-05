-- Follow-up reminders: 7 and 14 days after a role went to "applied" with no
-- change since, a reminder event is written once per milestone. The highest
-- milestone already flagged is kept on the role, so dismissing the event
-- (which deletes it) does not bring it back; moving the role to another
-- status resets the counter and stops the reminders.
alter table public.roles add column follow_up_days smallint not null default 0;

create or replace function public.reset_follow_ups()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    new.follow_up_days = 0;
  end if;
  return new;
end $$;
create trigger roles_reset_follow_ups before update of status on public.roles
  for each row execute function public.reset_follow_ups();

create or replace function public.flag_follow_ups()
returns void language plpgsql security definer set search_path = public as $$
declare
  m int;
begin
  foreach m in array array[7, 14] loop
    with due as (
      update public.roles r
         set follow_up_days = m
       where r.status = 'applied'
         and r.follow_up_days < m
         and r.status_changed_at <= now() - make_interval(days => m)
       returning r.user_id, r.id, r.status_changed_at
    )
    insert into public.role_events (user_id, role_id, kind, payload)
    select user_id, id, 'reminder',
           jsonb_build_object('reason', 'follow_up', 'days', m)
      from due;
  end loop;
end $$;
revoke execute on function public.flag_follow_ups() from public, anon, authenticated;

select cron.schedule('follow-ups', '10 1 * * *', $$select public.flag_follow_ups()$$);
