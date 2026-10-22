#!/usr/bin/env bash
# Disaster-recovery drill: back up the source DB, restore it into a throwaway
# scratch database, verify core tables are populated and the schema version is
# present, then drop the scratch DB. Proves a dump is actually restorable.
#
# Usage: DATABASE_URL=postgres://.../empdb ADMIN_URL=postgres://.../postgres \
#        ./restore_drill.sh
#   DATABASE_URL : the live database to back up and verify against.
#   ADMIN_URL    : a maintenance connection (e.g. the 'postgres' database) used
#                  to CREATE/DROP the scratch database. Defaults to DATABASE_URL
#                  with the database name swapped to 'postgres'.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
here="$(cd "$(dirname "$0")" && pwd)"
scratch="heec_drill_$(date -u +%Y%m%d%H%M%S)"
ADMIN_URL="${ADMIN_URL:-$(echo "$DATABASE_URL" | sed -E 's#/[^/?]+(\?|$)#/postgres\1#')}"

# Build a target URL for the scratch DB by replacing the database name.
scratch_url="$(echo "$DATABASE_URL" | sed -E "s#/[^/?]+(\?|\$)#/${scratch}\1#")"

cleanup() { psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS \"$scratch\"" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo ">> backing up source"
BK="$(mktemp -d)"
trap 'cleanup; rm -rf "$BK"' EXIT
BACKUP_DIR="$BK" "$here/pg_backup.sh"
dump="$(ls -1t "$BK"/heec-*.dump | head -1)"
[ -n "$dump" ] || { echo "FAIL: backup produced no dump" >&2; exit 1; }
echo ">> dump: $dump"

echo ">> creating scratch database $scratch"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"$scratch\""

echo ">> restoring into scratch"
TARGET_URL="$scratch_url" "$here/pg_restore.sh" "$dump"

echo ">> verifying"
orgs="$(psql "$scratch_url" -tAc "SELECT count(*) FROM organizations")"
tables="$(psql "$scratch_url" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")"
policies="$(psql "$scratch_url" -tAc "SELECT count(*) FROM pg_policies WHERE policyname='org_isolation'")"
echo "   organizations=$orgs base_tables=$tables rls_policies=$policies"
[ "$orgs" -ge 1 ] || { echo "FAIL: no organizations restored" >&2; exit 1; }
[ "$tables" -ge 50 ] || { echo "FAIL: unexpected table count" >&2; exit 1; }
[ "$policies" -ge 1 ] || { echo "FAIL: RLS policies missing after restore" >&2; exit 1; }
echo "RESTORE DRILL PASS"
