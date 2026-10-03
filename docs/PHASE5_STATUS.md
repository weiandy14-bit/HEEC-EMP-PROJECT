# Phase 5 實作狀態

業主已確認 `PHASE5_PLAN.md`。PR #2 為實作分支，尚未核定 Phase 5 完成或合併。

## 已驗證的 CI 里程碑

Commit `37192685424856aaf6771e9e140ce03da30f11f0`，[CI 37097812879](https://github.com/weiandy14-bit/HEEC-EMP-PROJECT/actions/runs/37097812879) 全綠：49 scheduler、14 exchange parser、43 web、105 PostgreSQL API 整合、18 browser E2E；20 migrations、seed、G9/G10、smoke 正負例與既有 250 萬任務效能門檻皆通過。

此版本包含 CSV/XLSX 基本交換、不可變預覽、版本向量、冪等提交、Scope/RBAC、交易回滾、upsert 缺欄保留、完整 Baseline task/assignment 工時與跨案重匯驗證、操作頁與兩种桌面尺寸 E2E。

## 後續增量（以最新 CI 證據為準）

- CSV package：manifest、SHA-256、列數、ZIP allowlist、實際解壓上限與可還原文字防公式。
- 逐欄 round-trip 報告與 API/UI 下載；單檔 CSV 的保護文字差異明列於報告。
- 可用成功／失敗範例 CSV；解析器 19 項本地測試通過。
- 日曆繼承與批次讀取，UTC 偏移修正；完整日曆時段、例外日與資源日曆資料輸出。
- 額外來源欄位／工作表、資源容量與日曆時區差異需確認，不無聲忽略。

上述增量尚需本版本全新 PostgreSQL / browser / smoke / 效能 CI 完整確認，不能引用上一版本綠燈替代。

## 尚未完成的 Phase 5 門檻

1. 完整來源日曆／資源 profile 的映射差異與決策 UI；不得無聲修改組織設定。
2. 作業歷史、伺服器取消與掃描重試、原檔／預覽保存期限清理。
3. 真正的非同步掃描／render worker 與重試，不能將目前同步服務稱為背景處理。
4. MSP XML 官方 schema 技術驗證與 go/no-go 報告；尚未支援 XML 或宣稱 Microsoft Project 桌面驗證。
5. 其餘計畫驗收追溯、OpenAPI、部署／掃描 adapter runbook 與最終驗證證據。

production 正式身分登入、Cloudflare 與私有雲端儲存接線依 Phase 6；測試掃描旁路只在 `NODE_ENV=test` 使用，production 掃描不可用時拒絕匯入。
