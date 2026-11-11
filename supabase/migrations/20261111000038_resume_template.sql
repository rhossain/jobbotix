-- Resume templates: which look an account's resume is shown, printed and
-- exported in. One choice per account, used for the master and every
-- tailored copy. The app knows the templates; the database only keeps the
-- name, so adding one needs no migration. An unknown name falls back to
-- "classic" in the app.

alter table public.profiles
  add column resume_template text not null default 'classic'
    check (resume_template ~ '^[a-z][a-z0-9_-]{1,30}$');
