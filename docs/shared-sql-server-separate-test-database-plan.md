# UQP 方案 B：共用 SQL Server 實例、獨立測試資料庫（規劃草案）

> 狀態：**PLANNING ONLY / NO DATABASE ACTION**。使用者正式 UQP 已於 Windows Server 上線；Windows 11 用作測試，現在兩者共用正式 SQL Server 資料庫。本文件只規劃將 Windows 11 改指向同一 SQL Server 實例上的不同測試資料庫；不代表已授權 CREATE DATABASE、RESTORE、Migration、資料複製或程式部署。

## 目標、拓樸與限制

- Windows Server 正式 UQP → 原正式 SQL Server 資料庫（不變）。
- Windows 11 測試 UQP → **提議**另建 `UQP_TEST`；獨立 SQL Login、資料庫使用者、應用環境設定與帳號；不使用正式 APP 的 `.env` 或憑證。
- 同一 SQL Server 實例共享 CPU、RAM、磁碟、tempdb、server-level principals 等資源。獨立資料庫**不等於**隔離實例，不能通過既有 4B-1/4B-2 的「隔離 SQL Server 2019 實例」前置條件。
- 4B 的 M01–M09、D01–D08、L01–L05、S01–S05 實機隔離案例仍 **NOT_RUN**；不能使用方案 B 測試取代獨立實例的 Migration 919 / 競爭鎖 / 破壞性回滾驗收。

## Phase B0 — 只讀盤點（必須由 DBA 核准的只讀工具執行）

1. 記錄 SQL Server 版本/edition、現行正式 DB 名稱、compatibility level、資料庫大小、備份/還原測試紀錄、磁碟及 tempdb 空間、IO/CPU 高峰及可用資源。
2. 由 DBA 以既有治理程序，盤點 `uqp.SchemaMigration` 與 schema/索引/約束/版本差異；**不得用 UQP 的 `db:migrate:status`**，其實作會在 status 分支判斷前嘗試建立 schema/ledger。
3. 盤點 Windows 11 測試 UQP 目前連線方式、服務啟動/排程/稽核寫入、資料來源（Oracle/SQL/MySQL/ODBC）、linked server、外部 API、通知、排程與設備 Token；確認**除平台 DB 之外**也不會觸及正式患者/設備/訊息。
4. 記錄正式備份可用性與還原流程，且不將正式個資整庫還原到較低保護的測試環境。

B0 未確認，不進 B1。

## Phase B1 — 環境建立（需另行明確核准）

- DBA 建立獨立 DB `UQP_TEST` 與專用帳號；僅授權指定 DB 需要的操作，明確拒絕正式 DB 的 CONNECT/DML/DDL；不可使用 sysadmin/db_owner 共享帳號、跨資料庫 ownership chaining、可跨庫的 stored procedure 或 linked server。
- 測試 DB 以**經核准的最小 Schema 建置流程和合成種子資料**為優先；若需正式資料庫的結構來源，採 schema-only 並檢視所有外部依賴。不得將含患者資料的正式備份直接當作測試資料。
- 依 DBA 規劃維護窗口與資源限制，測試 DB 專用資料/記錄檔與可監控空間，預估容量/IO/並發與 rollback 恢復方案。
- 測試服務用不同 `.env`、PORT、CLIENT_ORIGIN、JWT_SECRET、DATASOURCE_ENCRYPTION_KEY、HMAC keyring；敏感資料不提交 GitHub、不與正式系統共用。
- 三項 `DASHBOARD_QUERY_SOURCE_MANAGEMENT`、`DASHBOARD_QUERY_SOURCE_EXECUTION`、`DASHBOARD_QUERY_DEVICE_PLAYBACK` 預設 false；任何調整須另行審查。
- 先稽核程式初始化及背景任務，測試啟動不得連到正式資料來源，不能只改 `PLATFORM_DB_DATABASE` 就認定安全。
- 所有受管資料來源用 synthetic / stub；正式 HIS/Oracle 原則上不接入新測試服務。

## Phase B2 — 業務 CRUD 驗收（在 B1 核准完成後才可執行）

- U01 Dataset/查詢定義新增、修改、停用、刪除/封存、重複與權限拒絕。
- U02 查詢參數、分頁、IN/BETWEEN、結果欄位格式與 Excel 匯出；全為合成資料。
- U03 Dashboard 固定資訊、版面/多尺寸、預覽、刷新、播放、錯誤顯示與回復。
- U04 患者敏感欄位遮蔽、自訂規則、Legacy/CUSTOM 審核、版本衝突與安全拒絕。
- U05 使用者/角色/權限/PIN、TokenVersion、登出/撤權，均採合成帳號。
- U06 患者列表曝光稽核、HMAC 版本及失敗封閉；測試記錄不應包含明文患者資料。
- U07 Device Token、IP 限制、裝置停用/封存，僅測試設備及測試端點。
- U08 備份/還原演練、關閉測試服務/撤回測試帳號/檢查正式資料庫無變更；破壞性 DDL、919 回滾驗收不在方案 B 執行。

## 風險、回復與停止條件

- 正式系統資料庫名稱、帳號與既有 UQP 設定**維持不變**。Windows 11 專案放獨立資料夾，不覆蓋 Windows Server 正式檔案。
- 每次測試前由 DBA 驗證「所連 DB 的 server/instance/database 身分」及測試帳號無正式資料庫寫入權限；驗證只讀且獨立於 UQP Runner。
- 當資源利用率/正式服務延遲異常、出現非預期正式 DB 存取、疑似個資曝光、Schema 差異或任何非預期 DDL → 立即停止測試、隔離測試服務與帳號，先保全證據並由 DBA 判斷恢復方式。
- 正式程式升級必須另有變更單、正式備份、相容性矩陣、維護窗口、回復演練及核准；不因 Windows 11 測試通過即直接 ZIP 覆蓋正式系統。
- **禁止在共享實例上使用 4B 專用 `UQP_ACCEPT_<runId>` 名義繞過隔離限制；其驗收前提是獨立實例**。

## 立即可做（不修改資料庫）

- 依 `docs/offline-windows-test-4b2.md` 執行既有 Windows 11 離線單元/Playwright Mock，無後端/資料庫連線。
- 使用表單記錄 DBA 確認事項：實例版本/Edition、目前正式 DB 名稱（僅內部保存）、SchemaMigration 版本清單、可用磁碟/負載、測試帳號策略、資料來源隔離策略。
- 程式審查 `server/src/scripts/migrate.ts`：它會先寫 bootstrap ledger，並自動抓取所有 SQL Migration，**不能執行 `db:migrate`／`db:migrate:status`／`adopt` 探測共享 DB**。

**B0/B1/B2 只是一套分段工作計畫。本文件提交只改文件，不提供 SQL 指令、不執行 DB 操作。**
