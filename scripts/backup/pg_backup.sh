#!/usr/bin/env bash
# Logical backup of the HEEC EMP database (pg_dump custom format, compressed).
# Usage: DATABASE_URL=postgres://... BACKUP_DIR=/var/backups/heec ./pg_backup.sh
# Managed Postgres (Neon) also provides continuous PITR; this logical dump is a
# portable, restorable complement for off-platform retention and DR drills.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/heec-${ts}.dump"

# -Fc custom format (selective restore + parallel), --no-owner/--no-privileges
# so the dump restores cleanly into a differently-owned target (e.g. Neon).
pg_dump "$DATABASE_URL" -Fc --no-owner --no-privileges -f "$out"

sha256sum "$out" > "$out.sha256"
echo "backup: $out ($(du -h "$out" | cut -f1))"

# Retention: keep the newest N dumps (default 14).
keep="${BACKUP_KEEP:-14}"
ls -1t "$BACKUP_DIR"/heec-*.dump 2>/dev/null | tail -n +$((keep + 1)) | while read -r old; do
  rm -f "$old" "$old.sha256"
  echo "pruned: $old"
done
