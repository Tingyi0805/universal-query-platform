# UQP PR #66 — PREVIEW-P1 / 923-F1A 隔離 SQL Server 2019 驗收準備

> **狀態：F1A SQL witness 與離線檢查已提交；實機 F1／F2／F3／F4／F5／F6 全部 NOT_RUN。**
> 本文件不核准安裝 Migration 923、不啟用 SOURCE_BOUND、SQL_LOCK_VERIFIED 或資料列預覽。

## 為何需要此步

Dataset Designer 現有 `GET /datasets/:id/column-candidates` 對已儲存、無參數的 SQL Server SELECT
可顯示 `UNBOUND_CANDIDATE` 名稱／型別／序號；沒有讀取資料列，不可直接寫入 `uqp.DatasetColumn`
或當作資料負責人分類確認的證據。新建 Dataset 的 RAW_DESIGN 仍因可信來源 Fence、
Dataset Owner/Reviewer Scope、923 durable snapshot/CAS/audit 及結果形狀比對缺失而阻擋。
**UI 與合成測試成功不等於使用者已能安全執行資料預覽。**

## 本次新增

- `tools/sqlserver-acceptance/drafts/923/923_f1a_environment_readonly.sql`：人工唯讀 witness；
  **只回報** SQL Server Major/Build、Compatibility、登入/session、SQL Server 報告的
  server/instance/database 身分、五個 923 物件在目前權限下是否可見。
- `server/src/modules/dataset/datasetMetadata923F1a.test.ts`：靜態離線安全檢查；
  witness 不含 DDL/DML/權限變更，也不被自動 Migration runner 掃描。
- F1B 實際 DDL/CAS/DDL Fence 仍不具自動執行入口；既有草稿保存在
  `tools/sqlserver-acceptance/drafts/923/`。

## 將來操作人員核准前的必要證據（目前均未提供／NOT_RUN）

1. **物理隔離證據**：VM/Instance inventory 與 SQL Server 服務、網路介面、儲存磁碟及備份目標；
   必須證明測試 Instance 不在 `EINOV-VPN` 的 SQL Server Instance 上，且沒有生產工作負載。
   僅換 DB 名稱或依賴 `SERVERPROPERTY` 的自述資訊不能證明隔離。
2. **同意的目標識別**：先記錄人員核准的 Instance / database / Host / Endpoint。
   不要在程式碼或 issue 保存密碼、Connection String、HIS 或患者資料。
   保護使用者既有 `UniversalQueryPlatform` 及 `UniversalQueryPlatform_Old`。
3. **引擎與 catalog**：SQL Server 2019（15.x）、資料庫 Compatibility 150、
   明確為 catalog validator 授權的 principal；目標包含必要的 001–921 Schema 前置條件。
   923 必須是全部未安裝或完全一致；部分安裝與未知可見性拒絕。
4. **兩條獨立連線**：以不同 session ID 取得 witness、驗證所指 Instance/DB 完全一致。
   不只在同一 Connection 下切換交易。請提供去敏 session ID 與 lock/transaction 證據。
5. **權限分離**：遷移者、唯讀 validator、metadata collector、受控 DDL writer、
   runtime reader 使用不同可盤點的安全主體；任何未受控 DBA/DDL 路徑存在，
   F3 Source Fence 不得視為已驗證。
6. **測試資料與回復**：只有合成 SQL/table、空的或隔離還原的 UQP 平台 Schema。
   備份／快照、故障復原與稽核證據留存程序經人員核准。
7. **簽核範圍**：人員核准 **F1B 在隔離環境執行**才可套用 DDL；
   任何檢查工具的 UNVERIFIED/REVIEW_REQUIRED 都不是可執行授權。

## 唯讀 witness 使用界線

腳本只能由操作人員在已確認為獨立環境的 SSMS/SQL 工具中手動執行，
不得由 UQP Runtime 或 Migrator 自動執行。
若結果為 `REJECT_*`，立即停止；`UNVERIFIED_REQUIRES_OUT_OF_BAND_ISOLATION_REVIEW`
仍需要以上七項的人工與隔離證據，**不是 GO**。
`OBJECT_ID IS NULL` 可能只是權限不可見，不能解讀成 Schema 缺席。
只有特定授權 validator 的精確 `923_catalog_readonly.sql` 與 schema evidence
才能進行後續 catalog 判定。

## 下一個最小工作（不依賴 Codex）

核准隔離測試 Instance 後，才由專用帳號執行 F1B：確認 923 SQL Server 真實 round-trip、
空 predicate CAS 的雙連線競爭與 rollback、append-only ledger 和精確 AuditLogId。
接著完成 Owner Scope Writer (F2)、受控來源 DDL Gate (F3)、SOURCE_BOUND verifier (F4)、
交易稽核 (F5)、結果結構及交付前鎖定 (F6)。

在上述必要證據未成立前，不修改 Dataset 既有患者稽核、敏感遮蔽、
Raw Preview 或 Query/Excel/Dashboard 資料交付。**不要下載覆蓋本機 UQP 進行完整 UAT。**
