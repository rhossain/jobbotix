#!/usr/bin/env bash
# Applies the migrations to a throwaway PostgreSQL 16 and runs the RLS tests.
# Needs the postgres binaries on PATH or at /usr/lib/postgresql/16/bin.
# Usage: npm run db:test
set -euo pipefail

PGBIN="${PGBIN:-$(dirname "$(command -v initdb 2>/dev/null || echo /usr/lib/postgresql/16/bin/initdb)")}"
PORT="${PGPORT_TEST:-5499}"
DATA="$(mktemp -d)/pg"
SOCK="$(mktemp -d)"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() { "$PGBIN/pg_ctl" -D "$DATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$(dirname "$DATA")" "$SOCK"; }
trap cleanup EXIT


"$PGBIN/initdb" -D "$DATA" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -l "$DATA/log" start >/dev/null
PSQL=("$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -f "$ROOT/supabase/tests/stub-auth.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "applying $(basename "$f")"
  # pg_cron is stubbed; skip its extension lines on plain Postgres
  sed -e 's/^create extension if not exists pg_cron.*$//' -e 's/^grant usage on schema cron to postgres;$//' "$f" | "${PSQL[@]}"
done
"${PSQL[@]}" -f "$ROOT/supabase/tests/rls.sql"
