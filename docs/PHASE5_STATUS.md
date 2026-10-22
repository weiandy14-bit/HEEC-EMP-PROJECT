# Phase 5 實作狀態

業主已確認 `PHASE5_PLAN.md`。PR #2 為實作分支，尚未核定 Phase 5 完成或合併。

## 已驗證的 CI 里程碑

Commit `3a3909d53870ca5fb10ce964a61dc81d468e1623`，[CI 37099781355](https://github.com/weiandy14-bit/HEEC-EMP-PROJECT/actions/runs/37099781355) 全綠：49 scheduler、21 exchange parser、43 web、108 PostgreSQL API 整合、18 browser E2E；20 migrations、seed、G9/G10、smoke 正負例與既有 250 萬任務效能門檻皆通過。

此版本包含 CSV/XLSX 基本交換、不可變預覽、版本向量、冪等提交、Scope/RBAC、交易回滾、upsert 缺欄保留、完整 Baseline task/assignment 工時與跨案重匯驗證、操作頁與兩种桌面尺寸 E2E。

## 後續增量（以最新 CI 證據為準）

- CSV package：manifest、SHA-256、列數、ZIP allowlist、實際解壓上限與可還原文字防公式。
- 逐欄 round-trip 報告與 API/UI 下載；單檔 CSV 的保護文字差異明列於報告。
- 可用成功／失敗範例 CSV；解析器 21 項 CI 測試通過。
- 日曆繼承與批次讀取，UTC 偏移修正；完整日曆時段、例外日與資源日曆資料輸出。
- 額外來源欄位／工作表、資源容量與日曆時區差異需確認，不無聲忽略。

上述增量已由此程式 commit 的全新 PostgreSQL / browser / smoke / 效能 CI 完整確認。其後的匯出冪等回應一致性修正與新測試仍以最新 CI 為準。

## 尚未完成的 Phase 5 門檻

1. 已交付：完整來源日曆／資源 profile 映射差異與決策 UI。預覽回傳 `profiles`（來源日曆／資源對目標的差異：時區、每日工時、容量、未對應），操作頁以對照表明示差異並提供日曆／資源對應選擇（calendarMap/resourceMap）；匯入不修改組織日曆時區或資源容量（保留目標設定）。整合測試 exchange_profiles.test.mjs、web 決策表單元測試。
2. 已交付：作業歷史、伺服器取消、掃描重試（同步端點，exchange_lifecycle.test.mjs），以及原檔／預覽保存期限清理（migration 0021 + Admin 維運端點 /internal/exchange/retention，exchange_retention.test.mjs）。不可變預覽 DELETE trigger 已與清理策略一併設計：受限權限旗標允許清掃刪除過期列，一般路徑仍不可改刪。作業歷史與稽核保留為清理證據。另補 outbox 積壓（>20 筆）持續消費整合測試（outbox.test.mjs）。
3. 已交付：真正的非同步掃描／render worker（opt-in `Prefer: respond-async` → 202 + status_url；migration 0022 `exchange_worker_jobs` 佇列；租約認領與逾期回收、冪等、指數退避、最大重試、dead-letter；掃描與 render 均實際由背景 worker 執行）。同步 201 契約與回歸測試保留；掃描前禁預覽／提交、render 前禁下載；取消與保存期限清理與 worker 協調。前端加背景處理（輪詢）選項。整合測試 exchange_async.test.mjs（8 情境：接受、掃描完成、render 下載、驗證拒絕 dead、瞬時失敗重試→dead-letter、重複投遞冪等、worker 中斷恢復、取消競爭、scope/權限）。
4. 已交付（技術閘門）：MSP XML 匯入／匯出（format=xml）。安全自備解析器（拒絕 DTD/ENTITY/XXE、跨案、限深限量）；ConstraintType 0..7、PredecessorLink Type、LinkLag 十分之一分鐘（−40→−4）、ISO-8601 工期整分鐘（小數精度報錯不截斷）。單元 msp-xml.test.mjs（隨 test:exchange）、整合 exchange_xml.test.mjs（匯入→提交→匯出→再匯入圖等價）。go/no-go 報告見 docs/PHASE5_XML_GONOGO.md：建議作為程式化 XML 交換 GO，桌面 Microsoft Project 相容性待 UAT 實測（NO-GO 宣稱已桌面驗收），不可等價項由 round-trip 報告與該文件揭露。
5. 已交付：P5-01..P5-12 驗收追溯與證據彙整見 docs/PHASE5_ACCEPTANCE.md（區分本地／CI／桌面 UAT），含安全與效能證據；API contract 見 OPENAPI_EXCHANGE.json，操作／掃描規格見 PHASE5_RUNBOOK.md，XML go/no-go 見 PHASE5_XML_GONOGO.md。桌面 Microsoft Project 相容性仍列 UAT 依賴，未宣稱完成。

production 正式身分登入、Cloudflare 與私有雲端儲存接線依 Phase 6；測試掃描旁路只在 `NODE_ENV=test` 使用，production 掃描不可用時拒絕匯入。
