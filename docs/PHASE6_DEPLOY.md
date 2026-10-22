# Phase 6 — 部署、備份與災難復原 Runbook

本文件說明將 HEEC EMP 以**可攜式容器 + 受管服務**上線的方式（文件既定方向為
Cloudflare/Neon，但不綁單一廠商；任何容器主機 + 受管 PostgreSQL + S3 相容儲存皆可）。

## 1. 架構與映像

| 元件 | 本機/示範（docker-compose） | 正式（受管） |
|---|---|---|
| API（NestJS） | `Dockerfile` 映像 | 同一映像部署於 Cloudflare Containers / Fly / Render / Railway / VPS |
| Web（SPA） | `deploy/web.Dockerfile`（nginx，反代 `/api`） | 靜態可上 Pages/CDN，或同 nginx 容器 |
| PostgreSQL 16 | `postgres` 服務 | **Neon**（或其他受管 PG） |
| 私有物件儲存 | `minio` 服務（S3 相容） | **Cloudflare R2** / AWS S3（S3 相容 adapter） |
| 病毒掃描 | `clamav` 服務 | clamd（側車或掃描服務） |

同一份 API 映像在本機與正式皆用環境變數驅動（見 `.env.example`）。

本機啟動：
```bash
cp .env.example .env            # 視需要調整
docker compose up -d --build
docker compose run --rm migrate # 套用 migrations + seed（一次性）
# Web: http://localhost:8080   API: http://localhost:3000/api/v1/health
```

## 2. 身分（OIDC，DB 權威）

- 設 `OIDC_ISSUER`、`OIDC_AUDIENCE`（必要時 `OIDC_JWKS_URI`）。API 以 issuer discovery
  取 JWKS，驗證 Bearer JWT 的簽章與 iss/aud/exp/nbf。
- **組織與角色一律以 DB 為權威**：IdP 只證明「此人是誰」。使用者須先由 Admin 於
  `users`（issuer+subject）佈建並指派 `user_roles`，否則登入被拒（`user_not_provisioned`）。
- 開發身分替身標頭（`X-Org-Id/X-User-Id/X-Roles`）在 production 預設停用；僅
  `AUTH_DEV_HEADERS=1` 時啟用，**不是正式登入方案**。啟動時若設定不健全會輸出警告。

## 3. 資料庫與 Row-Level Security

- `db/apply.sh` 依序套用 `0001..0023`；`0023_rls.sql` 建立最小權限角色 `app_rw` 與
  org 隔離政策（GUC `app.current_org`，未設即 0 列，fail-closed）。
- 正式以 `app_rw`（非 superuser）連線即啟用 RLS。**尚待的部署步驟**：為每個請求於交易內
  設定 `SET LOCAL app.current_org`（`DatabaseService.withOrg` 已提供原語，請求管線接線為
  後續工作）。在此之前以 superuser 連線（RLS 休眠、app 層 scope 檢查為主）。Neon 上請為
  `app_rw` 設定密碼並授予連線。
- 連線字串 `DATABASE_URL` 於 Neon 需 `sslmode=require`。

## 4. 私有物件儲存

- `STORAGE_DRIVER=s3` 搭 `S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY`。
  R2/MinIO 用 `S3_FORCE_PATH_STYLE=true`；AWS 虛擬主機式設 `false`。
- 物件鍵由伺服器生成（UUID），防 traversal；原檔/輸出不入 Git、不公開。

## 5. 病毒掃描（fail-closed）

- `clamdscan` client 讀 `/etc/clamav/clamd.conf`（`deploy/clamd-client.conf` 指向 clamav 服務）。
- 掃描不可用一律 503 不提交；**production 無旁路**（測試旁路需 `NODE_ENV=test` 且
  `EXCHANGE_TEST_SCANNER=1`，正式拒絕）。

## 6. 可觀測性

- `GET /api/v1/health/live`（存活）、`/health/ready`（就緒：DB 硬相依→不通回 503，另報
  storage/scanner/auth 模式）、`/health`（相容）。
- `GET /api/v1/metrics`：Prometheus 文字格式（請求計數、延遲直方圖、uptime、RSS、build）。
  正式請置於內網或加保護後供抓取。
- 每請求一行 JSON 存取日誌（correlation id、method、path、status、dur、org/user）；
  `LOG_REQUESTS=0` 可靜音。

## 7. 備份與 PITR

- **受管 PITR**：Neon 提供連續 PITR（依方案保留視窗）；設定保留期並定期演練還原到時間點。
- **邏輯備份（可攜、離平台保存）**：
  ```bash
  DATABASE_URL=... BACKUP_DIR=/var/backups/heec scripts/backup/pg_backup.sh   # -Fc + sha256，保留 N 份
  TARGET_URL=...  scripts/backup/pg_restore.sh /var/backups/heec/heec-<ts>.dump
  ```
- **DR 演練（定期執行，CI 或排程）**：
  ```bash
  DATABASE_URL=.../empdb ADMIN_URL=.../postgres scripts/backup/restore_drill.sh
  ```
  備份→還原到 scratch DB→驗證組織數/表數/RLS 政策存在→drop。回報 `RESTORE DRILL PASS`。

## 8. CI 對映像的驗證

`ci.yml` 的 `docker-build` job 於每次 PR 建置 API 與 Web 映像並驗證 `docker compose config`，
確保部署構件可建。核心應用測試（lint/typecheck/unit/integration/E2E/smoke/效能）在 `verify` job。

## 9. 上線前檢查清單

- [ ] `OIDC_ISSUER/OIDC_AUDIENCE` 指向正式 IdP；首批使用者已於 DB 佈建並指派角色。
- [ ] `DATABASE_URL` 指向受管 PG（Neon，`sslmode=require`）；migrations 已套用至 0023。
- [ ] （強化）`app_rw` 連線 + 每請求 `app.current_org` 接線完成後切換。
- [ ] `STORAGE_DRIVER=s3` + R2/S3 憑證；bucket 為私有。
- [ ] clamd 可達；確認掃描 fail-closed（故意送 EICAR 應被拒）。
- [ ] TLS 於邊緣/反代終結；`/metrics` 受保護。
- [ ] 備份排程 + 定期 `restore_drill.sh` 綠燈。
- [ ] 負載測試（見 `scripts/performance/load.mjs`）在近正式環境達標。

## 10. 仍屬後續（誠實揭露）

- 每請求 `app.current_org` 於連線池之接線（啟用 `app_rw` 執行期強制）。
- 300 併發實測、桌面 Microsoft Project UAT、完整無障礙認證需於近正式環境與真實帳號執行。
