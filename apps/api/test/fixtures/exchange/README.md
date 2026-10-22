# Project 交換範例

`success.csv`：UTF-8 BOM、逗號、RFC4180、CRLF、Asia/Taipei，兩個葉工作，FS 相依。請在測試案件使用 2027-01-11 掛件日、每日 8 小時的工作日曆，明確選定 `uid:102` 掛件錨點。601 分鐘 Work 保持未指派，不放入任何工程師負荷。

`failure-cycle.csv`：同一資料但加入循環相依；預覽必須顯示 `dependency_cycle`，不可提交，案件任務保持不變。

這些名稱與日期是測試資料；系統的 Dashboard、案件和日曆均從資料庫取得。

單檔 CSV 不包含個別指派 Units、Contour 與完整 Baseline 快照；請以 XLSX 或 CSV package 進行完整交換。CSV package 包含 manifest、每張 CSV 的 SHA-256、列數與文字防公式還原版本；checksum 不符時拒絕。
