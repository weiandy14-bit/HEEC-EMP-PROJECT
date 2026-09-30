# Phase 3 流程引擎實作計畫

依《MEP Phase 0 架構規格 v0.6》§6/§7/§8/§11 與業主 2026-09-30 追加條件。
狀態：計畫已核定範圍，**開工前門檻**先行；再依 P3-01～P3-10 實作。每次失敗依
「重現 → 保存錯誤 → 定位根因 → 最小修復 → 重跑失敗項 → 重跑全部門檻」循環處理，
不得以跳過測試、放寬斷言、刪除案例或停用 CI 通過。

---

## 0. 開工前門檻（先完成，再進 P3-01）

| 項目 | 內容 | 狀態 |
|---|---|---|
| G9 起日修正 | `countWorkingDays` 僅計 [a,b) 內確有工作分鐘之日；起日落在工作結束邊界（如 18:00）不計，修正逾期天數起日多算 | ✅（`calendar.ts`；`phase2.test.ts` G9 斷言 3/3/0/0/1） |
| G2 實際重疊斷言 | 負 lag 正例加斷言：B 與 A 重疊、重疊量恰 1 工作日、B.start = A.finish − 1 工作日 | ✅（`phase2.test.ts`） |
| G4 後續非工作時段 | 前置完成落在後續日曆非工作時段（台北 12:00=04:00Z，早於 CALU 09:00Z）→ 後續對齊次一工作時段 09:00Z | ✅（`phase2.test.ts`） |
| G5 超期關鍵 | 已鎖定實績晚於掛件允許 → `overCritical=true`、負浮時、仍產出；落後沿後續傳遞至錨點；無實績之限制超出仍為衝突 | ✅（`schedule.ts` + `types.ts overCritical`；`phase2.test.ts` 正例與對照） |
| G7 property-based | 隨機 DAG＋日曆：可行性、浮時非負與 critical 一致、四種關係界限恆成立、add/subtract 往返一致、相同輸入同 hash | ✅（`property.test.ts`，3 群、共數百次隨機） |

門檻完成標準：lint / typecheck / test / build / 全新 DB migration＋seed / DB 規則測試 / smoke / CI 全綠，並提供新 commit 與 CI 連結。

---

## 1. 追加設計條件（貫穿 P3）

- **交付物 locked（P3-04）**：`locked` 交付物不得直接修改；任何後續變更一律建立新 `revision`。DELETE 採「封存」（設 `archived_at`）並保留稽核，不做實體刪除。
- **週工作顯示與去重（P3-06）**：跨週顯示條件＝「工作期間與查詢週相交」**或**「逾期且未完成」。`source_key` 僅負責資料去重（同來源不重複建列），**不**用來決定顯示在哪一週；週別由工作期間與查詢週的相交關係決定。
- **警示分級（P3-07）**：
  - 「已逾計畫完成（now > plan.finish 純日期/時間，採同一顯示語義）且未完成」→ 明確判為 **`overdue`**。
  - 「相對 Baseline 落後 ≥ 4 工作日」→ 判為 **`behind`**（1–3 工作日為 `attention`）。
  - 兩者同時成立 → 取 **`overdue`**（逾期優先於落後）。
  - 確認（ack）、暫緩（snooze）、關閉（close）之**理由、期限與歷史**分別驗證。
- **交易一致與冪等（P3-08～P3-10）**：事件寫入（`job_outbox`）與業務變更在**同一交易**提交；worker 重試以**事件 ID／aggregate version** 防止重複作用（同事件重放不重複套用）。權限負例與跨案 IDOR 於**真實資料庫整合測試**中執行。

---

## 2. P3-01 ～ P3-10（各含功能／資料表·API／測試輸入／預期結果／完成定義）

> 共通：寫入經伺服器 RBAC + org/project scope；狀態變更寫 `audit_logs`；事件經 `job_outbox` 同交易寫入、worker 冪等消費。

### P3-01 法定審查適用性狀態機　（狀態：✅ 已實作，8 整合測試通過並納入 CI）
- **功能**：每案逐專業設定 applicable / N/A / pending；N/A 必填理由，pending 必填責任人＋期限；保留核定者、依據、時間（D04 逐案確認，不預設）。
- **資料表·API**：`project_statutory_reviews`；`GET/POST /projects/{p}/reviews`、`PATCH /projects/{p}/reviews/{r}`。
- **測試輸入**：(a) not_applicable 無理由；(b) pending 無 owner/due；(c) applicable ＋ authority 齊備。
- **預期結果**：(a)(b) → 422 validation（服務層擋、DB CHECK 兜底）；(c) → 201，`review_events` + `audit_logs` 各一。
- **完成定義**：1 正 2 負測試通過，稽核可查。

### P3-02 送審／補正多輪循環　（狀態：✅ 已實作，3 整合測試通過並納入 CI）
- **功能**：以 `cycle_no` 進行 送審→補正→再送審，各輪歷史不被覆寫。
- **資料表·API**：`project_statutory_review_steps`、`review_events`；`POST /projects/{p}/reviews/{r}/steps`、`PATCH …/steps/{id}`。
- **測試輸入**：submit(cycle1) → revision → submit(cycle2)。
- **預期結果**：`cycle_no` 1→2；`U(review,cycle,step_code)` 不衝突；前輪列不變；`review_events` 逐步 append。
- **完成定義**：多輪測試通過，且第一輪資料在第二輪後仍讀回原值。

### P3-03 核可需文號＋日期　（狀態：✅ 已實作，5 整合測試通過並納入 CI）
- **功能**：狀態轉 approved 需 approval_number + approval_date，缺一不可。
- **資料表·API**：`project_statutory_reviews`；`PATCH /projects/{p}/reviews/{r}`（Lead/QA 核准）。
- **測試輸入**：(a) approved 缺文號或日期；(b) 齊備。
- **預期結果**：(a) → 422；(b) → 200，status=approved，稽核記文號 diff。
- **完成定義**：缺欄負例 + 齊備正例通過。

### P3-04 交付物狀態流轉與版本（含 locked / DELETE 追加條件）　（狀態：✅ 已實作，6 整合測試通過並納入 CI）
- **功能**：draft→submitted→accepted/rejected→locked；`revision` 案內唯一。**locked 不可直接修改，後續變更建立新 revision**；**DELETE 採封存（`archived_at`）並保留稽核**。
- **資料表·API**：`deliverables`（status, revision, *_at, approver_id, locked_at, archived_at）；`GET/POST/PATCH/DELETE /projects/{p}/deliverables`。
- **測試輸入**：建 rev A → submit → accept → lock；對 locked 發 PATCH；對 locked 之變更改建 rev B；DELETE 一筆後查稽核。
- **預期結果**：流轉正常；locked PATCH → 409/422；rev B 建立成功且 rev A 不變；DELETE → 標 `archived_at`、實體仍在、稽核有刪除事件。
- **完成定義**：流轉正例 + locked 不可改負例 + 新 revision 正例 + 封存保留稽核測試通過。

### P3-05 會議與紀錄
- **功能**：會議排程、狀態 scheduled/held/cancelled、紀錄附件關聯。
- **資料表·API**：`meetings`、`attachments`；`GET/POST/PATCH /projects/{p}/meetings`。
- **測試輸入**：(a) 建會議掛 minutes、標 held；(b) ends_at 早於 starts_at。
- **預期結果**：(a) 成功、附件關聯有效、狀態記稽核；(b) → 422（CHECK ends≥starts）。
- **完成定義**：正例 + 時間區間負例通過。

### P3-06 週工作衍生與跨週顯示／去重（含追加條件）
- **功能**：由工作／審查步驟／會議衍生 `weekly_items`；**跨週顯示條件＝工作期間與查詢週相交，或逾期且未完成**；逾期置頂；完成回寫。**`source_key` 僅資料去重，不決定週別**。
- **資料表·API**：`weekly_items`（source_key, type, due_at, status, completed_at, period 起訖）；`GET /projects/{p}/weekly-items?week=…`、`POST`、`PATCH`。
- **測試輸入**：(a) 期間橫跨 W 與 W+1 之項，分別查兩週；(b) 逾期未完成之項查其後任一週；(c) 同 `source_key` 觸發兩次。
- **預期結果**：(a) 兩週查詢皆返回該項（相交）；(b) 逾期未完成於後續週持續顯示置頂；(c) 僅一列（`U(project,source_key)`），非以 source_key 決定週別。
- **完成定義**：相交顯示 + 逾期持續顯示 + 去重（唯一鍵）+ 完成回寫測試通過。

### P3-07 警示引擎去重與分級（含追加條件）
- **功能**：fingerprint=`rule_code+entity+baseline+period`，同指紋更新 occurrence/last_seen 不重建；**「已逾計畫完成且未完成」→ overdue**；**相對 Baseline 落後 ≥4 工作日 → behind**（1–3 工作日 attention）；**兩者同時 → overdue**；ack/snooze/close 之理由、期限、歷史分別驗證。
- **資料表·API**：`alerts`、`alert_rules`；`GET /alerts`、`POST /alerts/{a}/ack|snooze|assign|close`。
- **測試輸入**：(a) 落後 3 工作日；(b) 落後 4 工作日；(c) 已逾計畫完成且未完成；(d) 同時逾期且落後 ≥4；(e) 同指紋兩次；(f) ack 無理由；(g) snooze 無到期；(h) close 後查歷史。
- **預期結果**：(a) attention；(b) behind；(c) overdue；(d) overdue（優先）；(e) occurrence=2 且不新增列；(f)(g) → 422；(h) 狀態轉換與理由/期限入歷史、可查。
- **完成定義**：分級四情境 + 去重 + ack/snooze/close 理由·期限·歷史測試通過；條件解除→closed 保留。

### P3-08 專案健康度與事件串接（含交易/冪等追加條件）
- **功能**：project.health = 最高未關閉警示級；**事件寫入與業務變更同一交易**；worker 依 aggregate version 串行、**以事件 ID／aggregate version 防重複作用**、失敗退避、dead-letter。
- **資料表·API**：`projects.health`、`job_outbox`（event_id, aggregate_version, state, attempts）；worker（背景）。
- **測試輸入**：(a) 觸發 behind 後讀 health；(b) 業務寫入與 outbox 於同交易，模擬提交失敗 → 兩者皆回滾；(c) 同 event_id 重投；(d) 首次消費拋錯後重試。
- **預期結果**：(a) health=behind；(b) 無「業務已寫但事件遺失」或反之；(c) 重複作用被防止（冪等）；(d) 退避重試成功或達上限進 dead-letter。
- **完成定義**：health 計算 + 同交易 + 冪等/重試/dead-letter 測試通過。

### P3-09 RBAC 與跨案 IDOR（真實資料庫整合測試）
- **功能**：Lead 審查核准、Engineer 僅本人實績、QA 審核、Viewer 只讀；跨案存取拒絕（服務層逐筆 scope）。
- **資料表·API**：全 Phase 3 端點。
- **測試輸入**（於真實 DB 整合測試執行）：(a) Engineer 改他人審查；(b) Viewer 寫交付物；(c) A 案使用者存取 B 案 review/deliverable。
- **預期結果**：(a)(b) → 403；(c) → 404（不洩存在性）；皆記稽核。
- **完成定義**：每類端點 ≥1 權限負例 + ≥1 跨案 IDOR 負例，於真實資料庫整合測試通過。

### P3-10 全數納入 CI
- **功能**：Phase 3 API 整合測試層（真實 PostgreSQL）＋對應 migration/seed 納入 CI。
- **資料表·API**：CI workflow 新增「API 整合測試」步驟（沿用 service container + migrations + seed + DB 規則測試）。
- **測試輸入**：CI 於全新 DB 執行 P3-01～P3-09 整合測試 + 既有 scheduler 單元、DB 規則、smoke。
- **預期結果**：全部通過方為綠；任一失敗即轉紅。
- **完成定義**：lint / typecheck / test / build / migration / seed / DB 規則 / smoke / Phase 3 整合測試在 CI 全綠。

---

## 3. Phase 3 總完成定義
P3-01～P3-09 各正負例測試通過並由 P3-10 納入 CI；既有門檻持續全綠；審查/交付/會議/週工作/警示之狀態機、去重、分級、事件串接（同交易＋冪等）與 RBAC/IDOR 皆有正負例佐證。
