# Supabase

Backend for Jobbotix: Postgres with row-level security, Auth, Edge Functions and
pg_cron, all on one free-tier project.

- `migrations/` — SQL migrations, applied in order with `supabase db push --remote`.
  Every table carries `user_id` and an RLS policy; two users must never see
  each other's rows.
- `functions/` — Deno Edge Functions that form the API: `ingest/roles` (receives
  scored roles from a user's scheduled search run), scoring helpers and AI calls
  that need a secret.

Local setup (once the Supabase CLI is installed):

```sh
supabase init          # creates config.toml
supabase start         # local Postgres + Studio
supabase db push --remote   # apply migrations to the linked project
supabase functions serve
```

Generated database types go to `libs/shared-types` with
`supabase gen types typescript --local > libs/shared-types/src/lib/database.types.ts`.
