# Phase 5 驗收追溯與證據（P5-01 ～ P5-12）

本文件將 `PHASE5_PLAN.md` §9 的分項驗收對應到實際程式與測試證據，並區分
**本地（fresh PostgreSQL 16 + API）／CI（權威）／桌面 UAT** 三種證據層級。
PR #2 保持 draft，未合併、未部署。

## 證據基線（本地，commit 9102e56 之工作樹）

- 單元：scheduler 49；exchange 解析＋XML 閘門 27；web 47（含非同步輪詢、profile 決策）。
- 整合（真實 DB+API，序列執行）：127。
- Browser E2E（1280×720 與 1920×1080）：18；含 axe WCAG 2.1 AA 自動檢查。
- DB 規則：G9 Baseline 不可變、G10 實績一致，皆 PASS。
- 效能：dashboard 250 萬任務門檻（CI 步驟）；本地量測 typical API p95≈1.37s、large p95≈2.53s（<3s）。
- 遷移：至 0022（0020 預覽、0021 保存期限、0022 非同步 worker 佇列）；seed 正常。
- build / lint / typecheck 全綠。CI 為權威閘門（最新 commit 由 PR #2 CI 驗證）。

## 分項追溯

| 編號 | 功能 | 主要程式 | 測試／證據 | 層級 | 狀態 |
|---|---|---|---|---|---|
| P5-01 | 格式/映射 | parser.ts, formats.ts, csv-package.ts | test/exchange/parser.test.mjs（引號換行/BOM/重複表頭/歧義日期/DST/1900-1904/純日期邊界）；integration/exchange.test.mjs | 本地+CI | ✅ |
| P5-02 | 階層/相依 | parser.ts（outline stack、拓撲）, exchange.service prepare | parser.test.mjs（跳級/循環/自相依/四關係/lag）；exchange.test.mjs 真實 DB 正負例；external_id_map | 本地+CI | ✅ |
| P5-03 | 資源/指派 | exchange.service（resolveResource、Work 守恆、units） | exchange.test.mjs（多人 Work、未知/歧義、null Units 拒絕）；dashboard_workload 讀回；跨 org 404 | 本地+CI | ✅ |
| P5-04 | 預覽/dry run | exchange.service preview、0020 immutable preview、vector() | exchange.test.mjs（preview_stale TOCTOU、不可變預覽、版本向量）；exchange_lifecycle | 本地+CI | ✅ |
| P5-05 | 原子/冪等 | exchange.service commit（SERIALIZABLE、Idempotency-Key）、outbox.service | exchange.test.mjs（半途回滾、同 key 重放、異 payload 409）；outbox.test.mjs（worker 一次、冪等重投、dead-letter、>20 積壓持續消費） | 本地+CI | ✅ |
| P5-06 | Baseline/實績 | exchange.service（Baseline 快照、COALESCE 保留實績）、0008/0015 | exchange.test.mjs（Task/Assignment Baseline 工時、跨案重匯快照）；db/tests G9/G10 | 本地+CI | ✅ |
| P5-07 | 匯出/差異 | exchange.service generateExport、formats.writeCsv/Xlsx、csv-package、round-trip.ts | exchange.test.mjs（CSV/XLSX/CSV package round-trip、文字防護、同 key 形狀固定/異格式 409）；exchange_xml round-trip | 本地+CI | ✅ |
| P5-08 | 掛件/排程 | exchange.service prepare（錨點、來源日期/日曆/限制/相依驗證）、scheduler | exchange.test.mjs（source_calendar/duration/constraint/dependency_conflict、anchor_conflict）；scheduler 49（SS/負 lag/constraint 回歸） | 本地+CI | ✅ |
| P5-09 | scope/惡意檔 | controllers（RBAC/scope）、storage（scan fail-closed、0700/0600）、formats（zip/巨集/外部連結）、protectText、msp-xml（DTD/XXE/跨案） | exchange.test.mjs（Viewer 403、跨案 404、公式防護、下載 scope）；parser.test.mjs（zip/巨集/XXE 拒絕）；msp-xml.test.mjs（DTD/XXE/跨案） | 本地+CI | ✅ |
| P5-10 | 操作 UI | ExchangePage.tsx、api.ts | web exchange.test.tsx（上傳→預覽錯誤→修正→提交→匯出、非同步輪詢、日曆/資源 profile 決策）；e2e/exchange.spec.mjs（兩桌面尺寸、權限牆、可復原網路錯誤）；dashboard.spec axe | 本地+CI | ✅ |
| P5-11 | XML 技術閘門 | msp-xml.ts、formats、service | msp-xml.test.mjs（ConstraintType 0..7、LinkLag −40→−4、精度/DTD/XXE/跨案）；exchange_xml.test.mjs（匯入→匯出→再匯入圖等價）；docs/PHASE5_XML_GONOGO.md | 本地+CI（技術）；桌面待 UAT | ✅ 技術 / ⏳ 桌面 UAT |
| P5-12 | 全門檻 | .github/workflows/ci.yml | lint/typecheck/test/build/migration 0001-0022/seed/DB 規則/API 整合/E2E/smoke/250 萬效能 | CI | ✅ |

## 作業生命週期與非同步（計畫 §7 與缺口補齊）

| 項目 | 程式 | 測試 | 狀態 |
|---|---|---|---|
| 作業歷史（匯入/匯出列表） | exchange.service listImports/listExports | exchange_lifecycle.test.mjs | ✅ |
| 伺服器取消（If-Match、移除原檔、冪等） | exchange.service cancel | exchange_lifecycle.test.mjs | ✅ |
| 掃描重試（僅 scan_state=error、fail-closed） | exchange.service scanRetry | exchange_lifecycle.test.mjs | ✅ |
| 保存期限清理（過期預覽/原檔/輸出；受限權限；可重試；保留歷史與稽核） | 0021、exchange.service retentionSweep | exchange_retention.test.mjs | ✅ |
| 非同步 worker（202、租約回收、冪等、退避、dead-letter、取消/保存期限協調） | 0022、exchange.service processWorker | exchange_async.test.mjs（8 情境） | ✅ |

## 安全證據

- 病毒掃描 fail-closed：掃描不可用回 503 不提交；免掃描僅 `NODE_ENV=test`＋`EXCHANGE_TEST_SCANNER=1`，production 不接受旁路（storage.ts）。
- 上傳 allowlist MIME＋簽章；XLSX/CSV package 需 ZIP 簽章與 zip-entry 數量/路徑/解壓大小/壓縮比上限、拒巨集/外部連結/公式 cell（formats.ts）。
- XML 禁 DTD/實體/外部載入、限深限量、跨案拒絕（msp-xml.ts）。
- CSV `=/+/-/@` 公式注入防護，可還原（formats.protectText／csv-package manifest）。
- 私有儲存：伺服器生成 key、防 traversal、目錄 0700／檔 0600；下載逐次驗 scope／期限／SHA-256、Cache-Control: no-store；原檔/輸出/密碼不入 Git（storage.ts、.gitignore）。
- 不可變：Baseline（G9）、交換預覽（0020 trigger；清理僅受限權限旗標）。
- RBAC/scope：PM/Admin，跨案 404、Viewer 403，內部維運端點 Admin（controllers＋整合負例）。
- 稽核：作業與每實體 diff 關聯、hash chain；不把整檔寫入 audit_logs。

## 效能證據

- Dashboard 讀模型 250 萬任務門檻為 CI 常態步驟；本地量測 typical/large API p95 均 <3s、查詢數與案件數無關。
- 交換以明確上限約束成本：單案 ≤5,000 工作、≤20,000 相依、≤20,000 指派、檔案 ≤10 MiB、解壓 ≤100 MiB（model.LIMITS）；超限即報錯，不無限展開。
- 非同步 worker 以批次（預設 20）、租約與退避處理負載；積壓（>20）持續消費已測。
- 註：未對「交換匯入/匯出」另設百萬級專屬效能門檻；如業主需要可另列為後續效能驗收項。

## 待辦與依賴（誠實揭露）

- 桌面 Microsoft Project 相容性：未於真實 Project 桌面實測（環境無 Project）；見 docs/PHASE5_XML_GONOGO.md 的 UAT 步驟與 GO/NO-GO。
- 正式登入（OIDC/Cloudflare）、雲端私有儲存 adapter 屬 Phase 6；dev 身分標頭與測試掃描旁路不可當正式部署方案。
- round-trip 的不可等價（單檔 CSV 指派/基準細節、XML 欄位範圍、成本未輸出）由 round-trip 報告與各文件自動揭露。

## 總結

P5-01～P5-10、P5-12 具本地與 CI 證據；P5-11 具技術閘門證據與 go/no-go，桌面相容性列為 UAT 依賴。
作業歷史/取消/掃描重試/保存期限清理/非同步 worker 等 §7 缺口已補齊並測試。
未經業主明確指示不合併、不部署、不宣稱桌面 UAT 完成。
