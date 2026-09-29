#!/usr/bin/env bash
# 依序套用所有 migrations。用法：DATABASE_URL=postgres://... ./db/apply.sh
set -euo pipefail
: "${DATABASE_URL:?請設定 DATABASE_URL}"
DIR="$(cd "$(dirname "$0")" && pwd)/migrations"
for f in "$DIR"/*.sql; do
  echo ">> $(basename "$f")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "migrations applied."
