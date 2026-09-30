# Phase 4 三頁 Dashboard 計畫

依《MEP Phase 0 架構規格 v0.6》§6/§7/§8/§11。本文件為 **Phase 4 開工前計畫**(尚未實作)。
狀態:計畫提出,待業主確認實作範圍後,再依驗收編號逐項推進。每次失敗依
「重現 → 保存錯誤 → 定位根因 → 最小修復 → 重跑失敗項 → 重跑全部門檻」循環處理,
不得以跳過測試、放寬斷言、刪除案例或停用 CI 通過。

> **業主 2026-09-30 決策**
> - **主交付 = 三頁 Dashboard UI(頁 A / 頁 B / 頁 C)**,含前端呈現;
>   既有**健康度、單案排程、審查 API** 保留作為三頁的**明細資料來源**(不作為主交付)。
> - 交付範圍:目前仍為**計畫文件**;實作範圍待確認,尚未開始 P4-A1。
> - 讀模型:**預設以資料庫即時查詢產生**,確保重新查詢取得**已提交的最新資料**
>   (read-your-writes,無跨請求快取遮蔽)。
> - **實作形式**:可用**一般 SQL View 或參數化查詢**,由**實測結果**擇優;
>   本階段**不使用 Materialized View,亦不使用跨請求結果快取**。
> - **效能升級路徑**:若達不到核定回應時間,**先**優化**索引 → 查詢 → 分頁 → 資料範圍**;
>   仍不足**再提出具「更新時限」的快取方案供核定**,不得逕自導入物化或快取。

---

## 0. 設計原則(貫穿 Phase 4)

- **主交付為三頁 UI**:頁 A/B/C 為前端可操作頁面;後端提供聚合端點 + 沿用既有明細 API。
- **讀寫分離**:僅新增讀模型 / 聚合端點;不改動 Phase 1–3 既有寫入語義。
- **即時查詢(不物化、不快取)**:讀模型預設以資料庫即時查詢產生(read-your-writes),
  以一般 SQL View 或參數化查詢實作,由實測擇優;不用 Materialized View 或跨請求快取。
- **一致語義**:時區 Asia/Taipei、日期半開區間 [start, finish)、健康度與警示分級沿用 P3-07/P3-08、
  週界相交沿用 P3-06。
- **RBAC + 跨案 IDOR**:聚合端點經 org/project scope;跨案彙總僅回可視專案,
  單案跨案存取回 404(不洩存在性),沿用 P3-09。
- **六種前端狀態為一等公民**(每頁皆須實作並驗收):
  `載入 loading / 空 empty / 錯誤 error / 無權限 no-permission / 部分資料 partial / 大資料量 large-volume`。
- **16:9 桌面呈現**:版面以 16:9 桌面(如 1280×720、1920×1080)為主要目標,格線式佈局、
  該視窗比例下無水平捲動、資訊密度可讀。
- **效能升級路徑**:達不到核定回應時間時,先優化索引→查詢→分頁→資料範圍,再提具更新時限之快取方案供核定。
- **前端技術**:框架於開工前確認(建議 React);圖表(甘特、KPI、看板)套用 dataviz 規範。

完成標準:見 §6。每項含正例 + 負例(權限/邊界)+ 真實結果。

---

## 1. 三頁總覽(主交付)

| 頁 | 名稱 | 核心問題 | 明細 API 來源(保留) |
|---|---|---|---|
| **頁 A** | 專案總覽 Portfolio Health | 「哪些案在燒?」跨案健康度與警示 | **健康度 API**(`projects.health`、`alerts`、`deliverables`) |
| **頁 B** | 進度與關鍵路徑 Schedule / CPM | 「這案卡在哪?」關鍵路徑、浮時、Baseline 落後 | **單案排程 API**(`schedule_runs`、`project_tasks`、`task_dependencies`、`baselines`) |
| **頁 C** | 審查・交付・週工作 Compliance & Delivery | 「合規與交付到位?」 | **審查 API**(`project_statutory_reviews`、`deliverables`、`weekly_items`、`meetings`) |

---

## 2. 頁 A 專案總覽(Portfolio Health)

**前端元件**
- KPI 列:專案總數、健康度分布(normal/attention/behind/overdue)、開啟中警示數、逾期交付數。
- 專案表/卡:每案 health、最高未關閉警示、下一法定期限、計畫 vs 實際進度 %、關鍵路徑落後天數。
- 警示彙總(依 severity 分組);篩選(專業/health/負責人)、排序(health desc / 落後天數 desc)。

**API**
- 聚合:`GET /dashboard/portfolio` → `{ kpis, projects[] }`;`GET /dashboard/portfolio/alerts?severity=`
- 明細來源(保留):既有健康度/警示查詢;參數 `?discipline= &health= &sort= &limit= &cursor=`

**資料來源**:`projects.health`、`alerts(state<>'closed')`、`deliverables(status/due_at)`、
`schedule_runs / project_tasks`、`baselines`;即時 view `v_project_dashboard`(每案一列,LATERAL 聚合),
沿用索引 `ix_alerts_project_sev_state`。

**互動狀態**:六種共通狀態(§5)+ filter・sort 即時 + drill-down 點卡進頁 B/C。

**權限**:登入且屬該 org 之任一角色可讀;僅回**使用者可視專案**;他 org/無 scope 專案不出現(不洩)。

**驗收案例(正/負)**

| 編號 | 類型 | 測試輸入 | 預期結果 |
|---|---|---|---|
| P4-A1 | 正 | seed N 案不同 health/警示 | KPI 分布與計數正確 |
| P4-A2 | 正 | 對某案 evaluate behind | 該案 health=behind(與 P3-08 一致) |
| P4-A3 | 正 | `?health=overdue&sort=late_days desc` | 只回逾期案、序正確 |
| P4-A4 | 負(權限/IDOR) | 他 org 專案、無 scope 使用者 | 不出現於彙總;無可視專案 → empty(非錯誤) |
| P4-A5 | 負(效能,補 G8) | ≥50 案彙總單次請求 | 無 N+1、`EXPLAIN` index scan、回應 < 門檻 |

---

## 3. 頁 B 進度與關鍵路徑(Schedule / CPM)

**前端元件**
- 甘特(planned vs baseline vs actual)、關鍵路徑高亮、浮時(total/free)、逾期與 **overCritical** 標記。
- 里程碑/法定錨點;schedule_run 資訊(engineVersion、inputHash、status)。
- 篩選(專業 / 僅關鍵路徑 / 僅逾期);drill:任務 → 明細與前後相依。

**API**
- 聚合:`GET /projects/{p}/dashboard/schedule` →
  `{ run, tasks[](es/ef/ls/lf, totalFloat, freeFloat, critical, overCritical, planned/actual/baseline),
     criticalPath[], milestones[] }`
- 明細來源(保留):既有**單案排程 API**;`GET /projects/{p}/dashboard/schedule/tasks/{t}`;
  `?run_id=` 回放歷史 run(唯讀),預設取最新 published run。

**資料來源**:`schedule_runs`、`project_tasks`、`task_dependencies`、`baselines/baseline_tasks`、
`calendars`;scheduler 純函式輸出(input/result hash 一致)。

**互動狀態**:六種共通狀態(§5)+ filter + drill-down + **stale**(project_tasks 更新晚於最新
schedule_run → 標示需重排)+ 歷史 run 唯讀。

**權限**:具該案 scope 之角色可讀;跨案(A 案 URL 取 B 案 run/task)→ 404(不洩)。

**驗收案例(正/負)**

| 編號 | 類型 | 測試輸入 | 預期結果 |
|---|---|---|---|
| P4-B1 | 正 | 對齊 scheduler 單元 T0x | critical 集合、totalFloat=0 一致 |
| P4-B2 | 正 | 落後任務 | lateDays 與 G9 修正一致(起日不多算) |
| P4-B3 | 正 | 鎖定實績超期 | overCritical=true、負浮時仍回傳(與 G5) |
| P4-B4 | 負(狀態) | 未發布 → 發布後改任務 | 未發布 empty;改任務後標 stale |
| P4-B5 | 負(IDOR) | A 案 URL 取 B 案 run/task | 404 |

---

## 4. 頁 C 審查・交付・週工作(Compliance & Delivery)

**前端元件**
- 法定審查矩陣(逐專業 applicable/N-A/pending + cycle 進度 + 下一期限;N/A 顯示理由)。
- 交付物看板(draft→submitted→accepted/rejected→locked;版本;逾期;locked 唯讀)。
- 週工作清單(`?week=`;跨週相交、逾期置頂、完成回寫);會議列(近期/未結)。

**API**
- 聚合:`GET /projects/{p}/dashboard/compliance` → `{ reviews[], reviewSummary, deliverables[], deliverableSummary }`;
  `GET /projects/{p}/dashboard/weekly?week=`
- 明細來源(保留):既有**審查 API**、交付物、週工作、會議明細(`GET …/reviews/{r}/steps`、`…/deliverables`)。

**資料來源**:`project_statutory_reviews / steps / review_events`、`deliverables`、`weekly_items`、
`meetings`;週界沿用 P3-06 Asia/Taipei 相交邏輯。

**互動狀態**:六種共通狀態(§5)+ week 切換 + filter(專業・狀態)+ drill-down(審查步驟歷史・交付版本)
+ 逾期置頂視覺。

**權限**:具該案 scope 者可讀;Viewer 唯讀可看、寫入(交付/審查)仍 403(沿用 P3-09);跨案 → 404。

**驗收案例(正/負)**

| 編號 | 類型 | 測試輸入 | 預期結果 |
|---|---|---|---|
| P4-C1 | 正 | 各適用性(applicable/N-A/pending) | 矩陣適用性/循環/下一期限正確、N/A 顯理由 |
| P4-C2 | 正 | 各狀態交付 | 看板計數與逾期標示正確;locked 唯讀 |
| P4-C3 | 正 | 跨週+逾期項,查兩週 | 相交兩週皆現、逾期持續置頂(與 P3-06) |
| P4-C4 | 負(權限) | Viewer 於看板寫入 | 讀 200、寫 403 |
| P4-C5 | 負(IDOR) | A 案 URL 取 B 案 compliance/weekly | 404 |

---

## 5. 共通 UI 狀態與 16:9 呈現(每頁皆須實作並驗收)

三頁(A/B/C)各自須實作並通過下列六種狀態與桌面呈現。驗收於前端(可含元件/E2E 測試)與
對應 API 邊界(整合測試)雙層佐證。

| 編號 | 狀態/呈現 | 觸發條件 | 預期行為(每頁) |
|---|---|---|---|
| P4-U1 | 載入 loading | 資料請求進行中 | 顯示骨架/spinner,不阻塞版面,不閃爍空白 |
| P4-U2 | 空 empty | 查詢成功但無資料(無可視專案/未發布排程/該分頁無項目) | 顯示引導訊息,非錯誤樣式 |
| P4-U3 | 錯誤 error | 5xx / 網路失敗 | 顯示錯誤與重試;不顯示殘缺資料當成功 |
| P4-U4 | 無權限 no-permission | 無 org/案 scope、角色不足 | 明確「無權限」訊息;不洩資源存在性(對應 403/404) |
| P4-U5 | 部分資料 partial | 部分子查詢/單案聚合失敗(頁 A) | 失敗區塊佔位標示,其餘正常呈現,不整頁失敗 |
| P4-U6 | 大資料量 large-volume | 高案量/多任務/多交付 | 分頁或虛擬滾動 + 上限保護;回應在門檻內、版面不崩壞 |
| P4-U7 | 16:9 桌面呈現 | 於 16:9 桌面(1280×720、1920×1080) | 格線式佈局、該比例無水平捲動、資訊密度可讀 |

---

## 6. Phase 4 完成定義

Phase 4 視為完成,須同時滿足:

1. **三頁 UI(A/B/C)** 皆可操作,前端元件如各頁所列。
2. 各頁功能正負驗收(P4-A1~A5、P4-B1~B5、P4-C1~C5)通過,含權限與跨案 IDOR 負例。
3. **六種前端狀態**(P4-U1~U6:載入/空/錯誤/無權限/部分資料/大資料量)於**每一頁**實作並驗收。
4. **16:9 桌面呈現**(P4-U7)於每頁達標。
5. 讀模型為即時查詢(read-your-writes),不用 Materialized View/跨請求快取;效能達核定門檻
   (P4-A5 補 Phase 2 遺留缺口 G8),否則依效能升級路徑處理。
6. 後端聚合端點皆 RBAC + org/project scope + 跨案 IDOR 404;新增 `dashboard_*.test.mjs` 整合測試,
   經 `test:integration` glob 自動納入 CI;migration(`0018+`)經 `db/apply.sh` glob 自動納入。
7. 既有 Phase 1–3 門檻(lint / typecheck / test / build / 全新 migration+seed / DB 規則 / smoke /
   整合測試)持續全綠。

---

## 7. 建議里程碑順序

開工前確認前端框架與讀模型 view 邊界 → **頁 A(總覽,給全局)** → **頁 B(排程深掘)** →
**頁 C(合規交付)**;各頁完成即補齊六種狀態與 16:9 呈現,不留待最後。
