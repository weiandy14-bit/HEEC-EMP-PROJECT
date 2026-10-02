# Phase 4 三頁 Dashboard 計畫

依《MEP Phase 0 架構規格 v0.6》§6/§7/§8/§11。本文件為 **已核准的 Phase 4 計畫與驗收基準**。
狀態:實作與驗收進行中;尚未宣告 Phase 4 完成。依驗收編號逐項推進。每次失敗依
「重現 → 保存錯誤 → 定位根因 → 最小修復 → 重跑失敗項 → 重跑全部門檻」循環處理,
不得以跳過測試、放寬斷言、刪除案例或停用 CI 通過。

> **業主決策(累積)**
> - **主交付 = 三頁 Dashboard UI(頁 A / 頁 B / 頁 C)**,含前端呈現。
> - **三頁主題(2026-10-01 更正,為準)**:
>   - **頁 A 專案總控甘特圖**:所有進行中案件於同一時間軸,可展開 WBS、切換日/週/月、
>     檢視 Baseline、實績、關鍵路徑與每案唯一 0.0 建照掛件里程碑。
>   - **頁 B 本週重要事項**:跨案件週一至週五事項,可切換前/本/下週,含交圖、送審、補正、
>     會議、責任人與來源。
>   - **頁 C 工程師未來四週負荷**:工程師 × 週之需求工時、可用工時與負荷率;處理跨案、跨週、
>     部分投入、個人假期、Max Units、零容量,並能展開來源。
>   - 健康度卡、單案排程、審查矩陣**僅保留為摘要或 drill-down,不得替代頁 B、頁 C**。
> - 讀模型:**預設以資料庫即時查詢產生**(read-your-writes);以**一般 SQL View 或參數化查詢**
>   實作,由實測擇優;**不使用 Materialized View 或跨請求結果快取**。
> - 效能:達不到核定回應時間時,先優化**索引 → 查詢 → 分頁 → 資料範圍**,再提具「更新時限」之
>   快取方案供核定。
> - 交付範圍:三頁 UI 與聚合 API 已開始實作;以實際驗收證據判定完成。

---

## 0. 設計原則(貫穿 Phase 4)

- **主交付為三頁 UI**:頁 A/B/C 為前端可操作頁面;後端提供聚合端點 + 沿用既有明細 API 作 drill-down。
- **讀寫分離**:僅新增讀模型 / 聚合端點;不改動 Phase 1–3 既有寫入語義。
- **即時查詢(不物化、不快取)**:讀模型以一般 SQL View 或參數化查詢實作,由實測擇優。
- **一致語義**:時區 Asia/Taipei、日期半開區間 [start, finish)、週界沿用 P3-06、
  工作時間/容量沿用 §7 日曆引擎(`calendar_working_days` + `calendar_exceptions`)。
- **RBAC + 跨案 IDOR**:聚合端點經 org/project/resource scope;跨案彙總僅回可視範圍;
  單案/單資源跨界存取回 404(不洩存在性),沿用 P3-09;成本欄位(cost_rate)受權限控管。
- **六種前端狀態為一等公民**(每頁皆須實作並驗收):
  `載入 loading / 空 empty / 錯誤 error / 無權限 no-permission / 部分資料 partial / 大資料量 large-volume`。
- **16:9 呈現(更正)**:**頁面主框架適配 16:9**;**甘特時間軸可水平捲動,案件/工程師名稱等左側欄固定可見**
  (凍結欄),使多案、長日期區間仍可讀。非甘特區塊於 16:9 主框架內不做非必要水平捲動。
- **前端技術**:已確認 React + Vite;圖表(甘特、矩陣、負荷熱區)套用 dataviz 規範。

完成標準:見 §6。每項含正例 + 負例(權限/邊界)+ 真實結果。

---

## 1. 三頁總覽(主交付)

| 頁 | 名稱 | 必須交付的主功能 | 摘要/drill-down(不可替代主功能) |
|---|---|---|---|
| **頁 A** | 專案總控甘特圖 | 所有進行中案件同一時間軸;WBS 展開;日/週/月切換;Baseline/實績/關鍵路徑/掛件里程碑 | 單案排程 API 作單案 drill-down;健康度作案件狀態標記 |
| **頁 B** | 本週重要事項 | 跨案件週一至週五事項;前/本/下週切換;交圖/送審/補正/會議 + 責任人 + 來源 | 審查矩陣、交付明細作來源 drill-down |
| **頁 C** | 工程師未來四週負荷 | 工程師 × 週之需求/可用工時與負荷率;跨案/跨週/部分投入/個人假期/Max Units/零容量;展開來源 | 單案排程/指派明細作來源 drill-down |

---

## 2. 頁 A 專案總控甘特圖(Multi-project Master Gantt)

**前端元件**
- 多案甘特:左側**凍結欄**(案件 → WBS 樹,可展開/收合);右側時間軸 bar,**可水平捲動**。
- 每任務三態 bar:planned / baseline / actual(逾期以色標);關鍵路徑高亮。
- **掛件里程碑**取每案 `projects.permit_filing_date` 與唯一 0.0 錨點工作;法定審查期限另列審查事件,不可冒充掛件日。里程碑以菱形及文字標示。
- 縮放切換 **日 / 週 / 月**;時間範圍選取;Today 線;工作相依線;篩選(案件、PM、專業、工程師、狀態、日期區間);儲存個人檢視。
- 摘要:每案健康度標記(drill-down 進單案排程)。

**API**
- 聚合:`GET /dashboard/gantt?zoom=day|week|month&from=&to=&status=in_progress&discipline=&pm_id=&resource_id=&project_id=&cursor=`
  → `{ projects[]{ id, name, health, tasks[]{ id, parent_id, wbs_path, name, critical,
       planned{start,finish}, baseline{start,finish}, actual{start,finish} }, dependencies[], milestones[] } }`
- 掛件里程碑 `kind=permit_filing` 且每案唯一;審查事件 `kind=review_due` 且可依篩選顯示;儲存檢視存使用者偏好,不得寫死案件。
- Drill-down(保留):`GET /projects/{p}/dashboard/schedule`(單案排程,含浮時/overCritical/相依)、
  `…/schedule/tasks/{t}`。

**資料來源**:`projects(status 進行中)`、`project_tasks(parent_id 階層、planned/actual)`、
`baselines/baseline_tasks`、`task_dependencies`(關鍵路徑,取自 scheduler 輸出/schedule_runs)、
`projects.permit_filing_date`/唯一 0.0 錨點(掛件里程碑)、`project_statutory_reviews`(獨立審查期限);
即時 view 或參數化查詢(每任務一列,併 baseline/actual)。

**互動狀態**:六種共通狀態(§5)+ WBS 展開/收合 + 日/週/月縮放 + 時間軸水平捲動(名稱欄凍結)
+ Today 線/相依線/菱形里程碑/儲存檢視 + drill-down 單案 + stale(任務變更晚於最新 schedule_run → 標示需重排)。

**權限**:登入該 org 具案件 scope 之角色可讀;僅顯示**可視進行中案件**;他 org/無 scope 案件不出現;
跨案 task drill-down → 404。

**驗收案例(正/負)**

| 編號 | 類型 | 測試輸入 | 預期結果 |
|---|---|---|---|
| P4-A1 | 正 | 多個進行中案件、各有 WBS 父子任務 | 同一時間軸列出各案;WBS 樹可展開;每任務含 planned/baseline/actual bar |
| P4-A2 | 正+邊界 | `zoom=day/week/month`;同案審查期限與掛件日不同 | 時間刻度正確;唯一 0.0 掛件菱形位於 `permit_filing_date`,審查期限為另一事件,不覆寫掛件日 |
| P4-A3 | 正 | 有關鍵路徑與落後實績之案 | 關鍵路徑高亮與 scheduler critical 一致;Baseline vs 實績對比正確 |
| P4-A4 | 負(權限/IDOR) | 他 org/無 scope 案件、跨案 task drill-down | 不出現於甘特;跨案 drill-down → 404 |
| P4-A5 | 效能(補 G8) | 50 案典型範圍與 500 active projects/單案最多 5,000 tasks 之資料集 | 分頁/虛擬化、範圍限制、無 N+1;典型 50 案首屏 P95 <3s,大資料集按核定查詢範圍實測並記錄 P95/查詢計畫;不以必有 index scan 作唯一標準 |
| P4-A6 | UI/互動 | Today 線、FS/SS 等相依、PM/工程師篩選、儲存檢視後重開 | 時間軸與相依線正確;篩選範圍正確;檢視可還原;鍵盤可操作且狀態有文字標籤 |

---

## 3. 頁 B 本週重要事項(Cross-project Weekly Priorities)

**前端元件**
- 週一至週五欄(跨所有可視案件),每格列事項卡:**類型(交圖/送審/補正/會議)**、標題、
  **所屬案件**、**責任人**、**來源**(可 drill-down 至原始交付/審查步驟/會議)。
- **前/本/下週**切換(Asia/Taipei 週界);逾期未完成置頂並持續顯示;完成回寫。
- 篩選(類型、案件、責任人)。

**API**
- 聚合:`GET /dashboard/weekly?week=prev|this|next|<YYYY-Www>&type=&assignee=`
  → `{ weekStart, weekEnd, items[]{ id, type(交圖|送審|補正|會議), title, project_id, project_name,
       assignee_id, assignee_name, source{kind,id}, due_at, status, overdue } }`
- Drill-down(保留):`GET …/reviews/{r}/steps`(送審/補正)、`…/deliverables`(交圖)、`…/meetings`(會議)。

**資料來源**:`weekly_items`(跨案彙整;type、source_key、period_start/end、due_at、status、owner)、
並由 `deliverables`(交圖 due)、`project_statutory_review_steps`(送審/補正 planned/due)、
`meetings`(會議 starts_at)衍生;週界與跨週相交沿用 P3-06。

**互動狀態**:六種共通狀態(§5)+ 前/本/下週切換 + filter + drill-down 來源 + 逾期置頂視覺。

**權限**:具案件 scope 者可讀,僅回**可視案件**之事項;Viewer 唯讀;無 scope 案件事項不出現。

**驗收案例(正/負)**

| 編號 | 類型 | 測試輸入 | 預期結果 |
|---|---|---|---|
| P4-B1 | 正 | 多案於本週各有 交圖/送審/補正/會議 | 週一至五彙整跨案事項,每項含類型、案件、責任人、來源 |
| P4-B2 | 正 | `week=prev/this/next` | 週界(Asia/Taipei 週一–週五)正確;事項落於對應週 |
| P4-B3 | 正 | 逾期未完成項 + 完成回寫 | 逾期持續顯示且置頂;標記完成後狀態更新、次週不再逾期顯示 |
| P4-B4 | 負(權限) | Viewer 讀取、無 scope 案件事項 | Viewer 讀 200;無 scope 案件事項不出現 |
| P4-B5 | 負(邊界) | 期間橫跨兩週之項、同來源觸發兩次 | 相交各週皆現;同 `source_key` 去重僅一列(不以 source_key 決定週別) |

---

## 4. 頁 C 工程師未來四週負荷(Engineer 4-Week Workload)

**前端元件**
- 矩陣:**工程師(列)× 未來四週(欄)**,每格顯示 **需求工時 / 可用工時 / 負荷率**,
  以熱區色標與文字/數字共同標示**正常 0–80%、偏高 >80–100%、超載 >100%**;零容量及資料缺漏另列狀態。
- 展開來源:點格列出貢獻**來源**(案件、任務、指派工時、`assignment_units`、booking_type)。
- 展開來源須能進一步查看每日工時/容量、假期、相同時段的衝突;未指派工作另列待分派清單,代班指派保留原指派歷史。
- 篩選/排序(團隊、工程師、案件);團隊容量/需求彙總、匯出;切換起始週。

**API**
- 聚合:`GET /dashboard/workload?from_week=<YYYY-Www>&weeks=4&team_id=&resource_id=`
  → `{ weeks[], resources[]{ resource_id, name, max_units, cells[]{ week, demand_minutes,
       capacity_minutes, load_rate, flags[over_allocated|simultaneous_conflict|zero_capacity|on_leave],
       sources[]{ project_id, task_id, minutes, assignment_units, booking_type } } } }, unassigned[], teamSummary[] }`
- Drill-down:`GET /dashboard/workload/resources/{resource_id}?week=<YYYY-Www>` 回每日容量/需求、假期、案件/WBS/指派與同時段衝突;匯出沿用可視 scope。
- 說明:`load_rate = demand_minutes / capacity_minutes`(API 比率,UI 顯示百分比);`capacity_minutes = 0` 時不除以零,
  回 `load_rate=null` 並置 `zero_capacity`(若 `demand>0` 另置 `over_allocated`)。

**資料來源**(即時查詢,view `v_resource_week_load` 或參數化查詢):
- 需求:`resource_assignments`(`planned_work_minutes`/`remaining_work_minutes`、`assignment_start/finish`、
  `contour` 逐期曲線;無 contour 則按窗內工作時間平均攤配到週)、跨 `project_id` 聚合(跨案)。
- 可用:`resources.max_units` × 由 `resource_calendars` → `calendars` / `calendar_working_days` /
  `calendar_exceptions` 逐日求得之工作分鐘(個人假期以 exception `available_minutes=0` 表示);
  `resources.active_from/to` 界定在職區間。
- 部分投入:`assignment_units < 1.0` 只限制該指派同時投入比例,不可對 `planned_work_minutes` 再乘一次;
  每週主狀態依需求 Work / 可用容量判定。另按實際**重疊工作時段**彙總有效指派 units 與當時 Max Units,
  超限才標示「同時投入衝突」;不同日指派不得把 units 相加誤判。代班另建有效期間的 assignment;
  未指派工作不灌入任何工程師負荷,列為資料品質待分派。

**互動狀態**:六種共通狀態(§5)+ 起始週切換 + filter + drill-down 來源 + 超載/零容量/請假標記。

**權限**:具 org 且資源可視範圍者可讀;僅回可視工程師與可視案件之貢獻;跨 org 工程師不出現(不洩);
`cost_rate`/成本欄位僅具權限者可見。

**驗收案例(正/負)**

| 編號 | 類型 | 測試輸入 | 預期結果 |
|---|---|---|---|
| P4-C1 | 正(基準) | 一工程師、單案、單週指派 8h;該週日曆可用 40h | 該格 demand=8h、capacity=40h、load_rate=0.2 |
| P4-C2 | 正(跨案/跨週) | 一工程師跨兩案,指派窗橫跨兩週 | 需求正確分攤至各案各週;展開來源列出各案/任務工時與 units |
| P4-C3 | 正+邊界(部分投入/Max Units) | `assignment_units=0.5`;週一與週二各 100% 指派;另兩筆同時段各 75% 指派且 Max Units=1 | 需求 Work 僅計一次;不同日不產生同時投入衝突;重疊時段 150% 才標衝突;週負荷率仍依 Work/容量計 |
| P4-C4 | 邊界(個人假期/零容量) | 個人日曆該週假期(exception=0)使可用降低;另一週 max_units=0 或無工作日 | 可用工時反映假期;零容量週 `capacity=0`、`load_rate=null`、置 `zero_capacity`;需求>0 再置 `over_allocated`(不除以零) |
| P4-C5 | 負(權限/IDOR) | 跨 org 工程師、無成本權限者 | 跨 org 工程師不出現;`cost_rate` 不外洩;越權查詢 → 404/欄位隱藏 |
| P4-C6 | UI/資料品質 | 週負荷分別為 80%、90%、110%;未指派工作及代班;點工程師週格 | 正常/偏高/超載以文字、百分比及色階表示;未指派另列;代班保留雙方歷史;可追溯每日/案件/WBS/指派來源並匯出可視資料 |

---

## 5. 共通 UI 狀態與 16:9 呈現(每頁皆須實作並驗收)

三頁(A/B/C)各自須實作並通過下列六種狀態與桌面呈現。驗收於前端(元件/E2E)與
對應 API 邊界(整合測試)雙層佐證。

| 編號 | 狀態/呈現 | 觸發條件 | 預期行為(每頁) |
|---|---|---|---|
| P4-U1 | 載入 loading | 資料請求進行中 | 顯示骨架/spinner,不阻塞版面,不閃爍空白 |
| P4-U2 | 空 empty | 查詢成功但無資料(無進行中案件/本週無事項/無在職工程師) | 顯示引導訊息,非錯誤樣式 |
| P4-U3 | 錯誤 error | 5xx / 網路失敗 | 顯示錯誤與重試;不顯示殘缺資料當成功 |
| P4-U4 | 無權限 no-permission | 無 org/案/資源 scope、角色不足 | 明確「無權限」訊息;不洩資源存在性(對應 403/404) |
| P4-U5 | 部分資料 partial | 部分案件/資源聚合失敗 | 失敗區塊佔位標示,其餘正常呈現,不整頁失敗 |
| P4-U6 | 大資料量 large-volume | 多案 × 多任務(頁 A)、多工程師(頁 C) | 分頁/虛擬滾動 + 範圍限制;回應在門檻內、版面不崩壞 |
| P4-U7 | 16:9 呈現 | 於 16:9 桌面(1280×720、1920×1080) | 主框架適配 16:9;**甘特/矩陣時間軸可水平捲動,左側名稱欄凍結可見**;非捲動區不溢出 |

---

## 6. Phase 4 完成定義

Phase 4 視為完成,須同時滿足:

1. **三頁 UI(A/B/C)** 皆可操作,主功能與各頁前端元件相符
   (頁 A 多案總控甘特、頁 B 跨案本週事項、頁 C 工程師四週負荷)。
2. 各頁功能正負驗收(P4-A1~A6、P4-B1~B5、**P4-C1~C6 含工程師負荷之跨案/跨週/部分投入/個人假期/
   Max Units/零容量**)通過,含權限與跨案 IDOR 負例。
3. **六種前端狀態**(P4-U1~U6)於**每一頁**實作並驗收。
4. **16:9 呈現**(P4-U7):主框架適配 16:9,甘特/矩陣時間軸可水平捲動且名稱欄凍結。
5. 讀模型為即時查詢(read-your-writes),不用 Materialized View/跨請求快取;效能達核定門檻
   (P4-A5 補 Phase 2 遺留缺口 G8),否則依效能升級路徑處理。
6. 後端聚合端點皆 RBAC + org/project/resource scope + 跨案 IDOR 404;新增 `dashboard_*.test.mjs`
   整合測試,經 `test:integration` glob 自動納入 CI;migration(`0018+`)經 `db/apply.sh` glob 自動納入。
7. 既有 Phase 1–3 門檻(lint / typecheck / test / build / 全新 migration+seed / DB 規則 / smoke /
   整合測試)持續全綠。

---

## 7. 建議里程碑順序

開工前確認前端框架與讀模型 view 邊界 → **頁 A(多案總控甘特,建立時間軸與 WBS 基礎)** →
**頁 C(工程師負荷,資源/日曆/指派計算最關鍵)** → **頁 B(跨案本週事項)**;
各頁完成即補齊六種狀態與 16:9 呈現,不留待最後。

> 順序說明:頁 C 的容量/需求計算風險最高,故列於頁 B 之前優先驗證;若業主偏好先出跨案事項,
> 可調整為 A → B → C。
