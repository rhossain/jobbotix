-- A photo for the resume, and a template per tailored resume.
--
-- The photo is optional and used only by a resume template that shows one.
-- The browser crops and shrinks it to a small JPEG before sending, so it is
-- kept here as text next to the account: no storage bucket, gone with the
-- account, and readable by its owner alone. It is never sent to an AI
-- provider and no admin view reads it.
create table public.resume_photos (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  -- "data:image/jpeg;base64,..." of at most about 150 kB
  data text not null check (
    length(data) between 100 and 200000
    and data ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+=*$'
  ),
  updated_at timestamptz not null default now()
);
create trigger resume_photos_updated_at before update on public.resume_photos
  for each row execute function public.set_updated_at();
alter table public.resume_photos enable row level security;
create policy "resume_photos: own row" on public.resume_photos
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A tailored resume can use another template than the account's own: the
-- right look depends on where the job is. Null means the account's choice.
alter table public.resume_variants
  add column template text
    check (template is null or template ~ '^[a-z][a-z0-9_-]{1,30}$');
