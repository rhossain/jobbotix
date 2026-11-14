# Jobbotix

Jobbotix finds, scores and drafts your job applications. You press send.

Every morning it searches remote job boards, scores each posting against your
profile, writes the cover letter and screening answers for the good ones, and
puts them in a tracker you work through. It never submits an application for you.

## Workspace

Nx monorepo, free-tier infrastructure only.

| Path                | What it is                                                                     |
| ------------------- | ------------------------------------------------------------------------------ |
| `apps/web`          | Angular 22 app (standalone components, signals, Tailwind v4)                   |
| `libs/shared-types` | Types shared by the app and the Edge Functions (`@jobbotix/shared-types`)      |
| `supabase/`         | Postgres migrations with row-level security, Edge Functions (the API), pg_cron |

Hosting: Cloudflare Pages on jobbotix.com. Backend: Supabase. Email: Resend.
Search runs: each user's Claude scheduled task, posting results to the ingest API.

## Develop

```sh
npm install
npm start            # nx serve web  → http://localhost:4200, demo mode (no backend)
npm run start:live   # same, against the hosted Supabase project (real sign-in)
npm test             # unit tests (vitest)
npm run lint
npm run build        # production build to dist/apps/web
npm run db:test      # migrations + row-level-security tests on a throwaway Postgres
```

`apps/web/src/environments/environment.ts` has `demo: true`: the app runs with
no backend, signed in as a demo user, on fictional roles kept in the browser.
Set it to `false` and fill `environment.production.ts` (copy the `.example`)
once a Supabase project exists.

## Design system

The UI is built from tokens and a small kit; pages should not invent their own.

- **Tokens** live in `apps/web/src/tailwind.css`: surfaces, ink, brand, signal,
  status colours, radii, elevation, motion and the type scale, for light and
  dark. `data-theme` on `<html>` switches themes (System / Light / Dark in
  Settings); with no choice the OS decides. `npm test` runs a contrast check on
  the token pairs and a design guard that rejects hard-coded colours, off-scale
  radii and tiny type in templates (`web:test-design`).
- **Type**: Bricolage Grotesque (self-hosted via Fontsource) for everything,
  IBM Plex Mono for codes and keys.
- **Kit**: `apps/web/src/app/ui/` (buttons, match ring, fields, tabs, sheet,
  confirm dialog, toast stack, skeletons, stats, empty states, copy button,
  scaled A4 page). In a development build, `/_ui` shows every component in
  every state.
- **Shell**: `apps/web/src/app/shell/`: sidebar (desktop), icon rail
  (tablet), top bar and bottom tab bar (phones), command palette (⌘K / Ctrl K).
- **Icons**: Lucide, generated into `ui/icons.generated.ts` by
  `node tools/gen-icons.mjs`; add a name to its list to ship another icon.
- Global classes (`jb-card`, `jb-tag`, `jb-chip`, `jb-status`, …) sit in
  Tailwind's components layer, so a utility on an element always wins.

## Deploy

Everything below is one-time setup; after it, `git push` to `main` is the
release (CI runs lint, tests, the database tests and the Deno checks).

### 1. Supabase (free tier)

1. Create a project at supabase.com. The project URL and the **anon** key
   live in `apps/web/src/environments/environment.production.ts` (committed:
   the anon key is public by design). The service-role key never goes anywhere near the app.
2. `npx supabase login`, `npx supabase link --project-ref <ref>`, then
   `npx supabase db push --remote` (all migrations, with RLS, cron jobs and RPCs).
   Without `--remote` the CLI targets a local Docker database, not the project.
3. Enable the `pg_cron`, `pg_net` and `vault` extensions in Database →
   Extensions if `db push` did not.
4. Deploy the functions: `npx supabase functions deploy` (all of
   `ingest-roles list-roles extract-role send-digest tailor-resume
set-anthropic-key draft-letter answer-screening prep-role parse-resume
fetch-sources match-postings score-role research-company list-models draft-thank-you draft-message delete-account set-ai-connection admin-users`).
5. Secrets (Project Settings → Edge Functions): `RESEND_API_KEY`,
   `DIGEST_CRON_SECRET` (any long random string), `APP_URL`
   (`https://jobbotix.com`), `DIGEST_FROM` (`Jobbotix <digest@jobbotix.com>`).
6. Vault (Database → Vault): `project_url` = the project URL, and
   `digest_cron_secret` = the same value as `DIGEST_CRON_SECRET`; the hourly
   digest cron reads both, and so do the `fetch-sources` (every 6 hours) and
   `match-postings` (hourly) crons. `CRON_SECRET` / `cron_secret` may replace
   the digest names; the functions accept either.
7. Resend: add jobbotix.com with the SPF and DKIM records it shows.
8. Sign up first: the first account becomes the admin. Sign-up is invite-only
   until you flip it on `/admin`.

### 2. Cloudflare Pages

Create a Pages project from the GitHub repo with:

- Build command: `npm ci && npx nx build web`
- Output directory: `dist/apps/web/browser`
- Environment variable: `NODE_VERSION=22`

`apps/web/public/_redirects` gives the SPA fallback and `_headers` sets the
security headers, so nothing else is needed. Add `jobbotix.com` and
`www.jobbotix.com` under Custom domains.

### 3. Your scheduled task

On the Search profile page, create an ingest key and press _Generate my
scheduled-task prompt_; paste that prompt into a Claude scheduled task that
runs daily. The run posts to `/functions/v1/ingest-roles` with the key.
`tools/migrate-tracker.mjs` moves rows from the old Job Pipeline artifact into
your account once.

## What runs where

| Need                                          | Where                                                                              | Needs a key? |
| --------------------------------------------- | ---------------------------------------------------------------------------------- | ------------ |
| Find postings (every 6 hours)                 | pg_cron → fetch-sources → each source adapter → shared postings pool               | No           |
| Match and score for each user (hourly)        | pg_cron → match-postings: profile rules, weights; your AI connection re-scores top | Optional     |
| Find, score, draft (legacy, daily)            | Your Claude scheduled task → ingest API                                            | No           |
| Tailored resume, letter, Q&A, prep in the app | Edge Functions with **your** AI key from Vault; local templates without one        | Optional     |
| Digest email                                  | pg_cron → send-digest → Resend                                                     | Resend key   |

## Status

Phases 0–3 are code-complete and run in demo mode (`environment.demo: true`):
every screen works with no backend. The Supabase implementations sit behind
the same repository interfaces and switch on when the project exists. See the
plan and TODO docs for what is left (deployment, domains, first outside user).
