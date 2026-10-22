#!/usr/bin/env bash
# Restore a pg_backup.sh dump into a target database.
# Usage: TARGET_URL=postgres://... ./pg_restore.sh path/to/heec-<ts>.dump
# The target database must already exist and be empty (or use --clean at risk).
set -euo pipefail
: "${TARGET_URL:?set TARGET_URL (destination database)}"
dump="${1:?usage: pg_restore.sh <dump-file>}"
[ -f "$dump" ] || { echo "no such dump: $dump" >&2; exit 1; }

# Verify integrity if a checksum sits next to the dump.
if [ -f "$dump.sha256" ]; then
  (cd "$(dirname "$dump")" && sha256sum -c "$(basename "$dump").sha256")
fi

# --no-owner/--no-privileges to land in a differently-owned target; single txn
# so a partial failure rolls back.
pg_restore --no-owner --no-privileges --exit-on-error --single-transaction \
  -d "$TARGET_URL" "$dump"
echo "restored $dump -> $TARGET_URL"
