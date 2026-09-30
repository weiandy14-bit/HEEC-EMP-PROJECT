#!/usr/bin/env bash
# 端到端煙霧測試（正例 + 負例）。
# 正例：建案 → 工作 → 相依 → 重算，斷言 schedule.status === "succeeded" 且計畫日期寫回。
# 負例：MFO 限制晚於掛件錨點所允許日期 → 重算必須被拒（scheduling 衝突、不得 succeeded）。
# 任一斷言不成立即以非零結束，使 smoke.sh 與 CI 轉紅。
set -euo pipefail
BASE="${BASE:-http://localhost:3000/api/v1}"
ORG=11111111-1111-1111-1111-111111111111
USR=22222222-2222-2222-2222-222222222222
CAL=33333333-3333-4333-8333-333333333333
H=(-H "X-Org-Id: $ORG" -H "X-User-Id: $USR" -H "X-Roles: PM,Lead" -H "Content-Type: application/json")
jid() { node -pe "JSON.parse(require('fs').readFileSync(0)).id"; }
fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 正例：可行排程應 succeeded
# ---------------------------------------------------------------------------
echo "== positive: feasible schedule =="
CODE="P-$(date +%s)"
PID=$(curl -s "${H[@]}" -X POST "$BASE/projects" \
  -d "{\"code\":\"$CODE\",\"name\":\"煙霧測試\",\"permit_filing_date\":\"2027-01-11\",\"default_calendar_id\":\"$CAL\"}" | jid)
[ -n "$PID" ] && [ "$PID" != "undefined" ] || fail "建立專案失敗"

AID=$(curl -s "${H[@]}" -X POST "$BASE/projects/$PID/tasks" \
  -d "{\"wbs_code\":\"0.0\",\"name\":\"掛件\",\"type\":\"anchor\",\"duration_minutes\":0,\"calendar_id\":\"$CAL\"}" | jid)
TA=$(curl -s "${H[@]}" -X POST "$BASE/projects/$PID/tasks" \
  -d "{\"wbs_code\":\"1.0\",\"name\":\"基本設計\",\"duration_minutes\":960,\"calendar_id\":\"$CAL\"}" | jid)
TB=$(curl -s "${H[@]}" -X POST "$BASE/projects/$PID/tasks" \
  -d "{\"wbs_code\":\"2.0\",\"name\":\"同步協調\",\"duration_minutes\":480,\"calendar_id\":\"$CAL\"}" | jid)
curl -s "${H[@]}" -X POST "$BASE/projects/$PID/dependencies" \
  -d "{\"predecessor_task_id\":\"$TA\",\"successor_task_id\":\"$TB\",\"relation\":\"FS\"}" >/dev/null
curl -s "${H[@]}" -X POST "$BASE/projects/$PID/dependencies" \
  -d "{\"predecessor_task_id\":\"$TB\",\"successor_task_id\":\"$AID\",\"relation\":\"FS\"}" >/dev/null

POS=$(curl -s "${H[@]}" -X POST "$BASE/projects/$PID/schedule-runs" -H "Idempotency-Key: smoke-pos-$CODE" -d '{}')
echo "$POS"
STATUS=$(node -pe "JSON.parse(require('fs').readFileSync(0)).status ?? ''" <<<"$POS")
[ "$STATUS" = "succeeded" ] || fail "正例：期望 status=succeeded，實得：$POS"
# 計畫日期確實寫回（掛件錨點應有 planned_finish）
PLANNED=$(curl -s "${H[@]}" "$BASE/projects/$PID/tasks" \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).data.filter(t=>t.planned_finish).length")
[ "$PLANNED" -ge 3 ] || fail "正例：期望至少 3 筆工作寫回 planned_finish，實得 $PLANNED"
echo "positive OK: status=succeeded, planned tasks=$PLANNED"

# ---------------------------------------------------------------------------
# 負例：MFO 限制晚於掛件錨點所允許日期 → 必須被拒（不得 succeeded）
# ---------------------------------------------------------------------------
echo "== negative: infeasible schedule must be rejected =="
NCODE="N-$(date +%s)"
NPID=$(curl -s "${H[@]}" -X POST "$BASE/projects" \
  -d "{\"code\":\"$NCODE\",\"name\":\"煙霧測試-負例\",\"permit_filing_date\":\"2027-01-11\",\"default_calendar_id\":\"$CAL\"}" | jid)
[ -n "$NPID" ] && [ "$NPID" != "undefined" ] || fail "建立負例專案失敗"
NAID=$(curl -s "${H[@]}" -X POST "$BASE/projects/$NPID/tasks" \
  -d "{\"wbs_code\":\"0.0\",\"name\":\"掛件\",\"type\":\"anchor\",\"duration_minutes\":0,\"calendar_id\":\"$CAL\"}" | jid)
# 基本設計 MFO 於 2027-01-20（晚於掛件 2027-01-11），且 FS 前置掛件 → 不可行
NTA=$(curl -s "${H[@]}" -X POST "$BASE/projects/$NPID/tasks" \
  -d "{\"wbs_code\":\"1.0\",\"name\":\"基本設計\",\"duration_minutes\":480,\"calendar_id\":\"$CAL\",\"constraint_type\":\"MFO\",\"constraint_date\":\"2027-01-20T18:00:00+08:00\"}" | jid)
curl -s "${H[@]}" -X POST "$BASE/projects/$NPID/dependencies" \
  -d "{\"predecessor_task_id\":\"$NTA\",\"successor_task_id\":\"$NAID\",\"relation\":\"FS\"}" >/dev/null

NEG=$(curl -s -o /tmp/neg_body -w "%{http_code}" "${H[@]}" -X POST "$BASE/projects/$NPID/schedule-runs" -H "Idempotency-Key: smoke-neg-$NCODE" -d '{}')
NEG_BODY=$(cat /tmp/neg_body)
echo "HTTP $NEG :: $NEG_BODY"
# 不得 succeeded
if node -e "process.exit(JSON.parse(require('fs').readFileSync('/tmp/neg_body')).status==='succeeded'?0:1)" 2>/dev/null; then
  fail "負例：不可行排程竟然 succeeded（應被拒）：$NEG_BODY"
fi
# 必須為 scheduling 類別的 422 錯誤
[ "$NEG" = "422" ] || fail "負例：期望 HTTP 422，實得 HTTP $NEG（body: $NEG_BODY）"
echo "$NEG_BODY" | grep -q '"category":"scheduling"' || fail "負例：期望 category=scheduling，實得：$NEG_BODY"
echo "negative OK: infeasible schedule rejected (HTTP 422, scheduling conflict)"

echo "SMOKE PASS"
