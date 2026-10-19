# R0-4：916／919 SQL 原始碼專項審查

狀態：**STATIC REVIEW ONLY / NO PRODUCTION APPROVAL**。2026-10-16 核對分支 SQL，未連線或修改資料庫。

## 916_workstation_management.sql

- 預檢 `SharedWorkstation`、`AppUser`、`SharedWorkstationSession`、`SharedWorkstationCredential`、`PatientListDisclosure`、`DashboardDisplayDevice`、`AuditLog`。
- 4 個 SharedWorkstation 欄位、3 個 audience 表、DashboardDisplayDevice.SharedWorkstationId 與 FK 均採「缺少才新增」模式。
- **阻擋 A（修正後）：916 腳本本身分多個 GO 且沒有自設跨批次交易；但現有 `server/src/scripts/migrate.ts` 在 Runner 層先建立 `sql.Transaction`，同一 transaction 依序執行每個 batch，再寫入 SchemaMigration 並提交。** 因此不能把 Runner 正常路徑描述為「無整體交易」。若由 SSMS 手工逐批執行則未受 Runner 交易保護；Runner 中 SQL Server DDL／錯誤／rollback 的實際結果仍須在獨立實例驗證。
- **阻擋 B：存在性檢查不足以證明同名欄位／CK／FK／表的資料型別、語義及 trust 正確**。不能自動重跑或套用在結構漂移 DB。
- CHECK `CK_Workstation_Retired` 對 `IsActive` 與 `PinLoginEnabled` 的既有資料有相容性要求；現場需測試已退役資料、現有裝置資料與索引影響。
- 實施前要先在獨立實例測試成功安裝、故障注入、部分安裝修復路徑，並制定補救／還原規則。

## 919_dashboard_dataset_security_contract.sql

- 有單一 TRY／CATCH 交易、`XACT_ABORT ON`、失敗時 `ROLLBACK`；不依賴 916～918。
- 對 ConfigVersion、新 rowversion 欄位、Metadata 表，執行型別、預設、CHECK、PK、FK 驗證；不將舊的欄位清單視為已認證的患者 metadata。
- **阻擋 C：DDL 交易與現有 Migration Runner 的交易／批次互動仍需實機驗證**，包含失敗回滾與 SchemaMigration ledger 一致性。
- **阻擋 D：SQL 預檢不代表完整的老版 API／併發寫入相容性**。須以合成資料驗證 RowVersion、批准版本衝突及稽核失敗封閉。
- 靜態未見對患者 Metadata 的自動回填，但不能據此宣稱完整安裝風險已消除。

## 後續檢查關卡

1. 先完成 915 既有結構與 916／919 前置物件的型別／約束精確比對。
2. 916 的跨批次故障恢復及 919 的 Runner 巢狀交易，**獨立 SQL Server 實例**演練後再決定是否修程式。
3. CI／Mock 成功不等於 SQL Server 升級成功；正式升級需事先核准、備份／還原驗證及變更窗口。
4. 目前禁止正式 DB Migration、PR #64 合併及 Windows Server ZIP 覆蓋。
