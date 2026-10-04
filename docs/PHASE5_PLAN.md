# Phase 5 — Microsoft Project 匯入／匯出計畫

狀態：**業主已確認，實作與驗證進行中**。基線 main `4c0fcf4a`，Phase 4 已驗收並合併；依 Master Prompt §16「每一階段先提出計畫與驗收案例，獲確認後再實作」。本文件不宣稱 Phase 5 已完成。

## 1. 範圍與現況

必交付：CSV / XLSX 欄位映射、檔案上傳、預覽、逐列驗證、dry run、原子提交、工作／階層／相依／資源／指派／進度／Baseline 交換、冪等與衝突防護、轉換報告、範例檔、API、操作 UI、真實 DB / E2E / round-trip 與 CI。

MSP XML：先做技術驗證，通過 schema／Tasks／Resources／Assignments／Calendars 與 round-trip 門檻即納入；未通過則保留具體阻塞報告與業主決策，不以副檔名或自製 XML 宣稱相容。二進位 `.mpp` 不在本階段。

已存在：`import_jobs`、`export_jobs`、`external_id_map`、`resource_aliases`、不可變 Baseline、job_outbox、AuditService、org/project scope 與排程引擎。Project 交換 controller/service/UI 已建立於 PR #2；完整完成定義仍依本計畫逐項驗證。頁 C 的負荷 CSV 不取代 Project 工作交換。

不改動：掛件錨定、已核定排程規則、實績保留、Baseline 不可變、逐案法定審查適用性、即時 Dashboard SQL。

## 2. 重要設計決策（已確認）

| 決策 | 建議方案 | 替代方案 | 理由、影響與確認事項 |
|---|---|---|---|
| P5-D01 格式 | CSV + XLSX 必做；XML 先技術驗證後按結果實作 | XML 同時列硬交付 | 遵守 Master Prompt「如技術可行」；確認 XML 採技術驗證閘門；不支援直接讀 .mpp |
| P5-D02 初期匯入 | create-only 預設；更新已有工作須明確選 upsert-by-external-id | 全案覆蓋 | 不因檔案缺列刪除工作；禁止名稱/WBS/行號偷偷匹配；確認 create-only + 顯式 upsert，無 destructive replace |
| P5-D03 匯入日期 | 保存有效來源計畫日期，先跑排程可行性與差異預覽；重算為另一項明確操作 | 提交時自動採引擎重算結果 | 原始日期不被無聲重排；掛件衝突或非法相依拒絕。確認預設不自動重算，source 日期差異可追溯 |
| P5-D04 多人 Work | 指派 sheet 優先；僅 task Work + 多人姓名時，提供等分建議，需逐筆確認分配且總和守恆才提交 | 按 Units 比例或拒絕所有缺指派檔 | 防止每人重複灌整份 Work；Units 缺值提議 1.0 並要求確認；無姓名 Work 保存為未指派需求。確認此預覽流程 |
| P5-D05 Baseline | 匯入為新不可變快照，預設 superseded；啟用需 PM/Admin 顯式選擇 | 一律拒絕 Baseline 或自動取代 active | 不覆寫既有 baseline_tasks/assignments；確認匯入不自動變 active |
| P5-D06 身分與儲存 | 沿用既有 scope；私有 object storage 介面，本機 private directory adapter；metadata/preview 在 PG | 公開上傳目錄／所有檔案塞 DB | 不依賴 Cloudflare 部署先完成；下載需逐次授權。確認本機 adapter 用於開發，production 用私有雲端 adapter |
| P5-D07 UI | 案件交換頁：上傳→映射→預覽解衝突→提交；匯出與歷史 | 只交 API / CLI | 內部人員可自行操作，原三頁新增案件交換入口；確認包含可操作 UI |
| P5-D08 限額 | 壓縮檔 10 MiB、總解壓 100 MiB、5,000 工作、20,000 指派／相依各自上限；可設定 | 不設上限 | 對齊單案設計容量、防 zip bomb；超限先拒絕。確認預設與可調整設定 |

## 3. 標準欄位映射

必要欄位順序固定如下；空值是否允許按欄位語義驗證，不把「必要欄位」等同「每列必有值」。匯出 Tasks 保持這個順序，擴充欄接在後方。中文表頭透過映射，不散落硬編碼。

| 欄位 | 系統目的欄位 / 行為 |
|---|---|
| Task Name | project_tasks.name；非空 |
| WBS | wbs_code；案內重複驗證，不能當永久身分 |
| Outline Level | 由列順序堆疊重建 parent_task_id；>=1，不可跨級跳躍 |
| Start / Finish | planned_start / planned_finish；成對且完成>=開始，UTC 儲存 |
| Duration | duration_minutes；0d 里程碑、h/min/d 換算，非負 |
| Predecessors | task_dependencies；FS/SS/FF/SF、正負 lag，多前置 |
| Resource Names | 資源精確／別名解析；每人獨立指派，不複製整份 Work |
| Work | 各有效指派 planned_work_minutes 合計；無資源則未指派 Work |
| % Complete | percent_complete 0–100；符合實績一致性 CHECK |
| Baseline Start / Finish | 新版 baseline_tasks；不可 UPDATE 原快照 |
| Milestone | milestone；必須 Duration=0 |
| Constraint Type / Date | ASAP/ALAP/MSO/MFO/SNET/SNLT/FNET/FNLT，非 ASAP/ALAP 需日期 |
| Notes | 備註純文字；UI 不執行 HTML |
| Unique ID / GUID | external_id_map；兩欄皆有時保留兩者與對照，GUID 優先 |

擴充欄：ID、Actual Start/Finish、Remaining Duration、System Code、Calendar Code、Summary、External Project、Task Type。XLSX 另提供 Assignments（Task GUID/UID、Resource GUID/Code、Units、Planned/Actual/Remaining Work、Start/Finish、Booking Type、Contour）、Resources、Calendars 與 Exceptions、Baselines、Metadata sheets。CSV 的必要 Tasks 檔仍可獨立映射；完整系統 round-trip 用多檔 CSV package（有 manifest 與 schema version）或多 sheet XLSX。Cost 僅授權者匯出；缺失、不支援或轉換損失列入報告。

## 4. 解析規則

- CSV：RFC 4180 引號／換行／逗號；UTF-8 可有 BOM。Big5 須使用者顯式選編碼，不猜碼；分隔符另設定，避免與欄內多前置分隔混淆。
- 日期：預設 ISO 8601 含 offset，或明確的 locale/date-format + IANA timezone。拒絕歧義 01/02/2027；純日期依明示的 start/finish 時段映射，不擅自午夜/18:00。XLSX 日期採 workbook 1900/1904 系統正確換算；不接受不存在日期。
- Duration：內部整數分鐘；d 用所選日曆 hours_per_day，不假設 24h/8h；無法整分鐘表示者報精度損失並拒絕或顯式確認。Elapsed duration（ed/eh）、週/月與自動/估計工期先報 unsupported，不默默當 working duration。
- Predecessors：`12FS+2d;8SS-4h`，關係可省略為 FS，lag 可省略為0；全字串解析，拒絕尾端垃圾、自相依、重複矛盾、未知 ID、非法 lag。**MSP 一般 Predecessors 的 ID 不等同 Unique ID**：預設指向明示 ID 欄；使用 UID 模式須顯式設定。缺 ID 的檔案須映射來源任務識別，不把實體行號當 ID。跨案拒絕，外部 project 欄不能開啟 portfolio dependency。
- 階層：Outline Level 優先，WBS 一致性校验；只有 WBS 時指定明確分隔／父節點規則。摘要日期由子工作彙整，不直接排程摘要；摘要列彙總 Work 不重複計入指派。
- 資源：同 org 的有效 code/GUID → 精確名稱 → 唯一 alias；多個同名、未知、跨 org 不自動匹配。未知者進待建立，須具建立權限且在原子交易內建立；停用資源報錯。預覽提供 resource UUID 映射；重跑需版本再驗。
- Units 與 Work 分別解析；多人 Work 分配整數餘數有穩定分配次序，合計相等。原匯入不能改寫其他案件資源容量；資源更新另有權限与衝突策略。
- % Complete=100 須有 Actual Finish，缺值要求補欄，不自動拿 planned Finish 冒充實績；已存在 actual 欄不由空值或重排覆寫。
- 掛件：使用者在預覽明確映射唯一錨點／確認現有錨點；0工期且日期與 project.permit_filing_date 規則一致。名稱／WBS=0.0 不能自動當錨點，法定審查日期不能取代掛件日。

## 5. 預覽與原子提交

1. RBAC + project scope 驗證，上傳私有區，檔案 hash / MIME / 大小 / 解壓上限／病毒掃描（未完成掃描不可解析提交）。
2. 建 import job + audit；解析正規模型（工作、相依、資源、指派、日曆、Baseline），逐列錯誤／警告、候選映射、dry run 排程與前後差異。
3. 保存 immutable preview payload/hash + file hash + mapping hash + schema/parser version + user decision hash；交易外的預覽不是提交成功。
4. 使用者補映射／解歧義／確認警告，生成新 preview revision。舊 preview 不可覆蓋；無 errors 且所有 blocking decisions 解完才准提交。
5. 提交附 Idempotency-Key、If-Match/job version、preview token。鎖 project 與被觸及實體；再次確認 project/task/resource/calendar/version vector 與 active baseline ID；任何 drift 回409 preview_stale，禁止 TOCTOU。
6. 同一 DB transaction 寫 task/hierarchy/dependency/assignment/external IDs／新 Baseline、audit、outbox、job success。排程可行性重新核對；任一失敗整筆 rollback。
7. failed job 記錄與失敗稽核在回滾後獨立寫入；不能讓失敗寫入洩漏部分業務資料。下載輸出物需先完整寫入／核對 hash，再發布 result key。
8. 同 key 同 payload 回同結果；同 key 異 payload 回409；worker 重投不重複建立工作／Baseline。程序中斷依 job lease/retry 復原。

新增模式僅新增。Upsert 以來源 system+external GUID/UID 對照更新白名單，保留 locked/actual/未列欄；缺列不代表刪除。刪除、取代全案或 active Baseline 需要獨立明確操作，不混入默認匯入。

## 6. 資料變更與 API

migration 從 0020 起新增，不改既有 migration。評估並補齊 import_preview_versions（normalized payload/hash/version vector/decisions/errors/warnings）、檔案 metadata/state、export idempotency/hash、external ID namespace/alias 關聯／合法型別 FK 驗證、未指派 Work 保存欄位。外部 ID 對照不可引用不存在或跨案任務；resource org scope 單獨驗證。預覽敏感資訊限制存取，保留與清理可配置；預設原檔/輸出30日、預覽90日，稽核不隨檔案清理刪除。

| 方法 | /api/v1 路徑 | 權限 / 目的 |
|---|---|---|
| GET | /exchange/schema | 授權使用者；欄位／格式版本／限制 |
| POST | /projects/{p}/imports | PM/Admin；上傳與建立 job，202 |
| GET | /projects/{p}/imports/{j} | PM/Admin；狀態、報告 |
| POST | /projects/{p}/imports/{j}/previews | PM/Admin；映射／dry run，產生不可變預覽 |
| GET | /projects/{p}/imports/{j}/previews/{v} | PM/Admin；分頁逐列 errors/warnings/changes |
| POST | /projects/{p}/imports/{j}/commit | PM/Admin；冪等／版本檢查／原子提交 |
| POST | /projects/{p}/exports | PM/Admin；格式與選定 Baseline，202 |
| GET | /projects/{p}/exports/{j} | PM/Admin；狀態／轉換報告 |
| GET | /projects/{p}/exports/{j}/download | PM/Admin；重新 scope、私有下載 |
| POST | /projects/{p}/exchange/round-trip | PM/Admin；標準化差異報告，不改正式案件 |

API 一致錯誤 envelope + correlation ID；job ID/附件 key 不繞過 project scope。Engineer/Lead/QA/Viewer 不得提交匯入或 Project 匯出（沿用 master PM 權限）。既有 Viewer 負荷 CSV 權限不等於本交換端點權限。

錯誤：422 import_format/row_invalid/predecessor_unknown/resource_ambiguous/anchor_conflict/unsupported_conversion；409 preview_stale/idempotency_conflict/duplicate_external_id；403 forbidden；跨案/跨 org 404；413 file_limit；503 scan_unavailable/storage_unavailable。使用者看欄位／列號／補救方式，不看堆疊；日誌保留 correlation 與技術細節。

事件：import.uploaded→scan.requested→import.parse→preview.ready；import.committed→alert.evaluate/dashboard.invalidate；明確重算操作才 schedule.requested。export.requested→export.render→export.ready；各業務變更/outbox 同交易，worker 依 event ID+version 防重、有限退避與 dead-letter。

## 7. UI 與安全

案件交換頁顯示來源格式、編碼／時區／日期格式、欄位映射、資源候選、錨點選擇、來源/新值差異、逐列 errors/warnings、commit 前摘要与版本。提供取消／重試與 job 歷史、匯出／差異報告下載；載入、空、錯誤、403、部分警告、大量列分頁；鍵盤操作、狀態不只顏色。

上傳 allowlist MIME+signature，拒絕 XLSM/巨集／加密 workbook/外部連結／公式 cell，不執行檔案內容；XLSX zip-entry 數量／路徑／解壓大小與壓縮比上限。XML 禁 DTD/XXE、實體／外部網路載入並限制節點深度。AV adapter 不可用時 fail closed；測試只注入可控掃描器，production 不開免掃描模式。Storage key 由伺服器生成、防 traversal、獨立權限；短時下載仍需核對 job ownership。

CSV 文字欄的 =/+/-/@ 與控制字符公式注入防護；負數 Duration/lag 不以字串淨化掩蓋，按型別驗證。Round-trip report 記錄 protective escaping 並可還原文字，XLSX 文字強制 string cell。Notes HTML 以純文字顯示。Cost、敏感資源資訊按 permission mask；批次 audit 記作業與每實體 diff 關聯，不把整檔寫進 audit_logs。

## 8. Microsoft Project 相容性與 round-trip

MSP XML 官方 ConstraintType 0..7 依次對應 ASAP/ALAP/MSO/MFO/SNET/SNLT/FNET/FNLT；除0/1需 ConstraintDate。PredecessorLink 的 LinkLag 單位為**十分之一分鐘**，不是內部分鐘；不得漏乘／漏除10。小數分鐘精度不支援須報告，不靜默截斷。

- 官方來源：https://learn.microsoft.com/en-us/office-project/xml-data-interchange/constrainttype-element?view=project-client-2016
- 官方來源：https://learn.microsoft.com/en-us/office-project/xml-data-interchange/predecessorlink-element?view=project-client-2016

標準化 round-trip：canonical graph → export → import 到隔離案件 → compare，以外部 ID對應（排除 DB UUID、job/稽核時間與允許的顯示格式差異）；比較欄位順序、階層、全部相依/lag、分鐘、各指派 Work/Units/日期、實績、進度、限制、里程碑與選定 Baseline。不得用同一 exporter 的假資料驗證自身。

另外用 Microsoft Project 桌面實際開啟 XLSX/CSV mapping 或 XML，再匯出來源驗證。若執行環境无 Project，清楚標「桌面相容性待實測」並列 UAT 依賴，不以 parser round-trip 宣稱 Project 已實際驗收。所有 loss/non-equivalence 自動報告，unsupported critical 欄位需阻擋或明確決策。

## 9. 分項驗收（五欄）

| 編號／功能 | 資料表·API | 測試輸入 | 預期結果 | 完成定義 |
|---|---|---|---|---|
| P5-01 格式/映射 | schema、imports、preview | 引號換行/中文CSV、1900/1904 XLSX；歧義日期/非法工期/重複表頭 | 正規分鐘UTC；逐列422，無 business 寫入 | 單元/fixture成功失敗與純日期邊界全過 |
| P5-02 階層/相依 | tasks/dependencies/external_id_map | 三層WBS、四種關係、12FS+2d/8SS-4h；未知ID/跳級/循環/跨案 | 父子與 lag 正確；非法图拒絕且衝突節點可查 | graph/property測試及真實DB正負例 |
| P5-03 資源/指派 | resources/aliases/assignments | 精確/alias/同名/未知；多人601min/部分Units/無人Work | 消歧義後601守恆，未知不偷建、未指派保留 | 負荷頁讀回、差異可追溯、跨org拒絕 |
| P5-04 預覽/dry run | preview_versions、imports | 產生預覽、重新映射、修改原案/資源日曆後提交 | 預覽無 business 寫入；旧token409 stale | immutable預覽、version vector及TOCTOU整合過 |
| P5-05 原子/冪等 | imports/outbox/audit | 中途故障、相同key重送、異payload、兩個並行提交 | 全回滾，無部分工作；同結果一次作用；409異內容 | DB故障注入/並行/worker重投全過 |
| P5-06 Baseline/實績 | baseline_tasks/assignments/tasks | 新快照；原Baseline更新、100無actualFinish、locked upsert | 新不可變非active；拒絕違規，原實績不變 | G9/G10與來源匯入整合皆過 |
| P5-07 匯出/差異 | exports、download、round-trip | 多人/負lag/假期/四關係/完整進度/Baseline，CSV與XLSX | 固定欄序/階層，總Work守恆；loss自動報告 | 獨立fixture→import→export→import標準化比對過 |
| P5-08 掛件/排程 | imports、scheduler | 兩案不同掛件/日曆；錯錨點、來源相依違反/超掛件 | 可行來源保存、衝突拒絕；不自動蓋實績 | 既有SS平行/負lag/constraint全部回歸 |
| P5-09 scope/惡意檔 | 全交換API/storage/scan | Viewer提交/跨案ID/zip bomb/巨集/XXE/公式/掃描不可用 | 403/404/413/422/503；无未授權資料、无公式执行 | 真實DB/安全fixture/私有下載負例過 |
| P5-10 操作 UI | React exchange 頁 | 正常上傳映射提交匯出、逐列錯誤、舊預覽、取消/重試 | 明確操作/狀態、錯誤可修正，scope同後端 | native E2E兩桌面+axe+UI六態過 |
| P5-11 XML 技術閘門 | parser/renderer/schema adapter | 官方schema fixture/0..7限制/linklag=-40/XProject/DTD | -40→-4分鐘；型別正確、跨案DTD拒絕 | schema+獨立fixture+桌面依賴報告，go/no-go供裁決 |
| P5-12 全門檻 | CI、新migration/seed | 新DB全套舊測試+Phase5；任一失敗 | CI轉紅，修復再跑，不跳過 | lint/typecheck/test/build/migration/DB/API/E2E/既有效能全綠 |

範例資料交付：成功 minimal.csv、full.xlsx／Tasks+Assignments+Resources+Calendars+Baseline CSV package、invalid_dates.csv、invalid_predecessors.csv、ambiguous_resources.csv、formula/zip/XXE 安全測試 fixtures；全為生成測試資料，不用真實敏感案件。

## 10. 實作順序、風險與完成定義

1. 本計畫確認 → P5-01/02 正規模型與純解析（先固定解析規格/偽碼/測試）。
2. P5-03/04/05/06：資源決策、private storage/scan、預覽版本、原子交易、Baseline/實績。
3. P5-07/08/09：CSV/XLSX 匯出與差異、錨點排程驗證、安全/RBAC。
4. P5-10：可操作交換 UI；P5-11 XML 技術驗證可與核心逐步推進，但不跳過相容性閘門。
5. P5-12：fresh DB/回歸/效能/安全/E2E，補永久報告；有錯先重現→根因→最小修復→失敗例→全門檻。

風險與依賴：MSP 的工作日／日期格式與本系統不同、多人Work來源不完整、官方XML分鐘精度差、DB預覽TOCTOU、附件惡意內容、AV與私有雲儲存、桌面Project環境。每項以正規模型／顯式預覽／版本鎖／fail closed／獨立fixture與UAT證據處理，未驗證者列出，不假裝完成。

總完成定義：P5-01～10/12逐項通過，XML有可審查go/no-go及相應交付；全部必要欄可匯入匯出，原子回滾/冪等/權限/稽核具證據；至少成功與失敗範例、標準化round-trip自動差異、既有Phase1–4 CI持續綠；文件揭露不能無損與桌面Project實測依賴。不得只完成Tasks CSV就宣告Phase5全部完成。
