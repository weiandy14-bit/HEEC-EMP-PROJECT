# Phase 4 接手與完成紀錄

狀態：**Phase 4 完成驗收**。接手起點 `1f25c8e`，沿用 React + Vite、即時 SQL、A → C → B 的核定順序。程式驗收版本 `1d005784b31f9060f82937191b71f46282079814`；CI [37025375590](https://github.com/weiandy14-bit/HEEC-EMP-PROJECT/actions/runs/37025375590) success。

## 已完成

- A：多案甘特、名稱字典篩選、日/週/月、三態/Baseline/進度、掛件與審查、關鍵路徑、FS/SS/FF/SF 相依線、任務明細、個人檢視保存、失敗/需重排提示。固定列虛擬化與案件/任務 keyset，5,000 層階層使用迭代遍歷。
- C：跨案/跨週 Work 分攤與 contour 守恆、Max Units、個人假期與父日曆、零容量、缺漏/部分資料、每日來源/WBS/指派/衝突起訖、名稱/案件/團隊篩選、排序、團隊容量需求、未指派分頁、CSV 與稽核。
- B：前/本/下/自訂 ISO 週、案件/責任人/類型篩選、跨週期間與逾期置頂、source 去重、來源對話框、以原業務狀態機完成回寫、健康/進度/掛件緩衝、分頁與來源局部降級。
- 每頁載入、空、錯誤重試、無權限、部分資料、大量資料；1280×720/1920×1080、凍結欄、滾動、鍵盤/焦點及 axe WCAG 2.1 A/AA。
- scope 逐筆核對、Viewer 唯讀、跨案 IDOR、不快取跨請求聚合資料。日曆單次請求批次讀取，避免 N+1。
- 500 active projects × 5,000 tasks 真實 PostgreSQL 實測；典型 50 案首屏 P95 達核定 <3s，大型首屏約 3.41s，據實保留數據。

## 驗證與證據

49 scheduler、40 web、96 真實 DB API、14 native Chromium 全通過。lint / typecheck / build / 全新 19 migrations + seed / G9 G10 DB 規則 / smoke 正負例全綠。

[逐項驗收追溯與讀取契約](PHASE4_ACCEPTANCE.md)、[量測報告](evidence/phase4/performance-report.json)、[SQL / EXPLAIN 摘要](evidence/phase4/query-plans.json)。完整截圖與查詢計畫於 CI artifact 保留 14 日；重跑 `scripts/performance/dashboard.mjs` 可重建獨立測試組織。

驗證修復流程：重現 → 根因 → 最小修復 → 重跑失敗案例 → 全門檻；未刪除斷言或略過測試來轉綠。本次修復包括選單異常回應防護、合法 ARIA 角色、獨立工程師名稱節點、效能腳本 UUID 明確轉型。

## 後續階段

Phase 4 核定功能已收尾。Phase 5：Microsoft Project CSV/Excel/可行的 MSP XML、原子匯入與 round-trip。Phase 6：正式 OIDC 帳密登入、Cloudflare/Neon 部署、並行壓力、安全、完整人工輔助科技驗證、備份還原與 UAT。保持 PR 未合併，未部署正式環境；開發身分標頭不作正式登入。
