# Phase 4 驗收追溯

狀態：功能收尾已實作，等待本批 CI、真實 DB / 瀏覽器 / 效能實測。此狀態不代表已驗收完成。

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
