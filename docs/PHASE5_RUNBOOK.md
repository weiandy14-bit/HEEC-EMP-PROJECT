# Project 交換操作與故障處理

## 現有流程
1. PM/Admin 選擇有權限案件，確認掛件日、工作日曆。
2. 選 CSV、XLSX、CSV package 或 MSP XML；CSV 明確指定 UTF-8/Big5、分隔符與來源時區；純日期指定起訖時間，不猜 locale。XML 為 MSP XML Data Interchange：拒絕 DTD/外部實體（XXE）與跨案；LinkLag 為十分之一分鐘、ConstraintType 0..7、ISO-8601 工期整分鐘（小數精度報錯）；本系統匯出 XML 為 UTF-8/UTC，再匯入宣告 timezone=UTC。桌面 Microsoft Project 相容性待 UAT，見 docs/PHASE5_XML_GONOGO.md。
3. 掃描成功後確認欄位／資源映射、ID/UID 模式及掛件錨點；多人 Work 總和須一致，未知／歧義資源不得選第一筆。預覽回傳來源日曆／資源 profile 對照（`profiles`）：操作頁以對照表明示時區／每日工時／容量／未對應差異，提供日曆（calendarMap）與資源（resourceMap）對應選擇；差異須確認警告後再提交，匯入不修改組織日曆時區或資源容量。
4. 預覽不寫入業務資料；修正錯誤、確認警告後重產預覽。來源與決策改動不得沿用舊 hash。
5. 提交做版本與冪等檢查；SQL 半途失敗回滾業務變更，保留失敗稽核。
6. 匯出與 round-trip JSON 報告列出逐欄差異。單檔 CSV 無法保存完整指派與基準；XLSX/CSV package 包含完整交換工作表。

預設為同步 201。另提供 opt-in 非同步：請求帶 `Prefer: respond-async` → 202 + status_url + Location，由背景 worker 執行掃描（匯入）／render（匯出）。同步與非同步共用掃描、驗證與 render 核心；Idempotency-Key 同時涵蓋兩路（同鍵同請求重放不重複執行，異請求 409）。非同步上傳成功僅表示「已接受」：掃描通過前禁預覽／提交，render 完成前禁下載（export_pending）。前端可輪詢狀態端點。Worker（POST /internal/exchange/worker，Admin；正式以排程驅動）具：租約認領、逾期租約回收（程序中斷可恢復）、冪等、指數退避、最大重試與 dead-letter。取消會一併取消佇列中的掃描作業，執行中的掃描於提交前重查狀態，已取消者不被重新完成；保存期限清理僅作用於已過期（非進行中）作業，不會提前刪除執行中檔案。

同步流程：作業歷史（GET /imports、GET /exports，新到舊、分頁、不外洩儲存鍵）、伺服器取消（POST /imports/{j}/cancel，If-Match 版本鎖、移除原檔、冪等、已提交不可取消）與掃描重試（POST /imports/{j}/scan-retry，僅 scan_state=error 可重試、fail-closed 不旁路、If-Match 版本鎖）已交付。原檔／預覽保存期限清理已交付：Admin 維運端點 POST /internal/exchange/retention 於單次清掃中刪除過期不可變預覽、清除過期原檔與匯出輸出檔；作業歷史列與稽核保留為清理證據。不可變預覽刪除以交易內受限權限旗標（app.retention_sweep）進行，觸發器仍拒絕一般路徑的 UPDATE／DELETE；檔案刪除成功才標記 purged_at，失敗者留待下次清掃重試（可重試）。真正非同步 worker 與 202 仍待完成，見 PHASE5_STATUS.md。

保存期限（預設）：原檔／輸出 30 天、預覽 90 天、稽核不隨檔案刪除。清理與下載／提交／worker 的競爭：匯入過期即 job_expired、匯出過期即 export_expired（兩者於讀檔前先擋），故清掃刪檔不影響進行中的有效預覽或下載；提交以 preview_stale／版本鎖防護。

### 作業控制故障處理
| 錯誤 | 處理 |
|---|---|
| version_conflict（cancel／scan-retry） | 讀最新 job 版本，重帶 If-Match 再操作，不硬覆蓋 |
| job_not_cancellable | 已 succeeded／failed 的作業不可取消；如需重做請重新上傳 |
| job_cancelled | 作業已取消，請以新 Idempotency-Key 重新上傳 |
| scan_not_retryable | 僅掃描不可用（scan_state=error）的作業可重試；clean 作業請直接預覽 |

## 掃描與私有檔案
- EXCHANGE_STORAGE_DIR 指向私有服務目錄，不映射公開靜態網站；新目錄 0700、新檔 0600。
- clamdscan 以 execFile 固定 argv 執行，30 秒 timeout／4 KiB 輸出；病毒拒絕，掃描不可用 503，不跳過。
- 免掃描只允許 NODE_ENV=test 加 EXCHANGE_TEST_SCANNER=1；production 不接受旁路。
- 下載逐次驗 scope、期限、SHA-256，Cache-Control: no-store；原檔、輸出、密碼與機密不推 GitHub。
- 開發 .exchange-files 已由 Git 排除；正式私有雲端 adapter、OIDC、Cloudflare 在 Phase 6。開發身分標頭不是正式登入方案。

## 故障處理
| 錯誤 | 處理 |
|---|---|
| DTO／逐列驗證 | 按欄位列號修正編碼、分隔符、時區、UID 模式與來源計畫；重新預覽 |
| preview_stale／version_conflict | 讀最新 job 版本、重產預覽，不硬覆蓋 |
| idempotency_conflict | 新內容用新 key；原提交只以原 key 重放 |
| resource_unknown／resource_ambiguous | 明確選定本組織資源 |
| file_infected／scan_unavailable | 不提交，檢查 ClamAV daemon／signature／權限，不停用掃描 |
| package_hash／package_unsafe | 重產整包；不能改某張 CSV 且保留舊 manifest，不接受額外執行檔 |
| import_failed | 業務已回滾；用 correlation ID 查技術日誌／稽核後修復、重產預覽 |
| 404 | 確認案件權限，不繞過 job scope |
| export_expired／output_corrupt | 重新匯出，不暴露 object key |

匯入不自動重排，不覆寫既有實際值或不可變 Baseline；重算是另一個明確操作。
