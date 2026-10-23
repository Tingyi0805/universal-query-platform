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

## 特別處理：`REJECTED_UNKNOWN`（非「部分安裝」）

這個狀態表示 923 Catalog 的驗證者**無法證明自己能看到完整資料庫目錄**，不是證明 923 表已部分安裝。SQL Server 2019、相容性 150 和基礎 Migration 都可能已符合要求。923 驗證器刻意同時要求：

- `USER_ID() = 1`（登入連線於目標資料庫的**有效資料庫主體是 dbo**）；只有 `IS_MEMBER('db_owner')=1` **不能**代替。
- `HAS_PERMS_BY_NAME(DB_NAME(),'DATABASE','VIEW DEFINITION')=1`。

登入必須與安裝程式連線實際使用的登入一致；若 SSMS 使用 Windows 認證，而 `server/.env` 使用 SQL 認證，結果可能不同。

在 SSMS 選取**重新建置的測試資料庫**後，可先執行這段唯讀檢查（不需提供密碼）：

```sql
SELECT DB_NAME() AS DatabaseName,
       ORIGINAL_LOGIN() AS LoginName,
       USER_NAME() AS DatabasePrincipal,
       USER_ID() AS DatabasePrincipalId,
       HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION') AS CanViewDefinition,
       IS_MEMBER(N'db_owner') AS IsDbOwnerRoleMember;
```

若 DatabasePrincipalId 非 1 或 CanViewDefinition 非 1，請**不要提升 UQP 平日使用帳號的權限**。準備由 DBA 核准、對本次重建測試 DB 具備 dbo 可見性的**安裝專用 SQL 登入**，再開啟新版 `tools/install-uqp-923.bat`；回答 `Use a separate SQL installation login for 923 only?` 為 `Y`，輸入安裝帳號與隱藏密碼。它只在此 PowerShell 程序的環境中暫時覆蓋登入，不會寫入 `server/.env`。

新版預檢會回報 `catalogVisibility.databasePrincipalIsDbo` 與 `catalogVisibility.canViewDefinition` 的布林值，並將缺乏可見性的情況明確分類為 `923_CATALOG_VISIBILITY_REQUIRES_DBO_AND_VIEW_DEFINITION`。即使改用安裝帳號，**仍必須通過**所有原有前置檢查，且目標不承載任何線上服務、具有可回復備份，才可以安裝。不應手動寫入 SchemaMigration、跳過 Catalog 或直接 CREATE 923 表。

## 失敗處理

- `923_BASELINE_OR_ENGINE_NOT_READY`：先查缺少的 Migration 編號、RowVersion/資料庫版本；不自動補表、不跳過前置條件。
- `923_PARTIAL_UNRECORDED_OR_UNTRUSTED`：手動安裝殘留、同名異物或 SchemaMigration 不一致。停止並由 DBA 比對／回復備份，不刪表、不 `adopt`。
- `923_TARGET_ATTESTATION_MISMATCH`：連到錯誤 Instance、DB 或 Login。停止並重新確認 `server/.env`。
- `923_INSTALL_UNEXPECTED_FAILURE_VERIFY_STATE`／`923_COMMIT_OR_ROLLBACK_UNCERTAIN_VERIFY_MANUALLY`：不重複安裝；先執行 `-Mode Verify` 或唯讀 Catalog 檢查，再決定復原。
- 不要將失敗訊息中的環境變數、密碼或帳密貼到公開 issue。

本安裝包需通過專用 CI 隔離 SQL Server 2019 安裝／驗證實測，且由您確認目標已重建、不承載正式使用者、備份可回復，才能執行本機安裝。
