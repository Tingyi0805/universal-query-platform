# R0：正式 SQL Server Migration 915 → GitHub 919 差異審查

> 2026-10-15 原始碼靜態檢查。**未連線任何資料庫，未執行 DDL/DML。** 正式資料庫 `uqp.SchemaMigration` 由管理者提供42筆記錄（001–026、900–915）；GitHub 固定清單46筆。對照結果：42筆檔名均一致，未記錄916–919。此比對**不證明正式 schema 實況**。

## Migration 詳細摘要

| ID | 新增/變更 | 部署安全條件與特別注意 |
|---|---|---|
| 916 | `SharedWorkstation` 新增 `PurposeCode` (NVARCHAR30 NOT NULL, default SHARED_QUERY)、`SortOrder` (INT NOT NULL, default 0)、`RetiredAtUtc`、`LastUsedAtUtc`；新建 `WorkstationAudience`、`WorkstationAudienceMember`、`SharedWorkstationAudience`；`DashboardDisplayDevice.SharedWorkstationId` 與 FK；新增 CHECK | 分段 GO，IF NOT EXISTS/IS NULL 防重複片段，**不是**已驗證的完整冪等；需核對既有欄位型別、約束同名語義、FK與退役資料；正式使用者/角色未自動賦權 |
| 917 | `Dashboard.QuerySourceMaxRows`；`DashboardDataSource.QueryDefinitionId`、`QueryBindingRevision` (default 0)、`MaxRows`、computed `QueryBindingState`；新 FK/CHECK | 要求 `DashboardDataSource`、`QueryDefinition` 等前置欄位；只要部分新欄位已存在就拒絕，不能重跑；既有來源保留未綁定，不會將 Dataset 猜測轉成 Query |
| 918 | `Dashboard.QueryMode` (default LEGACY)、`QueryModeVersion` (default 0)；`DashboardDisplayDevice.QueryModeGrantVersion`、`DelegatorTokenVersion`；CHECK | 必須先有917欄位；已部分安裝即拒絕；預設LEGACY，無自動播放模式切換、無授權 |
| 919 | `DatasetPatientAuditConfig.ConfigurationVersion` BIGINT NOT NULL DEFAULT1與CHECK；`Dashboard`和`DashboardDataSource`各一個 `ApprovalRowVersion` ROWVERSION；新表 `DatasetPatientAuditMetadata` (DatasetId、DefinitionHash、ColumnsJson) 與 PK/FK/CHECK；既有約束型別/語義/信任度檢查 | 前置 003/006/007/907/910/913；不必先安裝916–918。會對既有表做ALTER並驗CHECK，務必隔離驗證鎖定、回滾及舊版API相容性。既有資料未推定受信任核准，無自動回填患者欄位元資料 |

## 程式與資料庫整併前的阻擋檢查

1. 正式機的42筆僅為Migration ledger名稱；核對 `sys.tables`、`sys.columns`、`sys.indexes`、`sys.foreign_keys`、`sys.check_constraints` 才能判定結構。若曾人工改表，必須人工處理 drift。
2. 正式運行的 Node/React Build 版本尚未核實，不能由 GitHub main/PR SHA 推定正式執行版本。必須盤點舊版 API 和新欄位相依。
3. `server/src/scripts/migrate.ts` 的 `status` 分支執行前有 Schema/ledger 建立邏輯，**不得當作唯讀診斷**；`apply` 會選全部未紀錄Migration，包括916–919；沒有預設915截止。
4. `916` 涉共享工作站與裝置關聯；`917` 新 FK/CHECK；`918` QueryMode LEGACY；`919` 新ROWVERSION及Metadata約束。四者均需檢查舊應用讀寫與資料列鎖影響。
5. `919` 自有TRY/CATCH BEGIN/ROLLBACK TRANSACTION；Runner亦建立外層transaction，SQL Server巢狀交易失敗時需在**獨立實例**測試整體原子性。
6. 方案B同SQL Server實例的 `UQP_TEST` 尚未建立；即使建立也只能在DBA核准、合成資料、權限隔離、資源控制前提下做業務驗收。高風險回滾/DDL壓力需要獨立實例。
7. 機密金鑰、真實患者資料、正式DB備份不放進GitHub及測試報告。

## 下一步與交付要求

- R0-2：取得**唯讀**結構盤點（現有 `database/acceptance/production-schema-readonly-inventory.sql`）。由DBA審核所選DB與查詢權限；不需匯出患者列。另查正式程式目前執行版本。
- R0-3：根據盤點輸出 expected/actual/difference 三欄矩陣，區分 missing/extra/type-mismatch/constraint-drift，避免只根據 ledger 猜測。
- R1：建立可稽核的明確 allowlist / 不變 SHA-256 升級計畫與回復程序，先於獨立實例驗證，再核准正式操作。
- 現階段**禁止** `db:migrate`、`db:migrate:status`、`adopt`、正式ZIP覆蓋、PR合併和正式 DB 修改。

狀態：**STATIC_REVIEW_DONE / PRODUCTION_SCHEMA_NOT_VERIFIED / DB_ACTIONS_NOT_RUN**。
