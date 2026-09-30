# Scheduler 測試覆蓋對照表

對照《MEP Phase 0 架構規格 v0.6》§7 案例（T01–T10）、§10 R03，與排程核心行為維度。
狀態：✅ 已覆蓋　⚠️ 部分覆蓋　❌ 未覆蓋（缺口）

現有測試檔：
- `packages/scheduler/test/calendar.test.ts`（工作時間引擎，9 測試）
- `packages/scheduler/test/schedule.test.ts`（CPM 與案例，11 測試）
- 合計 **20 測試全過**（`npm test`）。

## 規格案例對照（§7 / §10）

| 案例 | 內容 | 測試 | 狀態 |
|---|---|---|---|
| T01 | 週五掛件、單一 1d FS，前一工作日完成、週末略過 | `T01…` | ✅ |
| T02 | 基設 5d、協調 3d SS+1d，B 於 A 開始後一工作日啟動、允許重疊 | `T02…` | ✅ |
| R03 | 基本設計 vs 建築/結構/MEP 同步協調 SS 並行；明列雙方 start/finish，協調在基設完成前開始 | `R03 平行協調…` | ✅ |
| T03 | FS−4h 與午休，後續於前項完成前 4 工作小時開始（負 lag） | `T03…` | ✅ |
| T04 | FF、SF 各一鏈，界限依 finish/start 公式、無倒置 | `T04…` | ✅ |
| T05 | 假日 → 任務按 project calendar 略過假日 | `T05…` + `假日例外…` | ⚠️（專案日曆假日已覆蓋；資源個人休假容量另屬負荷層，未涵蓋） |
| T06 | 循環、孤立、負工期 → 預覽拒絕並列節點/邊 | `T06…` | ✅ |
| T07 | MustFinishOn 晚於掛件允許日 → scheduling conflict | `T07…` | ✅ |
| T08 | Baseline 後延誤、已完成任務：基準/實績不變，未完項重排 | `T08…` | ⚠️（實績鎖定已覆蓋；Baseline 不可變與 late_days 屬 DB/服務層，scheduler 未涵蓋） |
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
| 負 lag | T03（FS−4h） | ✅ |
| 負 lag 上限（D06）拒絕 | — | ❌ 缺口 |
| 負 lag 導致非法日期拒絕 | — | ❌ 缺口 |
| 假日（專案日曆） | T05、`假日例外…` | ✅ |
| 個人休假/資源容量扣除 | — | ❌ 缺口（屬負荷層 §7 負荷，尚未實作） |
| 循環相依 | T06 | ✅ |
| 孤立/未連通錨點 | T06 | ✅ |
| 負工期 | T06 | ✅ |
| 限制 MFO | T07 | ✅ |
| 限制 SNET/SNLT/FNET/FNLT/MSO/ALAP | — | ❌ 缺口（僅 MFO 有案例） |
| 實績鎖定（actualStart/Finish） | T08 | ✅ |
| statusDate 剩餘重排 | T08（有帶入 statusDate） | ⚠️ 部分（未針對「進行中、僅剩餘段重排」單獨斷言） |
| 總浮時 total float | T01、R03、T10 | ✅ |
| 自由浮時 free float | R03（間接） | ⚠️ 部分（無多後續分歧的 free float 專測） |
| 關鍵路徑 critical | T01、R03、T10 | ✅ |
| 超期關鍵（負浮時標記） | — | ❌ 缺口 |
| 冪等 input/result hash | T09 | ✅ |
| 跨日曆相依（UTC 比較後換算） | — | ❌ 缺口 |
| 工作時間引擎（add/subtract/between/countDays/snap） | calendar.test.ts | ✅ |
| Baseline 不可變/late_days | — | ❌ 缺口（DB/服務層職責，非純函式 scheduler） |
| property-based（拓樸序、界限、往返、hash 一致，§10） | — | ❌ 缺口 |

## 缺口與後續補強計畫（依優先級）

優先級定義：
- **P0｜Phase 2 核心規則必補**：直接對應 §7 排程演算法正確性，缺少即代表核心規則未被證明；Phase 2 收尾前必須補齊。
- **P1｜Phase 2 收尾**：健全性與品質門檻（§10 覆蓋率、property-based），Phase 2 完成定義的一部分。
- **P2｜跨階段/服務層**：屬 DB/服務層或後續階段職責，於相應階段的整合測試層驗證。

| # | 缺口 | 對應規格 | 優先級 |
|---|---|---|---|
| G1 | **限制型別全覆蓋** SNET/SNLT/FNET/FNLT/MSO/ALAP（順向下界、逆向上界、與錨點衝突各一） | §7 關係界限/限制；§7 schedule 偽碼「apply MustFinishOn/…」 | **P0** |
| G2 | **負 lag 邊界**：超過 D06 上限（預設 30 工作日 =14400 分）→ `lag_out_of_bounds`；負 lag 造成 start>finish/非法日期 → 拒絕 | D06；§7「負 lag 可重疊，但不得違反 start≤finish」 | **P0** |
| G3 | **free float 專測**：一前置分歧至多後續，驗證單一任務延後而不推遲任一後續 earliest 的最小 slack；並與 total float 區辨 | §7「自由浮時為本任務延後而不推遲任一後續 earliest 的最小 slack」 | **P0** |
| G4 | **跨日曆相依**：前置與後續採不同日曆/時區，lag 以邊指定日曆換算，界限以 UTC 事件比較後換算 | §7「跨日曆相依比較 UTC 事件後轉換」；`lag` 使用相依邊指定日曆 | **P0** |
| G5 | **超期關鍵（負浮時標記）**：MFO/固定實績造成負浮時，`critical=true` 且標記超期關鍵 | §7「若已有負浮時需標為超期關鍵」 | P1 |
| G6 | **statusDate 進行中重排**：actualStart 已設、未完成，僅剩餘段依 statusDate 之後重排，前段固定 | §7「狀態日之前已完成片段固定，剩餘片段重排」 | P1 |
| G7 | **property-based**（隨機 DAG+日曆：拓樸序不變、相依界限恆成立、add/subtract 往返一致、相同輸入同 hash） | §10「algorithm unit + property-based」；核心覆蓋≥90% | P1 |
| G8 | **多案隔離效能**：多專案不同日曆併行重算，版本隔離與 P95（T10 延伸） | §7 T10；§1 驗收尺度 | P2 |
| G9 | **Baseline 不可變 / late_days**：基準快照不可 UPDATE、`late_days=max(0,countWorkingDays(baseline.finish,forecast.finish))` | §7 基準/進度；R05 | P2（服務層） |
| G10 | **實績鎖定進階**：完成=100 須完成日期、完成日期須 100% 的一致性（scheduler 已鎖定 actual，DB CHECK 已有；需整合測試斷言） | §7 進度規則 | P2（服務層） |

**P0 為本專案下一步（Phase 2 收尾）優先補強對象**：G1 限制型別、G2 負 lag 邊界、G3 free float、G4 跨日曆。
上述缺口皆不影響本輪已接受之驗收（CI 門檻、SS 平行案例、smoke 正負例）。
