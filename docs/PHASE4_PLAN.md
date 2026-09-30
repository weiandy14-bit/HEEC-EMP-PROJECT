# Phase 4 三頁 Dashboard 計畫

依《MEP Phase 0 架構規格 v0.6》§6/§7/§8/§11。本文件為 **Phase 4 開工前計畫**(尚未實作)。
狀態:計畫提出,待業主確認實作範圍後,再依 P4-01～P4-15 逐項推進。每次失敗依
「重現 → 保存錯誤 → 定位根因 → 最小修復 → 重跑失敗項 → 重跑全部門檻」循環處理,
不得以跳過測試、放寬斷言、刪除案例或停用 CI 通過。

> **業主 2026-09-30 決策**
> - 交付範圍:**先只出計畫文件**(本文件);實作範圍另行確認。
> - 讀模型實作:**預設以資料庫即時查詢產生**,確保重新查詢可取得**已提交的最新資料**
>   (read-your-writes,無跨請求快取遮蔽)。
> - **實作形式**:可使用**一般 SQL View 或參數化查詢**,由**實測結果**決定何者較適;
>   本階段**不使用 Materialized View,亦不使用跨請求結果快取**。
> - **效能升級路徑**:若未來達不到核定的回應時間,**先**優化**索引 → 查詢 → 分頁 → 資料範圍**;
>   仍不足時**再提出「具更新時限」的快取方案供核定**,不得逕自導入物化或快取。

---

## 0. 設計原則(貫穿 Phase 4)

- **讀寫分離**:Dashboard 僅新增「讀模型 / 聚合端點」,不改動 Phase 1–3 既有寫入語義。
- **一致語義**:時區 Asia/Taipei、日期半開區間 [start, finish)、健康度與警示分級沿用 P3-07/P3-08、
  週界相交沿用 P3-06。
- **即時查詢(不物化、不快取)**:讀模型**預設以資料庫即時查詢產生**,重新查詢即取得已提交最新資料
  (read-your-writes)。實作形式為**一般 SQL View 或參數化查詢**,由**實測**擇優;本階段
  **不使用 Materialized View,亦不使用跨請求結果快取**。故無 stale 快取問題:D2 的「stale」指
  **排程結果相對任務變更過期**(schedule_run 與 project_tasks 更新時間比較),非讀取快取過期。
- **效能升級路徑(政策)**:若達不到核定回應時間,**先**優化**索引 → 查詢 → 分頁 → 資料範圍**;
  仍不足**再提出具「更新時限」的快取方案供核定**,不得逕自導入物化視圖或跨請求快取。
  P4-05 的效能門檻即以此路徑驗證(先以索引與單次查詢達標)。
- **RBAC + 跨案 IDOR**:所有聚合端點經 org/project scope;跨案彙總僅回使用者可視專案,
  單案跨案存取回 404(不洩存在性),沿用 P3-09。
- **效能**:跨案彙總以單次查詢(GROUP BY / LATERAL)完成,禁 N+1;必要索引以 migration `0018+` 補上;
  以 `EXPLAIN` 斷言採 index scan。此頁補上 Phase 2 遺留缺口 **G8(多案效能)**。
- **互動狀態統一**:`loading / empty / error / partial(降級) / filter / drill-down / stale(結果過期)`。
- **前端**:圖表(甘特、KPI、看板)實作時套用 dataviz 規範;本階段可先交付可整合測試之聚合 API 層,
  UI 為後續子任務。

完成標準:lint / typecheck / test / build / 全新 DB migration＋seed / DB 規則測試 / smoke /
Phase 3+4 整合測試在 CI 全綠;每項含正例 + 邊界或負例 + 真實結果。

---

## 1. 三頁總覽

| 頁 | 名稱 | 核心問題 | 主要資料來源 |
|---|---|---|---|
| **D1** | 專案總覽 Portfolio Health | 「哪些案在燒?」跨案健康度與警示 | `projects.health`、`alerts`、`deliverables`、`schedule_runs` |
| **D2** | 進度與關鍵路徑 Schedule / CPM | 「這案卡在哪?」關鍵路徑、浮時、Baseline 落後 | `schedule_runs`、`project_tasks`、`task_dependencies`、`baselines` |
| **D3** | 審查・交付・週工作 Compliance & Delivery | 「合規與交付到位?」 | `project_statutory_reviews`、`deliverables`、`weekly_items`、`meetings` |

---

## 2. D1 專案總覽(Portfolio Health)

**頁面元件**
- KPI 列:專案總數、健康度分布(normal/attention/behind/overdue)、開啟中警示數、逾期交付數。
- 專案表/卡:每案 health、最高未關閉警示、下一法定期限、計畫 vs 實際進度 %、關鍵路徑落後天數。
- 警示彙總(依 severity 分組)。
- 篩選:專業、health、負責人;排序:health desc / 落後天數 desc。

**API(GET, v1)**
- `GET /dashboard/portfolio` → `{ kpis, projects[] }`
- `GET /dashboard/portfolio/alerts?severity=` → 跨案未關閉警示
- 參數:`?discipline= &health= &sort= &limit= &cursor=`(游標分頁)

**資料來源**:`projects.health`、`alerts(state<>'closed')`、`deliverables(status/due_at)`、
`schedule_runs / project_tasks`、`baselines`;新增即時 view `v_project_dashboard`(每案一列彙總,
以 LATERAL 子查詢聚合),沿用索引 `ix_alerts_project_sev_state`。

**互動狀態**:loading 骨架 / empty(無可視專案) / error(503→重試) /
**partial**(單案聚合失敗以佔位標示,不整頁失敗) / filter・sort 即時 / drill-down 點卡進 D2·D3。

**驗收案例**

| 編號 | 功能 | 資料表·API | 測試輸入 | 預期結果 | 完成定義 |
|---|---|---|---|---|---|
| P4-01 | KPI 彙總 | `v_project_dashboard` / `GET /dashboard/portfolio` | seed N 案不同 health/警示 | 分布與計數正確 | 正例通過 |
| P4-02 | 健康度即時 | 同上 | 對某案 evaluate behind | 該案 health=behind(與 P3-08 一致) | 正例通過 |
| P4-03 | 篩選/排序 | 同上 `?health= &sort=` | health=overdue、sort=late_days desc | 只回逾期案、序正確 | 正+邊界 |
| P4-04 | RBAC/IDOR | 同上 | 他 org 專案 | 不出現於彙總(不洩存在性) | 負例通過 |
| P4-05 | **效能(補 G8)** | 同上 | ≥50 案彙總單次請求 | 無 N+1、`EXPLAIN` 為 index scan、回應 < 門檻 | 效能邊界通過 |

---

## 3. D2 進度與關鍵路徑(Schedule / CPM)

**頁面元件**
- 甘特(planned vs baseline vs actual)、關鍵路徑高亮、浮時(total/free)、逾期與 **overCritical** 標記。
- 里程碑/法定錨點;schedule_run 資訊(engineVersion、inputHash、status)。
- 篩選:專業 / 僅關鍵路徑 / 僅逾期;drill:任務 → 明細與前後相依。

**API**
- `GET /projects/{p}/dashboard/schedule` →
  `{ run, tasks[](es/ef/ls/lf, totalFloat, freeFloat, critical, overCritical, planned/actual/baseline),
     criticalPath[], milestones[] }`
- `GET /projects/{p}/dashboard/schedule/tasks/{t}` → 單任務明細 + 前後相依
- `?run_id=` 回放歷史 run(唯讀);預設取最新 published run。

**資料來源**:`schedule_runs`(最新/指定)、`project_tasks`、`task_dependencies`、
`baselines/baseline_tasks`、`calendars`;scheduler 純函式輸出(input/result hash 一致)。

**互動狀態**:loading / empty(未跑排程→提示先發布) / error /
**stale**(project_tasks 更新時間晚於最新 schedule_run→標示需重排) / filter / drill-down /
歷史 run 唯讀。

**驗收案例**

| 編號 | 功能 | 資料表·API | 測試輸入 | 預期結果 | 完成定義 |
|---|---|---|---|---|---|
| P4-06 | 關鍵路徑一致 | `GET …/dashboard/schedule` | 對齊 scheduler 單元 T0x | critical 集合、totalFloat=0 一致 | 與單元對照 |
| P4-07 | Baseline 落後 | 同上 | 落後任務 | lateDays 與 G9 修正一致(起日不多算) | 正例通過 |
| P4-08 | overCritical | 同上 | 鎖定實績超期 | overCritical=true、負浮時仍回傳(與 G5) | 正例+對照 |
| P4-09 | empty/stale | 同上 | 未發布 → 發布後改任務 | 未發布回 empty;改任務後標 stale | 狀態案例 |
| P4-10 | IDOR | `…/tasks/{t}` | A 案 URL 取 B 案 run/task | 404 | 負例通過 |

---

## 4. D3 審查・交付・週工作(Compliance & Delivery)

**頁面元件**
- 法定審查矩陣(逐專業 applicable/N-A/pending + cycle 進度 + 下一期限;N/A 顯示理由)。
- 交付物看板(draft→submitted→accepted/rejected→locked;版本;逾期;locked 唯讀)。
- 週工作清單(`?week=`;跨週相交、逾期置頂、完成回寫)。
- 會議列(近期/未結)。

**API**
- `GET /projects/{p}/dashboard/compliance` → `{ reviews[], reviewSummary, deliverables[], deliverableSummary }`
- `GET /projects/{p}/dashboard/weekly?week=` → 沿用 P3-06 顯示規則 + 會議彙整
- 明細沿用既有 `GET …/reviews/{r}/steps`、`…/deliverables`。

**資料來源**:`project_statutory_reviews / steps / review_events`、`deliverables`、`weekly_items`、
`meetings`;週界沿用 P3-06 Asia/Taipei 相交邏輯。

**互動狀態**:loading / empty(單分頁無資料) / error / week 切換 / filter(專業・狀態) /
drill-down(審查步驟歷史・交付版本) / 逾期置頂視覺。

**驗收案例**

| 編號 | 功能 | 資料表·API | 測試輸入 | 預期結果 | 完成定義 |
|---|---|---|---|---|---|
| P4-11 | 審查矩陣 | `GET …/dashboard/compliance` | 各適用性(applicable/N-A/pending) | 適用性/循環/下一期限正確、N/A 顯理由 | 正例通過 |
| P4-12 | 交付看板統計 | 同上 | 各狀態交付 | 計數與逾期標示正確;locked 唯讀 | 正+邊界 |
| P4-13 | 週工作彙整 | `GET …/dashboard/weekly?week=` | 跨週+逾期項,查兩週 | 相交兩週皆現、逾期持續置頂(與 P3-06) | 正例通過 |
| P4-14 | 完成回寫 | 同上 | accept 交付 / done 週項 | 看板即時反映(即時查詢無延遲) | 正例通過 |
| P4-15 | IDOR/RBAC | compliance/weekly | 跨案、Viewer 寫入 | 跨案 404;Viewer 讀 200、寫 403(沿用) | 負例通過 |

---

## 5. 共通交付與完成定義

- 讀模型以 `0018+` migration 建立即時 `v_*` view 與必要索引;**不物化、不快取**;不改寫既有寫入。
- 聚合端點皆 RBAC + org/project scope + 跨案 IDOR 404。
- 新增 `dashboard_*.test.mjs` 整合測試,經 `test:integration` glob 自動納入 CI;
  migration 經 `db/apply.sh` glob 自動納入。
- **P4-05 補上 Phase 2 遺留缺口 G8(多案效能)**。
- 前端圖表為後續子任務,套用 dataviz 規範(色彩、KPI、甘特、看板)。
- 全部門檻全綠方標記完成;失敗依既定循環處理。

## 6. 建議里程碑順序

開工前確認讀模型 view 邊界 → **D1(總覽,給全局)** → **D2(排程深掘)** → **D3(合規交付)** →
前端 UI(如納入範圍)。

## 7. Phase 4 總完成定義

P4-01～P4-15 各正負例測試通過並納入 CI;既有 Phase 1–3 門檻持續全綠;
三頁之聚合端點、RBAC/IDOR、效能(G8)、互動狀態語義皆有正負例佐證。
