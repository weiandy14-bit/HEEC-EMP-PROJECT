# @heec/api — MEP 專案管理 API（NestJS）

模組化單體、REST、PostgreSQL。排程由 `@heec/scheduler` 純函式核心承擔。

## 環境變數

| 變數 | 說明 |
|---|---|
| `DATABASE_URL` | PostgreSQL 連線字串（必要） |
| `PORT` | 服務埠（預設 3000） |
| `PG_POOL_MAX` | 連線池上限（預設 10） |

## 執行

```bash
# 於 monorepo 根目錄
npm install
npm run build            # 先建 scheduler 再建 api
DATABASE_URL=postgres://... node apps/api/dist/main.js
# 或開發模式（Node 原生 TS）
npm run start:dev -w @heec/api
```

## 身分（MVP 開發替身）

正式部署為 OIDC SSO；開發期以標頭注入身分脈絡：

```
X-Org-Id:  <organizations.id>
X-User-Id: <users.id>
X-Roles:   PM,Lead        # 逗號分隔；Admin 具全部
```

> **安全限制**：此身分標頭**僅限開發／測試環境**使用。正式環境（`NODE_ENV=production`）
> 預設停用，除非顯式設 `AUTH_DEV_HEADERS=1`；停用時這些標頭不構成任何身分，端點回 401。
> **前端不得**將此標頭當成正式帳號密碼登入方案;正式身分一律經 OIDC SSO 驗證後注入脈絡。

## 主要端點（`/api/v1`）

| 方法 | 路徑 | 角色 | 說明 |
|---|---|---|---|
| GET | `/health` | — | 健康檢查（含 DB） |
| GET/POST | `/projects` | PM/Admin（建立） | 專案清單/建立 |
| GET/PATCH | `/projects/{id}` | PM/Admin | 取得/更新（PATCH 需 `If-Match` 版本） |
| GET/POST | `/projects/{p}/tasks` | PM/Lead/Admin | WBS 工作 |
| POST/DELETE | `/projects/{p}/dependencies` | PM/Lead/Admin | 相依關係 |
| POST | `/projects/{p}/schedule-runs` | PM/Lead/Admin | 觸發重算（`Idempotency-Key` 冪等） |
| GET | `/schedule-runs/{id}` | 授權 scope | 查詢執行結果 |

## 跨切面

- **X-Correlation-ID**：全鏈追蹤，回應標頭回寫。
- **錯誤 envelope**：`{code,category,message,fields?,correlation_id,retryable}`（§8）。
- **樂觀併發**：寫入以 `If-Match` 帶版本；不符回 412。
- **冪等**：重算以 `Idempotency-Key`；相同 key 回傳原 run（§7 T09）。
- **交易一致**：重算於單一交易寫回計畫日期、schedule_run、outbox 並遞增版本。

## 端到端驗證

`scripts/smoke.sh` 示範：建案 → 建工作（掛件錨點 + 兩工作）→ 建相依 → 重算 →
確認計畫日期寫回、週末略過、關鍵路徑與冪等重放。
