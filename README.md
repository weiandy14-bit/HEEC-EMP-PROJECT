# HEEC EMP — MEP 機電設計專案管理系統

以每案建照掛件日為固定錨點，管理五大機電專業排程、協調、法定審查、交付、週工作與資源負荷。案件、姓名、WBS、日期與統計均由資料庫產生。

Phase 4 三頁 Dashboard 已完成驗收，詳見 [驗收追溯](docs/PHASE4_ACCEPTANCE.md)、[接手紀錄](docs/PHASE4_HANDOFF.md) 與 [效能證據](docs/evidence/phase4/performance-report.json)。Microsoft Project 交換與正式外部帳密登入／Cloudflare 部署依 Phase 5／6 處理。

| 層 | 技術 |
|---|---|
| 前端 | React + Vite + TypeScript；多案甘特、本週事項、四週負荷 |
| API | NestJS + TypeScript、版本化 REST、模組化單體 |
| 排程 | packages/scheduler 純函式工作時間／相依／CPM 引擎 |
| 資料庫 | PostgreSQL；19 migrations、50 tables、即時 SQL view／查詢 |
| 驗證 | node:test、Vitest、真實 PostgreSQL、Playwright、axe、效能腳本 |

## 本機開發

需 Node.js 22（與 CI 相同）、npm 與 PostgreSQL 16。於倉庫根目錄執行：

```bash
npm ci
# DATABASE_URL 由本機環境提供，不將憑證提交到 GitHub
bash db/apply.sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/seed_dev.sql
npm run build
PORT=3023 node apps/api/dist/main.js
```

另開終端啟動前端；以下 UUID 僅對應開發 seed：

```bash
VITE_API_TARGET=http://localhost:3023 \
VITE_DEV_ORG=11111111-1111-1111-1111-111111111111 \
VITE_DEV_USER=22222222-2222-4222-8222-222222222222 \
VITE_DEV_ROLES=PM,Lead npm run dev -w @heec/web
```

瀏覽 Vite 顯示的本機網址。seed 不建立工程案件，首次 Dashboard 顯示空資料；可透過 API 建案或在獨立測試資料庫執行驗收測試。資料存放於 PostgreSQL，GitHub 負責版本控制。

開發身分標頭只供本機／測試；正式登入尚未接入 OIDC，不能把此模式直接部署為對外帳密網站。正式前端建置不附加 VITE_DEV 身分標頭。

## 驗證

```bash
npm run lint
npm run typecheck
npm test
npm run test:web
npm run build
bash db/run-tests.sh
# 以下須啟動 API，並使用隔離的測試資料庫
BASE=http://localhost:3023/api/v1 npm run test:integration -w @heec/api
BASE=http://localhost:3023/api/v1 bash scripts/smoke.sh
npx playwright install chromium
npm run test:e2e -w @heec/web
# 效能腳本會建立 250 萬筆測試任務，只在專用測試資料庫執行
BASE=http://localhost:3023/api/v1 node scripts/performance/dashboard.mjs
```

CI 對每個 PR 在全新 PostgreSQL 執行上述門檻，保存瀏覽器／效能 artifacts 14 日；已驗收的量測報告與 SQL 計畫摘要另保存於 docs/evidence/phase4。

## 目錄

- apps/web：三頁 Dashboard、互動、元件與瀏覽器驗證。
- apps/api：案件、工作、排程、Baseline、審查、交付、會議、週工作、警示、Dashboard、稽核。
- packages/scheduler：日曆、FS/SS/FF/SF、lag、限制、實績、critical／float。
- db：migration、seed、DB 規則測試。
- docs：架構、分階段計畫、驗收與量測證據。
- scripts：smoke 與即時 SQL／native browser 效能驗證。
