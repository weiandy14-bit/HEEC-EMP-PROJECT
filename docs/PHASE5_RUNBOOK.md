# Project 交換操作與故障處理

## 現有流程
1. PM/Admin 選擇有權限案件，確認掛件日、工作日曆。
2. 選 CSV、XLSX 或 CSV package；CSV 明確指定 UTF-8/Big5、分隔符與來源時區；純日期指定起訖時間，不猜 locale。
3. 掃描成功後確認欄位／資源映射、ID/UID 模式及掛件錨點；多人 Work 總和須一致，未知／歧義資源不得選第一筆。
4. 預覽不寫入業務資料；修正錯誤、確認警告後重產預覽。來源與決策改動不得沿用舊 hash。
5. 提交做版本與冪等檢查；SQL 半途失敗回滾業務變更，保留失敗稽核。
6. 匯出與 round-trip JSON 報告列出逐欄差異。單檔 CSV 無法保存完整指派與基準；XLSX/CSV package 包含完整交換工作表。

現在是同步 201；真正非同步 worker、202、歷史、取消、掃描重試與期限清理仍待完成，見 PHASE5_STATUS.md。

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
