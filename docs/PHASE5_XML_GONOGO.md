# Phase 5 — Microsoft Project XML 技術閘門 Go/No-Go 報告

狀態：供業主裁決。本報告說明 MSP XML（XML Data Interchange）匯入／匯出的技術驗證範圍、
安全姿態、已知不可等價與限制，以及桌面 Microsoft Project 的實測依賴。

## 1. 範圍與對應（已實作並測試）

- 格式：匯入 `format=xml`、匯出 `format=xml`（與 CSV/XLSX/CSV package 並列）。
- 解析器：`apps/api/src/exchange/msp-xml.ts`，對應至既有 canonical sheets（Tasks/Resources/Assignments），
  再經既有 normalizer、驗證、排程與 round-trip，規則與其他格式一致。
- ConstraintType 0..7 → ASAP / ALAP / MSO / MFO / SNET / SNLT / FNET / FNLT（官方順序）；
  非 0/1 需 ConstraintDate（由既有驗證強制）。
- PredecessorLink.Type 0/1/2/3 → FF/FS/SF/SS。
- **LinkLag 單位為十分之一分鐘**：`LinkLag=-40` → **−4 分鐘**（÷10）；匯出時 ×10。
- Duration/Work：ISO-8601 `PTnHnMnS` → 整數分鐘；**小數分鐘精度不支援 → 明確報錯 `xml_precision`，不靜默截斷**。
- 日期：MSP 本地時間，無時區標記；由上傳時指定來源時區套用（與 CSV 一致）。本系統匯出一律 UTC，
  再匯入時以 `timezone=UTC` 宣告（與 CSV/XLSX round-trip 慣例相同）。
- 身分：Task `UID` 作外部識別（同時填入 canonical `Unique ID` 與 `ID`，使前置關係可解析）；`GUID` 若有則保留。

官方來源：
- https://learn.microsoft.com/en-us/office-project/xml-data-interchange/constrainttype-element?view=project-client-2016
- https://learn.microsoft.com/en-us/office-project/xml-data-interchange/predecessorlink-element?view=project-client-2016

## 2. 安全姿態（XXE/DTD）

- 自備嚴格解析器，**拒絕 DTD／`<!ENTITY>`（`xml_dtd_forbidden`）**，不解析外部實體，
  僅接受 5 個預定義實體與數值字元參考，其他實體一律 `xml_entity_forbidden`。
- 不發出任何網路請求（無外部實體載入）；節點深度上限、檔案 10 MiB 上限。
- 跨案拒絕：`SubProjects`／`ExternalTask`／`ExternalUID` → `cross_project`。
- 上傳 MIME/檔頭檢查：僅接受 `<?xml` 或 `<Project>` 開頭；XML 不走 ZIP 簽章。

## 3. 測試證據（本地）

- 單元（`apps/api/test/exchange/msp-xml.test.mjs`，隨 `test:exchange` 於 CI 執行）：
  ConstraintType 0..7；PredecessorLink Type 與 LinkLag −40→−4；小數分鐘精度拒絕；
  DTD/XXE 拒絕；跨案拒絕；write→read 核心 round-trip（UID/Duration/Constraint/lag 保存）。
- 整合（`apps/api/test/integration/exchange_xml.test.mjs`，真實 DB+API）：
  匯入 XML → 提交 → 匯出 XML → 匯入隔離案件，工作數與相依關係等價。

## 4. 已知不可等價與限制（自動報告 / 本報告揭露）

- 小數分鐘精度：不支援，報錯而非截斷（刻意）。
- 匯出時間為 UTC；再匯入須宣告 `timezone=UTC`。與 MSP 桌面產生的本地時間 XML 相比，
  時區語意由上傳宣告決定。
- 匯出 `GUID` 以本系統內部 UUID 表示（合法 GUID 格式），用於 round-trip 身分對應；
  若來源另有 MSP GUID，匯入時保留來源 GUID。
- 目前 XML 對應聚焦於 Tasks 圖（名稱／WBS／階層／日期／工期／工時／進度／里程碑／限制／
  前置關係／Baseline 起訖）與基本 Resources/Assignments；資源日曆、完整 Baseline 指派、成本（Cost）
  等欄位未納入 XML 交換（CSV package／XLSX 提供較完整交換）。round-trip 報告會列出逐欄差異。
- 多數 MSP 專屬欄位（檢視、格式、OLE、公式）忽略不匯入。

## 5. 桌面 Microsoft Project 實測依賴（UAT）

**尚未**於真實 Microsoft Project 桌面應用開啟／另存驗證（執行環境無 Project）。
本閘門為官方 schema 欄位語意與獨立 fixture 的「技術」驗證，不等同桌面相容性驗收。

建議 UAT（業主端）：
1. 以本系統匯出 `project.xml`，於 Microsoft Project 桌面開啟，核對工作、相依（含 lag）、限制、里程碑。
2. 於 Project 桌面另存為 XML，回匯本系統，核對圖等價與逐欄 round-trip 報告。
3. 針對 LinkLag 單位（十分之一分鐘）與 ConstraintType 邊界（SNET/FNLT）各準備一例。

## 6. 裁決建議

- **GO**：作為程式化 XML 交換（上述欄位範圍、UTC 慣例、安全拒絕），技術驗證通過，CI 覆蓋。
- **NO-GO（待 UAT）**：在完成 §5 桌面實測前，不宣稱「Microsoft Project 桌面已驗收」；
  不可等價項以 round-trip 報告與本文件揭露。
