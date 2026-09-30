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

## 缺口與後續補強計畫（優先序）

1. **限制型別全覆蓋**：SNET/SNLT/FNET/FNLT/MSO/ALAP 各一案例（順向下界、逆向上界、與錨點衝突）。
2. **負 lag 邊界**：超過 D06 上限（預設 30 工作日）→ `lag_out_of_bounds`；負 lag 造成 start>finish/非法日期 → 拒絕。
3. **free float 專測**：一前置分歧至多後續，驗證單一任務延後而不推遲任一後續 earliest 的最小 slack。
4. **超期關鍵**：MFO/固定實績造成負浮時，`critical=true` 且標記超期。
5. **statusDate 進行中重排**：actualStart 已設、未完成，僅剩餘段依 statusDate 之後重排，前段固定。
6. **跨日曆相依**：前置與後續採不同日曆/時區，界限以 UTC 事件比較後換算。
7. **property-based**（§10）：隨機 DAG + 日曆，驗證拓樸序不變、相依界限恆成立、add/subtract 往返一致、相同輸入同 hash。
8. **多案隔離效能**：多專案不同日曆併行重算，版本隔離與 P95。
9. **Baseline/late_days（服務層）**：於 API 整合測試層驗證基準不可變與 `late_days` 計算（非 scheduler 純函式範圍）。

上述缺口不影響本輪驗收（CI 門檻、SS 平行測試），列為 Phase 2 收尾與 Phase 3 前的測試補強項目。
