# R0-3 第三輪：安全契約與 915 資料庫路徑

基準：PR #64 / 77511727de5704fa6b4f5ab86559a6add14f1d38。僅靜態檢查；沒有連線 SQL Server、沒有驗證實機 915。

## 已查證的 Guard

- `patientAuditContract.repository.ts` 中 createPatientAuditStore 的 transaction 先開 SERIALIZABLE transaction、`SET XACT_ABORT ON`、`requireSecuritySchema(request())`，**然後**才執行含 `ConfigurationVersion` / `DatasetPatientAuditMetadata` 的 read/save/metadata SQL。缺919時應於 catalog gate 拒絕，catch rollback。
- `dashboardApproval.repository.ts` 的 createDashboardApprovalStore transaction 在取得 legacy lock 相關的準備資訊與建立 transaction 後，先呼叫 `deps.schema(request())` 才執行涉及 `ApprovalRowVersion` 的 SQL。獨立 evidence reader 也先呼叫 schema gate。注意 pre-gate `deps.prepare(pool,id)` 仍須測試其只讀性及915相容性，不能概括宣稱所有操作皆安全。
- `securityContract.repository.ts` 的 `securityCatalogSql` 使用 `sys.tables`、`sys.columns`、`sys.check_constraints`、`sys.key_constraints`、`sys.foreign_keys` 查 metadata，不直接 SELECT 不存在的919新欄位；`catalogEvidence` 驗證欄位型別、預設值、ROWVERSION、Metadata PK/FK/CHECK及 trusted constraints，並透過 `assertSecuritySchema` 拒絕不符。
- `dashboardQueryMode.service.ts` 中 run() 先檢查 enabled()，然後 transaction、`tx.schemaReady()` 及 `tx.modeReady()`，再執行 actor/read/write；未開旗標時回404，缺Schema時回503（靜態預期，尚未作端到端實測）。

## 仍待完成

1. `dashboardApproval.repository.ts` 在 guard 前的 `deps.prepare()`、`lockLegacyBindings()` 及其他關聯 call graph 檢查。
2. `patientAuditConfig.routes.ts`、`dashboardApproval.routes.ts` 在 915 缺契約時的 Mock 驗收：要求無 CRUD 寫入、無稽核漏記、錯誤碼不洩漏 SQL；Dashboard 共用舊路由也需檢查。
3. 所有服務的 schema readiness 應針對 915 快照與 919 完整快照測試（注意 mock不能取代 SQL 引擎驗證）。
4. 正式環境現行 Node Build SHA 尚未確認，不可認定向前相容或允許直接更新程式。

**狀態：STATIC_GUARDS_IDENTIFIED / MOCK_NOT_RUN / REAL_DB_NOT_RUN**；正式系統、正式SQL、feature flags、PR 合併均未操作。
