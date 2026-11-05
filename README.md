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
npm start            # nx serve web  → http://localhost:4200
npm test             # unit tests (vitest)
npm run lint
npm run build        # production build to dist/apps/web
npm run db:test      # migrations + row-level-security tests on a throwaway Postgres
```

`apps/web/src/environments/environment.ts` has `demo: true`: the app runs with
no backend, signed in as a demo user, on fictional roles kept in the browser.
Set it to `false` and fill `environment.production.ts` (copy the `.example`)
once a Supabase project exists.

## Status

Phase 0 (foundation) is code-complete except for deploying to a Supabase
project. Phase 1 screens (Today, Roles, Board, Role detail, Search profile)
run in demo mode. See the plan and TODO docs for phases and decisions.
