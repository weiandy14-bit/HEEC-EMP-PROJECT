# 架構與實作現況

依 `MEP Phase 0 架構規格草案 v0.1` 實作。本文件記錄目前已交付內容與後續階段。

## 分層

```
┌────────────┐   HTTPS/JSON   ┌──────────────────────────┐
│  Web UI    │ ─────────────▶ │  API (NestJS 模組化單體)   │
│ (後續階段) │                │  RBAC / 驗證 / 交易        │
└────────────┘                └───────────┬──────────────┘
                                           │ 交易
                              ┌────────────▼─────────────┐
                              │       PostgreSQL          │
                              │  業務 + 稽核 + outbox     │
                              └────────────┬─────────────┘
                                           │ 讀一致快照 / 寫回
                              ┌────────────▼─────────────┐
                              │  @heec/scheduler（純函式） │
                              │  工作時間 / 相依 / CPM     │
                              └───────────────────────────┘
```

排程核心刻意與框架、DB 解耦：API 讀取一致快照組成 `ScheduleInput`，
呼叫純函式 `schedule()`，於單一交易寫回計畫日期、`schedule_runs`、`job_outbox`
並遞增版本。相同輸入 → 相同 `result_hash`（冪等，§7 T09）。

## 資料結構（`db/migrations`，§4）

14 個 migration、48 個表，已於真實 PostgreSQL 驗證全數套用。分域：

| 檔案 | 內容 |
|---|---|
| 0001 | 擴充、共通觸發器（updated_at + 樂觀鎖 version）、列舉 |
| 0002 | organizations / users / roles / permissions / user_roles / teams / login_events |
| 0003 | disciplines（五專業種子）/ projects / project_members / project_disciplines |
| 0004 | calendars / calendar_working_days / calendar_exceptions |
| 0005 | wbs_templates / versions / tasks |
| 0006 | project_tasks / task_dependencies（複合 FK 強制同案） |
| 0007 | resources / resource_calendars / resource_aliases / resource_assignments |
| 0008 | baselines / baseline_tasks / baseline_assignments（不可變快照） |
| 0009 | 法定審查模板 / 步驟 / 案件審查 / 審查步驟 / 審查事件 |
| 0010 | deliverables / meetings / weekly_items（source_key 去重） |
| 0011 | alert_rules / alerts（fingerprint 部分唯一） |
| 0012 | attachments / comments（polymorphic + 白名單） |
| 0013 | import_jobs / export_jobs / external_id_map |
| 0014 | audit_logs（月分割 + hash chain）/ system_settings / job_outbox / schedule_runs |

慣例：主表具 `id/org_id/created_at/updated_at/created_by/updated_by/version/archived_at`；
時間點 `timestamptz`、民用日期 `date`；`*_id` FK 刪除 RESTRICT；跨組織以
`(org_id,id)`、跨案依賴以 `(project_id,id)` 複合 FK 強制。

## 排程核心（`packages/scheduler`，§7）

零相依、Node 原生 TS、`node:test`。18 測試全過（含 5000 tasks 效能案例）。

- 工作時間引擎：每週時段、午休、假日例外、固定時區偏移；
  `addWorking`/`subtractWorking`/`workingMinutesBetween`/`countWorkingDays`
- 相依界限 FS/SS/FF/SF 正逆向公式，含正負 lag 與 lag 日曆
- CPM：拓樸序、環/孤立偵測、逆向(latest)/順向(earliest)、
  總浮時/自由浮時/關鍵路徑、限制與實績鎖定、狀態日
- 可行性以工作時間判斷（週末邊界不誤判）
- 對照規格案例 T01–T10 全數涵蓋

## API（`apps/api`，§8）

見 `apps/api/README.md`。已實作 health、projects、tasks、dependencies、
schedule-runs，並以 `scripts/smoke.sh` 端到端驗證。

## 後續階段（未於本次交付）

- 3 流程：審查/交付/會議/週工作/警示 API 與規則引擎
- 4 UI：三頁 Dashboard（總控甘特 / 本週 / 四週負荷）
- 5 交換：CSV/XLSX 匯入預覽與原子提交、匯出、round-trip 報告
- 6 上線：OIDC 實接、RLS、可觀測性、備份/PITR、負載測試
- 資源負荷計算（capacity_week、rate、衝突分級）與 baseline API
- OpenAPI 3.1 產生與 contract 測試

## 待業主裁決

Phase 0 之 D01–D17 暫定假設（掛件錨點命名、法定先後、負 lag 上限、
工作時間、假日來源、資源容量分攤等）於實作前仍待逐項確認；
本程式預設值僅供設計與測試示例。
