# Phase 4 驗收追溯

狀態：**Phase 4 已完成驗收**（2026-10-02）。程式版本 `1d005784b31f9060f82937191b71f46282079814`，CI [37025375590](https://github.com/weiandy14-bit/HEEC-EMP-PROJECT/actions/runs/37025375590) `verify=success`。以下結果來自真實 PostgreSQL 與 Chromium；文件收尾提交沿用相同程式版本並再次執行完整 CI。

| 驗收 | 設計 / 實作 | 證據入口 |
|---|---|---|
| A1–A4 | 即時 SQL view、多案/父子/三態/掛件/critical/scope、任務明細 | dashboard_gantt.test.mjs、gantt.test.tsx、dashboard.spec.mjs |
| A5 / G8 | 每案 task keyset、虛擬列、50/500 案與 2.5M 工作 | gantt-layout.test.ts、5000-task E2E、scripts/performance/dashboard.mjs；report.json、EXPLAIN JSON、首屏截圖由 CI 保存 |
| A6 | Today/FS/SS/FF/SF 線、字典名稱篩選、日期/刻度、儲存檢視、需重排/失敗/逾期文字 | gantt-api/timeline/gantt 元件及瀏覽器鍵盤案例 |
| B1–B2 | 四種來源與週工作/里程碑、前本下/ISO 自訂週、案件/責任人、週末另列 | dashboard_weekly.test.mjs、weekly.test.tsx |
| B3 | 來源 dialog、以既有狀態機端點回寫、completed_at/稽核、唯讀能力 | dashboard_weekly 正負完成/來源/IDOR、source dialog E2E |
| B4–B5 | scope/RBAC、跨週期間、source 去重與游標偏移分頁 | dashboard_weekly completion/paging；P3 weekly 測試 |
| C1–C5 | Work 不再乘 Units、工作日分攤/輪廓、容量/在職純日期、真實工作時段衝突、零容量、成本隱藏 | dashboard_workload.test.mjs、calendar.test.ts |
| C6 | 每日需求容量/假期、案件/WBS/指派名稱、衝突起訖、代班/未指派、CSV、名稱篩選/排序/分頁 | workload.test.tsx、dashboard_workload 真實 DB、來源/CSV E2E |
| U1–U4 | 每頁載入/空/錯誤+重試/403 | 三頁元件及 browser 狀態案例 |
| U5 | 甘特排程失敗佔位、weekly 分來源降級、workload 無法計算日曆之資源佔位 | 三頁元件 partial；B/C partial E2E |
| U6 | A 虛擬列+案件/工作分頁；B 每次50項；C 每頁50人/伺服器keyset；未指派另分頁 | phase4-states.test.tsx、Gantt 5000/B/C large E2E |
| U7 | 1280×720/1920×1080、凍結欄、甘特水平捲動/其他容器收斂 | desktop E2E 與 CI 截圖 |
| 基本可及性 | WCAG 2.1 A/AA axe 全頁、文字分級、Esc/焦點、鍵盤收合/導覽 | 每個桌面尺寸的 axe JSON 附件及 keyboard E2E；不等同人工螢幕閱讀器認證 |
| 既有回歸 | lint/typecheck/build/scheduler/web/fresh migrations/seed/DB rules/smoke/integration | CI verify |

## 計算與讀取契約

- 使用即時 SQL，無 Materialized View、無跨請求結果快取。日曆批次查詢結果只在單次請求中使用。
- 週界為 Asia/Taipei，ISO 週驗證含第 53 週是否存在；週末事項另列，保持週一至週五主欄。
- Contour 契約：排序且不重疊的 JSON 陣列 `{start,finish,work_minutes}[]`，總 Work 須等於 planned_work_minutes 且位於指派窗。非法輪廓顯示 data_missing 並使用平均分攤；來源維持可追溯，不靜默消失。
- 平均分攤採工作分鐘累積比例的整數邊界差，讓每日/每週分攤總和守恆。整個指派窗無工作分鐘時以時間比例保留需求，容量仍為零，不將 Work 歸零。
- 同時投入衝突回傳日曆工作窗口內的 UTC 起訖、units/max_units；休息及假日不算衝突。
- 案件篩選減少需求、維持工程師原容量。團隊摘要及 CSV 依可視來源彙總。
- 週工作完成透過原始業務端點，不在 Dashboard 另存一份完成状态。交付物 submitted 才能確認 accepted，補正輪次不覆寫歷史。
- 一般管理/審查/交付/會議/週工作來源的 project scope 收緊為建立者、PM、成員或 Admin；Engineer 週工作更新限本人。
- 單頁祖先及相依邊增加回應筆數；keyset 是即時讀取，並行排序變更後重新載入。效能報告會記錄 payload 和查詢數，不宣稱所有資料一次載入。

## 效能測試契約

典型集 50 active projects × 100 tasks；大型集 500 active projects × 5,000 tasks。首屏讀取 50 案、每案 200 匹配工作並保留祖先、相依；大型另驗單案 5,000 筆完整翻頁。各階段20次HTTP與每桌面20次native Chromium首屏，保存冷啟動樣本、P95、payload、vCPU/RAM/PG版本和實際 SQL EXPLAIN ANALYZE BUFFERS。

CI 硬門檻：典型 50 案 API / 首屏 P95 <3秒。大型資料按上述讀取範圍記錄實測，無擅自增加全量讀取保證。資料生成在獨立測試組織，正式資料不受修改。

正式帳號密碼登入、Cloudflare/Neon 部署與完整 OIDC 安全驗收屬後續階段；Phase 4 使用既有開發身分介面。

### 驗證補強

- 個人甘特檢視保存到 system_settings（org + server-derived user key、版本化歷史與稽核）；Viewer 僅能保存自己的 UI 偏好，不改案件。前端另保留使用者命名空間的本機檢視。
- 日曆採 resource_calendars 優先序選定資源 profile；parent_calendar_id 明確繼承週模式、疊加同日期例外，循環或不可用日曆隔離為該資源的 partial 佔位。
- 指派缺日期保留 unplaced_sources 並標示 data_missing，不把無法分攤的 Work 當成已驗證的零需求。
- 部分來源失敗已追加真實 PG 錯誤的服務測試、日曆循環隔離與甘特失敗排程狀態整合測試。

## 實際驗收結果

| 門檻 | 結果 |
|---|---|
| lint / typecheck / build | 全部通過 |
| scheduler / web 單元 | 49 / 40 通過 |
| 真實 PostgreSQL API 整合 | 96 通過（含權限、IDOR、來源完成、讀寫一致、partial、輪廓與分頁） |
| Native Chromium | 14 通過；1280×720 與 1920×1080，每頁 axe WCAG 2.1 A/AA 與鍵盤/焦點驗證 |
| fresh migration / seed | 19 migrations、seed 通過 |
| G9 / G10 DB 規則、smoke 正負例 | ALL PASS / SMOKE PASS |
| 大型資料 | 500 active projects × 5,000 tasks = 2,500,000；單案 5,000 任務五頁無漏列 |

### P4-A5 / G8 效能證據

CI runner：4 vCPU、約 15.6 GiB RAM、AMD EPYC 9V74、PostgreSQL 16.15。每組 20 次樣本；不是 300 人同時使用的壓測，該項仍屬 Phase 6。

| 實際資料集 | 甘特 API P95 | 1280×720 首屏 P95 | 1920×1080 首屏 P95 | 聚合 SQL 次數 |
|---|---:|---:|---:|---:|
| 50 案 × 100 tasks | 1,076 ms | 368 ms | 426 ms | 5 |
| 500 案 × 5,000 tasks | 1,572 ms | 3,405 ms | 3,411 ms | 5 |

典型範圍 API 與首屏皆低於核定 3 秒門檻。大型範圍首屏約 3.41 秒，按核定規格記錄實測值，未宣稱大型首屏也低於 3 秒。大型首屏 API 讀取 50 案 × 200 候選工作＋祖先＋接觸相依，回應約 5.45 MB；完整資料透過分頁載入。SQL 次數在 limit=1 與 limit=50 一致，無 N+1。大型 task 查詢 EXPLAIN execution time 1,466 ms；主要成本為候選排序與即時 view，其他四查詢各低於 2 ms。保留即時 SQL，不以快取掩蓋查詢成本。

同資料庫中，300 位工程師四週負荷 API P95 67 ms；500 案本週事項（50 項分頁）API P95 322 ms。

永久證據：[原始量測報告](evidence/phase4/performance-report.json)、[SQL 與查詢計畫摘要](evidence/phase4/query-plans.json)。完整 EXPLAIN、兩種桌面截圖、axe 與瀏覽器附件位於上述 CI artifacts，保留 14 日；腳本可重跑產生新證據。`report.commit` 是 GitHub PR merge 測試 SHA，branch head 另記於 provenance。

### 下一階段界線

本頁全部 Phase 4 編號已對應測試與證據。人工輔助科技完整認證、300 人並行壓測、正式 OIDC/Cloudflare/Neon 上線、備份還原演練屬 Phase 6；Microsoft Project 交換屬 Phase 5。現有開發身分介面不代表正式網站已可從外部帳密登入。
