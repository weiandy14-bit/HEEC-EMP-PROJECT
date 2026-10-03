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

1. 完整來源日曆／資源 profile 的映射差異與決策 UI；不得無聲修改組織設定。
2. 作業歷史、伺服器取消與掃描重試、原檔／預覽保存期限清理。
3. 真正的非同步掃描／render worker 與重試，不能將目前同步服務稱為背景處理。
4. MSP XML 官方 schema 技術驗證與 go/no-go 報告；尚未支援 XML 或宣稱 Microsoft Project 桌面驗證。
5. 其餘計畫驗收追溯與最終驗證證據；目前 API contract 見 OPENAPI_EXCHANGE.json，現行操作／掃描規格見 PHASE5_RUNBOOK.md。

production 正式身分登入、Cloudflare 與私有雲端儲存接線依 Phase 6；測試掃描旁路只在 `NODE_ENV=test` 使用，production 掃描不可用時拒絕匯入。
