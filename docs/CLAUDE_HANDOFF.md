# Claude Code 接手指引

## 權威版本與狀態
- Repository: https://github.com/weiandy14-bit/HEEC-EMP-PROJECT
- 接手分支: codex/phase5-project-exchange
- PR #2: https://github.com/weiandy14-bit/HEEC-EMP-PROJECT/pull/2 （draft、未合併）
- 最近程式提交: 28f2f5732fdd8d50f12952223883c04ef5cc223e
- 該提交 CI verify success: https://github.com/weiandy14-bit/HEEC-EMP-PROJECT/actions/runs/37100529730
- 本交接文件是後續文件提交；上述綠燈對應程式提交，勿誤稱未執行的新提交已通過 CI。
- Phase 4 已合併；Phase 5 已核准實作，但尚未完成全部驗收。不可直接從 main 當作已有 Phase 5。

## 先讀文件
1. 根目錄 AGENTS.md（若存在）以及專案既有 Master Prompt / PROMPT.md、PLAN.md、DECISIONS.md、STATUS.md（若存在）。
2. docs/PHASE5_PLAN.md：業主已確認之範圍。
3. docs/PHASE5_ALGORITHMS.md：演算法與解析規格。
4. docs/PHASE5_STATUS.md：已完成與缺口；其中舊提交的測試數不可代替最新證據。
5. docs/PHASE5_RUNBOOK.md、docs/OPENAPI_EXCHANGE.json。
6. .github/workflows/ci.yml：實際完整驗證步驟。

## 目前交付
CSV、XLSX、CSV package 交換；私有檔案與掃描；映射、不可變預覽、版本向量、RBAC/scope、原子提交、冪等重放、來源日期及實績保留、Baseline task/assignment 快照；匯出下載與逐欄 round-trip；React 操作頁、範例檔及測試。

主要程式位於 apps/api/src/exchange、apps/web/src/ExchangePage.tsx；scheduler 位於 packages/scheduler；DB migrations 已至 0020。以實際檔案為準，不覆寫既有 migration。

28f2f5 新增匯出冪等回應一致性，以及 PARSER_VERSION=2 舊預覽拒絕；schema/file format version 仍是 1，兩者不可混用。

## 尚待完成（不得刪減）
1. 完整來源日曆／資源 profile 的映射差異與決策 UI，不能無聲修改組織設定。
2. 作業歷史、伺服器取消、掃描重試、原檔／預覽保存期限清理。不可變預覽 DELETE trigger 與清理策略須一併設計。
3. 真正非同步掃描／render worker、冪等、重試與 dead-letter。現行同步 201 服務不能稱為非同步；既有 outbox 測試作用不能當作已完成實際 worker。
4. MSP XML 官方 schema 技術驗證與 go/no-go 報告。尚未支援 XML，也未實際驗證 Microsoft Project 桌面應用。
5. API contract 驗證、最終驗收追溯與計畫要求之安全／效能證據；檢查 PHASE5_PLAN 全部條件，不只完成此摘要。

production 登入、Cloudflare、雲端私有儲存接線屬 Phase 6；dev header 身分與測試掃描旁路不可當正式部署方案。

## 接手與驗證
使用 Node 22、PostgreSQL 16，npm ci。先確認 git status 與分支，保留未提交工作。按照 CI workflow 執行：
- npm run build
- npm run lint
- npm run typecheck
- npm test （僅 scheduler，不能代表全部測試）
- npm run test:exchange -w @heec/api
- npm run test:web
- Playwright 安裝及 npm run test:e2e -w @heec/web
- 在獨立測試 DB 執行 db/apply.sh、db/seed_dev.sql、db/run-tests.sh
- 啟動 API 後執行 test:integration、scripts/smoke.sh 與 dashboard performance。
DATABASE_URL 等環境設定參照 CI/runbook；只對可重建測試 DB 執行 seed 與效能資料，不對正式資料庫執行。

不要複製前一個暫存環境的 node_modules、資料庫目錄或機密。重建開發環境；正式資料與 secrets 不在 Git。

## 工作規則
業主已核准 Phase 5，無須重問是否開始。先回報實際檔案與缺口，再依計畫逐項補齊；問題循環為重現→定位根因→最小修正→針對測試→相關回歸→完整門檻。可重現錯誤先修復，不略過測試，不以重試掩蓋失敗。環境或需要新決策的阻塞須如實記錄。

目前此 Codex 的本地指令環境曾卡住，後續修改已透過 GitHub 保存並由 CI 驗證；這是舊環境狀態，不代表 Claude 的新環境也有相同問題。GitHub 分支為權威來源。

繼續推送此 PR 分支；未經業主明確指示，不合併 PR、不部署 production、不宣稱 Phase 5 全部完成。更新狀態與驗收證據並區分本地、CI、桌面 UAT。
