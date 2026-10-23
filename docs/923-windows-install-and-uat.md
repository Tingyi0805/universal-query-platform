# UQP — Migration 923 手動安裝及第一階段功能測試

**適用**：已重新建置、備份可還原且不承載線上使用者的 UQP 資料庫。部署於 Windows 11 的本機測試程式。**非正式服務更新包。**

## 先決條件

- SQL Server 2019 (15.x)，資料庫相容性等級 150；具有明確核准的 Schema 修改權限。
- `uqp.SchemaMigration` 正式紀錄至少包含 001、002、006、016、019、919、920、921；`uqp.Dataset`、`uqp.DataSource`、`uqp.AppUser` 與敏感政策、患者稽核基礎物件可見。除此之外，四張 923 表與 Sequence 必須**全部不存在**（或全部完全一致且已有相符紀錄）。
- **可驗證還原的備份／快照已完成**。使用者確認目標確實是重新建置、不提供正式服務的資料庫；若資料庫還承載使用者，停止並另備隔離環境。
- 原有伺服器 `server/.env` 或執行環境中的 `PLATFORM_DB_*` 指向要安裝的 UQP 平台資料庫；請勿在文件、PR、群組公開密碼或連線字串。使用具備安裝權限的專用資料庫登入。命令列需要 Node/npm、`server/node_modules`。

## 最少操作：Windows 11

1. **先備份資料庫並驗證還原可用**，停止任何會連至這個測試資料庫的舊 UQP Server/Worker；不要停止正式服務。
2. 取得含本工具的專案版本，解壓於獨立的新目錄（**不要覆蓋正式環境**）。若尚無 `node_modules`，在新目錄的 `server` 下執行 `npm install`；檢查 `server/.env` 指向正確重建 DB。
3. 執行 `tools\install-uqp-923.bat`，依畫面輸入 **SSMS 查詢結果** `@@SERVERNAME`、`DB_NAME()`、`ORIGINAL_LOGIN()` 對應的值。預檢未通過即停止，不要直接執行 `npm run db:migrate`。
4. 預檢回報 `923_PREFLIGHT=READY` 時，核對備份、輸入 `YES` 並重新鍵入資料庫名稱核准單獨安裝。
5. 看到 `923_APPLY=COMMITTED_EXACT_MATCH_NO_DELIVERY_AUTHORITY` 與 `923_VERIFY=INSTALLED_EXACT_MATCH_LEDGER_PRESENT` 才表示安裝已提交並驗證；保存去敏執行輸出。

若需要只確認狀態，可在 PowerShell 執行：
`powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\install-uqp-923.ps1 -Mode Preflight`
或改為 `-Mode Verify`。如果事先已安裝完成、preflight 顯示 `INSTALLED`，請直接執行 Verify，無須再次 Apply。

## 不能用這個安裝來宣稱完成的事

- Migration 923 **只安裝四張表＋一個 Sequence，並記錄 SchemaMigration**。不建立 Owner/Reviewer，不 seed 角色，**不開放** SQL_LOCK_VERIFIED、SOURCE_BOUND、Dataset 查詢資料列交付或患者資料曝光。
- 安裝不會自動修正既有「新增 Dataset 後無法預覽真正資料列」的問題。使用者可先驗證**無參數 SQL Server SELECT 的候選欄位描述**及本頁自訂遮蔽草稿；草稿不會儲存為正式政策。
- 正式資料預覽仍須完成 Owner/Reviewer、精確正式 Audit Writer、來源 DDL Fence、可信欄位證據與患者分類確認。既有患者稽核、RBAC、遮蔽不可關閉來省略驗收。
- 923 的開發位於 **PR #66 Draft**，目前不能將新包直接覆蓋線上 UQP。UAT 分為：Schema 安裝驗收 → 管理介面與欄位候選預覽 → 安全分類及資料列預覽 → Query/Excel/Dashboard 整合。

## 失敗處理

- `923_BASELINE_OR_ENGINE_NOT_READY`：先查缺少的 Migration 編號、RowVersion/資料庫版本；不自動補表、不跳過前置條件。
- `923_PARTIAL_UNRECORDED_OR_UNTRUSTED`：手動安裝殘留、同名異物或 SchemaMigration 不一致。停止並由 DBA 比對／回復備份，不刪表、不 `adopt`。
- `923_TARGET_ATTESTATION_MISMATCH`：連到錯誤 Instance、DB 或 Login。停止並重新確認 `server/.env`。
- `923_INSTALL_UNEXPECTED_FAILURE_VERIFY_STATE`／`923_COMMIT_OR_ROLLBACK_UNCERTAIN_VERIFY_MANUALLY`：不重複安裝；先執行 `-Mode Verify` 或唯讀 Catalog 檢查，再決定復原。
- 不要將失敗訊息中的環境變數、密碼或帳密貼到公開 issue。

本安裝包需通過專用 CI 隔離 SQL Server 2019 安裝／驗證實測，且由您確認目標已重建、不承載正式使用者、備份可回復，才能執行本機安裝。
