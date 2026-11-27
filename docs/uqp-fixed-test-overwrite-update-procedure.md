# UQP 固定測試更新方式（使用者決策）

狀態：**已決定並採用**（2026-11-26）。本文件記錄往後 UQP 的**測試環境**更新慣例；不代表正式環境發布授權。除非使用者另行明確決定，後續皆依此流程，不另建測試目錄、實例、資料庫或埠，也不反覆產生補丁包。

## 固定範圍

- 目標現有測試系統：`C:\UQP`；Server 埠 `3200`；沿用現有資料庫 `UniversalQueryPlatform` 與現有啟動／IIS 方式。
- **一個 GitHub Actions 驗證通過的完整 Windows 測試 ZIP**，直接含 `payload/`、`SHA256SUMS.csv`、更新 PowerShell 腳本（沒有 ZIP 包 ZIP）。採 **ZIP 覆蓋更新**，不推送增量補丁、不建立新 Instance。
- 下載位置應給出該次已驗證、未過期的**GitHub Actions Artifact 直接連結**，並明確列出 Commit、Run、Artifact 及測試狀態；連結不可沿用已過期的上一版。
- 固定解壓位置：`C:\UQP_Update\PR99_PR100_V2`（每次先清除**上一版暫存解壓內容**，不是刪除 `C:\UQP`），保留原始 ZIP 作為必要的回溯證據。
- 沿用 `C:\UQP\server\.env`、既有資料庫/連接埠及 `client\dist\web.config`；不自行重建 DB、重新執行 Migration 或改變安全設定。現有 929 是否已完成應根據既有驗收紀錄；新增 SQL 變更需另外提出、經使用者同意後才執行。
- 測試版更新不得被當成正式上線、PR Merge、核准播放或資料政策放行。

## 每次實際更新步驟

1. 先確認同一個 Commit 的必要 CI PASS、Windows 包建置與 Artifact 下載回讀 SHA-256 PASS；只發放已驗證版本。未完成 CI 必須標示待驗證。
2. **只停止 UQP 自身的 Server**（埠 `3200`），不結束整台機器其他 Node 工作。
3. 清空 `C:\UQP_Update\PR99_PR100_V2` 的舊解壓檔，再將這次單一 ZIP **直接**解壓到該目錄；確認沒有多包一層目錄。
4. 在 PowerShell 執行：
   ```powershell
   cd C:\UQP_Update\PR99_PR100_V2
   .\Update-UQP-PR99-PR100-Test-v2.ps1 -IConfirmThisIsTestOnly
   ```
5. 由腳本先核對 SHA-256、確認原路徑與環境、備份既有二進位，再覆蓋。保留主控台的 `PR99_PR100_V2_HASHES_PASS`、`PR99_PR100_V2_UPDATE_PASS`、`PR99_PR100_EXISTING_ENV_PRESERVED`、`PR99_PR100_EXISTING_PORT_DB_PRESERVED`、`PR99_PR100_WEB_CONFIG_PRESERVED`（既有 web.config 存在時）、`BACKUP_PATH`。任一驗證失敗即停止、不繼續假定安裝成功。
6. **依原本方式啟動**既有 UQP；若本次採人工啟動，從 `C:\UQP\server` 執行 `npm start`，否則沿用現有服務／啟動機制。
7. 僅實測**本次修改或先前失敗的功能**；已 PASS 的使用核准／停止使用、CI 與資料庫驗證不重複。記錄 PASS／FAIL、必要畫面或 Request ID；若異常先定位，不立即再要求下載另一包。

## 固定回報格式

每次回覆明確列出：**已完成／未完成／目前階段／下一步**；並區分「程式已修改」、「CI 已驗證」、「ZIP 已覆蓋」、「使用者實機驗收」四種不同證據。任何未完成的安全流程不得標為 PASS。避免無限增加驗收階段或重做已 PASS 項目。

## 例外與保障

- 如果後續 ZIP 更新腳本、檔案結構、必需 Migration 或部署目標改變，必須明確提出差異，不得暗中套用舊指令。
- 備份目的地由腳本回報的 `BACKUP_PATH` 為準；回滾只針對經確認的更新二進位，不任意動既有資料庫。
- 這份 SOP 記錄的是使用者**測試更新偏好**，不是對正式上線、繞過敏感遮蔽、患者揭露稽核或公共播放的授權。
