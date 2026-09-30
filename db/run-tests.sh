#!/usr/bin/env bash
# 執行 DB 規則測試（需先套用 migrations 與 seed_dev.sql）。
# 用法：DATABASE_URL=postgres://... bash db/run-tests.sh
set -euo pipefail
: "${DATABASE_URL:?請設定 DATABASE_URL}"
DIR="$(cd "$(dirname "$0")" && pwd)/tests"
for f in "$DIR"/*.sql; do
  echo ">> $(basename "$f")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "DB rule tests: ALL PASS"
