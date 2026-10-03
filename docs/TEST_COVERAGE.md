# Scheduler 測試覆蓋對照表

對照《MEP Phase 0 架構規格 v0.6》§7 案例（T01–T10）、§10 R03，與排程核心行為維度。
狀態：✅ 已覆蓋　⚠️ 部分覆蓋　❌ 未覆蓋（缺口）

現有排程測試：`calendar.test.ts`、`schedule.test.ts`、`constraints.test.ts`、`phase2.test.ts`、`property.test.ts`，合計 **49 測試**（`npm test`）。

跨層驗證另見 `apps/api/test/integration/dashboard_workload.test.mjs`、DB 規則測試與 [Phase 4 驗收追溯](PHASE4_ACCEPTANCE.md)。測試數量與程式碼覆蓋率是不同指標，不以案例數宣稱 90% 覆蓋率。

## 規格案例對照（§7 / §10）

| 案例 | 內容 | 測試 | 狀態 |
|---|---|---|---|
| T01 | 週五掛件、單一 1d FS，前一工作日完成、週末略過 | `T01…` | ✅ |
| T02 | 基設 5d、協調 3d SS+1d，B 於 A 開始後一工作日啟動、允許重疊 | `T02…` | ✅ |
| R03 | 基本設計 vs 建築/結構/MEP 同步協調 SS 並行；明列雙方 start/finish，協調在基設完成前開始 | `R03 平行協調…` | ✅ |
| T03 | FS−4h 與午休，後續於前項完成前 4 工作小時開始（負 lag） | `T03…` | ✅ |
| T04 | FF、SF 各一鏈，界限依 finish/start 公式、無倒置 | `T04…` | ✅ |
| T05 | 假日 → 任務按 project calendar 略過假日 | `T05…` + `假日例外…` | ✅（專案日曆單元測試＋Phase 4 資源假期容量整合測試） |
| T06 | 循環、孤立、負工期 → 預覽拒絕並列節點/邊 | `T06…` | ✅ |
| T07 | MustFinishOn 晚於掛件允許日 → scheduling conflict | `T07…` | ✅ |
| T08 | Baseline 後延誤、已完成任務：基準/實績不變，未完項重排 | `T08…` | ✅（實績鎖定、late_days 單元測試＋G9 DB 不可變快照） |
| T09 | 重複重算相同輸入 → 相同 result hash | `T09…` | ✅ |
| T10 | 5000 tasks、效能門檻 | `T10…` | ⚠️（單案 5000 已覆蓋 <5s；多案不同日曆隔離未涵蓋於單元層） |

## 行為維度對照

| 維度 | 測試 | 狀態 |
|---|---|---|
| 關係 FS | T01、T03、T06–T08 | ✅ |
| 關係 SS | T02、R03 | ✅ |
| 關係 FF | T04 | ✅ |
| 關係 SF | T04 | ✅ |
| 正 lag | T02、R03（SS+1d） | ✅ |
| 負 lag | T03（FS−4h）、G2 正例 | ✅ |
| 負 lag 上限（D06）拒絕 | G2（自訂上限、預設 14400 分） | ✅ |
| 假日（專案日曆） | T05、`假日例外…` | ✅ |
| 個人休假/資源容量扣除 | dashboard_workload.test.mjs（假期、日曆繼承、每日明細、零容量） | ✅ |
| 循環相依 | T06 | ✅ |
| 孤立/未連通錨點 | T06 | ✅ |
| 負工期 | T06 | ✅ |
| 限制 MFO/FNLT/SNET（原規格）+ ASAP | T07、G1（正+負例） | ✅ |
| 限制 SNLT/FNET/MSO/ALAP（新增，不改規則） | G1（正+負例） | ✅ |
| 實績鎖定（actualStart/Finish） | T08 | ✅ |
| statusDate 進行中剩餘重排 | G6（正+負例） | ✅ |
| 總浮時 total float | T01、R03、T10 | ✅ |
| 自由浮時 free float | G3（驅動 0 / 非驅動 >0，與 total 區辨） | ✅ |
| 關鍵路徑 critical | T01、R03、T10 | ✅ |
| 超期關鍵（負浮時標記 overCritical） | G5（實績晚於掛件、落後傳遞至錨點） | ✅ |
| 冪等 input/result hash | T09 | ✅ |
| 跨日曆相依（UTC 比較後換算） | G4（台北×UTC 日曆） | ✅ |
| 工作時間引擎（add/subtract/between/countDays/snap） | calendar.test.ts | ✅ |
| late_days（§7 逾期工作日） | G9（純函式，正+邊界） | ✅ |
| Baseline 不可變（快照 UPDATE/DELETE 拒絕） | G9（DB 觸發器，`db/tests`） | ✅ |
| 實績一致性（完成=100↔完成日期） | G10（DB CHECK，`db/tests`） | ✅ |
| property-based（拓樸序、界限、往返、hash 一致，§10） | G7（隨機 DAG+日曆，80/300/40 次） | ✅ |

## 缺口與後續補強計畫（依優先級）

優先級定義：
- **P0｜Phase 2 核心規則必補**：直接對應 §7 排程演算法正確性，缺少即代表核心規則未被證明；Phase 2 收尾前必須補齊。
- **P1｜Phase 2 收尾**：健全性與品質門檻（§10 覆蓋率、property-based），Phase 2 完成定義的一部分。
- **P2｜跨階段/服務層**：屬 DB/服務層或後續階段職責，於相應階段的整合測試層驗證。

| # | 缺口 | 對應規格 | 優先級 | 狀態 |
|---|---|---|---|---|
| G1 | 限制型別全覆蓋 SNET/SNLT/FNET/FNLT/MSO/ALAP | §7 關係界限/限制 | P0 | ✅ 已完成（`constraints.test.ts`，14 測試） |
| G2 | 負 lag 邊界：超過 D06 上限 → `lag_out_of_bounds` | D06；§7 | P0 | ✅ 已完成（`phase2.test.ts`） |
| G3 | free float 專測，與 total float 區辨 | §7 自由浮時 | P0 | ✅ 已完成（`phase2.test.ts`） |
| G4 | 跨日曆相依：UTC 事件比較後換算 | §7 跨日曆 | P0 | ✅ 已完成（`phase2.test.ts`） |
| G5 | 超期關鍵（負浮時標記，overCritical） | §7 | P1 | ✅ 已完成（`schedule.ts`+`phase2.test.ts`，正例與對照） |
| G6 | statusDate 進行中剩餘重排 | §7 狀態日 | P1 | ✅ 已完成（`phase2.test.ts`，正+負） |
| G7 | property-based（隨機 DAG+日曆） | §10 | P1 | ✅ 已完成（`property.test.ts`） |
| G8 | 多案隔離效能（T10 延伸） | §7 T10；§1 | P2 | ✅ Phase 4 完成（500 案 / 2.5M tasks、P95、EXPLAIN、無 N+1；見 PHASE4_ACCEPTANCE.md） |
| G9 | Baseline 不可變 / late_days | §7 基準/進度；R05 | P2 | ✅ 已完成（late_days 純函式 + DB 觸發器 `db/tests/g9…`） |
| G10 | 實績一致性（完成=100↔完成日期） | §7 進度規則 | P2 | ✅ 已完成（DB CHECK `db/tests/g10…`） |

**Phase 2 收尾已完成**：G1、G2、G3、G4、G5、G6、G7、G9、G10（含開工前門檻之 G9 起日修正、G2 重疊斷言、G4 非工作時段、G5 超期關鍵、G7 property-based）。
**G1–G10 已有對應證據**：G8 已於 Phase 4 完成核定 Dashboard 讀取範圍的多案實測。這不替代 Phase 6 的多人並行、持續壓力、安全與災難復原測試。
