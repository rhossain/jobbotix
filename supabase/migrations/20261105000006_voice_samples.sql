-- Voice samples are cover letters the user wrote themselves, kept to steer the
-- tone of generated ones. They belong to no role, so role_id becomes optional,
-- but a letter that is not a sample must still point at a role.
alter table public.cover_letters alter column role_id drop not null;
alter table public.cover_letters
  add constraint cover_letters_role_or_sample
  check (voice_sample or role_id is not null);
-- One working draft per role (samples are exempt).
create unique index cover_letters_one_draft_per_role
  on public.cover_letters (role_id) where (not voice_sample);
