# Phase 6 驗收追溯與證據（P6-01 ～ P6-07）

對應 `ARCHITECTURE.md` §6「上線：OIDC 實接、RLS、可觀測性、備份/PITR、負載測試」，
加上雲端私有儲存與可攜式部署。證據分 **本地（fresh PostgreSQL 16 + API）／CI（權威）／
部署 UAT（需真實帳號與近正式環境）** 三層。身分模型採「DB 權威、OIDC 僅驗證」；部署標的
採「可攜式 Docker + Neon + S3 相容」。

## 分項追溯

| 編號 | 功能 | 主要程式 | 測試／證據 | 層級 | 狀態 |
|---|---|---|---|---|---|
| P6-01 | OIDC 身分（DB 權威） | auth/jwt.ts, oidc.service.ts, identity.service.ts, auth.module.ts, request-context.ts, roles.guard.ts | 單元 test/auth/oidc.test.mjs（9：RS256/ES256、過期、aud/iss、竄改、alg=none、kid 輪替）；整合 test/integration/auth_oidc.test.mjs（4：DB 對應、未佈建拒、未啟用拒、登入節流） | 本地+CI | ✅ |
| P6-02 | Row-Level Security 組織隔離 | db/migrations/0023_rls.sql, database.service.ts（withOrg/transaction orgId） | 整合 test/integration/rls.test.mjs（7：per-org 可見、WITH CHECK 擋跨組織寫入、跨組織 UPDATE 0 列、未設 GUC fail-closed、superuser 繞過確認）；fresh apply 0001..0023 | 本地+CI | ✅ 政策/角色；⏳ 執行期 app_rw 接線 |
| P6-03 | S3 相容私有儲存 | exchange/s3.ts（SigV4）, exchange/storage.ts（driver facade） | 單元 test/exchange/s3.test.mjs（5：SigV4 簽章金鑰 KAT、簽章結構/決定性、mock S3 往返、facade 分派）；exchange 整合 30/30（本機驅動不變） | 本地+CI（技術）；真實 R2/S3/MinIO 待部署 UAT | ✅ 技術 / ⏳ UAT |
| P6-04 | 可觀測性 | common/metrics.ts, common/request-log.middleware.ts, health/metrics.controller.ts, health/health.controller.ts | 整合 test/integration/observability.test.mjs（3：liveness、readiness 元件、Prometheus 格式與計數） | 本地+CI | ✅ |
| P6-05 | 備份 / PITR / DR | scripts/backup/pg_backup.sh, pg_restore.sh, restore_drill.sh | 本地實跑 restore_drill：備份→還原 scratch→驗證 orgs/表數/RLS 政策存在→drop＝PASS。Neon 連續 PITR 為受管能力 | 本地；排程 DR 與 Neon PITR 為營運 | ✅ 腳本 / ⏳ 營運排程 |
| P6-06 | 可攜式部署（Docker/Neon/S3） | Dockerfile, deploy/web.Dockerfile, deploy/nginx.conf, docker-compose.yml, .env.example, docs/PHASE6_DEPLOY.md | `docker compose config` 有效（本地）；CI `docker-build` job 建置 API 與 Web 映像 | 本地（config）+CI（build）；實際 provision 待業主帳號 | ✅ 構件 / ⏳ provision |
| P6-07 | 負載測試骨架 | scripts/performance/load.mjs | 本地 smoke：40 VUs／6s＝3,319 req、0 錯、p95 127ms、548 rps | 本地（骨架）；300 併發達標待近正式環境 | ✅ 骨架 / ⏳ 300 併發實測 |

## 安全與設計重點

- **DB 權威**：OIDC 只驗證身分（iss/aud/exp/nbf、JWKS 簽章，拒 alg=none 與對稱金鑰）；
  org 與角色一律讀 DB，未佈建帳號拒登（`user_not_provisioned`）。開發標頭正式環境預設停用。
- **RLS**：`app_current_org()` 以交易 GUC 決定可見列，未設即 0 列（fail-closed）；ENABLE+FORCE
  於所有 org 表（48 政策）＋ organizations/baseline_*/role_permissions 專屬政策；`v_gantt_task`
  改 `security_invoker` 以免視圖繞過。superuser 會繞過 RLS，故正式以最小權限 `app_rw` 連線。
- **私有儲存**：S3 相容 adapter 自備 SigV4（KAT 驗證簽章金鑰推導正確）；伺服器生成 UUID 鍵防
  traversal；本機驅動維持 0700/0600 與既有語義。
- **掃描 fail-closed**：不可用回 503 不提交；production 無旁路。
- **可觀測性**：結構化 JSON 存取日誌（含 correlation 與 org/user）、/metrics、/health/{live,ready}。

## 待辦與依賴（誠實揭露）

- **執行期 RLS 強制**：為每個請求於連線交易內 `SET LOCAL app.current_org` 並以 `app_rw` 連線
  （`DatabaseService.withOrg` 原語已具，請求管線接線為後續工作）。在此之前正式以 superuser 連線，
  app 層 scope 檢查為主、RLS 政策為縱深防禦且已通過獨立證明。
- **真實雲端 provision**：Neon、R2/S3、IdP 與 secrets 需業主帳號；實際上線與憑證注入由業主執行。
- **300 併發實測、桌面 Microsoft Project UAT、完整無障礙（WCAG）認證**需於近正式環境與真實帳號完成。

## 總結

P6-01、P6-04 具本地與 CI 完整證據；P6-02/P6-03/P6-05/P6-06/P6-07 具技術/骨架證據與獨立驗證，
並明列執行期接線與真實環境 provision 為剩餘項。未經業主明確指示不逕行對外部署。
