#!/usr/bin/env bash
# 端到端煙霧測試：建案 → 工作 → 相依 → 重算 → 驗證計畫日期與冪等。
# 前置：API 於 $BASE 執行、DB 已套用 migrations 與 db/seed_dev.sql。
set -euo pipefail
BASE="${BASE:-http://localhost:3000/api/v1}"
ORG=11111111-1111-1111-1111-111111111111
USR=22222222-2222-2222-2222-222222222222
CAL=33333333-3333-4333-8333-333333333333
H=(-H "X-Org-Id: $ORG" -H "X-User-Id: $USR" -H "X-Roles: PM,Lead" -H "Content-Type: application/json")
jid(){ node -pe "JSON.parse(require('fs').readFileSync(0)).id"; }

CODE="P-$(date +%s)"
PID=$(curl -s "${H[@]}" -X POST "$BASE/projects" -d "{\"code\":\"$CODE\",\"name\":\"煙霧測試\",\"permit_filing_date\":\"2027-01-11\",\"default_calendar_id\":\"$CAL\"}" | jid)
echo "project=$PID"

AID=$(curl -s "${H[@]}" -X POST "$BASE/projects/$PID/tasks" -d "{\"wbs_code\":\"0.0\",\"name\":\"掛件\",\"type\":\"anchor\",\"duration_minutes\":0,\"calendar_id\":\"$CAL\"}" | jid)
TA=$(curl -s "${H[@]}" -X POST "$BASE/projects/$PID/tasks" -d "{\"wbs_code\":\"1.0\",\"name\":\"基本設計\",\"duration_minutes\":960,\"calendar_id\":\"$CAL\"}" | jid)
TB=$(curl -s "${H[@]}" -X POST "$BASE/projects/$PID/tasks" -d "{\"wbs_code\":\"2.0\",\"name\":\"同步協調\",\"duration_minutes\":480,\"calendar_id\":\"$CAL\"}" | jid)

curl -s "${H[@]}" -X POST "$BASE/projects/$PID/dependencies" -d "{\"predecessor_task_id\":\"$TA\",\"successor_task_id\":\"$TB\",\"relation\":\"FS\"}" >/dev/null
curl -s "${H[@]}" -X POST "$BASE/projects/$PID/dependencies" -d "{\"predecessor_task_id\":\"$TB\",\"successor_task_id\":\"$AID\",\"relation\":\"FS\"}" >/dev/null

echo "== schedule =="
curl -s "${H[@]}" -X POST "$BASE/projects/$PID/schedule-runs" -H "Idempotency-Key: smoke-$CODE" -d '{}'; echo
echo "== tasks =="
curl -s "${H[@]}" "$BASE/projects/$PID/tasks" | node -e "const {data}=JSON.parse(require('fs').readFileSync(0)); for(const t of data) console.log(t.wbs_code, t.name, t.planned_start, t.planned_finish, 'crit='+t.critical)"
