# HEEC EMP — MEP 機電設計專案管理系統

以每案建照掛件日為固定錨點，管理五大機電專業之排程、同步協調、法定審查、交圖與掛件；
由同一資料模型支撐排程、基準、實績、四週資源負荷、三頁動態 Dashboard、Project 交換與稽核。

本倉庫依據 `MEP Phase 0 架構規格草案 v0.1` 實作。案件數、姓名與日期均為資料，不寫入程式常數。

## 架構

| 層 | 技術 |
|---|---|
| 前端 | React + TypeScript（後續階段） |
| API | NestJS + TypeScript、REST/OpenAPI、模組化單體 |
| 排程核心 | `packages/scheduler` — 純函式、可測試、與框架無關 |
| 資料庫 | PostgreSQL（DDL migrations 於 `db/migrations`） |

## 目錄結構

```
db/migrations/      PostgreSQL schema（資料結構，先於程式完成）
docs/               資料模型與設計文件
packages/scheduler/ 純函式排程核心（時間模型、相依界限、CPM）
apps/api/           NestJS 後端（領域模組、REST API）
```

## 開發

```bash
# 資料庫 schema
psql "$DATABASE_URL" -f db/migrations/0001_common.sql   # 依序執行 0001..NNNN

# 排程核心
cd packages/scheduler && npm install && npm test

# 後端 API
cd apps/api && npm install && npm run start:dev
```

## 實作範圍與界線

本階段交付：完整資料結構、後端骨架、純函式排程核心與其測試。
Phase 0 規格中的暫定假設（D01–D17）於實作前仍待業主逐項裁決；本程式的預設值僅供設計與測試示例。
