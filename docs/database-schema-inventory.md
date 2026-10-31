# SQL Schema 使用清冊（D5-C-3）

基準：`ae1b367b9d4b4e0cd66df368ea6f3e889098d9bc`；盤點日期：2026-10-31。
本清冊是 **Repository 宣告及可追查程式路徑** 的清冊，不是正式資料庫 Catalog 匯出。
未連線正式 SQL Server、未執行 Migration、未變更既有 SQL、未操作 C:\UQP。
正式 Ledger 資訊來自本次任務提供的事實，未聲稱已獨立實測。

## D5-C-4-C／D5-C-4-D 正式證據補註

分析基準 `9f8dfb244c5b5b831df021e955bad27cd6f30b8b`；D5-C-4-D補正基準 `69c319292c30e0a5473e12874be2175a3995f178`；完整核對見 [正式 Drift／依賴報告](database-schema-production-drift-d5-c4.md)。
以下數字與分類仍是 **Repository 預期宣告／用途**，不重算為正式已安裝數量。
正式事實依使用者提供：UniversalQueryPlatform／SQL Server 15.0.2180.2 Express／uqp，未由本代理連線。

- 923：四表 87 欄位、24 CHECK、4 DEFAULT、7 PK/UQ、10 FK、9 明確 Index 與 Sequence 參數結構比對 PASS；Ledger 923_dataset_metadata.sql 於 2026-10-23 13:08:48。四表均0筆不改變使用分類；當年原始部署檔仍 UNKNOWN。
- 924：ScopeBinding NOT_FOUND、Ledger 無紀錄、Permission 資料未確認；此處列 ACTIVE 指 Repository Scope／欄位初始化依賴，不表示正式表存在，也不授權安裝。
- 925：已提供三表、34欄位、8 CHECK、8 DEFAULT、3 PK、2 UQ、2 FK、7索引（含backing）、0 Trigger及欄位／Collation／Default／FK動作／鍵／INCLUDE等明細，**正式證據已取得、可人工比對**。CreatedBy／UpdatedBy NULL相符、非Drift；exact validator尚未執行，Identity seed/increment等補充屬性未驗收，不宣告完整EXACT_MATCH，也不將34欄位全列UNKNOWN。
- Ledger：使用者已執行包含922～926的正式唯讀查詢，當次只有923_dataset_metadata.sql（2026-10-23 13:08:48）；922／924／925／926當次無紀錄。無紀錄不等於物件不存在或從未以其他方式安裝；925 installer原設計不寫Ledger。
- 922歷史內容／相關物件仍UNKNOWN；926當次Ledger無紀錄已確認，新增欄位／Constraint／Trigger存在性仍待Catalog。來源ACTIVE／MIGRATION_ONLY分類不等於正式安裝事實。
- 可安全清理候選仍無；UNUSED_CONFIRMED 維持0。以下原始欄位／Constraint／來源SHA清冊不變；其中UNKNOWN屬用途／外部依賴分類，不表示925已取得的正式欄位結果未知或未提供。

## 計數與分類口徑

一個應用 Schema：`uqp`。SQL Server 系統 Schema、外部資料來源 Schema、測試臨時 Schema 不納入此數字。
下列物件數包括表、欄位、具名 Constraint、宣告為未命名的 PK／DEFAULT（記錄邏輯宣告，實際自動生成名稱 UNKNOWN）、明確 CREATE INDEX、Trigger、Sequence 及 Schema。
PK/UQ 的隱含索引已計入 Constraint，不再次算作 Index；同名歷史定義按最後宣告合併。
這是來源推導的目標結構，不保證某安裝環境已具備全部物件，尤其 923～926。

- ACTIVE：目前掛載的程式功能讀寫，或欄位／Constraint 的宣告結構相依（完整性、預設值、索引鍵）。不代表正式環境啟用頻率。
- LEGACY_REQUIRED：既有資料路徑或 exact Catalog 安裝相容性必須保留。
- MIGRATION_ONLY：歷史升級來源；49 份 Migration **另計於腳本清單**，不把整張 Runtime 表歸為 Migration-only。
- UNUSED_CONFIRMED：包含外部用途與 DB 相依性均有否定證據才可採用；本次沒有符合項目。
- UNKNOWN：無足夠的欄位用途、外部依賴或效能證據；必須保留。沒有 Runtime 文字引用本身不構成刪除理由。

欄位 ACTIVE 的判據：出現在本表的現行 PK/FK/UQ/CHECK/DEFAULT/Index 宣告，或已追查的 auth、datasource、dataset、device、audit、ledger 讀寫路徑。
其餘欄位保守列 UNKNOWN，不宣稱所有 SELECT * 欄位都實際被業務使用。
Constraint ACTIVE 指目標安裝後由資料庫執行完整性契約；Index UNKNOWN 指缺少實際 workload/使用統計，並非建議刪除。
NULL 未顯式指定者不憑連線預設猜測；Identity/PK/Rowversion 依 SQL Server 型別規則標示。
Computed 欄位的實際 nullability 仍需 Catalog 確認。

| 類別 | 數量 |
|---|---:|
| SCHEMA | 1 |
| TABLE | 54 |
| COLUMN | 536 |
| CONSTRAINT | 407 |
| INDEX | 43 |
| TRIGGER | 1 |
| SEQUENCE | 1 |

| 使用狀態 | 數量（以上物件合計） |
|---|---:|
| ACTIVE | 865 |
| LEGACY_REQUIRED | 32 |
| MIGRATION_ONLY | 0 |
| UNUSED_CONFIRMED | 0 |
| UNKNOWN | 146 |
| TOTAL | 1043 |

## 來源與範圍界線

已核對 58 份 tracked SQL、49 份 Migration、runner、獨立 923/924/925 installer、Runtime Repository、queryCompiler／adapter、app 路由、測試 Fixture 及 CI。
`database/seeds`、`database/scripts`、`server/sql` 在此 HEAD 不存在；seed 實際嵌於 Migration／installer，不能憑缺目錄判斷沒有 seed。
[依賴圖](database-schema-dependency-map.md)、[清理報告](database-schema-cleanup-report.md)、[Migration Inventory](database-migration-inventory.md) 補充執行事實與限制。

兩個表級特殊判定：`DashboardAuthenticationPolicy` 無已證明 Runtime 消費者，為 UNKNOWN；
`DatasetSecurityConfirmation` 仍是 923 exact Catalog／四表安裝契約的一部分，為 LEGACY_REQUIRED，不能因缺少直接業務 DML 刪除。

## 表與欄位清單

每節 SQL Repository／模組路徑是導航證據，須結合依賴圖的路由、交易與動態 SQL 說明閱讀。
欄位定義保留來源中的 DEFAULT、Identity、Collation 與 Computed 表達式；FK 的目標／欄位、CHECK 條件、PK/UQ 鍵及 Index INCLUDE／filter 見同表宣告。
未列 Trigger 的表在這些來源沒有宣告 Trigger；不代表正式 Catalog 沒有外加 Trigger。

### uqp.AppUser

表級狀態：**ACTIVE**；建立來源：[database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql)。

程式／SQL Repository 引用：[server/src/modules/admin/admin.repository.ts](../server/src/modules/admin/admin.repository.ts)、[server/src/modules/admin/sharedWorkstation.repository.ts](../server/src/modules/admin/sharedWorkstation.repository.ts)、[server/src/modules/admin/workstationManagement.repository.ts](../server/src/modules/admin/workstationManagement.repository.ts)、[server/src/modules/audit/audit.repository.ts](../server/src/modules/audit/audit.repository.ts)、[server/src/modules/audit/deviceAuditHistory.ts](../server/src/modules/audit/deviceAuditHistory.ts)、[server/src/modules/auth/auth.repository.ts](../server/src/modules/auth/auth.repository.ts)、[server/src/modules/auth/quickPin.service.ts](../server/src/modules/auth/quickPin.service.ts)、[server/src/modules/dataset/datasetScopeManagement.repository.ts](../server/src/modules/dataset/datasetScopeManagement.repository.ts)、[server/src/modules/dataset/datasetMetadata924Catalog.ts](../server/src/modules/dataset/datasetMetadata924Catalog.ts)、[server/src/modules/dataset/dataset923ScopeConfirmationGate.ts](../server/src/modules/dataset/dataset923ScopeConfirmationGate.ts)、[server/src/modules/queryDefinition/queryAccess.repository.ts](../server/src/modules/queryDefinition/queryAccess.repository.ts)、[server/src/modules/version/version.repository.ts](../server/src/modules/version/version.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `Id BIGINT IDENTITY(1,1) PRIMARY KEY` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| Username | NVARCHAR(100) | NOT NULL | ACTIVE | `Username NVARCHAR(100) NOT NULL` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| DisplayName | NVARCHAR(200) | NOT NULL | ACTIVE | `DisplayName NVARCHAR(200) NOT NULL` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| PasswordHash | NVARCHAR(255) | NULL | ACTIVE | `PasswordHash NVARCHAR(255) NULL` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| AuthProvider | NVARCHAR(30) | NOT NULL | ACTIVE | `AuthProvider NVARCHAR(30) NOT NULL CONSTRAINT DF_AppUser_AuthProvider DEFAULT ('LOCAL')` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| IsActive | BIT | NOT NULL | ACTIVE | `IsActive BIT NOT NULL CONSTRAINT DF_AppUser_IsActive DEFAULT (1)` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| CreatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_AppUser_CreatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| UpdatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_AppUser_UpdatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| TokenVersion | INT | NOT NULL | ACTIVE | `TokenVersion INT NOT NULL CONSTRAINT DF_AppUser_TokenVersion DEFAULT (1)` · [database/migrations/019_user_token_version.sql](../database/migrations/019_user_token_version.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| (unnamed PK: Id) | PRIMARY KEY | ACTIVE | `Id BIGINT IDENTITY(1,1) PRIMARY KEY` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| DF_AppUser_AuthProvider | DEFAULT | ACTIVE | `AuthProvider NVARCHAR(30) NOT NULL CONSTRAINT DF_AppUser_AuthProvider DEFAULT ('LOCAL')` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| DF_AppUser_IsActive | DEFAULT | ACTIVE | `IsActive BIT NOT NULL CONSTRAINT DF_AppUser_IsActive DEFAULT (1)` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| DF_AppUser_CreatedAt | DEFAULT | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_AppUser_CreatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| DF_AppUser_UpdatedAt | DEFAULT | ACTIVE | `UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_AppUser_UpdatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| UQ_AppUser_Username | UNIQUE | ACTIVE | `CONSTRAINT UQ_AppUser_Username UNIQUE (Username)` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| CK_AppUser_AuthProvider | CHECK | ACTIVE | `CONSTRAINT CK_AppUser_AuthProvider CHECK (AuthProvider IN ('LOCAL','AD','ORACLE'))` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| DF_AppUser_TokenVersion | DEFAULT | ACTIVE | `TokenVersion INT NOT NULL CONSTRAINT DF_AppUser_TokenVersion DEFAULT (1)` · [database/migrations/019_user_token_version.sql](../database/migrations/019_user_token_version.sql) |
| CK_AppUser_TokenVersion_Positive | CHECK | ACTIVE | `CONSTRAINT CK_AppUser_TokenVersion_Positive CHECK (TokenVersion >= 1)` · [database/migrations/019_user_token_version.sql](../database/migrations/019_user_token_version.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.AuditLog

表級狀態：**ACTIVE**；建立來源：[database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql)。

程式／SQL Repository 引用：[server/src/modules/admin/admin.repository.ts](../server/src/modules/admin/admin.repository.ts)、[server/src/modules/admin/workstationManagement.repository.ts](../server/src/modules/admin/workstationManagement.repository.ts)、[server/src/modules/audit/audit.repository.ts](../server/src/modules/audit/audit.repository.ts)、[server/src/modules/audit/deviceAuditHistory.ts](../server/src/modules/audit/deviceAuditHistory.ts)、[server/src/modules/audit/deliveryAudit.repository.ts](../server/src/modules/audit/deliveryAudit.repository.ts)、[server/src/modules/dataset/column.repository.ts](../server/src/modules/dataset/column.repository.ts)、[server/src/modules/dataset/dataset.repository.ts](../server/src/modules/dataset/dataset.repository.ts)、[server/src/modules/dataset/datasetPublicDisplay.repository.ts](../server/src/modules/dataset/datasetPublicDisplay.repository.ts)、[server/src/modules/dataset/datasetSensitiveColumn.repository.ts](../server/src/modules/dataset/datasetSensitiveColumn.repository.ts)、[server/src/modules/dataset/datasetScopeManagement.repository.ts](../server/src/modules/dataset/datasetScopeManagement.repository.ts)、[server/src/modules/dataset/dataset923ExactAuditReceipt.ts](../server/src/modules/dataset/dataset923ExactAuditReceipt.ts)、[server/src/modules/dataset/datasetMaskTemplate.repository.ts](../server/src/modules/dataset/datasetMaskTemplate.repository.ts)、[server/src/modules/queryDefinition/queryDefinition.repository.ts](../server/src/modules/queryDefinition/queryDefinition.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `Id BIGINT IDENTITY(1,1) PRIMARY KEY` · [database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql) |
| EventType | NVARCHAR(50) | NOT NULL | ACTIVE | `EventType NVARCHAR(50) NOT NULL` · [database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql) |
| UserId | BIGINT | NULL | ACTIVE | `UserId BIGINT NULL` · [database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql) |
| QueryDefinitionId | BIGINT | NULL | ACTIVE | `QueryDefinitionId BIGINT NULL` · [database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql) |
| DatasetId | BIGINT | NULL | ACTIVE | `DatasetId BIGINT NULL` · [database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql) |
| Status | NVARCHAR(20) | NOT NULL | ACTIVE | `Status NVARCHAR(20) NOT NULL` · [database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql) |
| ParametersJson | NVARCHAR(MAX) | NULL | ACTIVE | `ParametersJson NVARCHAR(MAX) NULL` · [database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql) |
| ResultRowCount | INT | NULL | ACTIVE | `ResultRowCount INT NULL` · [database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql) |
| DurationMs | INT | NULL | ACTIVE | `DurationMs INT NULL` · [database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql) |
| IpAddress | NVARCHAR(100) | NULL | ACTIVE | `IpAddress NVARCHAR(100) NULL` · [database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql) |
| UserAgent | NVARCHAR(500) | NULL | ACTIVE | `UserAgent NVARCHAR(500) NULL` · [database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql) |
| ErrorCode | NVARCHAR(200) | NULL | ACTIVE | `ErrorCode NVARCHAR(200) NULL` · [database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql) |
| CreatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_AuditLog_CreatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql) |
| CompletedAtUtc | DATETIME2(0) | NULL | ACTIVE | `CompletedAtUtc DATETIME2(0) NULL` · [database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql) |
| EventCategory | NVARCHAR(20) | NOT NULL | ACTIVE | `EventCategory NVARCHAR(20) NOT NULL CONSTRAINT DF_AuditLog_EventCategory DEFAULT ('SYSTEM')` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| IsImportant | BIT | NOT NULL | ACTIVE | `IsImportant BIT NOT NULL CONSTRAINT DF_AuditLog_IsImportant DEFAULT (0)` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| (unnamed PK: Id) | PRIMARY KEY | ACTIVE | `Id BIGINT IDENTITY(1,1) PRIMARY KEY` · [database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql) |
| DF_AuditLog_CreatedAt | DEFAULT | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_AuditLog_CreatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql) |
| FK_AuditLog_User | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_AuditLog_User FOREIGN KEY (UserId) REFERENCES uqp.AppUser(Id)` · [database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql) |
| FK_AuditLog_Query | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_AuditLog_Query FOREIGN KEY (QueryDefinitionId) REFERENCES uqp.QueryDefinition(Id)` · [database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql) |
| FK_AuditLog_Dataset | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_AuditLog_Dataset FOREIGN KEY (DatasetId) REFERENCES uqp.Dataset(Id)` · [database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql) |
| CK_AuditLog_Status | CHECK | ACTIVE | `CONSTRAINT CK_AuditLog_Status CHECK (Status IN ('STARTED','SUCCESS','FAILED'))` · [database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql) |
| DF_AuditLog_EventCategory | DEFAULT | ACTIVE | `EventCategory NVARCHAR(20) NOT NULL CONSTRAINT DF_AuditLog_EventCategory DEFAULT ('SYSTEM')` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| DF_AuditLog_IsImportant | DEFAULT | ACTIVE | `IsImportant BIT NOT NULL CONSTRAINT DF_AuditLog_IsImportant DEFAULT (0)` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| CK_AuditLog_EventCategory | CHECK | ACTIVE | `CONSTRAINT CK_AuditLog_EventCategory CHECK (EventCategory IN ('SECURITY','CONFIG','USAGE','SYSTEM'))` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |

| Index | 狀態 | 鍵／INCLUDE／filter／來源 |
|---|---|---|
| IX_AuditLog_CreatedAtUtc | UNKNOWN | `CREATE INDEX IX_AuditLog_CreatedAtUtc ON uqp.AuditLog (CreatedAtUtc DESC);` · [database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql) |
| IX_AuditLog_UserId_CreatedAtUtc | UNKNOWN | `CREATE INDEX IX_AuditLog_UserId_CreatedAtUtc ON uqp.AuditLog (UserId, CreatedAtUtc DESC);` · [database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql) |
| IX_AuditLog_QueryDefinitionId_CreatedAtUtc | UNKNOWN | `CREATE INDEX IX_AuditLog_QueryDefinitionId_CreatedAtUtc ON uqp.AuditLog (QueryDefinitionId, CreatedAtUtc DESC);` · [database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql) |
| IX_AuditLog_EventCategory_CreatedAtUtc | UNKNOWN | `CREATE INDEX IX_AuditLog_EventCategory_CreatedAtUtc ON uqp.AuditLog(EventCategory, CreatedAtUtc DESC);` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| IX_AuditLog_EventType_CreatedAtUtc | UNKNOWN | `CREATE INDEX IX_AuditLog_EventType_CreatedAtUtc ON uqp.AuditLog(EventType, CreatedAtUtc DESC);` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| IX_AuditLog_User_Query_Event_Status_CreatedAtUtc | UNKNOWN | `CREATE INDEX IX_AuditLog_User_Query_Event_Status_CreatedAtUtc ON uqp.AuditLog ( UserId, QueryDefinitionId, EventType, Status, CreatedAtUtc DESC ) WHERE UserId IS NOT NULL AND QueryDefinitionId IS NOT NULL;` · [database/migrations/018_recent_query_usage_index.sql](../database/migrations/018_recent_query_usage_index.sql) |

### uqp.AuditLogArchive

表級狀態：**ACTIVE**；建立來源：[database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql)。

程式／SQL Repository 引用：[server/src/modules/audit/audit.repository.ts](../server/src/modules/audit/audit.repository.ts)、[server/src/modules/audit/deviceAuditHistory.ts](../server/src/modules/audit/deviceAuditHistory.ts)、[server/src/modules/dataset/datasetScopeManagement.repository.ts](../server/src/modules/dataset/datasetScopeManagement.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `Id BIGINT NOT NULL CONSTRAINT PK_AuditLogArchive PRIMARY KEY` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| EventType | NVARCHAR(50) | NOT NULL | ACTIVE | `EventType NVARCHAR(50) NOT NULL` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| EventCategory | NVARCHAR(20) | NOT NULL | ACTIVE | `EventCategory NVARCHAR(20) NOT NULL` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| IsImportant | BIT | NOT NULL | ACTIVE | `IsImportant BIT NOT NULL` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| UserId | BIGINT | NULL | ACTIVE | `UserId BIGINT NULL` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| Username | NVARCHAR(100) | NULL | ACTIVE | `Username NVARCHAR(100) NULL` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| DisplayName | NVARCHAR(200) | NULL | ACTIVE | `DisplayName NVARCHAR(200) NULL` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| QueryDefinitionId | BIGINT | NULL | ACTIVE | `QueryDefinitionId BIGINT NULL` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| QueryCode | NVARCHAR(100) | NULL | ACTIVE | `QueryCode NVARCHAR(100) NULL` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| QueryName | NVARCHAR(200) | NULL | ACTIVE | `QueryName NVARCHAR(200) NULL` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| DatasetId | BIGINT | NULL | ACTIVE | `DatasetId BIGINT NULL` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| DatasetCode | NVARCHAR(100) | NULL | ACTIVE | `DatasetCode NVARCHAR(100) NULL` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| DatasetName | NVARCHAR(200) | NULL | ACTIVE | `DatasetName NVARCHAR(200) NULL` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| Status | NVARCHAR(20) | NOT NULL | ACTIVE | `Status NVARCHAR(20) NOT NULL` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| ParametersJson | NVARCHAR(MAX) | NULL | ACTIVE | `ParametersJson NVARCHAR(MAX) NULL` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| ResultRowCount | INT | NULL | ACTIVE | `ResultRowCount INT NULL` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| DurationMs | INT | NULL | ACTIVE | `DurationMs INT NULL` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| IpAddress | NVARCHAR(100) | NULL | ACTIVE | `IpAddress NVARCHAR(100) NULL` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| UserAgent | NVARCHAR(500) | NULL | ACTIVE | `UserAgent NVARCHAR(500) NULL` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| ErrorCode | NVARCHAR(200) | NULL | ACTIVE | `ErrorCode NVARCHAR(200) NULL` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| CreatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| CompletedAtUtc | DATETIME2(0) | NULL | ACTIVE | `CompletedAtUtc DATETIME2(0) NULL` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| ArchivedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `ArchivedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_AuditLogArchive_ArchivedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| PK_AuditLogArchive | PRIMARY KEY | ACTIVE | `Id BIGINT NOT NULL CONSTRAINT PK_AuditLogArchive PRIMARY KEY` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| DF_AuditLogArchive_ArchivedAt | DEFAULT | ACTIVE | `ArchivedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_AuditLogArchive_ArchivedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| CK_AuditLogArchive_EventCategory | CHECK | ACTIVE | `CONSTRAINT CK_AuditLogArchive_EventCategory CHECK (EventCategory IN ('SECURITY','CONFIG','USAGE','SYSTEM'))` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| CK_AuditLogArchive_Status | CHECK | ACTIVE | `CONSTRAINT CK_AuditLogArchive_Status CHECK (Status IN ('STARTED','SUCCESS','FAILED'))` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |

| Index | 狀態 | 鍵／INCLUDE／filter／來源 |
|---|---|---|
| IX_AuditLogArchive_CreatedAtUtc | UNKNOWN | `CREATE INDEX IX_AuditLogArchive_CreatedAtUtc ON uqp.AuditLogArchive(CreatedAtUtc DESC);` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |
| IX_AuditLogArchive_Category_CreatedAtUtc | UNKNOWN | `CREATE INDEX IX_AuditLogArchive_Category_CreatedAtUtc ON uqp.AuditLogArchive(EventCategory, CreatedAtUtc DESC);` · [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) |

### uqp.Dashboard

表級狀態：**ACTIVE**；建立來源：[database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql)。

程式／SQL Repository 引用：[server/src/modules/dashboard/dashboard.repository.ts](../server/src/modules/dashboard/dashboard.repository.ts)、[server/src/modules/dashboard/dashboardDevice.repository.ts](../server/src/modules/dashboard/dashboardDevice.repository.ts)、[server/src/modules/dashboard/dashboardLayout.repository.ts](../server/src/modules/dashboard/dashboardLayout.repository.ts)、[server/src/modules/dashboard/dashboardQueryMode.repository.ts](../server/src/modules/dashboard/dashboardQueryMode.repository.ts)、[server/src/modules/dashboard/dashboardSourceWriteGuard.ts](../server/src/modules/dashboard/dashboardSourceWriteGuard.ts)、[server/src/modules/dashboard/dashboardApproval.repository.ts](../server/src/modules/dashboard/dashboardApproval.repository.ts)、[server/src/modules/dashboard/dashboardQuerySources.repository.ts](../server/src/modules/dashboard/dashboardQuerySources.repository.ts)、[server/src/modules/dashboard/dashboardDeviceManagement.repository.ts](../server/src/modules/dashboard/dashboardDeviceManagement.repository.ts)、[server/src/modules/dashboard/dashboardQuerySourceExecution.repository.ts](../server/src/modules/dashboard/dashboardQuerySourceExecution.repository.ts)、[server/src/modules/dashboard/dashboardTransition.repository.ts](../server/src/modules/dashboard/dashboardTransition.repository.ts)、[server/src/modules/dashboard/dashboardLegacyLocks.ts](../server/src/modules/dashboard/dashboardLegacyLocks.ts)、[server/src/modules/dataset/dataset.repository.ts](../server/src/modules/dataset/dataset.repository.ts)、[server/src/modules/dataset/datasetSensitiveColumn.repository.ts](../server/src/modules/dataset/datasetSensitiveColumn.repository.ts)、[server/src/modules/queryDefinition/queryAccess.repository.ts](../server/src/modules/queryDefinition/queryAccess.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Dashboard PRIMARY KEY` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| Code | NVARCHAR(100) | NOT NULL | ACTIVE | `Code NVARCHAR(100) NOT NULL` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| Name | NVARCHAR(200) | NOT NULL | ACTIVE | `Name NVARCHAR(200) NOT NULL` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| Description | NVARCHAR(1000) | NULL | UNKNOWN | `Description NVARCHAR(1000) NULL` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| QueryDefinitionId | BIGINT | NOT NULL | LEGACY_REQUIRED | `QueryDefinitionId BIGINT NOT NULL` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| RefreshSeconds | INT | NOT NULL | ACTIVE | `RefreshSeconds INT NOT NULL CONSTRAINT DF_Dashboard_RefreshSeconds DEFAULT (10)` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| ParametersJson | NVARCHAR(MAX) | NOT NULL | ACTIVE | `ParametersJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_Dashboard_ParametersJson DEFAULT ('{}')` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| IsActive | BIT | NOT NULL | ACTIVE | `IsActive BIT NOT NULL CONSTRAINT DF_Dashboard_IsActive DEFAULT (1)` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| CreatedByUserId | BIGINT | NULL | ACTIVE | `CreatedByUserId BIGINT NULL` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| UpdatedByUserId | BIGINT | NULL | ACTIVE | `UpdatedByUserId BIGINT NULL` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| CreatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_Dashboard_CreatedAtUtc DEFAULT (SYSUTCDATETIME())` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| UpdatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_Dashboard_UpdatedAtUtc DEFAULT (SYSUTCDATETIME())` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| DisplayMode | NVARCHAR(20) | NOT NULL | ACTIVE | `DisplayMode NVARCHAR(20) NOT NULL CONSTRAINT DF_Dashboard_DisplayMode DEFAULT ('BIG_SCREEN')` · [database/migrations/021_dashboard_display_layout.sql](../database/migrations/021_dashboard_display_layout.sql) |
| DisplayTitle | NVARCHAR(200) | NULL | UNKNOWN | `DisplayTitle NVARCHAR(200) NULL` · [database/migrations/021_dashboard_display_layout.sql](../database/migrations/021_dashboard_display_layout.sql) |
| PageSize | INT | NOT NULL | ACTIVE | `PageSize INT NOT NULL CONSTRAINT DF_Dashboard_PageSize DEFAULT (5)` · [database/migrations/021_dashboard_display_layout.sql](../database/migrations/021_dashboard_display_layout.sql) |
| PageSeconds | INT | NOT NULL | ACTIVE | `PageSeconds INT NOT NULL CONSTRAINT DF_Dashboard_PageSeconds DEFAULT (20)` · [database/migrations/021_dashboard_display_layout.sql](../database/migrations/021_dashboard_display_layout.sql) |
| ShowClock | BIT | NOT NULL | ACTIVE | `ShowClock BIT NOT NULL CONSTRAINT DF_Dashboard_ShowClock DEFAULT (1)` · [database/migrations/021_dashboard_display_layout.sql](../database/migrations/021_dashboard_display_layout.sql) |
| ShowPageNumber | BIT | NOT NULL | ACTIVE | `ShowPageNumber BIT NOT NULL CONSTRAINT DF_Dashboard_ShowPageNumber DEFAULT (1)` · [database/migrations/021_dashboard_display_layout.sql](../database/migrations/021_dashboard_display_layout.sql) |
| ShowCountdown | BIT | NOT NULL | ACTIVE | `ShowCountdown BIT NOT NULL CONSTRAINT DF_Dashboard_ShowCountdown DEFAULT (1)` · [database/migrations/021_dashboard_display_layout.sql](../database/migrations/021_dashboard_display_layout.sql) |
| QuerySourceMaxRows | INT | NULL | ACTIVE | `QuerySourceMaxRows INT NULL` · [database/migrations/917_dashboard_query_source_model.sql](../database/migrations/917_dashboard_query_source_model.sql) |
| QueryMode | VARCHAR(24) | NOT NULL | ACTIVE | `QueryMode VARCHAR(24) NOT NULL CONSTRAINT DF_Dashboard_QueryMode DEFAULT ('LEGACY')` · [database/migrations/918_dashboard_query_playback_mode.sql](../database/migrations/918_dashboard_query_playback_mode.sql) |
| QueryModeVersion | BIGINT | NOT NULL | ACTIVE | `QueryModeVersion BIGINT NOT NULL CONSTRAINT DF_Dashboard_QueryModeVersion DEFAULT (0)` · [database/migrations/918_dashboard_query_playback_mode.sql](../database/migrations/918_dashboard_query_playback_mode.sql) |
| ApprovalRowVersion | ROWVERSION | NOT NULL | UNKNOWN | `ApprovalRowVersion ROWVERSION NOT NULL` · [database/migrations/919_dashboard_dataset_security_contract.sql](../database/migrations/919_dashboard_dataset_security_contract.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| PK_Dashboard | PRIMARY KEY | ACTIVE | `Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Dashboard PRIMARY KEY` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| DF_Dashboard_RefreshSeconds | DEFAULT | ACTIVE | `RefreshSeconds INT NOT NULL CONSTRAINT DF_Dashboard_RefreshSeconds DEFAULT (10)` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| DF_Dashboard_ParametersJson | DEFAULT | ACTIVE | `ParametersJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_Dashboard_ParametersJson DEFAULT ('{}')` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| DF_Dashboard_IsActive | DEFAULT | ACTIVE | `IsActive BIT NOT NULL CONSTRAINT DF_Dashboard_IsActive DEFAULT (1)` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| DF_Dashboard_CreatedAtUtc | DEFAULT | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_Dashboard_CreatedAtUtc DEFAULT (SYSUTCDATETIME())` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| DF_Dashboard_UpdatedAtUtc | DEFAULT | ACTIVE | `UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_Dashboard_UpdatedAtUtc DEFAULT (SYSUTCDATETIME())` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| UQ_Dashboard_Code | UNIQUE | ACTIVE | `CONSTRAINT UQ_Dashboard_Code UNIQUE (Code)` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| FK_Dashboard_QueryDefinition | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_Dashboard_QueryDefinition FOREIGN KEY (QueryDefinitionId) REFERENCES uqp.QueryDefinition(Id)` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| FK_Dashboard_CreatedByUser | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_Dashboard_CreatedByUser FOREIGN KEY (CreatedByUserId) REFERENCES uqp.AppUser(Id)` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| FK_Dashboard_UpdatedByUser | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_Dashboard_UpdatedByUser FOREIGN KEY (UpdatedByUserId) REFERENCES uqp.AppUser(Id)` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| CK_Dashboard_RefreshSeconds | CHECK | ACTIVE | `CONSTRAINT CK_Dashboard_RefreshSeconds CHECK (RefreshSeconds BETWEEN 5 AND 3600)` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| CK_Dashboard_ParametersJson | CHECK | ACTIVE | `CONSTRAINT CK_Dashboard_ParametersJson CHECK (ISJSON(ParametersJson)=1)` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| DF_Dashboard_DisplayMode | DEFAULT | ACTIVE | `DisplayMode NVARCHAR(20) NOT NULL CONSTRAINT DF_Dashboard_DisplayMode DEFAULT ('BIG_SCREEN')` · [database/migrations/021_dashboard_display_layout.sql](../database/migrations/021_dashboard_display_layout.sql) |
| DF_Dashboard_PageSize | DEFAULT | ACTIVE | `PageSize INT NOT NULL CONSTRAINT DF_Dashboard_PageSize DEFAULT (5)` · [database/migrations/021_dashboard_display_layout.sql](../database/migrations/021_dashboard_display_layout.sql) |
| DF_Dashboard_PageSeconds | DEFAULT | ACTIVE | `PageSeconds INT NOT NULL CONSTRAINT DF_Dashboard_PageSeconds DEFAULT (20)` · [database/migrations/021_dashboard_display_layout.sql](../database/migrations/021_dashboard_display_layout.sql) |
| DF_Dashboard_ShowClock | DEFAULT | ACTIVE | `ShowClock BIT NOT NULL CONSTRAINT DF_Dashboard_ShowClock DEFAULT (1)` · [database/migrations/021_dashboard_display_layout.sql](../database/migrations/021_dashboard_display_layout.sql) |
| DF_Dashboard_ShowPageNumber | DEFAULT | ACTIVE | `ShowPageNumber BIT NOT NULL CONSTRAINT DF_Dashboard_ShowPageNumber DEFAULT (1)` · [database/migrations/021_dashboard_display_layout.sql](../database/migrations/021_dashboard_display_layout.sql) |
| DF_Dashboard_ShowCountdown | DEFAULT | ACTIVE | `ShowCountdown BIT NOT NULL CONSTRAINT DF_Dashboard_ShowCountdown DEFAULT (1)` · [database/migrations/021_dashboard_display_layout.sql](../database/migrations/021_dashboard_display_layout.sql) |
| CK_Dashboard_DisplayMode | CHECK | ACTIVE | `CONSTRAINT CK_Dashboard_DisplayMode CHECK (DisplayMode IN ('TABLE','BIG_SCREEN'))` · [database/migrations/021_dashboard_display_layout.sql](../database/migrations/021_dashboard_display_layout.sql) |
| CK_Dashboard_PageSize | CHECK | ACTIVE | `CONSTRAINT CK_Dashboard_PageSize CHECK (PageSize BETWEEN 1 AND 50)` · [database/migrations/021_dashboard_display_layout.sql](../database/migrations/021_dashboard_display_layout.sql) |
| CK_Dashboard_PageSeconds | CHECK | ACTIVE | `CONSTRAINT CK_Dashboard_PageSeconds CHECK (PageSeconds BETWEEN 5 AND 3600)` · [database/migrations/021_dashboard_display_layout.sql](../database/migrations/021_dashboard_display_layout.sql) |
| CK_Dashboard_QuerySourceMaxRows | CHECK | ACTIVE | `CONSTRAINT CK_Dashboard_QuerySourceMaxRows CHECK (QuerySourceMaxRows IS NULL OR QuerySourceMaxRows BETWEEN 1 AND 10000)` · [database/migrations/917_dashboard_query_source_model.sql](../database/migrations/917_dashboard_query_source_model.sql) |
| DF_Dashboard_QueryMode | DEFAULT | ACTIVE | `QueryMode VARCHAR(24) NOT NULL CONSTRAINT DF_Dashboard_QueryMode DEFAULT ('LEGACY')` · [database/migrations/918_dashboard_query_playback_mode.sql](../database/migrations/918_dashboard_query_playback_mode.sql) |
| DF_Dashboard_QueryModeVersion | DEFAULT | ACTIVE | `QueryModeVersion BIGINT NOT NULL CONSTRAINT DF_Dashboard_QueryModeVersion DEFAULT (0)` · [database/migrations/918_dashboard_query_playback_mode.sql](../database/migrations/918_dashboard_query_playback_mode.sql) |
| CK_Dashboard_QueryMode | CHECK | ACTIVE | `CONSTRAINT CK_Dashboard_QueryMode CHECK (QueryMode IN ('LEGACY','QUERY_ONLY','QUERY_ONLY_DISABLED') AND QueryModeVersion >= 0 AND (QueryMode='LEGACY' OR QueryModeVersion > 0))` · [database/migrations/918_dashboard_query_playback_mode.sql](../database/migrations/918_dashboard_query_playback_mode.sql) |

| Index | 狀態 | 鍵／INCLUDE／filter／來源 |
|---|---|---|
| IX_Dashboard_QueryDefinitionId | UNKNOWN | `CREATE INDEX IX_Dashboard_QueryDefinitionId ON uqp.Dashboard(QueryDefinitionId, IsActive);` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |
| IX_Dashboard_IsActive_Name | UNKNOWN | `CREATE INDEX IX_Dashboard_IsActive_Name ON uqp.Dashboard(IsActive, Name);` · [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) |

### uqp.DashboardAuthenticationPolicy

表級狀態：**UNKNOWN**；建立來源：[database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql)。

程式／SQL Repository 引用：未證明直接業務讀寫；依上述特殊判定保留。

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| DashboardId | BIGINT | NOT NULL | UNKNOWN | `DashboardId BIGINT NOT NULL PRIMARY KEY` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| PolicyCode | NVARCHAR(30) | NOT NULL | UNKNOWN | `PolicyCode NVARCHAR(30) NOT NULL CONSTRAINT DF_DashboardAuthenticationPolicy_Code DEFAULT 'STAFF_SECURE'` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| IdleLockSeconds | INT | NOT NULL | UNKNOWN | `IdleLockSeconds INT NOT NULL CONSTRAINT DF_DashboardAuthenticationPolicy_Idle DEFAULT 180` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| UpdatedAtUtc | DATETIME2(3) | NOT NULL | UNKNOWN | `UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_DashboardAuthenticationPolicy_Updated DEFAULT SYSUTCDATETIME()` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| (unnamed PK: DashboardId) | PRIMARY KEY | UNKNOWN | `DashboardId BIGINT NOT NULL PRIMARY KEY` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| DF_DashboardAuthenticationPolicy_Code | DEFAULT | UNKNOWN | `PolicyCode NVARCHAR(30) NOT NULL CONSTRAINT DF_DashboardAuthenticationPolicy_Code DEFAULT 'STAFF_SECURE'` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| DF_DashboardAuthenticationPolicy_Idle | DEFAULT | UNKNOWN | `IdleLockSeconds INT NOT NULL CONSTRAINT DF_DashboardAuthenticationPolicy_Idle DEFAULT 180` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| DF_DashboardAuthenticationPolicy_Updated | DEFAULT | UNKNOWN | `UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_DashboardAuthenticationPolicy_Updated DEFAULT SYSUTCDATETIME()` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| CK_DashboardAuthenticationPolicy_Code | CHECK | UNKNOWN | `CONSTRAINT CK_DashboardAuthenticationPolicy_Code CHECK (PolicyCode IN ('PUBLIC','STAFF_FAST','STAFF_SECURE','SENSITIVE'))` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| CK_DashboardAuthenticationPolicy_Idle | CHECK | UNKNOWN | `CONSTRAINT CK_DashboardAuthenticationPolicy_Idle CHECK (IdleLockSeconds BETWEEN 30 AND 3600)` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.DashboardDataSource

表級狀態：**ACTIVE**；建立來源：[database/migrations/913_dashboard_multi_dataset_sources.sql](../database/migrations/913_dashboard_multi_dataset_sources.sql)。

程式／SQL Repository 引用：[server/src/modules/dashboard/dashboardDataSource.repository.ts](../server/src/modules/dashboard/dashboardDataSource.repository.ts)、[server/src/modules/dashboard/dashboardSourceWriteGuard.ts](../server/src/modules/dashboard/dashboardSourceWriteGuard.ts)、[server/src/modules/dashboard/dashboardApproval.repository.ts](../server/src/modules/dashboard/dashboardApproval.repository.ts)、[server/src/modules/dashboard/dashboardQuerySources.repository.ts](../server/src/modules/dashboard/dashboardQuerySources.repository.ts)、[server/src/modules/dashboard/dashboardQuerySourceExecution.repository.ts](../server/src/modules/dashboard/dashboardQuerySourceExecution.repository.ts)、[server/src/modules/dashboard/dashboardLegacyLocks.ts](../server/src/modules/dashboard/dashboardLegacyLocks.ts)、[server/src/modules/dataset/dataset.repository.ts](../server/src/modules/dataset/dataset.repository.ts)、[server/src/modules/queryDefinition/queryAccess.repository.ts](../server/src/modules/queryDefinition/queryAccess.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DashboardDataSource PRIMARY KEY` · [database/migrations/913_dashboard_multi_dataset_sources.sql](../database/migrations/913_dashboard_multi_dataset_sources.sql) |
| DashboardId | BIGINT | NOT NULL | ACTIVE | `DashboardId BIGINT NOT NULL` · [database/migrations/913_dashboard_multi_dataset_sources.sql](../database/migrations/913_dashboard_multi_dataset_sources.sql) |
| SourceKey | NVARCHAR(64) | NOT NULL | ACTIVE | `SourceKey NVARCHAR(64) NOT NULL` · [database/migrations/913_dashboard_multi_dataset_sources.sql](../database/migrations/913_dashboard_multi_dataset_sources.sql) |
| DatasetId | BIGINT | NOT NULL | ACTIVE | `DatasetId BIGINT NOT NULL` · [database/migrations/913_dashboard_multi_dataset_sources.sql](../database/migrations/913_dashboard_multi_dataset_sources.sql) |
| RefreshSeconds | INT | NOT NULL | ACTIVE | `RefreshSeconds INT NOT NULL CONSTRAINT DF_DashboardDataSource_RefreshSeconds DEFAULT (30)` · [database/migrations/913_dashboard_multi_dataset_sources.sql](../database/migrations/913_dashboard_multi_dataset_sources.sql) |
| ParametersJson | NVARCHAR(MAX) | NOT NULL | ACTIVE | `ParametersJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_DashboardDataSource_ParametersJson DEFAULT (N'{}')` · [database/migrations/913_dashboard_multi_dataset_sources.sql](../database/migrations/913_dashboard_multi_dataset_sources.sql) |
| IsEnabled | BIT | NOT NULL | ACTIVE | `IsEnabled BIT NOT NULL CONSTRAINT DF_DashboardDataSource_IsEnabled DEFAULT (1)` · [database/migrations/913_dashboard_multi_dataset_sources.sql](../database/migrations/913_dashboard_multi_dataset_sources.sql) |
| CreatedAtUtc | DATETIME2(3) | NOT NULL | ACTIVE | `CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_DashboardDataSource_CreatedAt DEFAULT SYSUTCDATETIME()` · [database/migrations/913_dashboard_multi_dataset_sources.sql](../database/migrations/913_dashboard_multi_dataset_sources.sql) |
| UpdatedAtUtc | DATETIME2(3) | NOT NULL | ACTIVE | `UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_DashboardDataSource_UpdatedAt DEFAULT SYSUTCDATETIME()` · [database/migrations/913_dashboard_multi_dataset_sources.sql](../database/migrations/913_dashboard_multi_dataset_sources.sql) |
| PageSize | INT | NOT NULL | ACTIVE | `PageSize INT NOT NULL CONSTRAINT DF_DashboardDataSource_PageSize DEFAULT (10)` · [database/migrations/914_dashboard_source_paging.sql](../database/migrations/914_dashboard_source_paging.sql) |
| PageSeconds | INT | NOT NULL | ACTIVE | `PageSeconds INT NOT NULL CONSTRAINT DF_DashboardDataSource_PageSeconds DEFAULT (15)` · [database/migrations/914_dashboard_source_paging.sql](../database/migrations/914_dashboard_source_paging.sql) |
| QueryDefinitionId | BIGINT | NULL | ACTIVE | `QueryDefinitionId BIGINT NULL` · [database/migrations/917_dashboard_query_source_model.sql](../database/migrations/917_dashboard_query_source_model.sql) |
| QueryBindingRevision | BIGINT | NOT NULL | ACTIVE | `QueryBindingRevision BIGINT NOT NULL CONSTRAINT DF_DashboardDataSource_QueryBindingRevision DEFAULT (0)` · [database/migrations/917_dashboard_query_source_model.sql](../database/migrations/917_dashboard_query_source_model.sql) |
| MaxRows | INT | NULL | ACTIVE | `MaxRows INT NULL` · [database/migrations/917_dashboard_query_source_model.sql](../database/migrations/917_dashboard_query_source_model.sql) |
| QueryBindingState | computed VARCHAR(20) | UNKNOWN（需 Catalog 驗證） | UNKNOWN | `QueryBindingState AS CONVERT(VARCHAR(20), CASE WHEN QueryDefinitionId IS NULL THEN 'PENDING_CONVERSION' ELSE 'QUERY_BOUND' END)` · [database/migrations/917_dashboard_query_source_model.sql](../database/migrations/917_dashboard_query_source_model.sql) |
| ApprovalRowVersion | ROWVERSION | NOT NULL | UNKNOWN | `ApprovalRowVersion ROWVERSION NOT NULL` · [database/migrations/919_dashboard_dataset_security_contract.sql](../database/migrations/919_dashboard_dataset_security_contract.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| PK_DashboardDataSource | PRIMARY KEY | ACTIVE | `Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DashboardDataSource PRIMARY KEY` · [database/migrations/913_dashboard_multi_dataset_sources.sql](../database/migrations/913_dashboard_multi_dataset_sources.sql) |
| DF_DashboardDataSource_RefreshSeconds | DEFAULT | ACTIVE | `RefreshSeconds INT NOT NULL CONSTRAINT DF_DashboardDataSource_RefreshSeconds DEFAULT (30)` · [database/migrations/913_dashboard_multi_dataset_sources.sql](../database/migrations/913_dashboard_multi_dataset_sources.sql) |
| DF_DashboardDataSource_ParametersJson | DEFAULT | ACTIVE | `ParametersJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_DashboardDataSource_ParametersJson DEFAULT (N'{}')` · [database/migrations/913_dashboard_multi_dataset_sources.sql](../database/migrations/913_dashboard_multi_dataset_sources.sql) |
| DF_DashboardDataSource_IsEnabled | DEFAULT | ACTIVE | `IsEnabled BIT NOT NULL CONSTRAINT DF_DashboardDataSource_IsEnabled DEFAULT (1)` · [database/migrations/913_dashboard_multi_dataset_sources.sql](../database/migrations/913_dashboard_multi_dataset_sources.sql) |
| DF_DashboardDataSource_CreatedAt | DEFAULT | ACTIVE | `CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_DashboardDataSource_CreatedAt DEFAULT SYSUTCDATETIME()` · [database/migrations/913_dashboard_multi_dataset_sources.sql](../database/migrations/913_dashboard_multi_dataset_sources.sql) |
| DF_DashboardDataSource_UpdatedAt | DEFAULT | ACTIVE | `UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_DashboardDataSource_UpdatedAt DEFAULT SYSUTCDATETIME()` · [database/migrations/913_dashboard_multi_dataset_sources.sql](../database/migrations/913_dashboard_multi_dataset_sources.sql) |
| FK_DashboardDataSource_Dashboard | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_DashboardDataSource_Dashboard FOREIGN KEY (DashboardId) REFERENCES uqp.Dashboard(Id) ON DELETE CASCADE` · [database/migrations/913_dashboard_multi_dataset_sources.sql](../database/migrations/913_dashboard_multi_dataset_sources.sql) |
| FK_DashboardDataSource_Dataset | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_DashboardDataSource_Dataset FOREIGN KEY (DatasetId) REFERENCES uqp.Dataset(Id)` · [database/migrations/913_dashboard_multi_dataset_sources.sql](../database/migrations/913_dashboard_multi_dataset_sources.sql) |
| UQ_DashboardDataSource_Key | UNIQUE | ACTIVE | `CONSTRAINT UQ_DashboardDataSource_Key UNIQUE (DashboardId, SourceKey)` · [database/migrations/913_dashboard_multi_dataset_sources.sql](../database/migrations/913_dashboard_multi_dataset_sources.sql) |
| CK_DashboardDataSource_Refresh | CHECK | ACTIVE | `CONSTRAINT CK_DashboardDataSource_Refresh CHECK (RefreshSeconds BETWEEN 5 AND 3600)` · [database/migrations/913_dashboard_multi_dataset_sources.sql](../database/migrations/913_dashboard_multi_dataset_sources.sql) |
| CK_DashboardDataSource_Parameters | CHECK | ACTIVE | `CONSTRAINT CK_DashboardDataSource_Parameters CHECK (ISJSON(ParametersJson) = 1)` · [database/migrations/913_dashboard_multi_dataset_sources.sql](../database/migrations/913_dashboard_multi_dataset_sources.sql) |
| DF_DashboardDataSource_PageSize | DEFAULT | ACTIVE | `PageSize INT NOT NULL CONSTRAINT DF_DashboardDataSource_PageSize DEFAULT (10)` · [database/migrations/914_dashboard_source_paging.sql](../database/migrations/914_dashboard_source_paging.sql) |
| DF_DashboardDataSource_PageSeconds | DEFAULT | ACTIVE | `PageSeconds INT NOT NULL CONSTRAINT DF_DashboardDataSource_PageSeconds DEFAULT (15)` · [database/migrations/914_dashboard_source_paging.sql](../database/migrations/914_dashboard_source_paging.sql) |
| CK_DashboardDataSource_PageSize | CHECK | ACTIVE | `CONSTRAINT CK_DashboardDataSource_PageSize CHECK (PageSize BETWEEN 1 AND 100)` · [database/migrations/915_dashboard_security_reconciliation.sql](../database/migrations/915_dashboard_security_reconciliation.sql) |
| CK_DashboardDataSource_PageSeconds | CHECK | ACTIVE | `CONSTRAINT CK_DashboardDataSource_PageSeconds CHECK (PageSeconds BETWEEN 5 AND 3600)` · [database/migrations/915_dashboard_security_reconciliation.sql](../database/migrations/915_dashboard_security_reconciliation.sql) |
| DF_DashboardDataSource_QueryBindingRevision | DEFAULT | ACTIVE | `QueryBindingRevision BIGINT NOT NULL CONSTRAINT DF_DashboardDataSource_QueryBindingRevision DEFAULT (0)` · [database/migrations/917_dashboard_query_source_model.sql](../database/migrations/917_dashboard_query_source_model.sql) |
| FK_DashboardDataSource_QueryDefinition | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_DashboardDataSource_QueryDefinition FOREIGN KEY (QueryDefinitionId) REFERENCES uqp.QueryDefinition(Id)` · [database/migrations/917_dashboard_query_source_model.sql](../database/migrations/917_dashboard_query_source_model.sql) |
| CK_DashboardDataSource_QueryBindingRevision | CHECK | ACTIVE | `CONSTRAINT CK_DashboardDataSource_QueryBindingRevision CHECK (QueryBindingRevision >= 0)` · [database/migrations/917_dashboard_query_source_model.sql](../database/migrations/917_dashboard_query_source_model.sql) |
| CK_DashboardDataSource_MaxRows | CHECK | ACTIVE | `CONSTRAINT CK_DashboardDataSource_MaxRows CHECK (MaxRows IS NULL OR MaxRows BETWEEN 1 AND 10000)` · [database/migrations/917_dashboard_query_source_model.sql](../database/migrations/917_dashboard_query_source_model.sql) |
| CK_DashboardDataSource_QueryBoundLimit | CHECK | ACTIVE | `CONSTRAINT CK_DashboardDataSource_QueryBoundLimit CHECK (QueryDefinitionId IS NULL OR MaxRows IS NOT NULL)` · [database/migrations/917_dashboard_query_source_model.sql](../database/migrations/917_dashboard_query_source_model.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.DashboardDeviceArchiveHistory

表級狀態：**ACTIVE**；建立來源：[database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql)。

程式／SQL Repository 引用：[server/src/modules/dashboard/dashboardDevice.repository.ts](../server/src/modules/dashboard/dashboardDevice.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `Id BIGINT IDENTITY(1,1) PRIMARY KEY` · [database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql) |
| DashboardId | BIGINT | NOT NULL | ACTIVE | `DashboardId BIGINT NOT NULL` · [database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql) |
| DeviceId | BIGINT | NOT NULL | UNKNOWN | `DeviceId BIGINT NOT NULL` · [database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql) |
| ArchiveMode | NVARCHAR(10) | NOT NULL | ACTIVE | `ArchiveMode NVARCHAR(10) NOT NULL` · [database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql) |
| ArchivedByUserId | BIGINT | NULL | UNKNOWN | `ArchivedByUserId BIGINT NULL` · [database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql) |
| ArchivedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `ArchivedAtUtc DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()` · [database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| (unnamed PK: Id) | PRIMARY KEY | ACTIVE | `Id BIGINT IDENTITY(1,1) PRIMARY KEY` · [database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql) |
| (unnamed DEFAULT: ArchivedAtUtc) | DEFAULT | ACTIVE | `ArchivedAtUtc DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()` · [database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql) |
| CK_DashboardDeviceArchiveHistory_Mode | CHECK | ACTIVE | `CONSTRAINT CK_DashboardDeviceArchiveHistory_Mode CHECK (ArchiveMode IN ('MANUAL','AUTO'))` · [database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql) |

| Index | 狀態 | 鍵／INCLUDE／filter／來源 |
|---|---|---|
| IX_DashboardDeviceArchiveHistory_Dashboard | UNKNOWN | `CREATE INDEX IX_DashboardDeviceArchiveHistory_Dashboard ON uqp.DashboardDeviceArchiveHistory(DashboardId, ArchivedAtUtc DESC);` · [database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql) |

### uqp.DashboardDeviceArchivePolicy

表級狀態：**ACTIVE**；建立來源：[database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql)。

程式／SQL Repository 引用：[server/src/modules/dashboard/dashboardDevice.repository.ts](../server/src/modules/dashboard/dashboardDevice.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| DashboardId | BIGINT | NOT NULL | ACTIVE | `DashboardId BIGINT NOT NULL PRIMARY KEY REFERENCES uqp.Dashboard(Id) ON DELETE CASCADE` · [database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql) |
| AutoArchiveEnabled | BIT | NOT NULL | ACTIVE | `AutoArchiveEnabled BIT NOT NULL DEFAULT 1` · [database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql) |
| RetentionDays | INT | NOT NULL | ACTIVE | `RetentionDays INT NOT NULL DEFAULT 90` · [database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql) |
| UpdatedByUserId | BIGINT | NULL | UNKNOWN | `UpdatedByUserId BIGINT NULL` · [database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql) |
| UpdatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `UpdatedAtUtc DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()` · [database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| (unnamed PK: DashboardId) | PRIMARY KEY | ACTIVE | `DashboardId BIGINT NOT NULL PRIMARY KEY REFERENCES uqp.Dashboard(Id) ON DELETE CASCADE` · [database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql) |
| (unnamed DEFAULT: AutoArchiveEnabled) | DEFAULT | ACTIVE | `AutoArchiveEnabled BIT NOT NULL DEFAULT 1` · [database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql) |
| (unnamed DEFAULT: RetentionDays) | DEFAULT | ACTIVE | `RetentionDays INT NOT NULL DEFAULT 90` · [database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql) |
| (unnamed DEFAULT: UpdatedAtUtc) | DEFAULT | ACTIVE | `UpdatedAtUtc DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()` · [database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql) |
| CK_DashboardDeviceArchivePolicy_Days | CHECK | ACTIVE | `CONSTRAINT CK_DashboardDeviceArchivePolicy_Days CHECK (RetentionDays BETWEEN 1 AND 3650)` · [database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.DashboardDevicePlaybackSettings

表級狀態：**ACTIVE**；建立來源：[database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql)。

程式／SQL Repository 引用：[server/src/modules/dashboard/dashboardDevice.repository.ts](../server/src/modules/dashboard/dashboardDevice.repository.ts)、[server/src/modules/dashboard/dashboardDeviceManagement.repository.ts](../server/src/modules/dashboard/dashboardDeviceManagement.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| DashboardId | BIGINT | NOT NULL | UNKNOWN | `DashboardId BIGINT NOT NULL` · [database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) |
| DeviceId | BIGINT | NOT NULL | ACTIVE | `DeviceId BIGINT NOT NULL PRIMARY KEY` · [database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) |
| Browser | NVARCHAR(10) | NOT NULL | ACTIVE | `Browser NVARCHAR(10) NOT NULL DEFAULT 'edge'` · [database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) |
| ScreenNumber | INT | NOT NULL | ACTIVE | `ScreenNumber INT NOT NULL DEFAULT 2` · [database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) |
| Fullscreen | BIT | NOT NULL | ACTIVE | `Fullscreen BIT NOT NULL DEFAULT 1` · [database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) |
| WindowX | INT | NOT NULL | ACTIVE | `WindowX INT NOT NULL DEFAULT 1920` · [database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) |
| WindowY | INT | NOT NULL | ACTIVE | `WindowY INT NOT NULL DEFAULT 0` · [database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) |
| WindowWidth | INT | NOT NULL | ACTIVE | `WindowWidth INT NOT NULL DEFAULT 1920` · [database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) |
| WindowHeight | INT | NOT NULL | ACTIVE | `WindowHeight INT NOT NULL DEFAULT 1080` · [database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) |
| UpdatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `UpdatedAtUtc DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()` · [database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| (unnamed PK: DeviceId) | PRIMARY KEY | ACTIVE | `DeviceId BIGINT NOT NULL PRIMARY KEY` · [database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) |
| (unnamed DEFAULT: Browser) | DEFAULT | ACTIVE | `Browser NVARCHAR(10) NOT NULL DEFAULT 'edge'` · [database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) |
| (unnamed DEFAULT: ScreenNumber) | DEFAULT | ACTIVE | `ScreenNumber INT NOT NULL DEFAULT 2` · [database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) |
| (unnamed DEFAULT: Fullscreen) | DEFAULT | ACTIVE | `Fullscreen BIT NOT NULL DEFAULT 1` · [database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) |
| (unnamed DEFAULT: WindowX) | DEFAULT | ACTIVE | `WindowX INT NOT NULL DEFAULT 1920` · [database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) |
| (unnamed DEFAULT: WindowY) | DEFAULT | ACTIVE | `WindowY INT NOT NULL DEFAULT 0` · [database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) |
| (unnamed DEFAULT: WindowWidth) | DEFAULT | ACTIVE | `WindowWidth INT NOT NULL DEFAULT 1920` · [database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) |
| (unnamed DEFAULT: WindowHeight) | DEFAULT | ACTIVE | `WindowHeight INT NOT NULL DEFAULT 1080` · [database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) |
| (unnamed DEFAULT: UpdatedAtUtc) | DEFAULT | ACTIVE | `UpdatedAtUtc DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()` · [database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) |
| FK_DashboardDevicePlaybackSettings_Device | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_DashboardDevicePlaybackSettings_Device FOREIGN KEY (DeviceId) REFERENCES uqp.DashboardDisplayDevice(Id)` · [database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) |
| CK_DashboardDevicePlaybackSettings_Browser | CHECK | ACTIVE | `CONSTRAINT CK_DashboardDevicePlaybackSettings_Browser CHECK (Browser IN ('chrome','edge'))` · [database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) |
| CK_DashboardDevicePlaybackSettings_Screen | CHECK | ACTIVE | `CONSTRAINT CK_DashboardDevicePlaybackSettings_Screen CHECK (ScreenNumber BETWEEN 1 AND 16)` · [database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) |
| CK_DashboardDevicePlaybackSettings_Size | CHECK | ACTIVE | `CONSTRAINT CK_DashboardDevicePlaybackSettings_Size CHECK (WindowWidth>=200 AND WindowHeight>=200)` · [database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.DashboardDisplayDevice

表級狀態：**ACTIVE**；建立來源：[database/migrations/025_dashboard_display_device.sql](../database/migrations/025_dashboard_display_device.sql)。

程式／SQL Repository 引用：[server/src/modules/admin/workstationManagement.repository.ts](../server/src/modules/admin/workstationManagement.repository.ts)、[server/src/modules/audit/deviceAuditHistory.ts](../server/src/modules/audit/deviceAuditHistory.ts)、[server/src/modules/dashboard/dashboardDevice.repository.ts](../server/src/modules/dashboard/dashboardDevice.repository.ts)、[server/src/modules/dashboard/dashboardDeviceList.ts](../server/src/modules/dashboard/dashboardDeviceList.ts)、[server/src/modules/dashboard/dashboardDeviceLifecycleSchema.ts](../server/src/modules/dashboard/dashboardDeviceLifecycleSchema.ts)、[server/src/modules/dashboard/dashboardQueryMode.repository.ts](../server/src/modules/dashboard/dashboardQueryMode.repository.ts)、[server/src/modules/dashboard/dashboardDeviceManagement.repository.ts](../server/src/modules/dashboard/dashboardDeviceManagement.repository.ts)、[server/src/modules/dashboard/dashboardDeviceCredentialWriters.ts](../server/src/modules/dashboard/dashboardDeviceCredentialWriters.ts)、[server/src/modules/dashboard/dashboardTransition.repository.ts](../server/src/modules/dashboard/dashboardTransition.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `Id BIGINT IDENTITY(1,1) PRIMARY KEY` · [database/migrations/025_dashboard_display_device.sql](../database/migrations/025_dashboard_display_device.sql) |
| DashboardId | BIGINT | NOT NULL | ACTIVE | `DashboardId BIGINT NOT NULL` · [database/migrations/025_dashboard_display_device.sql](../database/migrations/025_dashboard_display_device.sql) |
| DeviceName | NVARCHAR(200) | NOT NULL | ACTIVE | `DeviceName NVARCHAR(200) NOT NULL` · [database/migrations/025_dashboard_display_device.sql](../database/migrations/025_dashboard_display_device.sql) |
| TokenHash | CHAR(64) | NOT NULL | ACTIVE | `TokenHash CHAR(64) NOT NULL` · [database/migrations/025_dashboard_display_device.sql](../database/migrations/025_dashboard_display_device.sql) |
| IsActive | BIT | NOT NULL | ACTIVE | `IsActive BIT NOT NULL CONSTRAINT DF_DashboardDisplayDevice_IsActive DEFAULT (1)` · [database/migrations/025_dashboard_display_device.sql](../database/migrations/025_dashboard_display_device.sql) |
| ExpiresAtUtc | DATETIME2(0) | NULL | ACTIVE | `ExpiresAtUtc DATETIME2(0) NULL` · [database/migrations/025_dashboard_display_device.sql](../database/migrations/025_dashboard_display_device.sql) |
| LastUsedAtUtc | DATETIME2(0) | NULL | ACTIVE | `LastUsedAtUtc DATETIME2(0) NULL` · [database/migrations/025_dashboard_display_device.sql](../database/migrations/025_dashboard_display_device.sql) |
| CreatedByUserId | BIGINT | NOT NULL | ACTIVE | `CreatedByUserId BIGINT NOT NULL` · [database/migrations/025_dashboard_display_device.sql](../database/migrations/025_dashboard_display_device.sql) |
| CreatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_DashboardDisplayDevice_CreatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/025_dashboard_display_device.sql](../database/migrations/025_dashboard_display_device.sql) |
| RevokedAtUtc | DATETIME2(0) | NULL | ACTIVE | `RevokedAtUtc DATETIME2(0) NULL` · [database/migrations/025_dashboard_display_device.sql](../database/migrations/025_dashboard_display_device.sql) |
| EnforceIpRestriction | BIT | NOT NULL | ACTIVE | `EnforceIpRestriction BIT NOT NULL CONSTRAINT DF_DashboardDisplayDevice_EnforceIpRestriction DEFAULT (0)` · [database/migrations/026_dashboard_device_ip_restriction.sql](../database/migrations/026_dashboard_device_ip_restriction.sql) |
| AllowedIp | NVARCHAR(64) | NULL | ACTIVE | `AllowedIp NVARCHAR(64) NULL` · [database/migrations/026_dashboard_device_ip_restriction.sql](../database/migrations/026_dashboard_device_ip_restriction.sql) |
| AllowedCidr | NVARCHAR(64) | NULL | ACTIVE | `AllowedCidr NVARCHAR(64) NULL` · [database/migrations/026_dashboard_device_ip_restriction.sql](../database/migrations/026_dashboard_device_ip_restriction.sql) |
| ArchivedAtUtc | DATETIME2(0) | NULL | ACTIVE | `ArchivedAtUtc DATETIME2(0) NULL` · [database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql) |
| SharedWorkstationId | BIGINT | NULL | ACTIVE | `SharedWorkstationId BIGINT NULL` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |
| QueryModeGrantVersion | BIGINT | NULL | ACTIVE | `QueryModeGrantVersion BIGINT NULL` · [database/migrations/918_dashboard_query_playback_mode.sql](../database/migrations/918_dashboard_query_playback_mode.sql) |
| DelegatorTokenVersion | BIGINT | NULL | ACTIVE | `DelegatorTokenVersion BIGINT NULL` · [database/migrations/918_dashboard_query_playback_mode.sql](../database/migrations/918_dashboard_query_playback_mode.sql) |
| SuspendedAtUtc | DATETIME2(0) | NULL | ACTIVE | `SuspendedAtUtc DATETIME2(0) NULL` · [database/migrations/926_dashboard_device_lifecycle.sql](../database/migrations/926_dashboard_device_lifecycle.sql) |
| ReenrollmentRequired | BIT | NULL | ACTIVE | `ReenrollmentRequired BIT NULL` · [database/migrations/926_dashboard_device_lifecycle.sql](../database/migrations/926_dashboard_device_lifecycle.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| (unnamed PK: Id) | PRIMARY KEY | ACTIVE | `Id BIGINT IDENTITY(1,1) PRIMARY KEY` · [database/migrations/025_dashboard_display_device.sql](../database/migrations/025_dashboard_display_device.sql) |
| DF_DashboardDisplayDevice_IsActive | DEFAULT | ACTIVE | `IsActive BIT NOT NULL CONSTRAINT DF_DashboardDisplayDevice_IsActive DEFAULT (1)` · [database/migrations/025_dashboard_display_device.sql](../database/migrations/025_dashboard_display_device.sql) |
| DF_DashboardDisplayDevice_CreatedAt | DEFAULT | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_DashboardDisplayDevice_CreatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/025_dashboard_display_device.sql](../database/migrations/025_dashboard_display_device.sql) |
| UQ_DashboardDisplayDevice_TokenHash | UNIQUE | ACTIVE | `CONSTRAINT UQ_DashboardDisplayDevice_TokenHash UNIQUE (TokenHash)` · [database/migrations/025_dashboard_display_device.sql](../database/migrations/025_dashboard_display_device.sql) |
| FK_DashboardDisplayDevice_Dashboard | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_DashboardDisplayDevice_Dashboard FOREIGN KEY (DashboardId) REFERENCES uqp.Dashboard(Id) ON DELETE CASCADE` · [database/migrations/025_dashboard_display_device.sql](../database/migrations/025_dashboard_display_device.sql) |
| FK_DashboardDisplayDevice_CreatedByUser | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_DashboardDisplayDevice_CreatedByUser FOREIGN KEY (CreatedByUserId) REFERENCES uqp.AppUser(Id)` · [database/migrations/025_dashboard_display_device.sql](../database/migrations/025_dashboard_display_device.sql) |
| DF_DashboardDisplayDevice_EnforceIpRestriction | DEFAULT | ACTIVE | `EnforceIpRestriction BIT NOT NULL CONSTRAINT DF_DashboardDisplayDevice_EnforceIpRestriction DEFAULT (0)` · [database/migrations/026_dashboard_device_ip_restriction.sql](../database/migrations/026_dashboard_device_ip_restriction.sql) |
| FK_DisplayDevice_Workstation | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_DisplayDevice_Workstation FOREIGN KEY (SharedWorkstationId) REFERENCES uqp.SharedWorkstation(Id)` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |
| CK_DashboardDevice_QueryModeGrant | CHECK | ACTIVE | `CONSTRAINT CK_DashboardDevice_QueryModeGrant CHECK ((QueryModeGrantVersion IS NULL AND DelegatorTokenVersion IS NULL) OR (QueryModeGrantVersion IS NOT NULL AND DelegatorTokenVersion IS NOT NULL AND QueryModeGrantVersion > 0 AND DelegatorTokenVersion > 0))` · [database/migrations/918_dashboard_query_playback_mode.sql](../database/migrations/918_dashboard_query_playback_mode.sql) |
| CK_DashboardDevice_LifecycleTerminal | CHECK | ACTIVE | `CONSTRAINT CK_DashboardDevice_LifecycleTerminal CHECK (CASE WHEN RevokedAtUtc IS NOT NULL AND IsActive<>0 THEN 0 WHEN ArchivedAtUtc IS NOT NULL AND IsActive<>0 THEN 0 ELSE 1 END=1)` · [database/migrations/926_dashboard_device_lifecycle.sql](../database/migrations/926_dashboard_device_lifecycle.sql) |
| CK_DashboardDevice_LifecycleSuspended | CHECK | ACTIVE | `CONSTRAINT CK_DashboardDevice_LifecycleSuspended CHECK (CASE WHEN SuspendedAtUtc IS NULL THEN 1 WHEN IsActive=0 AND RevokedAtUtc IS NULL AND ArchivedAtUtc IS NULL AND ReenrollmentRequired=1 AND QueryModeGrantVersion IS NULL AND DelegatorTokenVersion IS NULL THEN 1 ELSE 0 END=1)` · [database/migrations/926_dashboard_device_lifecycle.sql](../database/migrations/926_dashboard_device_lifecycle.sql) |
| CK_DashboardDevice_LifecycleEnrollment | CHECK | ACTIVE | `CONSTRAINT CK_DashboardDevice_LifecycleEnrollment CHECK (CASE WHEN ReenrollmentRequired IS NULL THEN 1 WHEN RevokedAtUtc IS NOT NULL THEN 0 WHEN ArchivedAtUtc IS NOT NULL THEN 0 WHEN SuspendedAtUtc IS NOT NULL THEN 1 WHEN IsActive=1 THEN 1 ELSE 0 END=1)` · [database/migrations/926_dashboard_device_lifecycle.sql](../database/migrations/926_dashboard_device_lifecycle.sql) |

| Index | 狀態 | 鍵／INCLUDE／filter／來源 |
|---|---|---|
| IX_DashboardDisplayDevice_Dashboard | UNKNOWN | `CREATE INDEX IX_DashboardDisplayDevice_Dashboard ON uqp.DashboardDisplayDevice (DashboardId, IsActive, ExpiresAtUtc);` · [database/migrations/025_dashboard_display_device.sql](../database/migrations/025_dashboard_display_device.sql) |
| IX_DashboardDisplayDevice_ArchiveSweep | UNKNOWN | `CREATE INDEX IX_DashboardDisplayDevice_ArchiveSweep ON uqp.DashboardDisplayDevice (DashboardId, IsActive, ArchivedAtUtc, RevokedAtUtc) WHERE IsActive=0 AND ArchivedAtUtc IS NULL;` · [database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql) |

Trigger：`uqp.TR_DashboardDevice_Lifecycle`（ACTIVE），來源 926；禁止還原已撤銷／封存時間，屬不可移除的完整性契約。Runtime schema attestation 會驗證其定義。

### uqp.DashboardDisplayProfile

表級狀態：**ACTIVE**；建立來源：[database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql)。

程式／SQL Repository 引用：[server/src/modules/dashboard/dashboardLayout.repository.ts](../server/src/modules/dashboard/dashboardLayout.repository.ts)、[server/src/modules/dashboard/dashboardQuerySources.repository.ts](../server/src/modules/dashboard/dashboardQuerySources.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DashboardDisplayProfile PRIMARY KEY` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| DashboardId | BIGINT | NOT NULL | ACTIVE | `DashboardId BIGINT NOT NULL` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| Name | NVARCHAR(100) | NOT NULL | ACTIVE | `Name NVARCHAR(100) NOT NULL` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| CanvasWidth | INT | NOT NULL | ACTIVE | `CanvasWidth INT NOT NULL CONSTRAINT DF_DashboardDisplayProfile_Width DEFAULT (1920)` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| CanvasHeight | INT | NOT NULL | ACTIVE | `CanvasHeight INT NOT NULL CONSTRAINT DF_DashboardDisplayProfile_Height DEFAULT (1080)` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| IsDefault | BIT | NOT NULL | ACTIVE | `IsDefault BIT NOT NULL CONSTRAINT DF_DashboardDisplayProfile_Default DEFAULT (0)` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| SortOrder | INT | NOT NULL | ACTIVE | `SortOrder INT NOT NULL CONSTRAINT DF_DashboardDisplayProfile_Sort DEFAULT (0)` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| CreatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_DashboardDisplayProfile_Created DEFAULT (SYSUTCDATETIME())` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| UpdatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_DashboardDisplayProfile_Updated DEFAULT (SYSUTCDATETIME())` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| ConfigJson | NVARCHAR(MAX) | NOT NULL | ACTIVE | `ConfigJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_DashboardDisplayProfile_Config DEFAULT ('{}')` · [database/migrations/024_dashboard_visual_styling.sql](../database/migrations/024_dashboard_visual_styling.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| PK_DashboardDisplayProfile | PRIMARY KEY | ACTIVE | `Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DashboardDisplayProfile PRIMARY KEY` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| DF_DashboardDisplayProfile_Width | DEFAULT | ACTIVE | `CanvasWidth INT NOT NULL CONSTRAINT DF_DashboardDisplayProfile_Width DEFAULT (1920)` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| DF_DashboardDisplayProfile_Height | DEFAULT | ACTIVE | `CanvasHeight INT NOT NULL CONSTRAINT DF_DashboardDisplayProfile_Height DEFAULT (1080)` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| DF_DashboardDisplayProfile_Default | DEFAULT | ACTIVE | `IsDefault BIT NOT NULL CONSTRAINT DF_DashboardDisplayProfile_Default DEFAULT (0)` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| DF_DashboardDisplayProfile_Sort | DEFAULT | ACTIVE | `SortOrder INT NOT NULL CONSTRAINT DF_DashboardDisplayProfile_Sort DEFAULT (0)` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| DF_DashboardDisplayProfile_Created | DEFAULT | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_DashboardDisplayProfile_Created DEFAULT (SYSUTCDATETIME())` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| DF_DashboardDisplayProfile_Updated | DEFAULT | ACTIVE | `UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_DashboardDisplayProfile_Updated DEFAULT (SYSUTCDATETIME())` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| FK_DashboardDisplayProfile_Dashboard | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_DashboardDisplayProfile_Dashboard FOREIGN KEY (DashboardId) REFERENCES uqp.Dashboard(Id) ON DELETE CASCADE` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| UQ_DashboardDisplayProfile_Name | UNIQUE | ACTIVE | `CONSTRAINT UQ_DashboardDisplayProfile_Name UNIQUE (DashboardId, Name)` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| CK_DashboardDisplayProfile_Width | CHECK | ACTIVE | `CONSTRAINT CK_DashboardDisplayProfile_Width CHECK (CanvasWidth BETWEEN 320 AND 7680)` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| CK_DashboardDisplayProfile_Height | CHECK | ACTIVE | `CONSTRAINT CK_DashboardDisplayProfile_Height CHECK (CanvasHeight BETWEEN 240 AND 4320)` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| DF_DashboardDisplayProfile_Config | DEFAULT | ACTIVE | `ConfigJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_DashboardDisplayProfile_Config DEFAULT ('{}')` · [database/migrations/024_dashboard_visual_styling.sql](../database/migrations/024_dashboard_visual_styling.sql) |
| CK_DashboardDisplayProfile_ConfigJson | CHECK | ACTIVE | `CONSTRAINT CK_DashboardDisplayProfile_ConfigJson CHECK (ISJSON(ConfigJson)=1)` · [database/migrations/024_dashboard_visual_styling.sql](../database/migrations/024_dashboard_visual_styling.sql) |

| Index | 狀態 | 鍵／INCLUDE／filter／來源 |
|---|---|---|
| IX_DashboardDisplayProfile_Dashboard | UNKNOWN | `CREATE INDEX IX_DashboardDisplayProfile_Dashboard ON uqp.DashboardDisplayProfile(DashboardId, IsDefault DESC, SortOrder, Id);` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |

### uqp.DashboardWidget

表級狀態：**ACTIVE**；建立來源：[database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql)。

程式／SQL Repository 引用：[server/src/modules/dashboard/dashboardLayout.repository.ts](../server/src/modules/dashboard/dashboardLayout.repository.ts)、[server/src/modules/dashboard/dashboardQuerySources.repository.ts](../server/src/modules/dashboard/dashboardQuerySources.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DashboardWidget PRIMARY KEY` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| ProfileId | BIGINT | NOT NULL | ACTIVE | `ProfileId BIGINT NOT NULL` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| WidgetType | NVARCHAR(30) | NOT NULL | ACTIVE | `WidgetType NVARCHAR(30) NOT NULL` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| Title | NVARCHAR(200) | NULL | UNKNOWN | `Title NVARCHAR(200) NULL` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| SourceKey | NVARCHAR(256) | NULL | UNKNOWN | `SourceKey NVARCHAR(256) NULL` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| StaticText | NVARCHAR(1000) | NULL | UNKNOWN | `StaticText NVARCHAR(1000) NULL` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| X | INT | NOT NULL | ACTIVE | `X INT NOT NULL` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| Y | INT | NOT NULL | ACTIVE | `Y INT NOT NULL` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| Width | INT | NOT NULL | ACTIVE | `Width INT NOT NULL` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| Height | INT | NOT NULL | ACTIVE | `Height INT NOT NULL` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| FontSize | INT | NOT NULL | ACTIVE | `FontSize INT NOT NULL CONSTRAINT DF_DashboardWidget_FontSize DEFAULT (36)` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| Alignment | NVARCHAR(10) | NOT NULL | ACTIVE | `Alignment NVARCHAR(10) NOT NULL CONSTRAINT DF_DashboardWidget_Alignment DEFAULT ('CENTER')` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| ConfigJson | NVARCHAR(MAX) | NOT NULL | ACTIVE | `ConfigJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_DashboardWidget_Config DEFAULT ('{}')` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| SortOrder | INT | NOT NULL | ACTIVE | `SortOrder INT NOT NULL CONSTRAINT DF_DashboardWidget_Sort DEFAULT (0)` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| CreatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_DashboardWidget_Created DEFAULT (SYSUTCDATETIME())` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| UpdatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_DashboardWidget_Updated DEFAULT (SYSUTCDATETIME())` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| PK_DashboardWidget | PRIMARY KEY | ACTIVE | `Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DashboardWidget PRIMARY KEY` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| DF_DashboardWidget_FontSize | DEFAULT | ACTIVE | `FontSize INT NOT NULL CONSTRAINT DF_DashboardWidget_FontSize DEFAULT (36)` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| DF_DashboardWidget_Alignment | DEFAULT | ACTIVE | `Alignment NVARCHAR(10) NOT NULL CONSTRAINT DF_DashboardWidget_Alignment DEFAULT ('CENTER')` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| DF_DashboardWidget_Config | DEFAULT | ACTIVE | `ConfigJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_DashboardWidget_Config DEFAULT ('{}')` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| DF_DashboardWidget_Sort | DEFAULT | ACTIVE | `SortOrder INT NOT NULL CONSTRAINT DF_DashboardWidget_Sort DEFAULT (0)` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| DF_DashboardWidget_Created | DEFAULT | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_DashboardWidget_Created DEFAULT (SYSUTCDATETIME())` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| DF_DashboardWidget_Updated | DEFAULT | ACTIVE | `UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_DashboardWidget_Updated DEFAULT (SYSUTCDATETIME())` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| FK_DashboardWidget_Profile | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_DashboardWidget_Profile FOREIGN KEY (ProfileId) REFERENCES uqp.DashboardDisplayProfile(Id) ON DELETE CASCADE` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| CK_DashboardWidget_Position | CHECK | ACTIVE | `CONSTRAINT CK_DashboardWidget_Position CHECK (X >= 0 AND Y >= 0)` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| CK_DashboardWidget_Size | CHECK | ACTIVE | `CONSTRAINT CK_DashboardWidget_Size CHECK (Width >= 40 AND Height >= 30)` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| CK_DashboardWidget_FontSize | CHECK | ACTIVE | `CONSTRAINT CK_DashboardWidget_FontSize CHECK (FontSize BETWEEN 8 AND 240)` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| CK_DashboardWidget_Alignment | CHECK | ACTIVE | `CONSTRAINT CK_DashboardWidget_Alignment CHECK (Alignment IN ('LEFT','CENTER','RIGHT'))` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| CK_DashboardWidget_ConfigJson | CHECK | ACTIVE | `CONSTRAINT CK_DashboardWidget_ConfigJson CHECK (ISJSON(ConfigJson)=1)` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |
| CK_DashboardWidget_Type | CHECK | ACTIVE | `CONSTRAINT CK_DashboardWidget_Type CHECK ( WidgetType IN ('TEXT','PARAMETER','FIELD','CLOCK','PAGE_INFO','COUNTDOWN','TABLE','CONTAINER') )` · [database/migrations/024_dashboard_visual_styling.sql](../database/migrations/024_dashboard_visual_styling.sql) |

| Index | 狀態 | 鍵／INCLUDE／filter／來源 |
|---|---|---|
| IX_DashboardWidget_Profile | UNKNOWN | `CREATE INDEX IX_DashboardWidget_Profile ON uqp.DashboardWidget(ProfileId, SortOrder, Id);` · [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) |

### uqp.DataSource

表級狀態：**ACTIVE**；建立來源：[database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql)。

程式／SQL Repository 引用：[server/src/modules/dashboard/dashboard.repository.ts](../server/src/modules/dashboard/dashboard.repository.ts)、[server/src/modules/dashboard/dashboardDataSource.repository.ts](../server/src/modules/dashboard/dashboardDataSource.repository.ts)、[server/src/modules/dashboard/dashboardApproval.repository.ts](../server/src/modules/dashboard/dashboardApproval.repository.ts)、[server/src/modules/dataset/column.repository.ts](../server/src/modules/dataset/column.repository.ts)、[server/src/modules/dataset/dataset.repository.ts](../server/src/modules/dataset/dataset.repository.ts)、[server/src/modules/dataset/datasetPublicDisplay.repository.ts](../server/src/modules/dataset/datasetPublicDisplay.repository.ts)、[server/src/modules/dataset/datasetScopeManagement.repository.ts](../server/src/modules/dataset/datasetScopeManagement.repository.ts)、[server/src/modules/dataset/datasetFieldInitialization.repository.ts](../server/src/modules/dataset/datasetFieldInitialization.repository.ts)、[server/src/modules/dataset/dataset923ScopeConfirmationGate.ts](../server/src/modules/dataset/dataset923ScopeConfirmationGate.ts)、[server/src/modules/dataset/datasetColumnCandidate.ts](../server/src/modules/dataset/datasetColumnCandidate.ts)、[server/src/modules/datasource/datasource.repository.ts](../server/src/modules/datasource/datasource.repository.ts)、[server/src/modules/datasource/datasourceVersion.repository.ts](../server/src/modules/datasource/datasourceVersion.repository.ts)、[server/src/modules/datasource/versionFoundationSchema.ts](../server/src/modules/datasource/versionFoundationSchema.ts)、[server/src/modules/queryDefinition/queryDefinition.repository.ts](../server/src/modules/queryDefinition/queryDefinition.repository.ts)、[server/src/modules/version/version.repository.ts](../server/src/modules/version/version.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `Id BIGINT IDENTITY(1,1) PRIMARY KEY` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| Code | NVARCHAR(100) | NOT NULL | ACTIVE | `Code NVARCHAR(100) NOT NULL` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| Name | NVARCHAR(200) | NOT NULL | ACTIVE | `Name NVARCHAR(200) NOT NULL` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| Type | NVARCHAR(20) | NOT NULL | ACTIVE | `Type NVARCHAR(20) NOT NULL` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| Host | NVARCHAR(255) | NOT NULL | ACTIVE | `Host NVARCHAR(255) NOT NULL` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| Port | INT | NOT NULL | ACTIVE | `Port INT NOT NULL` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| DatabaseName | NVARCHAR(255) | NULL | ACTIVE | `DatabaseName NVARCHAR(255) NULL` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| OracleServiceName | NVARCHAR(255) | NULL | ACTIVE | `OracleServiceName NVARCHAR(255) NULL` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| OracleConnectionMode | NVARCHAR(20) | NULL | ACTIVE | `OracleConnectionMode NVARCHAR(20) NULL` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| Username | NVARCHAR(200) | NOT NULL | ACTIVE | `Username NVARCHAR(200) NOT NULL` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| EncryptedPassword | NVARCHAR(2000) | NOT NULL | ACTIVE | `EncryptedPassword NVARCHAR(2000) NOT NULL` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| ConnectionTimeoutSec | INT | NOT NULL | ACTIVE | `ConnectionTimeoutSec INT NOT NULL CONSTRAINT DF_DataSource_ConnectionTimeout DEFAULT (10)` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| QueryTimeoutSec | INT | NOT NULL | ACTIVE | `QueryTimeoutSec INT NOT NULL CONSTRAINT DF_DataSource_QueryTimeout DEFAULT (30)` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| EncryptConnection | BIT | NOT NULL | ACTIVE | `EncryptConnection BIT NOT NULL CONSTRAINT DF_DataSource_Encrypt DEFAULT (0)` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| TrustServerCertificate | BIT | NOT NULL | ACTIVE | `TrustServerCertificate BIT NOT NULL CONSTRAINT DF_DataSource_TrustCertificate DEFAULT (1)` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| IsActive | BIT | NOT NULL | ACTIVE | `IsActive BIT NOT NULL CONSTRAINT DF_DataSource_IsActive DEFAULT (1)` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| CreatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_DataSource_CreatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| UpdatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_DataSource_UpdatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| OdbcConnectionMode | NVARCHAR(30) | NULL | ACTIVE | `OdbcConnectionMode NVARCHAR(30) NULL` · [database/migrations/010_odbc_datasource.sql](../database/migrations/010_odbc_datasource.sql) |
| OdbcDsn | NVARCHAR(255) | NULL | ACTIVE | `OdbcDsn NVARCHAR(255) NULL` · [database/migrations/010_odbc_datasource.sql](../database/migrations/010_odbc_datasource.sql) |
| EncryptedOdbcConnectionString | NVARCHAR(4000) | NULL | ACTIVE | `EncryptedOdbcConnectionString NVARCHAR(4000) NULL` · [database/migrations/010_odbc_datasource.sql](../database/migrations/010_odbc_datasource.sql) |
| ConfigurationRowVersion | ROWVERSION | NOT NULL | ACTIVE | `ConfigurationRowVersion ROWVERSION NOT NULL` · [database/migrations/921_datasource_native_parameter_versions.sql](../database/migrations/921_datasource_native_parameter_versions.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| (unnamed PK: Id) | PRIMARY KEY | ACTIVE | `Id BIGINT IDENTITY(1,1) PRIMARY KEY` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| DF_DataSource_ConnectionTimeout | DEFAULT | ACTIVE | `ConnectionTimeoutSec INT NOT NULL CONSTRAINT DF_DataSource_ConnectionTimeout DEFAULT (10)` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| DF_DataSource_QueryTimeout | DEFAULT | ACTIVE | `QueryTimeoutSec INT NOT NULL CONSTRAINT DF_DataSource_QueryTimeout DEFAULT (30)` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| DF_DataSource_Encrypt | DEFAULT | ACTIVE | `EncryptConnection BIT NOT NULL CONSTRAINT DF_DataSource_Encrypt DEFAULT (0)` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| DF_DataSource_TrustCertificate | DEFAULT | ACTIVE | `TrustServerCertificate BIT NOT NULL CONSTRAINT DF_DataSource_TrustCertificate DEFAULT (1)` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| DF_DataSource_IsActive | DEFAULT | ACTIVE | `IsActive BIT NOT NULL CONSTRAINT DF_DataSource_IsActive DEFAULT (1)` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| DF_DataSource_CreatedAt | DEFAULT | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_DataSource_CreatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| DF_DataSource_UpdatedAt | DEFAULT | ACTIVE | `UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_DataSource_UpdatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| UQ_DataSource_Code | UNIQUE | ACTIVE | `CONSTRAINT UQ_DataSource_Code UNIQUE (Code)` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| CK_DataSource_OracleMode | CHECK | ACTIVE | `CONSTRAINT CK_DataSource_OracleMode CHECK ( OracleConnectionMode IS NULL OR OracleConnectionMode IN ('SERVICE_NAME','SID') )` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| CK_DataSource_Port | CHECK | ACTIVE | `CONSTRAINT CK_DataSource_Port CHECK (Port BETWEEN 1 AND 65535)` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| CK_DataSource_ConnectionTimeout | CHECK | ACTIVE | `CONSTRAINT CK_DataSource_ConnectionTimeout CHECK (ConnectionTimeoutSec BETWEEN 1 AND 300)` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| CK_DataSource_QueryTimeout | CHECK | ACTIVE | `CONSTRAINT CK_DataSource_QueryTimeout CHECK (QueryTimeoutSec BETWEEN 1 AND 3600)` · [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) |
| CK_DataSource_Type | CHECK | ACTIVE | `CONSTRAINT CK_DataSource_Type CHECK (Type IN ('SQLSERVER','ORACLE','MYSQL','POSTGRESQL','ODBC'))` · [database/migrations/010_odbc_datasource.sql](../database/migrations/010_odbc_datasource.sql) |
| CK_DataSource_OdbcMode | CHECK | ACTIVE | `CONSTRAINT CK_DataSource_OdbcMode CHECK (OdbcConnectionMode IS NULL OR OdbcConnectionMode IN ('DSN','CONNECTION_STRING'))` · [database/migrations/010_odbc_datasource.sql](../database/migrations/010_odbc_datasource.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.Dataset

表級狀態：**ACTIVE**；建立來源：[database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql)。

程式／SQL Repository 引用：[server/src/modules/audit/audit.repository.ts](../server/src/modules/audit/audit.repository.ts)、[server/src/modules/dashboard/dashboard.repository.ts](../server/src/modules/dashboard/dashboard.repository.ts)、[server/src/modules/dashboard/dashboardDataSource.repository.ts](../server/src/modules/dashboard/dashboardDataSource.repository.ts)、[server/src/modules/dashboard/dashboardApproval.repository.ts](../server/src/modules/dashboard/dashboardApproval.repository.ts)、[server/src/modules/dashboard/dashboardLegacyLocks.ts](../server/src/modules/dashboard/dashboardLegacyLocks.ts)、[server/src/modules/dataset/column.repository.ts](../server/src/modules/dataset/column.repository.ts)、[server/src/modules/dataset/dataset.repository.ts](../server/src/modules/dataset/dataset.repository.ts)、[server/src/modules/dataset/parameter.repository.ts](../server/src/modules/dataset/parameter.repository.ts)、[server/src/modules/dataset/datasetPublicDisplay.repository.ts](../server/src/modules/dataset/datasetPublicDisplay.repository.ts)、[server/src/modules/dataset/datasetSensitiveColumn.repository.ts](../server/src/modules/dataset/datasetSensitiveColumn.repository.ts)、[server/src/modules/dataset/nativeParameterVersion.repository.ts](../server/src/modules/dataset/nativeParameterVersion.repository.ts)、[server/src/modules/dataset/datasetScopeManagement.repository.ts](../server/src/modules/dataset/datasetScopeManagement.repository.ts)、[server/src/modules/dataset/datasetFieldInitialization.repository.ts](../server/src/modules/dataset/datasetFieldInitialization.repository.ts)、[server/src/modules/dataset/datasetMetadata924Catalog.ts](../server/src/modules/dataset/datasetMetadata924Catalog.ts)、[server/src/modules/dataset/datasetDeliveryPolicy.repository.ts](../server/src/modules/dataset/datasetDeliveryPolicy.repository.ts)、[server/src/modules/dataset/dataset923ScopeConfirmationGate.ts](../server/src/modules/dataset/dataset923ScopeConfirmationGate.ts)、[server/src/modules/dataset/parameterTestFixture.ts](../server/src/modules/dataset/parameterTestFixture.ts)、[server/src/modules/dataset/patientAuditContract.repository.ts](../server/src/modules/dataset/patientAuditContract.repository.ts)、[server/src/modules/dataset/datasetMaskTemplate.repository.ts](../server/src/modules/dataset/datasetMaskTemplate.repository.ts)、[server/src/modules/dataset/datasetColumnCandidate.ts](../server/src/modules/dataset/datasetColumnCandidate.ts)、[server/src/modules/datasource/datasource.repository.ts](../server/src/modules/datasource/datasource.repository.ts)、[server/src/modules/datasource/versionFoundationSchema.ts](../server/src/modules/datasource/versionFoundationSchema.ts)、[server/src/modules/queryDefinition/queryDefinition.repository.ts](../server/src/modules/queryDefinition/queryDefinition.repository.ts)、[server/src/modules/version/version.repository.ts](../server/src/modules/version/version.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `Id BIGINT IDENTITY(1,1) PRIMARY KEY` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| Code | NVARCHAR(100) | NOT NULL | ACTIVE | `Code NVARCHAR(100) NOT NULL` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| Name | NVARCHAR(200) | NOT NULL | ACTIVE | `Name NVARCHAR(200) NOT NULL` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| Description | NVARCHAR(1000) | NULL | ACTIVE | `Description NVARCHAR(1000) NULL` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| DataSourceId | BIGINT | NOT NULL | ACTIVE | `DataSourceId BIGINT NOT NULL` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| SqlText | NVARCHAR(MAX) | NOT NULL | ACTIVE | `SqlText NVARCHAR(MAX) NOT NULL` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| MaxRows | INT | NOT NULL | ACTIVE | `MaxRows INT NOT NULL CONSTRAINT DF_Dataset_MaxRows DEFAULT (500)` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| QueryTimeoutSec | INT | NULL | ACTIVE | `QueryTimeoutSec INT NULL` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| IsActive | BIT | NOT NULL | ACTIVE | `IsActive BIT NOT NULL CONSTRAINT DF_Dataset_IsActive DEFAULT (1)` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| CreatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_Dataset_CreatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| UpdatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_Dataset_UpdatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| IsArchived | BIT | NOT NULL | ACTIVE | `IsArchived BIT NOT NULL CONSTRAINT DF_Dataset_IsArchived DEFAULT (0)` · [database/migrations/013_dataset_archive.sql](../database/migrations/013_dataset_archive.sql) |
| ArchivedAtUtc | DATETIME2(0) | NULL | ACTIVE | `ArchivedAtUtc DATETIME2(0) NULL` · [database/migrations/013_dataset_archive.sql](../database/migrations/013_dataset_archive.sql) |
| ArchivedByUserId | BIGINT | NULL | ACTIVE | `ArchivedByUserId BIGINT NULL` · [database/migrations/013_dataset_archive.sql](../database/migrations/013_dataset_archive.sql) |
| DefinitionRowVersion | ROWVERSION | NOT NULL | ACTIVE | `DefinitionRowVersion ROWVERSION NOT NULL` · [database/migrations/920_dataset_definition_rowversion.sql](../database/migrations/920_dataset_definition_rowversion.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| (unnamed PK: Id) | PRIMARY KEY | ACTIVE | `Id BIGINT IDENTITY(1,1) PRIMARY KEY` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| DF_Dataset_MaxRows | DEFAULT | ACTIVE | `MaxRows INT NOT NULL CONSTRAINT DF_Dataset_MaxRows DEFAULT (500)` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| DF_Dataset_IsActive | DEFAULT | ACTIVE | `IsActive BIT NOT NULL CONSTRAINT DF_Dataset_IsActive DEFAULT (1)` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| DF_Dataset_CreatedAt | DEFAULT | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_Dataset_CreatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| DF_Dataset_UpdatedAt | DEFAULT | ACTIVE | `UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_Dataset_UpdatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| UQ_Dataset_Code | UNIQUE | ACTIVE | `CONSTRAINT UQ_Dataset_Code UNIQUE (Code)` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| FK_Dataset_DataSource | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_Dataset_DataSource FOREIGN KEY (DataSourceId) REFERENCES uqp.DataSource(Id)` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| CK_Dataset_MaxRows | CHECK | ACTIVE | `CONSTRAINT CK_Dataset_MaxRows CHECK (MaxRows BETWEEN 1 AND 10000)` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| CK_Dataset_QueryTimeout | CHECK | ACTIVE | `CONSTRAINT CK_Dataset_QueryTimeout CHECK (QueryTimeoutSec IS NULL OR QueryTimeoutSec BETWEEN 1 AND 3600)` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| DF_Dataset_IsArchived | DEFAULT | ACTIVE | `IsArchived BIT NOT NULL CONSTRAINT DF_Dataset_IsArchived DEFAULT (0)` · [database/migrations/013_dataset_archive.sql](../database/migrations/013_dataset_archive.sql) |
| FK_Dataset_ArchivedBy | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_Dataset_ArchivedBy FOREIGN KEY (ArchivedByUserId) REFERENCES uqp.AppUser(Id) ON DELETE SET NULL` · [database/migrations/013_dataset_archive.sql](../database/migrations/013_dataset_archive.sql) |

| Index | 狀態 | 鍵／INCLUDE／filter／來源 |
|---|---|---|
| IX_Dataset_IsArchived | UNKNOWN | `CREATE INDEX IX_Dataset_IsArchived ON uqp.Dataset(IsArchived, IsActive);` · [database/migrations/013_dataset_archive.sql](../database/migrations/013_dataset_archive.sql) |

### uqp.DatasetColumn

表級狀態：**ACTIVE**；建立來源：[database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql)。

程式／SQL Repository 引用：[server/src/modules/dataset/column.repository.ts](../server/src/modules/dataset/column.repository.ts)、[server/src/modules/dataset/datasetPublicDisplay.repository.ts](../server/src/modules/dataset/datasetPublicDisplay.repository.ts)、[server/src/modules/dataset/datasetSensitiveColumn.repository.ts](../server/src/modules/dataset/datasetSensitiveColumn.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| DatasetId | BIGINT | NOT NULL | ACTIVE | `DatasetId BIGINT NOT NULL` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |
| ColumnName | NVARCHAR(256) | NOT NULL | ACTIVE | `ColumnName NVARCHAR(256) NOT NULL` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |
| DataType | NVARCHAR(100) | NULL | UNKNOWN | `DataType NVARCHAR(100) NULL` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |
| Ordinal | INT | NOT NULL | UNKNOWN | `Ordinal INT NOT NULL` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |
| UpdatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_DatasetColumn_UpdatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| DF_DatasetColumn_UpdatedAt | DEFAULT | ACTIVE | `UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_DatasetColumn_UpdatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |
| PK_DatasetColumn | PRIMARY KEY | ACTIVE | `CONSTRAINT PK_DatasetColumn PRIMARY KEY (DatasetId, ColumnName)` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |
| FK_DatasetColumn_Dataset | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_DatasetColumn_Dataset FOREIGN KEY (DatasetId) REFERENCES uqp.Dataset(Id) ON DELETE CASCADE` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.DatasetFieldSnapshot

表級狀態：**ACTIVE**；建立來源：[tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql)。

程式／SQL Repository 引用：[server/src/modules/dataset/datasetFieldInitialization.repository.ts](../server/src/modules/dataset/datasetFieldInitialization.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `[Id] BIGINT IDENTITY(1,1) NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| DatasetId | BIGINT | NOT NULL | ACTIVE | `[DatasetId] BIGINT NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| DataSourceId | BIGINT | NOT NULL | ACTIVE | `[DataSourceId] BIGINT NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| PlatformIncarnation | UNIQUEIDENTIFIER | NOT NULL | UNKNOWN | `[PlatformIncarnation] UNIQUEIDENTIFIER NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| DefinitionVersion | BINARY(8) | NOT NULL | ACTIVE | `[DefinitionVersion] BINARY(8) NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| ConfigurationVersion | BINARY(8) | NOT NULL | ACTIVE | `[ConfigurationVersion] BINARY(8) NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| BaseContractVersion | BINARY(8) | NULL | ACTIVE | `[BaseContractVersion] BINARY(8) NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| SqlDigest | BINARY(32) | NOT NULL | UNKNOWN | `[SqlDigest] BINARY(32) NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| ParameterDigest | BINARY(32) | NOT NULL | UNKNOWN | `[ParameterDigest] BINARY(32) NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| NativeTypesDigest | BINARY(32) | NOT NULL | UNKNOWN | `[NativeTypesDigest] BINARY(32) NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| ColumnsDigest | BINARY(32) | NOT NULL | UNKNOWN | `[ColumnsDigest] BINARY(32) NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| ColumnsJson | NVARCHAR(MAX) | NOT NULL | ACTIVE | `[ColumnsJson] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| NativeBindingsJson | NVARCHAR(MAX) | NOT NULL | ACTIVE | `[NativeBindingsJson] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| ParameterMode | NVARCHAR(16) | NOT NULL | ACTIVE | `[ParameterMode] NVARCHAR(16) COLLATE Latin1_General_100_BIN2 NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CollectorVersion | NVARCHAR(64) | NOT NULL | UNKNOWN | `[CollectorVersion] NVARCHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CodecVersion | NVARCHAR(64) | NOT NULL | UNKNOWN | `[CodecVersion] NVARCHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| PlanVersion | NVARCHAR(64) | NOT NULL | UNKNOWN | `[PlanVersion] NVARCHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| DriverVersion | NVARCHAR(64) | NOT NULL | UNKNOWN | `[DriverVersion] NVARCHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CollectedAt | DATETIME2(7) | NOT NULL | ACTIVE | `[CollectedAt] DATETIME2(7) NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| ExpiresAt | DATETIME2(7) | NOT NULL | ACTIVE | `[ExpiresAt] DATETIME2(7) NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| State | NVARCHAR(16) | NOT NULL | ACTIVE | `[State] NVARCHAR(16) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT [DF_DatasetFieldSnapshot_State] DEFAULT (N'DESCRIBED')` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| StateRowVersion | ROWVERSION | NOT NULL | UNKNOWN | `[StateRowVersion] ROWVERSION NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| SourceIdentity | UNIQUEIDENTIFIER | NULL | ACTIVE | `[SourceIdentity] UNIQUEIDENTIFIER NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| SourceIncarnation | UNIQUEIDENTIFIER | NULL | ACTIVE | `[SourceIncarnation] UNIQUEIDENTIFIER NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| LeaseId | UNIQUEIDENTIFIER | NULL | ACTIVE | `[LeaseId] UNIQUEIDENTIFIER NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| SourceGeneration | BIGINT | NULL | ACTIVE | `[SourceGeneration] BIGINT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| LeaseVersion | BIGINT | NULL | ACTIVE | `[LeaseVersion] BIGINT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| SourceCollation | NVARCHAR(128) | NULL | ACTIVE | `[SourceCollation] NVARCHAR(128) COLLATE Latin1_General_100_BIN2 NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CollectorEvidenceDigest | BINARY(32) | NULL | ACTIVE | `[CollectorEvidenceDigest] BINARY(32) NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| SourceEvidenceJson | NVARCHAR(MAX) | NULL | ACTIVE | `[SourceEvidenceJson] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| DF_DatasetFieldSnapshot_State | DEFAULT | ACTIVE | `[State] NVARCHAR(16) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT [DF_DatasetFieldSnapshot_State] DEFAULT (N'DESCRIBED')` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| PK_DatasetFieldSnapshot | PRIMARY KEY | ACTIVE | `CONSTRAINT [PK_DatasetFieldSnapshot] PRIMARY KEY CLUSTERED ([Id] ASC)` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| UQ_DatasetFieldSnapshot_DatasetId_Id | UNIQUE | ACTIVE | `CONSTRAINT [UQ_DatasetFieldSnapshot_DatasetId_Id] UNIQUE NONCLUSTERED ([DatasetId] ASC,[Id] ASC)` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CK_DatasetFieldSnapshot_Ids | CHECK | ACTIVE | `CONSTRAINT [CK_DatasetFieldSnapshot_Ids] CHECK (CASE WHEN (([Id] IS NULL OR ([Id]>(0))) AND ([DatasetId] IS NULL OR ([DatasetId]>(0))) AND ([DataSourceId] IS NULL OR ([DataSourceId]>(0))) AND ([SourceGeneration] IS NULL OR ([SourceGeneration]>(0))) AND ([LeaseVersion] IS NULL OR ([LeaseVersion]>(0)))) THEN (1) ELSE (0) END=(1))` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CK_DatasetFieldSnapshot_Versions | CHECK | ACTIVE | `CONSTRAINT [CK_DatasetFieldSnapshot_Versions] CHECK (CASE WHEN (([DefinitionVersion] IS NULL OR ([DefinitionVersion]<>0x0000000000000000)) AND ([ConfigurationVersion] IS NULL OR ([ConfigurationVersion]<>0x0000000000000000)) AND ([BaseContractVersion] IS NULL OR ([BaseContractVersion]<>0x0000000000000000))) THEN (1) ELSE (0) END=(1))` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CK_DatasetFieldSnapshot_State | CHECK | ACTIVE | `CONSTRAINT [CK_DatasetFieldSnapshot_State] CHECK (CASE WHEN ((([State]=N'DESCRIBED' AND DATALENGTH([State])=(18)) OR ([State]=N'SOURCE_BOUND' AND DATALENGTH([State])=(24)) OR ([State]=N'INVALIDATED' AND DATALENGTH([State])=(22)) OR ([State]=N'EXPIRED' AND DATALENGTH([State])=(14)))) THEN (1) ELSE (0) END=(1))` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CK_DatasetFieldSnapshot_ParameterMode | CHECK | ACTIVE | `CONSTRAINT [CK_DatasetFieldSnapshot_ParameterMode] CHECK (CASE WHEN ((([ParameterMode]=N'NO_PARAMETERS' AND DATALENGTH([ParameterMode])=(26)) OR ([ParameterMode]=N'UNPROVEN' AND DATALENGTH([ParameterMode])=(16)))) THEN (1) ELSE (0) END=(1))` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CK_DatasetFieldSnapshot_Expiry | CHECK | ACTIVE | `CONSTRAINT [CK_DatasetFieldSnapshot_Expiry] CHECK (CASE WHEN ([ExpiresAt]>[CollectedAt]) THEN (1) ELSE (0) END=(1))` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CK_DatasetFieldSnapshot_Json | CHECK | ACTIVE | `CONSTRAINT [CK_DatasetFieldSnapshot_Json] CHECK (CASE WHEN (ISJSON([ColumnsJson])=(1) AND DATALENGTH([ColumnsJson])<=(1048576) AND ISJSON([NativeBindingsJson])=(1) AND DATALENGTH([NativeBindingsJson])<=(1048576) AND ([SourceEvidenceJson] IS NULL OR (ISJSON([SourceEvidenceJson])=(1) AND DATALENGTH([SourceEvidenceJson])<=(65536)))) THEN (1) ELSE (0) END=(1))` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CK_DatasetFieldSnapshot_SourceBound | CHECK | ACTIVE | `CONSTRAINT [CK_DatasetFieldSnapshot_SourceBound] CHECK (CASE WHEN ([State]<>N'SOURCE_BOUND' OR ([ParameterMode]=N'NO_PARAMETERS' AND [SourceIdentity] IS NOT NULL AND [SourceIncarnation] IS NOT NULL AND [LeaseId] IS NOT NULL AND [SourceGeneration] IS NOT NULL AND [LeaseVersion] IS NOT NULL AND [SourceCollation] IS NOT NULL AND [CollectorEvidenceDigest] IS NOT NULL AND [SourceEvidenceJson] IS NOT NULL)) THEN (1) ELSE (0) END=(1))` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| FK_DatasetFieldSnapshot_Dataset | FOREIGN KEY | ACTIVE | `CONSTRAINT [FK_DatasetFieldSnapshot_Dataset] FOREIGN KEY ([DatasetId]) REFERENCES [uqp].[Dataset] ([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| FK_DatasetFieldSnapshot_DataSource | FOREIGN KEY | ACTIVE | `CONSTRAINT [FK_DatasetFieldSnapshot_DataSource] FOREIGN KEY ([DataSourceId]) REFERENCES [uqp].[DataSource] ([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |

| Index | 狀態 | 鍵／INCLUDE／filter／來源 |
|---|---|---|
| IX_FieldSnapshot_DatasetState | UNKNOWN | `CREATE NONCLUSTERED INDEX [IX_FieldSnapshot_DatasetState] ON [uqp].[DatasetFieldSnapshot] ([DatasetId] ASC,[State] ASC,[Id] ASC) INCLUDE ([DefinitionVersion],[ConfigurationVersion],[ExpiresAt]);` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| IX_FieldSnapshot_Source | UNKNOWN | `CREATE NONCLUSTERED INDEX [IX_FieldSnapshot_Source] ON [uqp].[DatasetFieldSnapshot] ([DataSourceId] ASC,[DatasetId] ASC,[Id] ASC);` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |

### uqp.DatasetMaskTemplate

表級狀態：**ACTIVE**；建立來源：[tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql)。

程式／SQL Repository 引用：[server/src/modules/dataset/datasetMaskTemplate.repository.ts](../server/src/modules/dataset/datasetMaskTemplate.repository.ts)、[server/src/modules/dataset/datasetDisplaySchema.ts](../server/src/modules/dataset/datasetDisplaySchema.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DatasetMaskTemplate PRIMARY KEY` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| Name | NVARCHAR(100) | NOT NULL | ACTIVE | `Name NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NOT NULL` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| AliasesJson | NVARCHAR(4000) | NOT NULL | ACTIVE | `AliasesJson NVARCHAR(4000) NOT NULL` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| MaskMode | VARCHAR(16) | NOT NULL | ACTIVE | `MaskMode VARCHAR(16) NOT NULL` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| CustomMaskJson | NVARCHAR(256) | NULL | ACTIVE | `CustomMaskJson NVARCHAR(256) NULL` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| SuggestedPublicAllowed | BIT | NOT NULL | ACTIVE | `SuggestedPublicAllowed BIT NOT NULL CONSTRAINT DF_MaskTemplate_Public DEFAULT(0)` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| IsActive | BIT | NOT NULL | ACTIVE | `IsActive BIT NOT NULL CONSTRAINT DF_MaskTemplate_Active DEFAULT(1)` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| Revision | BIGINT | NOT NULL | ACTIVE | `Revision BIGINT NOT NULL CONSTRAINT DF_MaskTemplate_Revision DEFAULT(1)` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| CreatedBy | BIGINT | NULL | UNKNOWN | `CreatedBy BIGINT NULL` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| UpdatedBy | BIGINT | NULL | UNKNOWN | `UpdatedBy BIGINT NULL` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| CreatedAtUtc | DATETIME2(3) | NOT NULL | ACTIVE | `CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_MaskTemplate_Created DEFAULT SYSUTCDATETIME()` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| UpdatedAtUtc | DATETIME2(3) | NOT NULL | ACTIVE | `UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_MaskTemplate_Updated DEFAULT SYSUTCDATETIME()` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| RowVersion | ROWVERSION | NOT NULL | UNKNOWN | `RowVersion ROWVERSION NOT NULL` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| PK_DatasetMaskTemplate | PRIMARY KEY | ACTIVE | `Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DatasetMaskTemplate PRIMARY KEY` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| DF_MaskTemplate_Public | DEFAULT | ACTIVE | `SuggestedPublicAllowed BIT NOT NULL CONSTRAINT DF_MaskTemplate_Public DEFAULT(0)` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| DF_MaskTemplate_Active | DEFAULT | ACTIVE | `IsActive BIT NOT NULL CONSTRAINT DF_MaskTemplate_Active DEFAULT(1)` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| DF_MaskTemplate_Revision | DEFAULT | ACTIVE | `Revision BIGINT NOT NULL CONSTRAINT DF_MaskTemplate_Revision DEFAULT(1)` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| DF_MaskTemplate_Created | DEFAULT | ACTIVE | `CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_MaskTemplate_Created DEFAULT SYSUTCDATETIME()` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| DF_MaskTemplate_Updated | DEFAULT | ACTIVE | `UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_MaskTemplate_Updated DEFAULT SYSUTCDATETIME()` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| UQ_MaskTemplate_Name | UNIQUE | ACTIVE | `CONSTRAINT UQ_MaskTemplate_Name UNIQUE(Name)` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| CK_MaskTemplate_Revision | CHECK | ACTIVE | `CONSTRAINT CK_MaskTemplate_Revision CHECK(Revision>0)` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| CK_MaskTemplate_Aliases | CHECK | ACTIVE | `CONSTRAINT CK_MaskTemplate_Aliases CHECK(ISJSON(AliasesJson)=1)` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| CK_MaskTemplate_Mode | CHECK | ACTIVE | `CONSTRAINT CK_MaskTemplate_Mode CHECK(MaskMode IN ('NONE','CUSTOM','FULL','OMIT'))` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| CK_MaskTemplate_Custom | CHECK | ACTIVE | `CONSTRAINT CK_MaskTemplate_Custom CHECK((MaskMode='CUSTOM' AND CustomMaskJson IS NOT NULL AND ISJSON(CustomMaskJson)=1) OR (MaskMode<>'CUSTOM' AND CustomMaskJson IS NULL))` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| CK_MaskTemplate_Public | CHECK | ACTIVE | `CONSTRAINT CK_MaskTemplate_Public CHECK(MaskMode<>'OMIT' OR SuggestedPublicAllowed=0)` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.DatasetMaskTemplateUse

表級狀態：**ACTIVE**；建立來源：[tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql)。

程式／SQL Repository 引用：[server/src/modules/dataset/datasetMaskTemplate.repository.ts](../server/src/modules/dataset/datasetMaskTemplate.repository.ts)、[server/src/modules/dataset/datasetDisplaySchema.ts](../server/src/modules/dataset/datasetDisplaySchema.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DatasetMaskTemplateUse PRIMARY KEY` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| DatasetId | BIGINT | NOT NULL | ACTIVE | `DatasetId BIGINT NOT NULL` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| ColumnName | NVARCHAR(256) | NOT NULL | ACTIVE | `ColumnName NVARCHAR(256) COLLATE Latin1_General_100_BIN2 NOT NULL` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| TemplateId | BIGINT | NOT NULL | ACTIVE | `TemplateId BIGINT NOT NULL` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| TemplateRevision | BIGINT | NOT NULL | ACTIVE | `TemplateRevision BIGINT NOT NULL` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| SensitivityVersion | BIGINT | NOT NULL | ACTIVE | `SensitivityVersion BIGINT NOT NULL` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| AppliedBy | BIGINT | NOT NULL | ACTIVE | `AppliedBy BIGINT NOT NULL` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| AppliedAtUtc | DATETIME2(3) | NOT NULL | ACTIVE | `AppliedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_MaskTemplateUse_Applied DEFAULT SYSUTCDATETIME()` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| PK_DatasetMaskTemplateUse | PRIMARY KEY | ACTIVE | `Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DatasetMaskTemplateUse PRIMARY KEY` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| DF_MaskTemplateUse_Applied | DEFAULT | ACTIVE | `AppliedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_MaskTemplateUse_Applied DEFAULT SYSUTCDATETIME()` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| FK_MaskTemplateUse_Template | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_MaskTemplateUse_Template FOREIGN KEY(TemplateId) REFERENCES uqp.DatasetMaskTemplate(Id)` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| CK_MaskTemplateUse_Values | CHECK | ACTIVE | `CONSTRAINT CK_MaskTemplateUse_Values CHECK(DatasetId>0 AND TemplateRevision>0 AND SensitivityVersion>0 AND AppliedBy>0)` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |

| Index | 狀態 | 鍵／INCLUDE／filter／來源 |
|---|---|---|
| IX_MaskTemplateUse_Template | UNKNOWN | `CREATE INDEX IX_MaskTemplateUse_Template ON uqp.DatasetMaskTemplateUse(TemplateId,DatasetId) INCLUDE(ColumnName,TemplateRevision,SensitivityVersion);` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| IX_MaskTemplateUse_Dataset | UNKNOWN | `CREATE INDEX IX_MaskTemplateUse_Dataset ON uqp.DatasetMaskTemplateUse(DatasetId,ColumnName,Id);` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |

### uqp.DatasetNativeParameterContract

表級狀態：**ACTIVE**；建立來源：[database/migrations/921_datasource_native_parameter_versions.sql](../database/migrations/921_datasource_native_parameter_versions.sql)。

程式／SQL Repository 引用：[server/src/modules/dataset/nativeParameterVersion.repository.ts](../server/src/modules/dataset/nativeParameterVersion.repository.ts)、[server/src/modules/dataset/datasetFieldInitialization.repository.ts](../server/src/modules/dataset/datasetFieldInitialization.repository.ts)、[server/src/modules/datasource/versionFoundationSchema.ts](../server/src/modules/datasource/versionFoundationSchema.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| DatasetId | BIGINT | NOT NULL | ACTIVE | `DatasetId BIGINT NOT NULL` · [database/migrations/921_datasource_native_parameter_versions.sql](../database/migrations/921_datasource_native_parameter_versions.sql) |
| DefinitionRowVersion | BINARY(8) | NOT NULL | UNKNOWN | `DefinitionRowVersion BINARY(8) NOT NULL` · [database/migrations/921_datasource_native_parameter_versions.sql](../database/migrations/921_datasource_native_parameter_versions.sql) |
| DataSourceId | BIGINT | NOT NULL | ACTIVE | `DataSourceId BIGINT NOT NULL` · [database/migrations/921_datasource_native_parameter_versions.sql](../database/migrations/921_datasource_native_parameter_versions.sql) |
| ConfigurationRowVersion | BINARY(8) | NOT NULL | UNKNOWN | `ConfigurationRowVersion BINARY(8) NOT NULL` · [database/migrations/921_datasource_native_parameter_versions.sql](../database/migrations/921_datasource_native_parameter_versions.sql) |
| NativeTypesJson | NVARCHAR(MAX) | NULL | ACTIVE | `NativeTypesJson NVARCHAR(MAX) NULL` · [database/migrations/921_datasource_native_parameter_versions.sql](../database/migrations/921_datasource_native_parameter_versions.sql) |
| EvidenceSource | NVARCHAR(32) | NULL | ACTIVE | `EvidenceSource NVARCHAR(32) NULL` · [database/migrations/921_datasource_native_parameter_versions.sql](../database/migrations/921_datasource_native_parameter_versions.sql) |
| State | NVARCHAR(16) | NOT NULL | ACTIVE | `State NVARCHAR(16) NOT NULL CONSTRAINT DF_DatasetNativeParameterContract_State DEFAULT (N'UNCONFIRMED')` · [database/migrations/921_datasource_native_parameter_versions.sql](../database/migrations/921_datasource_native_parameter_versions.sql) |
| ContractRowVersion | ROWVERSION | NOT NULL | UNKNOWN | `ContractRowVersion ROWVERSION NOT NULL` · [database/migrations/921_datasource_native_parameter_versions.sql](../database/migrations/921_datasource_native_parameter_versions.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| DF_DatasetNativeParameterContract_State | DEFAULT | ACTIVE | `State NVARCHAR(16) NOT NULL CONSTRAINT DF_DatasetNativeParameterContract_State DEFAULT (N'UNCONFIRMED')` · [database/migrations/921_datasource_native_parameter_versions.sql](../database/migrations/921_datasource_native_parameter_versions.sql) |
| PK_DatasetNativeParameterContract | PRIMARY KEY | ACTIVE | `CONSTRAINT PK_DatasetNativeParameterContract PRIMARY KEY (DatasetId)` · [database/migrations/921_datasource_native_parameter_versions.sql](../database/migrations/921_datasource_native_parameter_versions.sql) |
| FK_DatasetNativeParameterContract_Dataset | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_DatasetNativeParameterContract_Dataset FOREIGN KEY (DatasetId) REFERENCES uqp.Dataset(Id)` · [database/migrations/921_datasource_native_parameter_versions.sql](../database/migrations/921_datasource_native_parameter_versions.sql) |
| FK_DatasetNativeParameterContract_DataSource | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_DatasetNativeParameterContract_DataSource FOREIGN KEY (DataSourceId) REFERENCES uqp.DataSource(Id)` · [database/migrations/921_datasource_native_parameter_versions.sql](../database/migrations/921_datasource_native_parameter_versions.sql) |
| CK_DatasetNativeParameterContract_State | CHECK | ACTIVE | `CONSTRAINT CK_DatasetNativeParameterContract_State CHECK (State=N'UNCONFIRMED')` · [database/migrations/921_datasource_native_parameter_versions.sql](../database/migrations/921_datasource_native_parameter_versions.sql) |
| CK_DatasetNativeParameterContract_Json | CHECK | ACTIVE | `CONSTRAINT CK_DatasetNativeParameterContract_Json CHECK (NativeTypesJson IS NULL OR ISJSON(NativeTypesJson)=1)` · [database/migrations/921_datasource_native_parameter_versions.sql](../database/migrations/921_datasource_native_parameter_versions.sql) |
| CK_DatasetNativeParameterContract_Source | CHECK | ACTIVE | `CONSTRAINT CK_DatasetNativeParameterContract_Source CHECK (EvidenceSource IS NULL OR EvidenceSource=N'DATABASE_DECLARATION' OR EvidenceSource=N'EXPLICIT_RUNTIME_BIND')` · [database/migrations/921_datasource_native_parameter_versions.sql](../database/migrations/921_datasource_native_parameter_versions.sql) |
| CK_DatasetNativeParameterContract_Pair | CHECK | ACTIVE | `CONSTRAINT CK_DatasetNativeParameterContract_Pair CHECK (CASE WHEN NativeTypesJson IS NULL AND EvidenceSource IS NULL THEN 1 WHEN NativeTypesJson IS NOT NULL AND EvidenceSource IS NOT NULL THEN 1 ELSE 0 END=1)` · [database/migrations/921_datasource_native_parameter_versions.sql](../database/migrations/921_datasource_native_parameter_versions.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.DatasetParameter

表級狀態：**ACTIVE**；建立來源：[database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql)。

程式／SQL Repository 引用：[server/src/modules/dashboard/dashboard.repository.ts](../server/src/modules/dashboard/dashboard.repository.ts)、[server/src/modules/dataset/column.repository.ts](../server/src/modules/dataset/column.repository.ts)、[server/src/modules/dataset/dataset.repository.ts](../server/src/modules/dataset/dataset.repository.ts)、[server/src/modules/dataset/parameter.repository.ts](../server/src/modules/dataset/parameter.repository.ts)、[server/src/modules/dataset/nativeParameterVersion.repository.ts](../server/src/modules/dataset/nativeParameterVersion.repository.ts)、[server/src/modules/dataset/datasetFieldInitialization.repository.ts](../server/src/modules/dataset/datasetFieldInitialization.repository.ts)、[server/src/modules/dataset/parameterTestFixture.ts](../server/src/modules/dataset/parameterTestFixture.ts)、[server/src/modules/datasource/versionFoundationSchema.ts](../server/src/modules/datasource/versionFoundationSchema.ts)、[server/src/modules/queryDefinition/queryDefinition.repository.ts](../server/src/modules/queryDefinition/queryDefinition.repository.ts)、[server/src/modules/version/version.repository.ts](../server/src/modules/version/version.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `Id BIGINT IDENTITY(1,1) PRIMARY KEY` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| DatasetId | BIGINT | NOT NULL | ACTIVE | `DatasetId BIGINT NOT NULL` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| Name | NVARCHAR(100) | NOT NULL | ACTIVE | `Name NVARCHAR(100) NOT NULL` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| Label | NVARCHAR(200) | NOT NULL | UNKNOWN | `Label NVARCHAR(200) NOT NULL` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| DataType | NVARCHAR(20) | NOT NULL | ACTIVE | `DataType NVARCHAR(20) NOT NULL` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| ControlType | NVARCHAR(30) | NOT NULL | ACTIVE | `ControlType NVARCHAR(30) NOT NULL` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| IsRequired | BIT | NOT NULL | ACTIVE | `IsRequired BIT NOT NULL CONSTRAINT DF_DatasetParameter_Required DEFAULT (0)` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| DefaultValue | NVARCHAR(1000) | NULL | UNKNOWN | `DefaultValue NVARCHAR(1000) NULL` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| DisplayOrder | INT | NOT NULL | ACTIVE | `DisplayOrder INT NOT NULL CONSTRAINT DF_DatasetParameter_Order DEFAULT (0)` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| Placeholder | NVARCHAR(200) | NULL | UNKNOWN | `Placeholder NVARCHAR(200) NULL` · [database/migrations/004_parameter_designer.sql](../database/migrations/004_parameter_designer.sql) |
| HelpText | NVARCHAR(500) | NULL | UNKNOWN | `HelpText NVARCHAR(500) NULL` · [database/migrations/004_parameter_designer.sql](../database/migrations/004_parameter_designer.sql) |
| OptionMode | NVARCHAR(20) | NOT NULL | ACTIVE | `OptionMode NVARCHAR(20) NOT NULL CONSTRAINT DF_DatasetParameter_OptionMode DEFAULT ('NONE')` · [database/migrations/004_parameter_designer.sql](../database/migrations/004_parameter_designer.sql) |
| FixedOptionsJson | NVARCHAR(MAX) | NULL | UNKNOWN | `FixedOptionsJson NVARCHAR(MAX) NULL` · [database/migrations/004_parameter_designer.sql](../database/migrations/004_parameter_designer.sql) |
| LookupDatasetId | BIGINT | NULL | ACTIVE | `LookupDatasetId BIGINT NULL` · [database/migrations/004_parameter_designer.sql](../database/migrations/004_parameter_designer.sql) |
| LookupValueField | NVARCHAR(128) | NULL | UNKNOWN | `LookupValueField NVARCHAR(128) NULL` · [database/migrations/004_parameter_designer.sql](../database/migrations/004_parameter_designer.sql) |
| LookupLabelField | NVARCHAR(128) | NULL | UNKNOWN | `LookupLabelField NVARCHAR(128) NULL` · [database/migrations/004_parameter_designer.sql](../database/migrations/004_parameter_designer.sql) |
| DateOutputMode | NVARCHAR(20) | NOT NULL | ACTIVE | `DateOutputMode NVARCHAR(20) NOT NULL CONSTRAINT DF_DatasetParameter_DateOutputMode DEFAULT ('NATIVE')` · [database/migrations/023_dynamic_date_parameters.sql](../database/migrations/023_dynamic_date_parameters.sql) |
| DateCalendar | NVARCHAR(20) | NOT NULL | ACTIVE | `DateCalendar NVARCHAR(20) NOT NULL CONSTRAINT DF_DatasetParameter_DateCalendar DEFAULT ('GREGORIAN')` · [database/migrations/023_dynamic_date_parameters.sql](../database/migrations/023_dynamic_date_parameters.sql) |
| DateFormat | NVARCHAR(100) | NULL | UNKNOWN | `DateFormat NVARCHAR(100) NULL` · [database/migrations/023_dynamic_date_parameters.sql](../database/migrations/023_dynamic_date_parameters.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| (unnamed PK: Id) | PRIMARY KEY | ACTIVE | `Id BIGINT IDENTITY(1,1) PRIMARY KEY` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| DF_DatasetParameter_Required | DEFAULT | ACTIVE | `IsRequired BIT NOT NULL CONSTRAINT DF_DatasetParameter_Required DEFAULT (0)` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| DF_DatasetParameter_Order | DEFAULT | ACTIVE | `DisplayOrder INT NOT NULL CONSTRAINT DF_DatasetParameter_Order DEFAULT (0)` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| FK_DatasetParameter_Dataset | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_DatasetParameter_Dataset FOREIGN KEY (DatasetId) REFERENCES uqp.Dataset(Id) ON DELETE CASCADE` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| UQ_DatasetParameter_Name | UNIQUE | ACTIVE | `CONSTRAINT UQ_DatasetParameter_Name UNIQUE (DatasetId, Name)` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| CK_DatasetParameter_DataType | CHECK | ACTIVE | `CONSTRAINT CK_DatasetParameter_DataType CHECK (DataType IN ('STRING','NUMBER','DATE','DATETIME','BOOLEAN'))` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| CK_DatasetParameter_ControlType | CHECK | ACTIVE | `CONSTRAINT CK_DatasetParameter_ControlType CHECK (ControlType IN ('TEXT','NUMBER','DATE','DATETIME','SELECT','MULTISELECT','CHECKBOX'))` · [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) |
| DF_DatasetParameter_OptionMode | DEFAULT | ACTIVE | `OptionMode NVARCHAR(20) NOT NULL CONSTRAINT DF_DatasetParameter_OptionMode DEFAULT ('NONE')` · [database/migrations/004_parameter_designer.sql](../database/migrations/004_parameter_designer.sql) |
| CK_DatasetParameter_OptionMode | CHECK | ACTIVE | `CONSTRAINT CK_DatasetParameter_OptionMode CHECK (OptionMode IN ('NONE','FIXED','DATASET'))` · [database/migrations/004_parameter_designer.sql](../database/migrations/004_parameter_designer.sql) |
| FK_DatasetParameter_LookupDataset | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_DatasetParameter_LookupDataset FOREIGN KEY (LookupDatasetId) REFERENCES uqp.Dataset(Id)` · [database/migrations/004_parameter_designer.sql](../database/migrations/004_parameter_designer.sql) |
| DF_DatasetParameter_DateOutputMode | DEFAULT | ACTIVE | `DateOutputMode NVARCHAR(20) NOT NULL CONSTRAINT DF_DatasetParameter_DateOutputMode DEFAULT ('NATIVE')` · [database/migrations/023_dynamic_date_parameters.sql](../database/migrations/023_dynamic_date_parameters.sql) |
| DF_DatasetParameter_DateCalendar | DEFAULT | ACTIVE | `DateCalendar NVARCHAR(20) NOT NULL CONSTRAINT DF_DatasetParameter_DateCalendar DEFAULT ('GREGORIAN')` · [database/migrations/023_dynamic_date_parameters.sql](../database/migrations/023_dynamic_date_parameters.sql) |
| CK_DatasetParameter_DateOutputMode | CHECK | ACTIVE | `CONSTRAINT CK_DatasetParameter_DateOutputMode CHECK (DateOutputMode IN ('NATIVE','STRING'))` · [database/migrations/023_dynamic_date_parameters.sql](../database/migrations/023_dynamic_date_parameters.sql) |
| CK_DatasetParameter_DateCalendar | CHECK | ACTIVE | `CONSTRAINT CK_DatasetParameter_DateCalendar CHECK (DateCalendar IN ('GREGORIAN','ROC'))` · [database/migrations/023_dynamic_date_parameters.sql](../database/migrations/023_dynamic_date_parameters.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.DatasetPatientAuditConfig

表級狀態：**ACTIVE**；建立來源：[database/migrations/907_dataset_patient_audit_config.sql](../database/migrations/907_dataset_patient_audit_config.sql)。

程式／SQL Repository 引用：[server/src/modules/dashboard/dashboardQueryMode.repository.ts](../server/src/modules/dashboard/dashboardQueryMode.repository.ts)、[server/src/modules/dashboard/dashboardDeviceManagement.repository.ts](../server/src/modules/dashboard/dashboardDeviceManagement.repository.ts)、[server/src/modules/dataset/patientAuditConfig.repository.ts](../server/src/modules/dataset/patientAuditConfig.repository.ts)、[server/src/modules/dataset/datasetPublicDisplay.repository.ts](../server/src/modules/dataset/datasetPublicDisplay.repository.ts)、[server/src/modules/dataset/datasetDeliveryPolicy.repository.ts](../server/src/modules/dataset/datasetDeliveryPolicy.repository.ts)、[server/src/modules/dataset/patientAuditContract.repository.ts](../server/src/modules/dataset/patientAuditContract.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| DatasetId | BIGINT | NOT NULL | ACTIVE | `DatasetId BIGINT NOT NULL PRIMARY KEY` · [database/migrations/907_dataset_patient_audit_config.sql](../database/migrations/907_dataset_patient_audit_config.sql) |
| IsEnabled | BIT | NOT NULL | ACTIVE | `IsEnabled BIT NOT NULL CONSTRAINT DF_DatasetPatientAuditConfig_Enabled DEFAULT (0)` · [database/migrations/907_dataset_patient_audit_config.sql](../database/migrations/907_dataset_patient_audit_config.sql) |
| PatientKeyColumn | NVARCHAR(128) | NOT NULL | ACTIVE | `PatientKeyColumn NVARCHAR(128) NOT NULL` · [database/migrations/907_dataset_patient_audit_config.sql](../database/migrations/907_dataset_patient_audit_config.sql) |
| UpdatedAtUtc | DATETIME2(3) | NOT NULL | ACTIVE | `UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_DatasetPatientAuditConfig_Updated DEFAULT SYSUTCDATETIME()` · [database/migrations/907_dataset_patient_audit_config.sql](../database/migrations/907_dataset_patient_audit_config.sql) |
| ConfigurationVersion | BIGINT | NOT NULL | ACTIVE | `ConfigurationVersion BIGINT NOT NULL CONSTRAINT DF_DatasetPatientAuditConfig_Version DEFAULT (1) WITH VALUES` · [database/migrations/919_dashboard_dataset_security_contract.sql](../database/migrations/919_dashboard_dataset_security_contract.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| (unnamed PK: DatasetId) | PRIMARY KEY | ACTIVE | `DatasetId BIGINT NOT NULL PRIMARY KEY` · [database/migrations/907_dataset_patient_audit_config.sql](../database/migrations/907_dataset_patient_audit_config.sql) |
| DF_DatasetPatientAuditConfig_Enabled | DEFAULT | ACTIVE | `IsEnabled BIT NOT NULL CONSTRAINT DF_DatasetPatientAuditConfig_Enabled DEFAULT (0)` · [database/migrations/907_dataset_patient_audit_config.sql](../database/migrations/907_dataset_patient_audit_config.sql) |
| DF_DatasetPatientAuditConfig_Updated | DEFAULT | ACTIVE | `UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_DatasetPatientAuditConfig_Updated DEFAULT SYSUTCDATETIME()` · [database/migrations/907_dataset_patient_audit_config.sql](../database/migrations/907_dataset_patient_audit_config.sql) |
| FK_DatasetPatientAuditConfig_Dataset | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_DatasetPatientAuditConfig_Dataset FOREIGN KEY (DatasetId) REFERENCES uqp.Dataset(Id) ON DELETE CASCADE` · [database/migrations/907_dataset_patient_audit_config.sql](../database/migrations/907_dataset_patient_audit_config.sql) |
| CK_DatasetPatientAuditConfig_Key | CHECK | ACTIVE | `CONSTRAINT CK_DatasetPatientAuditConfig_Key CHECK (LEN(LTRIM(RTRIM(PatientKeyColumn))) > 0)` · [database/migrations/907_dataset_patient_audit_config.sql](../database/migrations/907_dataset_patient_audit_config.sql) |
| DF_DatasetPatientAuditConfig_Version | DEFAULT | ACTIVE | `ConfigurationVersion BIGINT NOT NULL CONSTRAINT DF_DatasetPatientAuditConfig_Version DEFAULT (1) WITH VALUES` · [database/migrations/919_dashboard_dataset_security_contract.sql](../database/migrations/919_dashboard_dataset_security_contract.sql) |
| CK_DatasetPatientAuditConfig_Version | CHECK | ACTIVE | `CONSTRAINT CK_DatasetPatientAuditConfig_Version CHECK (ConfigurationVersion>=1)` · [database/migrations/919_dashboard_dataset_security_contract.sql](../database/migrations/919_dashboard_dataset_security_contract.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.DatasetPatientAuditMetadata

表級狀態：**ACTIVE**；建立來源：[database/migrations/919_dashboard_dataset_security_contract.sql](../database/migrations/919_dashboard_dataset_security_contract.sql)。

程式／SQL Repository 引用：[server/src/modules/dataset/patientAuditContract.repository.ts](../server/src/modules/dataset/patientAuditContract.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| DatasetId | BIGINT | NOT NULL | ACTIVE | `DatasetId BIGINT NOT NULL CONSTRAINT PK_DatasetPatientAuditMetadata PRIMARY KEY` · [database/migrations/919_dashboard_dataset_security_contract.sql](../database/migrations/919_dashboard_dataset_security_contract.sql) |
| DefinitionHash | CHAR(64) | NOT NULL | UNKNOWN | `DefinitionHash CHAR(64) NOT NULL` · [database/migrations/919_dashboard_dataset_security_contract.sql](../database/migrations/919_dashboard_dataset_security_contract.sql) |
| ColumnsJson | NVARCHAR(MAX) | NOT NULL | ACTIVE | `ColumnsJson NVARCHAR(MAX) NOT NULL` · [database/migrations/919_dashboard_dataset_security_contract.sql](../database/migrations/919_dashboard_dataset_security_contract.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| PK_DatasetPatientAuditMetadata | PRIMARY KEY | ACTIVE | `DatasetId BIGINT NOT NULL CONSTRAINT PK_DatasetPatientAuditMetadata PRIMARY KEY` · [database/migrations/919_dashboard_dataset_security_contract.sql](../database/migrations/919_dashboard_dataset_security_contract.sql) |
| FK_DatasetPatientAuditMetadata_Dataset | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_DatasetPatientAuditMetadata_Dataset FOREIGN KEY (DatasetId) REFERENCES uqp.Dataset(Id) ON DELETE CASCADE` · [database/migrations/919_dashboard_dataset_security_contract.sql](../database/migrations/919_dashboard_dataset_security_contract.sql) |
| CK_DatasetPatientAuditMetadata_Json | CHECK | ACTIVE | `CONSTRAINT CK_DatasetPatientAuditMetadata_Json CHECK (ISJSON(ColumnsJson)=1)` · [database/migrations/919_dashboard_dataset_security_contract.sql](../database/migrations/919_dashboard_dataset_security_contract.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.DatasetPublicDisplayPolicy

表級狀態：**ACTIVE**；建立來源：[tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql)。

程式／SQL Repository 引用：[server/src/modules/dataset/datasetPublicDisplay.repository.ts](../server/src/modules/dataset/datasetPublicDisplay.repository.ts)、[server/src/modules/dataset/datasetDisplaySchema.ts](../server/src/modules/dataset/datasetDisplaySchema.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| DatasetId | BIGINT | NOT NULL | ACTIVE | `DatasetId BIGINT NOT NULL CONSTRAINT PK_DatasetPublicDisplayPolicy PRIMARY KEY` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| DataSourceId | BIGINT | NOT NULL | UNKNOWN | `DataSourceId BIGINT NOT NULL` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| DefinitionVersion | BINARY(8) | NOT NULL | UNKNOWN | `DefinitionVersion BINARY(8) NOT NULL` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| ConfigurationVersion | BINARY(8) | NOT NULL | UNKNOWN | `ConfigurationVersion BINARY(8) NOT NULL` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| SensitivityVersion | BIGINT | NOT NULL | ACTIVE | `SensitivityVersion BIGINT NOT NULL` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| GrantsJson | NVARCHAR(MAX) | NOT NULL | ACTIVE | `GrantsJson NVARCHAR(MAX) NOT NULL` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| ConfirmedBy | BIGINT | NOT NULL | ACTIVE | `ConfirmedBy BIGINT NOT NULL` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| ConfirmedAtUtc | DATETIME2(3) | NOT NULL | ACTIVE | `ConfirmedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_PublicDisplay_Confirmed DEFAULT SYSUTCDATETIME()` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| UpdatedAtUtc | DATETIME2(3) | NOT NULL | ACTIVE | `UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_PublicDisplay_Updated DEFAULT SYSUTCDATETIME()` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| RequestId | UNIQUEIDENTIFIER | NOT NULL | ACTIVE | `RequestId UNIQUEIDENTIFIER NOT NULL` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| RequestDigest | CHAR(64) | NOT NULL | UNKNOWN | `RequestDigest CHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| AuditLogId | BIGINT | NOT NULL | ACTIVE | `AuditLogId BIGINT NOT NULL` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| RowVersion | ROWVERSION | NOT NULL | UNKNOWN | `RowVersion ROWVERSION NOT NULL` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| PK_DatasetPublicDisplayPolicy | PRIMARY KEY | ACTIVE | `DatasetId BIGINT NOT NULL CONSTRAINT PK_DatasetPublicDisplayPolicy PRIMARY KEY` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| DF_PublicDisplay_Confirmed | DEFAULT | ACTIVE | `ConfirmedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_PublicDisplay_Confirmed DEFAULT SYSUTCDATETIME()` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| DF_PublicDisplay_Updated | DEFAULT | ACTIVE | `UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_PublicDisplay_Updated DEFAULT SYSUTCDATETIME()` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| FK_PublicDisplay_Dataset | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_PublicDisplay_Dataset FOREIGN KEY(DatasetId) REFERENCES uqp.Dataset(Id) ON DELETE CASCADE` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| CK_PublicDisplay_Values | CHECK | ACTIVE | `CONSTRAINT CK_PublicDisplay_Values CHECK(SensitivityVersion>0 AND ConfirmedBy>0 AND AuditLogId>0)` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| CK_PublicDisplay_Json | CHECK | ACTIVE | `CONSTRAINT CK_PublicDisplay_Json CHECK(ISJSON(GrantsJson)=1 AND DATALENGTH(GrantsJson)<=262144)` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |
| UQ_PublicDisplay_Request | UNIQUE | ACTIVE | `CONSTRAINT UQ_PublicDisplay_Request UNIQUE(RequestId)` · [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.DatasetSecurityConfirmation

表級狀態：**LEGACY_REQUIRED**；建立來源：[tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql)。

程式／SQL Repository 引用：未證明直接業務讀寫；依上述特殊判定保留。

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| DatasetId | BIGINT | NOT NULL | LEGACY_REQUIRED | `[DatasetId] BIGINT NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| SnapshotId | BIGINT | NOT NULL | LEGACY_REQUIRED | `[SnapshotId] BIGINT NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| State | NVARCHAR(16) | NOT NULL | LEGACY_REQUIRED | `[State] NVARCHAR(16) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT [DF_DatasetSecurityConfirmation_State] DEFAULT (N'PENDING')` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| StateRowVersion | ROWVERSION | NOT NULL | LEGACY_REQUIRED | `[StateRowVersion] ROWVERSION NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| DecisionId | BIGINT | NOT NULL | LEGACY_REQUIRED | `[DecisionId] BIGINT NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| Classification | NVARCHAR(24) | NULL | LEGACY_REQUIRED | `[Classification] NVARCHAR(24) COLLATE Latin1_General_100_BIN2 NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| SensitivityVersion | BIGINT | NULL | LEGACY_REQUIRED | `[SensitivityVersion] BIGINT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| PolicyDigest | BINARY(32) | NULL | LEGACY_REQUIRED | `[PolicyDigest] BINARY(32) NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| PatientConfigurationVersion | BIGINT | NULL | LEGACY_REQUIRED | `[PatientConfigurationVersion] BIGINT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| PatientKeyAlias | NVARCHAR(128) | NULL | LEGACY_REQUIRED | `[PatientKeyAlias] NVARCHAR(128) COLLATE Latin1_General_100_BIN2 NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| ReviewerId | BIGINT | NULL | LEGACY_REQUIRED | `[ReviewerId] BIGINT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| OwnerUserId | BIGINT | NULL | LEGACY_REQUIRED | `[OwnerUserId] BIGINT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| ApproverScopeKind | NVARCHAR(8) | NULL | LEGACY_REQUIRED | `[ApproverScopeKind] NVARCHAR(8) COLLATE Latin1_General_100_BIN2 NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| ReviewerTokenVersion | BIGINT | NULL | LEGACY_REQUIRED | `[ReviewerTokenVersion] BIGINT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| OwnerTokenVersion | BIGINT | NULL | LEGACY_REQUIRED | `[OwnerTokenVersion] BIGINT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| ActorScopeEpoch | BINARY(8) | NULL | LEGACY_REQUIRED | `[ActorScopeEpoch] BINARY(8) NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| OwnerScopeEpoch | BINARY(8) | NULL | LEGACY_REQUIRED | `[OwnerScopeEpoch] BINARY(8) NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| AuthorizationModelVersion | NVARCHAR(32) | NOT NULL | LEGACY_REQUIRED | `[AuthorizationModelVersion] NVARCHAR(32) COLLATE Latin1_General_100_BIN2 NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| PlatformIncarnation | UNIQUEIDENTIFIER | NOT NULL | LEGACY_REQUIRED | `[PlatformIncarnation] UNIQUEIDENTIFIER NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| DF_DatasetSecurityConfirmation_State | DEFAULT | LEGACY_REQUIRED | `[State] NVARCHAR(16) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT [DF_DatasetSecurityConfirmation_State] DEFAULT (N'PENDING')` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| PK_DatasetSecurityConfirmation | PRIMARY KEY | LEGACY_REQUIRED | `CONSTRAINT [PK_DatasetSecurityConfirmation] PRIMARY KEY CLUSTERED ([DatasetId] ASC)` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CK_DatasetSecurityConfirmation_Ids | CHECK | LEGACY_REQUIRED | `CONSTRAINT [CK_DatasetSecurityConfirmation_Ids] CHECK (CASE WHEN (([DatasetId] IS NULL OR ([DatasetId]>(0))) AND ([SnapshotId] IS NULL OR ([SnapshotId]>(0))) AND ([DecisionId] IS NULL OR ([DecisionId]>(0))) AND ([SensitivityVersion] IS NULL OR ([SensitivityVersion]>(0))) AND ([PatientConfigurationVersion] IS NULL OR ([PatientConfigurationVersion]>(0))) AND ([ReviewerId] IS NULL OR ([ReviewerId]>(0))) AND ([OwnerUserId] IS NULL OR ([OwnerUserId]>(0))) AND ([ReviewerTokenVersion] IS NULL OR ([ReviewerTokenVersion]>(0))) AND ([OwnerTokenVersion] IS NULL OR ([OwnerTokenVersion]>(0)))) THEN (1) ELSE (0) END=(1))` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CK_DatasetSecurityConfirmation_Epochs | CHECK | LEGACY_REQUIRED | `CONSTRAINT [CK_DatasetSecurityConfirmation_Epochs] CHECK (CASE WHEN (([ActorScopeEpoch] IS NULL OR ([ActorScopeEpoch]<>0x0000000000000000)) AND ([OwnerScopeEpoch] IS NULL OR ([OwnerScopeEpoch]<>0x0000000000000000))) THEN (1) ELSE (0) END=(1))` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CK_DatasetSecurityConfirmation_State | CHECK | LEGACY_REQUIRED | `CONSTRAINT [CK_DatasetSecurityConfirmation_State] CHECK (CASE WHEN ((([State]=N'PENDING' AND DATALENGTH([State])=(14)) OR ([State]=N'ACTIVE' AND DATALENGTH([State])=(12)) OR ([State]=N'REJECTED' AND DATALENGTH([State])=(16)) OR ([State]=N'REVOKED' AND DATALENGTH([State])=(14)) OR ([State]=N'INVALIDATED' AND DATALENGTH([State])=(22)))) THEN (1) ELSE (0) END=(1))` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CK_DatasetSecurityConfirmation_Classification | CHECK | LEGACY_REQUIRED | `CONSTRAINT [CK_DatasetSecurityConfirmation_Classification] CHECK (CASE WHEN (([Classification] IS NULL OR ((([Classification]=N'NON_PATIENT_PUBLIC' AND DATALENGTH([Classification])=(36)) OR ([Classification]=N'NON_PATIENT_SENSITIVE' AND DATALENGTH([Classification])=(42)) OR ([Classification]=N'PATIENT' AND DATALENGTH([Classification])=(14)))))) THEN (1) ELSE (0) END=(1))` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CK_DatasetSecurityConfirmation_ScopeKind | CHECK | LEGACY_REQUIRED | `CONSTRAINT [CK_DatasetSecurityConfirmation_ScopeKind] CHECK (CASE WHEN (([ApproverScopeKind] IS NULL OR ((([ApproverScopeKind]=N'OWNER' AND DATALENGTH([ApproverScopeKind])=(10)) OR ([ApproverScopeKind]=N'REVIEWER' AND DATALENGTH([ApproverScopeKind])=(16)))))) THEN (1) ELSE (0) END=(1))` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CK_DatasetSecurityConfirmation_AuthorizationModel | CHECK | LEGACY_REQUIRED | `CONSTRAINT [CK_DatasetSecurityConfirmation_AuthorizationModel] CHECK (CASE WHEN ((([AuthorizationModelVersion]=N'DATASET_SCOPE_AUTH_V1' AND DATALENGTH([AuthorizationModelVersion])=(42)))) THEN (1) ELSE (0) END=(1))` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CK_DatasetSecurityConfirmation_Active | CHECK | LEGACY_REQUIRED | `CONSTRAINT [CK_DatasetSecurityConfirmation_Active] CHECK (CASE WHEN ([State]<>N'ACTIVE' OR ([Classification] IS NOT NULL AND [SensitivityVersion] IS NOT NULL AND [PolicyDigest] IS NOT NULL AND [ReviewerId] IS NOT NULL AND [OwnerUserId] IS NOT NULL AND [ApproverScopeKind] IS NOT NULL AND [ReviewerTokenVersion] IS NOT NULL AND [OwnerTokenVersion] IS NOT NULL AND [ActorScopeEpoch] IS NOT NULL AND [OwnerScopeEpoch] IS NOT NULL AND (([ApproverScopeKind]=N'OWNER' AND [ReviewerId]=[OwnerUserId] AND [ReviewerTokenVersion]=[OwnerTokenVersion] AND [ActorScopeEpoch]=[OwnerScopeEpoch]) OR ([ApproverScopeKind]=N'REVIEWER' AND [ReviewerId]<>[OwnerUserId])) AND (([Classification]=N'PATIENT' AND [PatientConfigurationVersion] IS NOT NULL AND [PatientKeyAlias] IS NOT NULL AND DATALENGTH([PatientKeyAlias])>(0)) OR ([Classification] IN (N'NON_PATIENT_PUBLIC',N'NON_PATIENT_SENSITIVE') AND [PatientConfigurationVersion] IS NULL AND [PatientKeyAlias] IS NULL)))) THEN (1) ELSE (0) END=(1))` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| FK_DatasetSecurityConfirmation_Snapshot | FOREIGN KEY | LEGACY_REQUIRED | `CONSTRAINT [FK_DatasetSecurityConfirmation_Snapshot] FOREIGN KEY ([DatasetId],[SnapshotId]) REFERENCES [uqp].[DatasetFieldSnapshot] ([DatasetId],[Id]) ON DELETE NO ACTION ON UPDATE NO ACTION` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |

| Index | 狀態 | 鍵／INCLUDE／filter／來源 |
|---|---|---|
| IX_SecurityConfirmation_Snapshot | LEGACY_REQUIRED | `CREATE NONCLUSTERED INDEX [IX_SecurityConfirmation_Snapshot] ON [uqp].[DatasetSecurityConfirmation] ([SnapshotId] ASC,[DatasetId] ASC);` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |

### uqp.DatasetSecurityDecision

表級狀態：**ACTIVE**；建立來源：[tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql)。

程式／SQL Repository 引用：[server/src/modules/dataset/datasetScopeManagement.repository.ts](../server/src/modules/dataset/datasetScopeManagement.repository.ts)、[server/src/modules/dataset/datasetFieldInitialization.repository.ts](../server/src/modules/dataset/datasetFieldInitialization.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `[Id] BIGINT NOT NULL CONSTRAINT [DF_DatasetSecurityDecision_Id] DEFAULT (NEXT VALUE FOR [uqp].[DatasetSecurityDecisionSeq])` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| DatasetId | BIGINT | NOT NULL | ACTIVE | `[DatasetId] BIGINT NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| Kind | NVARCHAR(16) | NOT NULL | ACTIVE | `[Kind] NVARCHAR(16) COLLATE Latin1_General_100_BIN2 NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| SnapshotId | BIGINT | NULL | ACTIVE | `[SnapshotId] BIGINT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| SubjectUserId | BIGINT | NULL | ACTIVE | `[SubjectUserId] BIGINT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| ScopeKind | NVARCHAR(8) | NULL | ACTIVE | `[ScopeKind] NVARCHAR(8) COLLATE Latin1_General_100_BIN2 NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| RequestId | UNIQUEIDENTIFIER | NOT NULL | ACTIVE | `[RequestId] UNIQUEIDENTIFIER NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CommandDigest | BINARY(32) | NOT NULL | UNKNOWN | `[CommandDigest] BINARY(32) NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| ActorId | BIGINT | NOT NULL | ACTIVE | `[ActorId] BIGINT NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| ActorTokenVersion | BIGINT | NOT NULL | ACTIVE | `[ActorTokenVersion] BIGINT NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| Action | NVARCHAR(32) | NOT NULL | ACTIVE | `[Action] NVARCHAR(32) COLLATE Latin1_General_100_BIN2 NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| ReasonCode | NVARCHAR(32) | NOT NULL | ACTIVE | `[ReasonCode] NVARCHAR(32) COLLATE Latin1_General_100_BIN2 NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| PreviousState | NVARCHAR(16) | NOT NULL | ACTIVE | `[PreviousState] NVARCHAR(16) COLLATE Latin1_General_100_BIN2 NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| NextState | NVARCHAR(16) | NOT NULL | ACTIVE | `[NextState] NVARCHAR(16) COLLATE Latin1_General_100_BIN2 NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| PreviousStateVersion | BINARY(8) | NULL | ACTIVE | `[PreviousStateVersion] BINARY(8) NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| NextStateVersion | BINARY(8) | NOT NULL | ACTIVE | `[NextStateVersion] BINARY(8) NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| SnapshotDigest | BINARY(32) | NULL | UNKNOWN | `[SnapshotDigest] BINARY(32) NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| PolicyDigest | BINARY(32) | NULL | UNKNOWN | `[PolicyDigest] BINARY(32) NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| SourceOperationEvidenceDigest | BINARY(32) | NULL | UNKNOWN | `[SourceOperationEvidenceDigest] BINARY(32) NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| AuthorizationEvidenceJson | NVARCHAR(MAX) | NOT NULL | ACTIVE | `[AuthorizationEvidenceJson] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| DetailsJson | NVARCHAR(MAX) | NOT NULL | ACTIVE | `[DetailsJson] NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| AuditLogId | BIGINT | NOT NULL | ACTIVE | `[AuditLogId] BIGINT NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| TransactionReference | UNIQUEIDENTIFIER | NOT NULL | UNKNOWN | `[TransactionReference] UNIQUEIDENTIFIER NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| PlatformIncarnation | UNIQUEIDENTIFIER | NOT NULL | UNKNOWN | `[PlatformIncarnation] UNIQUEIDENTIFIER NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| DecidedAt | DATETIME2(7) | NOT NULL | UNKNOWN | `[DecidedAt] DATETIME2(7) NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| DF_DatasetSecurityDecision_Id | DEFAULT | ACTIVE | `[Id] BIGINT NOT NULL CONSTRAINT [DF_DatasetSecurityDecision_Id] DEFAULT (NEXT VALUE FOR [uqp].[DatasetSecurityDecisionSeq])` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| PK_DatasetSecurityDecision | PRIMARY KEY | ACTIVE | `CONSTRAINT [PK_DatasetSecurityDecision] PRIMARY KEY CLUSTERED ([Id] ASC)` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| UQ_DatasetSecurityDecision_RequestId | UNIQUE | ACTIVE | `CONSTRAINT [UQ_DatasetSecurityDecision_RequestId] UNIQUE NONCLUSTERED ([RequestId] ASC)` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CK_DatasetSecurityDecision_Ids | CHECK | ACTIVE | `CONSTRAINT [CK_DatasetSecurityDecision_Ids] CHECK (CASE WHEN (([Id] IS NULL OR ([Id]>(0))) AND ([DatasetId] IS NULL OR ([DatasetId]>(0))) AND ([SnapshotId] IS NULL OR ([SnapshotId]>(0))) AND ([SubjectUserId] IS NULL OR ([SubjectUserId]>(0))) AND ([ActorId] IS NULL OR ([ActorId]>(0))) AND ([ActorTokenVersion] IS NULL OR ([ActorTokenVersion]>(0))) AND ([AuditLogId] IS NULL OR ([AuditLogId]>(0)))) THEN (1) ELSE (0) END=(1))` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CK_DatasetSecurityDecision_Shape | CHECK | ACTIVE | `CONSTRAINT [CK_DatasetSecurityDecision_Shape] CHECK (CASE WHEN ((([Kind]=N'SCOPE' AND [SubjectUserId] IS NOT NULL AND [ScopeKind] IS NOT NULL AND [ScopeKind] IN (N'OWNER',N'REVIEWER') AND [SnapshotId] IS NULL) OR ([Kind] IN (N'SNAPSHOT',N'CONFIRMATION') AND [SubjectUserId] IS NULL AND [ScopeKind] IS NULL AND [SnapshotId] IS NOT NULL)) AND ((([Kind]=N'SNAPSHOT' AND DATALENGTH([Kind])=(16)) OR ([Kind]=N'SCOPE' AND DATALENGTH([Kind])=(10)) OR ([Kind]=N'CONFIRMATION' AND DATALENGTH([Kind])=(24))) AND ([ScopeKind] IS NULL OR ((([ScopeKind]=N'OWNER' AND DATALENGTH([ScopeKind])=(10)) OR ([ScopeKind]=N'REVIEWER' AND DATALENGTH([ScopeKind])=(16))))))) THEN (1) ELSE (0) END=(1))` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CK_DatasetSecurityDecision_Action | CHECK | ACTIVE | `CONSTRAINT [CK_DatasetSecurityDecision_Action] CHECK (CASE WHEN ((([Kind]=N'SNAPSHOT' AND [Action] IN (N'COLLECT_METADATA',N'INVALIDATE')) OR ([Kind]=N'SCOPE' AND [Action] IN (N'GRANT_SCOPE',N'REVOKE_SCOPE')) OR ([Kind]=N'CONFIRMATION' AND [Action] IN (N'CONFIRM',N'REJECT',N'REVOKE',N'INVALIDATE'))) AND ((([Action]=N'COLLECT_METADATA' AND DATALENGTH([Action])=(32)) OR ([Action]=N'GRANT_SCOPE' AND DATALENGTH([Action])=(22)) OR ([Action]=N'REVOKE_SCOPE' AND DATALENGTH([Action])=(24)) OR ([Action]=N'CONFIRM' AND DATALENGTH([Action])=(14)) OR ([Action]=N'REJECT' AND DATALENGTH([Action])=(12)) OR ([Action]=N'REVOKE' AND DATALENGTH([Action])=(12)) OR ([Action]=N'INVALIDATE' AND DATALENGTH([Action])=(20))))) THEN (1) ELSE (0) END=(1))` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CK_DatasetSecurityDecision_Reason | CHECK | ACTIVE | `CONSTRAINT [CK_DatasetSecurityDecision_Reason] CHECK (CASE WHEN ((([ReasonCode]=N'METADATA_COLLECTED' AND DATALENGTH([ReasonCode])=(36)) OR ([ReasonCode]=N'OWNER_APPOINTED' AND DATALENGTH([ReasonCode])=(30)) OR ([ReasonCode]=N'REVIEWER_APPOINTED' AND DATALENGTH([ReasonCode])=(36)) OR ([ReasonCode]=N'SCOPE_REBOUND' AND DATALENGTH([ReasonCode])=(26)) OR ([ReasonCode]=N'SCOPE_REVOKED' AND DATALENGTH([ReasonCode])=(26)) OR ([ReasonCode]=N'CLASSIFICATION_ACCEPTED' AND DATALENGTH([ReasonCode])=(46)) OR ([ReasonCode]=N'POLICY_REJECTED' AND DATALENGTH([ReasonCode])=(30)) OR ([ReasonCode]=N'AUTHORIZATION_REVOKED' AND DATALENGTH([ReasonCode])=(42)) OR ([ReasonCode]=N'EVIDENCE_CHANGED' AND DATALENGTH([ReasonCode])=(32)))) THEN (1) ELSE (0) END=(1))` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CK_DatasetSecurityDecision_States | CHECK | ACTIVE | `CONSTRAINT [CK_DatasetSecurityDecision_States] CHECK (CASE WHEN (([Kind]=N'SNAPSHOT' AND (([PreviousState]=N'MISSING' AND DATALENGTH([PreviousState])=(14)) OR ([PreviousState]=N'DESCRIBED' AND DATALENGTH([PreviousState])=(18)) OR ([PreviousState]=N'SOURCE_BOUND' AND DATALENGTH([PreviousState])=(24)) OR ([PreviousState]=N'INVALIDATED' AND DATALENGTH([PreviousState])=(22)) OR ([PreviousState]=N'EXPIRED' AND DATALENGTH([PreviousState])=(14))) AND (([NextState]=N'DESCRIBED' AND DATALENGTH([NextState])=(18)) OR ([NextState]=N'SOURCE_BOUND' AND DATALENGTH([NextState])=(24)) OR ([NextState]=N'INVALIDATED' AND DATALENGTH([NextState])=(22)) OR ([NextState]=N'EXPIRED' AND DATALENGTH([NextState])=(14)))) OR ([Kind]=N'SCOPE' AND (([PreviousState]=N'MISSING' AND DATALENGTH([PreviousState])=(14)) OR ([PreviousState]=N'ACTIVE' AND DATALENGTH([PreviousState])=(12)) OR ([PreviousState]=N'REVOKED' AND DATALENGTH([PreviousState])=(14))) AND (([NextState]=N'ACTIVE' AND DATALENGTH([NextState])=(12)) OR ([NextState]=N'REVOKED' AND DATALENGTH([NextState])=(14)))) OR ([Kind]=N'CONFIRMATION' AND (([PreviousState]=N'MISSING' AND DATALENGTH([PreviousState])=(14)) OR ([PreviousState]=N'PENDING' AND DATALENGTH([PreviousState])=(14)) OR ([PreviousState]=N'ACTIVE' AND DATALENGTH([PreviousState])=(12)) OR ([PreviousState]=N'REJECTED' AND DATALENGTH([PreviousState])=(16)) OR ([PreviousState]=N'REVOKED' AND DATALENGTH([PreviousState])=(14)) OR ([PreviousState]=N'INVALIDATED' AND DATALENGTH([PreviousState])=(22))) AND (([NextState]=N'PENDING' AND DATALENGTH([NextState])=(14)) OR ([NextState]=N'ACTIVE' AND DATALENGTH([NextState])=(12)) OR ([NextState]=N'REJECTED' AND DATALENGTH([NextState])=(16)) OR ([NextState]=N'REVOKED' AND DATALENGTH([NextState])=(14)) OR ([NextState]=N'INVALIDATED' AND DATALENGTH([NextState])=(22))))) THEN (1) ELSE (0) END=(1))` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CK_DatasetSecurityDecision_Versions | CHECK | ACTIVE | `CONSTRAINT [CK_DatasetSecurityDecision_Versions] CHECK (CASE WHEN ((([PreviousState]=N'MISSING' AND [PreviousStateVersion] IS NULL) OR ([PreviousState]<>N'MISSING' AND [PreviousStateVersion] IS NOT NULL)) AND ([PreviousStateVersion] IS NULL OR ([PreviousStateVersion]<>0x0000000000000000)) AND ([NextStateVersion] IS NULL OR ([NextStateVersion]<>0x0000000000000000))) THEN (1) ELSE (0) END=(1))` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CK_DatasetSecurityDecision_Json | CHECK | ACTIVE | `CONSTRAINT [CK_DatasetSecurityDecision_Json] CHECK (CASE WHEN (ISJSON([AuthorizationEvidenceJson])=(1) AND DATALENGTH([AuthorizationEvidenceJson])<=(16384) AND ISJSON([DetailsJson])=(1) AND DATALENGTH([DetailsJson])<=(16384)) THEN (1) ELSE (0) END=(1))` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| FK_DatasetSecurityDecision_Dataset | FOREIGN KEY | ACTIVE | `CONSTRAINT [FK_DatasetSecurityDecision_Dataset] FOREIGN KEY ([DatasetId]) REFERENCES [uqp].[Dataset] ([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| FK_DatasetSecurityDecision_Snapshot | FOREIGN KEY | ACTIVE | `CONSTRAINT [FK_DatasetSecurityDecision_Snapshot] FOREIGN KEY ([DatasetId],[SnapshotId]) REFERENCES [uqp].[DatasetFieldSnapshot] ([DatasetId],[Id]) ON DELETE NO ACTION ON UPDATE NO ACTION` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| FK_DatasetSecurityDecision_Scope | FOREIGN KEY | ACTIVE | `CONSTRAINT [FK_DatasetSecurityDecision_Scope] FOREIGN KEY ([DatasetId],[SubjectUserId],[ScopeKind]) REFERENCES [uqp].[DatasetSecurityScope] ([DatasetId],[UserId],[ScopeKind]) ON DELETE NO ACTION ON UPDATE NO ACTION` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |

| Index | 狀態 | 鍵／INCLUDE／filter／來源 |
|---|---|---|
| IX_SecurityDecision_Dataset | UNKNOWN | `CREATE NONCLUSTERED INDEX [IX_SecurityDecision_Dataset] ON [uqp].[DatasetSecurityDecision] ([DatasetId] ASC,[Id] ASC);` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| IX_SecurityDecision_Snapshot | UNKNOWN | `CREATE NONCLUSTERED INDEX [IX_SecurityDecision_Snapshot] ON [uqp].[DatasetSecurityDecision] ([SnapshotId] ASC,[Id] ASC);` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| UX_SecurityDecision_CollectionSnapshot | ACTIVE | `CREATE UNIQUE NONCLUSTERED INDEX [UX_SecurityDecision_CollectionSnapshot] ON [uqp].[DatasetSecurityDecision] ([SnapshotId] ASC) WHERE ([Kind]=N'SNAPSHOT' AND [Action]=N'COLLECT_METADATA');` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |

### uqp.DatasetSecurityScope

表級狀態：**ACTIVE**；建立來源：[tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql)。

程式／SQL Repository 引用：[server/src/modules/dataset/datasetScopeManagement.repository.ts](../server/src/modules/dataset/datasetScopeManagement.repository.ts)、[server/src/modules/dataset/dataset923ScopeConfirmationGate.ts](../server/src/modules/dataset/dataset923ScopeConfirmationGate.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| DatasetId | BIGINT | NOT NULL | ACTIVE | `[DatasetId] BIGINT NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| UserId | BIGINT | NOT NULL | ACTIVE | `[UserId] BIGINT NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| ScopeKind | NVARCHAR(8) | NOT NULL | ACTIVE | `[ScopeKind] NVARCHAR(8) COLLATE Latin1_General_100_BIN2 NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| BoundDataSourceId | BIGINT | NOT NULL | ACTIVE | `[BoundDataSourceId] BIGINT NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| State | NVARCHAR(8) | NOT NULL | ACTIVE | `[State] NVARCHAR(8) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT [DF_DatasetSecurityScope_State] DEFAULT (N'REVOKED')` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| ParentOwnerUserId | BIGINT | NULL | ACTIVE | `[ParentOwnerUserId] BIGINT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| ParentOwnerKind | NVARCHAR(8) | NULL | ACTIVE | `[ParentOwnerKind] NVARCHAR(8) COLLATE Latin1_General_100_BIN2 NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| ChangedByUserId | BIGINT | NOT NULL | ACTIVE | `[ChangedByUserId] BIGINT NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| LastRequestId | UNIQUEIDENTIFIER | NOT NULL | ACTIVE | `[LastRequestId] UNIQUEIDENTIFIER NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| LastReasonCode | NVARCHAR(32) | NOT NULL | UNKNOWN | `[LastReasonCode] NVARCHAR(32) COLLATE Latin1_General_100_BIN2 NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| GrantedAt | DATETIME2(7) | NOT NULL | UNKNOWN | `[GrantedAt] DATETIME2(7) NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| ChangedAt | DATETIME2(7) | NOT NULL | UNKNOWN | `[ChangedAt] DATETIME2(7) NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| ScopeRowVersion | ROWVERSION | NOT NULL | UNKNOWN | `[ScopeRowVersion] ROWVERSION NOT NULL` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| DF_DatasetSecurityScope_State | DEFAULT | ACTIVE | `[State] NVARCHAR(8) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT [DF_DatasetSecurityScope_State] DEFAULT (N'REVOKED')` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| PK_DatasetSecurityScope | PRIMARY KEY | ACTIVE | `CONSTRAINT [PK_DatasetSecurityScope] PRIMARY KEY CLUSTERED ([DatasetId] ASC,[UserId] ASC,[ScopeKind] ASC)` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| UQ_DatasetSecurityScope_LastRequestId | UNIQUE | ACTIVE | `CONSTRAINT [UQ_DatasetSecurityScope_LastRequestId] UNIQUE NONCLUSTERED ([LastRequestId] ASC)` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CK_DatasetSecurityScope_Ids | CHECK | ACTIVE | `CONSTRAINT [CK_DatasetSecurityScope_Ids] CHECK (CASE WHEN (([DatasetId] IS NULL OR ([DatasetId]>(0))) AND ([UserId] IS NULL OR ([UserId]>(0))) AND ([BoundDataSourceId] IS NULL OR ([BoundDataSourceId]>(0))) AND ([ChangedByUserId] IS NULL OR ([ChangedByUserId]>(0))) AND ([ParentOwnerUserId] IS NULL OR ([ParentOwnerUserId]>(0)))) THEN (1) ELSE (0) END=(1))` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CK_DatasetSecurityScope_State | CHECK | ACTIVE | `CONSTRAINT [CK_DatasetSecurityScope_State] CHECK (CASE WHEN ((([State]=N'ACTIVE' AND DATALENGTH([State])=(12)) OR ([State]=N'REVOKED' AND DATALENGTH([State])=(14)))) THEN (1) ELSE (0) END=(1))` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| CK_DatasetSecurityScope_Parent | CHECK | ACTIVE | `CONSTRAINT [CK_DatasetSecurityScope_Parent] CHECK (CASE WHEN ((([ScopeKind]=N'OWNER' AND [ParentOwnerUserId] IS NULL AND [ParentOwnerKind] IS NULL) OR ([ScopeKind]=N'REVIEWER' AND [ParentOwnerUserId] IS NOT NULL AND [ParentOwnerKind] IS NOT NULL AND [ParentOwnerKind]=N'OWNER' AND [UserId]<>[ParentOwnerUserId])) AND ((([ScopeKind]=N'OWNER' AND DATALENGTH([ScopeKind])=(10)) OR ([ScopeKind]=N'REVIEWER' AND DATALENGTH([ScopeKind])=(16))) AND ([ParentOwnerKind] IS NULL OR ((([ParentOwnerKind]=N'OWNER' AND DATALENGTH([ParentOwnerKind])=(10))))))) THEN (1) ELSE (0) END=(1))` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| FK_DatasetSecurityScope_Dataset | FOREIGN KEY | ACTIVE | `CONSTRAINT [FK_DatasetSecurityScope_Dataset] FOREIGN KEY ([DatasetId]) REFERENCES [uqp].[Dataset] ([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| FK_DatasetSecurityScope_User | FOREIGN KEY | ACTIVE | `CONSTRAINT [FK_DatasetSecurityScope_User] FOREIGN KEY ([UserId]) REFERENCES [uqp].[AppUser] ([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| FK_DatasetSecurityScope_DataSource | FOREIGN KEY | ACTIVE | `CONSTRAINT [FK_DatasetSecurityScope_DataSource] FOREIGN KEY ([BoundDataSourceId]) REFERENCES [uqp].[DataSource] ([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| FK_DatasetSecurityScope_ParentOwner | FOREIGN KEY | ACTIVE | `CONSTRAINT [FK_DatasetSecurityScope_ParentOwner] FOREIGN KEY ([DatasetId],[ParentOwnerUserId],[ParentOwnerKind]) REFERENCES [uqp].[DatasetSecurityScope] ([DatasetId],[UserId],[ScopeKind]) ON DELETE NO ACTION ON UPDATE NO ACTION` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |

| Index | 狀態 | 鍵／INCLUDE／filter／來源 |
|---|---|---|
| IX_SecurityScope_User | UNKNOWN | `CREATE NONCLUSTERED INDEX [IX_SecurityScope_User] ON [uqp].[DatasetSecurityScope] ([UserId] ASC,[State] ASC,[DatasetId] ASC,[ScopeKind] ASC) INCLUDE ([BoundDataSourceId],[ParentOwnerUserId]);` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| IX_SecurityScope_Parent | UNKNOWN | `CREATE NONCLUSTERED INDEX [IX_SecurityScope_Parent] ON [uqp].[DatasetSecurityScope] ([DatasetId] ASC,[ParentOwnerUserId] ASC,[ParentOwnerKind] ASC,[State] ASC,[UserId] ASC);` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |
| IX_SecurityScope_Source | UNKNOWN | `CREATE NONCLUSTERED INDEX [IX_SecurityScope_Source] ON [uqp].[DatasetSecurityScope] ([BoundDataSourceId] ASC,[DatasetId] ASC,[UserId] ASC,[ScopeKind] ASC);` · [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) |

### uqp.DatasetSecurityScopeBinding

表級狀態：**ACTIVE**；建立來源：[database/drafts/924_dataset_security_scope_binding.sql](../database/drafts/924_dataset_security_scope_binding.sql)。

程式／SQL Repository 引用：[server/src/modules/dataset/datasetScopeManagement.repository.ts](../server/src/modules/dataset/datasetScopeManagement.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| DatasetId | BIGINT | NOT NULL | ACTIVE | `DatasetId BIGINT NOT NULL` · [database/drafts/924_dataset_security_scope_binding.sql](../database/drafts/924_dataset_security_scope_binding.sql) |
| UserId | BIGINT | NOT NULL | ACTIVE | `UserId BIGINT NOT NULL` · [database/drafts/924_dataset_security_scope_binding.sql](../database/drafts/924_dataset_security_scope_binding.sql) |
| ScopeKind | NVARCHAR(8) | NOT NULL | ACTIVE | `ScopeKind NVARCHAR(8) COLLATE Latin1_General_100_BIN2 NOT NULL` · [database/drafts/924_dataset_security_scope_binding.sql](../database/drafts/924_dataset_security_scope_binding.sql) |
| ScopeVersion | BINARY(8) | NOT NULL | ACTIVE | `ScopeVersion BINARY(8) NOT NULL` · [database/drafts/924_dataset_security_scope_binding.sql](../database/drafts/924_dataset_security_scope_binding.sql) |
| SubjectTokenVersion | INT | NOT NULL | ACTIVE | `SubjectTokenVersion INT NOT NULL` · [database/drafts/924_dataset_security_scope_binding.sql](../database/drafts/924_dataset_security_scope_binding.sql) |
| DefinitionVersion | BINARY(8) | NOT NULL | ACTIVE | `DefinitionVersion BINARY(8) NOT NULL` · [database/drafts/924_dataset_security_scope_binding.sql](../database/drafts/924_dataset_security_scope_binding.sql) |
| ConfigurationVersion | BINARY(8) | NOT NULL | ACTIVE | `ConfigurationVersion BINARY(8) NOT NULL` · [database/drafts/924_dataset_security_scope_binding.sql](../database/drafts/924_dataset_security_scope_binding.sql) |
| ParentScopeVersion | BINARY(8) | NULL | ACTIVE | `ParentScopeVersion BINARY(8) NULL` · [database/drafts/924_dataset_security_scope_binding.sql](../database/drafts/924_dataset_security_scope_binding.sql) |
| ParentTokenVersion | INT | NULL | ACTIVE | `ParentTokenVersion INT NULL` · [database/drafts/924_dataset_security_scope_binding.sql](../database/drafts/924_dataset_security_scope_binding.sql) |
| PlatformIncarnation | UNIQUEIDENTIFIER | NOT NULL | UNKNOWN | `PlatformIncarnation UNIQUEIDENTIFIER NOT NULL` · [database/drafts/924_dataset_security_scope_binding.sql](../database/drafts/924_dataset_security_scope_binding.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| PK_DatasetSecurityScopeBinding | PRIMARY KEY | ACTIVE | `CONSTRAINT PK_DatasetSecurityScopeBinding PRIMARY KEY CLUSTERED(DatasetId,UserId,ScopeKind)` · [database/drafts/924_dataset_security_scope_binding.sql](../database/drafts/924_dataset_security_scope_binding.sql) |
| FK_DatasetSecurityScopeBinding_Dataset | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_DatasetSecurityScopeBinding_Dataset FOREIGN KEY(DatasetId) REFERENCES uqp.Dataset(Id) ON DELETE NO ACTION ON UPDATE NO ACTION` · [database/drafts/924_dataset_security_scope_binding.sql](../database/drafts/924_dataset_security_scope_binding.sql) |
| FK_DatasetSecurityScopeBinding_User | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_DatasetSecurityScopeBinding_User FOREIGN KEY(UserId) REFERENCES uqp.AppUser(Id) ON DELETE NO ACTION ON UPDATE NO ACTION` · [database/drafts/924_dataset_security_scope_binding.sql](../database/drafts/924_dataset_security_scope_binding.sql) |
| CK_DatasetSecurityScopeBinding_Values | CHECK | ACTIVE | `CONSTRAINT CK_DatasetSecurityScopeBinding_Values CHECK(CASE WHEN DatasetId>0 AND UserId>0 AND SubjectTokenVersion>0 AND ScopeVersion<>0x0000000000000000 AND DefinitionVersion<>0x0000000000000000 AND ConfigurationVersion<>0x0000000000000000 AND ((ScopeKind=N'OWNER' AND DATALENGTH(ScopeKind)=10 AND ParentScopeVersion IS NULL AND ParentTokenVersion IS NULL) OR (ScopeKind=N'REVIEWER' AND DATALENGTH(ScopeKind)=16 AND ParentScopeVersion IS NOT NULL AND ParentScopeVersion<>0x0000000000000000 AND ParentTokenVersion IS NOT NULL AND ParentTokenVersion>0)) THEN 1 ELSE 0 END=1)` · [database/drafts/924_dataset_security_scope_binding.sql](../database/drafts/924_dataset_security_scope_binding.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.DatasetSensitiveColumn

表級狀態：**ACTIVE**；建立來源：[database/migrations/910_dataset_sensitive_columns.sql](../database/migrations/910_dataset_sensitive_columns.sql)。

程式／SQL Repository 引用：[server/src/modules/dashboard/dashboard.repository.ts](../server/src/modules/dashboard/dashboard.repository.ts)、[server/src/modules/dashboard/dashboardQueryMode.repository.ts](../server/src/modules/dashboard/dashboardQueryMode.repository.ts)、[server/src/modules/dashboard/dashboardApproval.repository.ts](../server/src/modules/dashboard/dashboardApproval.repository.ts)、[server/src/modules/dataset/column.repository.ts](../server/src/modules/dataset/column.repository.ts)、[server/src/modules/dataset/dataset.repository.ts](../server/src/modules/dataset/dataset.repository.ts)、[server/src/modules/dataset/datasetPublicDisplay.repository.ts](../server/src/modules/dataset/datasetPublicDisplay.repository.ts)、[server/src/modules/dataset/datasetSensitiveColumn.repository.ts](../server/src/modules/dataset/datasetSensitiveColumn.repository.ts)、[server/src/modules/dataset/datasetDeliveryPolicy.repository.ts](../server/src/modules/dataset/datasetDeliveryPolicy.repository.ts)、[server/src/modules/dataset/patientAuditContract.repository.ts](../server/src/modules/dataset/patientAuditContract.repository.ts)、[server/src/modules/version/version.repository.ts](../server/src/modules/version/version.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| DatasetId | BIGINT | NOT NULL | ACTIVE | `DatasetId BIGINT NOT NULL` · [database/migrations/910_dataset_sensitive_columns.sql](../database/migrations/910_dataset_sensitive_columns.sql) |
| ColumnName | NVARCHAR(256) | NOT NULL | ACTIVE | `ColumnName NVARCHAR(256) NOT NULL` · [database/migrations/910_dataset_sensitive_columns.sql](../database/migrations/910_dataset_sensitive_columns.sql) |
| SensitivityType | NVARCHAR(64) | NOT NULL | ACTIVE | `SensitivityType NVARCHAR(64) NOT NULL` · [database/migrations/910_dataset_sensitive_columns.sql](../database/migrations/910_dataset_sensitive_columns.sql) |
| DeviceMaskMode | VARCHAR(16) | NOT NULL | ACTIVE | `DeviceMaskMode VARCHAR(16) NOT NULL` · [database/migrations/910_dataset_sensitive_columns.sql](../database/migrations/910_dataset_sensitive_columns.sql) |
| UpdatedByUserId | BIGINT | NULL | UNKNOWN | `UpdatedByUserId BIGINT NULL` · [database/migrations/910_dataset_sensitive_columns.sql](../database/migrations/910_dataset_sensitive_columns.sql) |
| UpdatedAtUtc | DATETIME2(3) | NOT NULL | ACTIVE | `UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_DatasetSensitiveColumn_UpdatedAt DEFAULT SYSUTCDATETIME()` · [database/migrations/910_dataset_sensitive_columns.sql](../database/migrations/910_dataset_sensitive_columns.sql) |
| CustomMaskJson | NVARCHAR(256) | NULL | ACTIVE | `CustomMaskJson NVARCHAR(256) NULL` · [database/migrations/912_custom_device_mask.sql](../database/migrations/912_custom_device_mask.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| DF_DatasetSensitiveColumn_UpdatedAt | DEFAULT | ACTIVE | `UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_DatasetSensitiveColumn_UpdatedAt DEFAULT SYSUTCDATETIME()` · [database/migrations/910_dataset_sensitive_columns.sql](../database/migrations/910_dataset_sensitive_columns.sql) |
| PK_DatasetSensitiveColumn | PRIMARY KEY | ACTIVE | `CONSTRAINT PK_DatasetSensitiveColumn PRIMARY KEY (DatasetId, ColumnName)` · [database/migrations/910_dataset_sensitive_columns.sql](../database/migrations/910_dataset_sensitive_columns.sql) |
| FK_DatasetSensitiveColumn_Dataset | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_DatasetSensitiveColumn_Dataset FOREIGN KEY (DatasetId) REFERENCES uqp.Dataset(Id) ON DELETE CASCADE` · [database/migrations/910_dataset_sensitive_columns.sql](../database/migrations/910_dataset_sensitive_columns.sql) |
| CK_DatasetSensitiveColumn_SensitiveNotRaw | CHECK | ACTIVE | `CONSTRAINT CK_DatasetSensitiveColumn_SensitiveNotRaw CHECK (SensitivityType='OTHER' OR DeviceMaskMode <> 'NONE')` · [database/migrations/910_dataset_sensitive_columns.sql](../database/migrations/910_dataset_sensitive_columns.sql) |
| CK_DatasetSensitiveColumn_CustomMask | CHECK | ACTIVE | `CONSTRAINT CK_DatasetSensitiveColumn_CustomMask CHECK ( DeviceMaskMode <> 'CUSTOM' OR ( CustomMaskJson IS NOT NULL AND ISJSON(CustomMaskJson)=1 AND TRY_CONVERT(INT, JSON_VALUE(CASE WHEN ISJSON(CustomMaskJson)=1 THEN CustomMaskJson ELSE N'{}' END, '$.prefix')) IS NOT NULL AND TRY_CONVERT(INT, JSON_VALUE(CASE WHEN ISJSON(CustomMaskJson)=1 THEN CustomMaskJson ELSE N'{}' END, '$.prefix')) BETWEEN 0 AND 100 AND TRY_CONVERT(INT, JSON_VALUE(CASE WHEN ISJSON(CustomMaskJson)=1 THEN CustomMaskJson ELSE N'{}' END, '$.suffix')) IS NOT NULL AND TRY_CONVERT(INT, JSON_VALUE(CASE WHEN ISJSON(CustomMaskJson)=1 THEN CustomMaskJson ELSE N'{}' END, '$.suffix')) BETWEEN 0 AND 100 AND JSON_VALUE(CASE WHEN ISJSON(CustomMaskJson)=1 THEN CustomMaskJson ELSE N'{}' END, '$.symbol') IS NOT NULL AND LEN((JSON_VALUE(CASE WHEN ISJSON(CustomMaskJson)=1 THEN CustomMaskJson ELSE N'{}' END, '$.symbol') + N'x') COLLATE Latin1_General_100_CI_AS_SC)=2 AND DATALENGTH(JSON_VALUE(CASE WHEN ISJSON(CustomMaskJson)=1 THEN CustomMaskJson ELSE N'{}' END, '$.symbol')) BETWEEN 2 AND 4 AND CHARINDEX(NCHAR(10), JSON_VALUE(CASE WHEN ISJSON(CustomMaskJson)=1 THEN CustomMaskJson ELSE N'{}' END, '$.symbol'))=0 AND CHARINDEX(NCHAR(13), JSON_VALUE(CASE WHEN ISJSON(CustomMaskJson)=1 THEN CustomMaskJson ELSE N'{}' END, '$.symbol'))=0 AND CHARINDEX(NCHAR(9), JSON_VALUE(CASE WHEN ISJSON(CustomMaskJson)=1 THEN CustomMaskJson ELSE N'{}' END, '$.symbol'))=0 ) )` · [database/migrations/915_dashboard_security_reconciliation.sql](../database/migrations/915_dashboard_security_reconciliation.sql) |
| CK_DatasetSensitiveColumn_Mask | CHECK | ACTIVE | `CONSTRAINT CK_DatasetSensitiveColumn_Mask CHECK (DeviceMaskMode IN ('NONE','NAME','MRN','PHONE','GENERIC','FULL','OMIT','CUSTOM'))` · [database/migrations/912_custom_device_mask.sql](../database/migrations/912_custom_device_mask.sql) |

| Index | 狀態 | 鍵／INCLUDE／filter／來源 |
|---|---|---|
| IX_DatasetSensitiveColumn_Type | UNKNOWN | `CREATE INDEX IX_DatasetSensitiveColumn_Type ON uqp.DatasetSensitiveColumn(SensitivityType, DatasetId);` · [database/migrations/910_dataset_sensitive_columns.sql](../database/migrations/910_dataset_sensitive_columns.sql) |

### uqp.DatasetSensitivePolicyVersion

表級狀態：**ACTIVE**；建立來源：[database/migrations/910_dataset_sensitive_columns.sql](../database/migrations/910_dataset_sensitive_columns.sql)。

程式／SQL Repository 引用：[server/src/modules/dashboard/dashboard.repository.ts](../server/src/modules/dashboard/dashboard.repository.ts)、[server/src/modules/dashboard/dashboardQueryMode.repository.ts](../server/src/modules/dashboard/dashboardQueryMode.repository.ts)、[server/src/modules/dashboard/dashboardApproval.repository.ts](../server/src/modules/dashboard/dashboardApproval.repository.ts)、[server/src/modules/dataset/datasetPublicDisplay.repository.ts](../server/src/modules/dataset/datasetPublicDisplay.repository.ts)、[server/src/modules/dataset/datasetSensitiveColumn.repository.ts](../server/src/modules/dataset/datasetSensitiveColumn.repository.ts)、[server/src/modules/dataset/datasetDeliveryPolicy.repository.ts](../server/src/modules/dataset/datasetDeliveryPolicy.repository.ts)、[server/src/modules/dataset/datasetMaskTemplate.repository.ts](../server/src/modules/dataset/datasetMaskTemplate.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| DatasetId | BIGINT | NOT NULL | ACTIVE | `DatasetId BIGINT NOT NULL PRIMARY KEY` · [database/migrations/910_dataset_sensitive_columns.sql](../database/migrations/910_dataset_sensitive_columns.sql) |
| VersionNumber | BIGINT | NOT NULL | ACTIVE | `VersionNumber BIGINT NOT NULL CONSTRAINT DF_DatasetSensitivePolicyVersion_Number DEFAULT (0)` · [database/migrations/910_dataset_sensitive_columns.sql](../database/migrations/910_dataset_sensitive_columns.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| (unnamed PK: DatasetId) | PRIMARY KEY | ACTIVE | `DatasetId BIGINT NOT NULL PRIMARY KEY` · [database/migrations/910_dataset_sensitive_columns.sql](../database/migrations/910_dataset_sensitive_columns.sql) |
| DF_DatasetSensitivePolicyVersion_Number | DEFAULT | ACTIVE | `VersionNumber BIGINT NOT NULL CONSTRAINT DF_DatasetSensitivePolicyVersion_Number DEFAULT (0)` · [database/migrations/910_dataset_sensitive_columns.sql](../database/migrations/910_dataset_sensitive_columns.sql) |
| CK_DatasetSensitivePolicyVersion_Nonnegative | CHECK | ACTIVE | `CONSTRAINT CK_DatasetSensitivePolicyVersion_Nonnegative CHECK (VersionNumber >= 0)` · [database/migrations/910_dataset_sensitive_columns.sql](../database/migrations/910_dataset_sensitive_columns.sql) |
| FK_DatasetSensitivePolicyVersion_Dataset | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_DatasetSensitivePolicyVersion_Dataset FOREIGN KEY (DatasetId) REFERENCES uqp.Dataset(Id) ON DELETE CASCADE` · [database/migrations/910_dataset_sensitive_columns.sql](../database/migrations/910_dataset_sensitive_columns.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.DatasetVersion

表級狀態：**ACTIVE**；建立來源：[database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql)。

程式／SQL Repository 引用：[server/src/modules/version/version.repository.ts](../server/src/modules/version/version.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DatasetVersion PRIMARY KEY` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| DatasetId | BIGINT | NOT NULL | ACTIVE | `DatasetId BIGINT NOT NULL` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| VersionNo | INT | NOT NULL | ACTIVE | `VersionNo INT NOT NULL` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| SnapshotJson | NVARCHAR(MAX) | NOT NULL | UNKNOWN | `SnapshotJson NVARCHAR(MAX) NOT NULL` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| Reason | NVARCHAR(100) | NULL | UNKNOWN | `Reason NVARCHAR(100) NULL` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| CreatedByUserId | BIGINT | NULL | ACTIVE | `CreatedByUserId BIGINT NULL` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| CreatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_DatasetVersion_CreatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| IsPinned | BIT | NOT NULL | ACTIVE | `IsPinned BIT NOT NULL CONSTRAINT DF_DatasetVersion_IsPinned DEFAULT (0)` · [database/migrations/015_version_retention.sql](../database/migrations/015_version_retention.sql) |
| IsPublishedSnapshot | BIT | NOT NULL | ACTIVE | `IsPublishedSnapshot BIT NOT NULL CONSTRAINT DF_DatasetVersion_IsPublishedSnapshot DEFAULT (0)` · [database/migrations/015_version_retention.sql](../database/migrations/015_version_retention.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| PK_DatasetVersion | PRIMARY KEY | ACTIVE | `Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DatasetVersion PRIMARY KEY` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| DF_DatasetVersion_CreatedAt | DEFAULT | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_DatasetVersion_CreatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| FK_DatasetVersion_Dataset | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_DatasetVersion_Dataset FOREIGN KEY (DatasetId) REFERENCES uqp.Dataset(Id) ON DELETE CASCADE` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| FK_DatasetVersion_CreatedBy | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_DatasetVersion_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES uqp.AppUser(Id) ON DELETE SET NULL` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| UQ_DatasetVersion | UNIQUE | ACTIVE | `CONSTRAINT UQ_DatasetVersion UNIQUE (DatasetId, VersionNo)` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| DF_DatasetVersion_IsPinned | DEFAULT | ACTIVE | `IsPinned BIT NOT NULL CONSTRAINT DF_DatasetVersion_IsPinned DEFAULT (0)` · [database/migrations/015_version_retention.sql](../database/migrations/015_version_retention.sql) |
| DF_DatasetVersion_IsPublishedSnapshot | DEFAULT | ACTIVE | `IsPublishedSnapshot BIT NOT NULL CONSTRAINT DF_DatasetVersion_IsPublishedSnapshot DEFAULT (0)` · [database/migrations/015_version_retention.sql](../database/migrations/015_version_retention.sql) |

| Index | 狀態 | 鍵／INCLUDE／filter／來源 |
|---|---|---|
| IX_DatasetVersion_Dataset_Created | UNKNOWN | `CREATE INDEX IX_DatasetVersion_Dataset_Created ON uqp.DatasetVersion(DatasetId, CreatedAtUtc DESC);` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| IX_DatasetVersion_Retention | UNKNOWN | `CREATE INDEX IX_DatasetVersion_Retention ON uqp.DatasetVersion(DatasetId, VersionNo DESC, IsPinned, IsPublishedSnapshot, CreatedAtUtc);` · [database/migrations/015_version_retention.sql](../database/migrations/015_version_retention.sql) |

### uqp.PatientListDisclosure

表級狀態：**ACTIVE**；建立來源：[database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql)。

程式／SQL Repository 引用：[server/src/modules/admin/workstationManagement.repository.ts](../server/src/modules/admin/workstationManagement.repository.ts)、[server/src/modules/audit/patientDisclosure.repository.ts](../server/src/modules/audit/patientDisclosure.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY` · [database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql) |
| AuditLogId | BIGINT | NULL | UNKNOWN | `AuditLogId BIGINT NULL` · [database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql) |
| UserId | BIGINT | NULL | ACTIVE | `UserId BIGINT NULL` · [database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql) |
| WorkstationId | BIGINT | NULL | UNKNOWN | `WorkstationId BIGINT NULL` · [database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql) |
| SessionId | UNIQUEIDENTIFIER | NULL | UNKNOWN | `SessionId UNIQUEIDENTIFIER NULL` · [database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql) |
| QueryDefinitionId | BIGINT | NULL | UNKNOWN | `QueryDefinitionId BIGINT NULL` · [database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql) |
| DatasetId | BIGINT | NULL | UNKNOWN | `DatasetId BIGINT NULL` · [database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql) |
| DeliveryType | NVARCHAR(20) | NOT NULL | ACTIVE | `DeliveryType NVARCHAR(20) NOT NULL` · [database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql) |
| RowCount | INT | NOT NULL | ACTIVE | `[RowCount] INT NOT NULL` · [database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql) |
| PageNumber | INT | NULL | UNKNOWN | `PageNumber INT NULL` · [database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql) |
| Masked | BIT | NOT NULL | ACTIVE | `Masked BIT NOT NULL CONSTRAINT DF_PatientListDisclosure_Masked DEFAULT (0)` · [database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql) |
| DisclosedAtUtc | DATETIME2(3) | NOT NULL | ACTIVE | `DisclosedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_PatientListDisclosure_Time DEFAULT SYSUTCDATETIME()` · [database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql) |
| DashboardDeviceId | BIGINT | NULL | ACTIVE | `DashboardDeviceId BIGINT NULL` · [database/migrations/909_dashboard_device_disclosure.sql](../database/migrations/909_dashboard_device_disclosure.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| (unnamed PK: Id) | PRIMARY KEY | ACTIVE | `Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY` · [database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql) |
| DF_PatientListDisclosure_Masked | DEFAULT | ACTIVE | `Masked BIT NOT NULL CONSTRAINT DF_PatientListDisclosure_Masked DEFAULT (0)` · [database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql) |
| DF_PatientListDisclosure_Time | DEFAULT | ACTIVE | `DisclosedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_PatientListDisclosure_Time DEFAULT SYSUTCDATETIME()` · [database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql) |
| CK_PatientListDisclosure_Type | CHECK | ACTIVE | `CONSTRAINT CK_PatientListDisclosure_Type CHECK (DeliveryType IN ('MANUAL','PAGE','AUTO_REFRESH','DASHBOARD'))` · [database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql) |
| CK_PatientListDisclosure_Rows | CHECK | ACTIVE | `CONSTRAINT CK_PatientListDisclosure_Rows CHECK ([RowCount] BETWEEN 0 AND 10000)` · [database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql) |
| FK_PatientListDisclosure_DashboardDevice | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_PatientListDisclosure_DashboardDevice FOREIGN KEY (DashboardDeviceId) REFERENCES uqp.DashboardDisplayDevice(Id)` · [database/migrations/909_dashboard_device_disclosure.sql](../database/migrations/909_dashboard_device_disclosure.sql) |

| Index | 狀態 | 鍵／INCLUDE／filter／來源 |
|---|---|---|
| IX_PatientListDisclosure_UserTime | UNKNOWN | `CREATE INDEX IX_PatientListDisclosure_UserTime ON uqp.PatientListDisclosure(UserId, DisclosedAtUtc DESC);` · [database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql) |
| IX_PatientListDisclosure_DashboardDeviceId | UNKNOWN | `CREATE INDEX IX_PatientListDisclosure_DashboardDeviceId ON uqp.PatientListDisclosure(DashboardDeviceId) WHERE DashboardDeviceId IS NOT NULL;` · [database/migrations/909_dashboard_device_disclosure.sql](../database/migrations/909_dashboard_device_disclosure.sql) |

### uqp.PatientListDisclosureSubject

表級狀態：**ACTIVE**；建立來源：[database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql)。

程式／SQL Repository 引用：[server/src/modules/audit/patientDisclosure.repository.ts](../server/src/modules/audit/patientDisclosure.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| DisclosureId | BIGINT | NOT NULL | ACTIVE | `DisclosureId BIGINT NOT NULL` · [database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql) |
| PatientKeyHash | VARBINARY(32) | NOT NULL | ACTIVE | `PatientKeyHash VARBINARY(32) NOT NULL` · [database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql) |
| KeyVersion | INT | NOT NULL | ACTIVE | `KeyVersion INT NOT NULL CONSTRAINT DF_PatientListDisclosureSubject_KeyVersion DEFAULT (1)` · [database/migrations/908_patient_audit_hmac_key_version.sql](../database/migrations/908_patient_audit_hmac_key_version.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| FK_PatientListDisclosureSubject_Disclosure | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_PatientListDisclosureSubject_Disclosure FOREIGN KEY (DisclosureId) REFERENCES uqp.PatientListDisclosure(Id)` · [database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql) |
| DF_PatientListDisclosureSubject_KeyVersion | DEFAULT | ACTIVE | `KeyVersion INT NOT NULL CONSTRAINT DF_PatientListDisclosureSubject_KeyVersion DEFAULT (1)` · [database/migrations/908_patient_audit_hmac_key_version.sql](../database/migrations/908_patient_audit_hmac_key_version.sql) |
| PK_PatientListDisclosureSubject | PRIMARY KEY | ACTIVE | `CONSTRAINT PK_PatientListDisclosureSubject PRIMARY KEY (DisclosureId, KeyVersion, PatientKeyHash)` · [database/migrations/908_patient_audit_hmac_key_version.sql](../database/migrations/908_patient_audit_hmac_key_version.sql) |

| Index | 狀態 | 鍵／INCLUDE／filter／來源 |
|---|---|---|
| IX_PatientListDisclosureSubject_Patient | UNKNOWN | `CREATE INDEX IX_PatientListDisclosureSubject_Patient ON uqp.PatientListDisclosureSubject(PatientKeyHash, DisclosureId);` · [database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql) |
| IX_PatientListDisclosureSubject_PatientVersion | UNKNOWN | `CREATE INDEX IX_PatientListDisclosureSubject_PatientVersion ON uqp.PatientListDisclosureSubject(KeyVersion, PatientKeyHash, DisclosureId);` · [database/migrations/908_patient_audit_hmac_key_version.sql](../database/migrations/908_patient_audit_hmac_key_version.sql) |

### uqp.Permission

表級狀態：**ACTIVE**；建立來源：[database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql)。

程式／SQL Repository 引用：[server/src/modules/admin/admin.repository.ts](../server/src/modules/admin/admin.repository.ts)、[server/src/modules/admin/workstationManagement.repository.ts](../server/src/modules/admin/workstationManagement.repository.ts)、[server/src/modules/auth/auth.repository.ts](../server/src/modules/auth/auth.repository.ts)、[server/src/modules/dataset/datasetScopeManagement.repository.ts](../server/src/modules/dataset/datasetScopeManagement.repository.ts)、[server/src/modules/dataset/dataset923ScopeConfirmationGate.ts](../server/src/modules/dataset/dataset923ScopeConfirmationGate.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `Id BIGINT IDENTITY(1,1) PRIMARY KEY` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| Code | NVARCHAR(100) | NOT NULL | ACTIVE | `Code NVARCHAR(100) NOT NULL` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| Name | NVARCHAR(200) | NOT NULL | UNKNOWN | `Name NVARCHAR(200) NOT NULL` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| Description | NVARCHAR(500) | NULL | UNKNOWN | `Description NVARCHAR(500) NULL` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| (unnamed PK: Id) | PRIMARY KEY | ACTIVE | `Id BIGINT IDENTITY(1,1) PRIMARY KEY` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| UQ_Permission_Code | UNIQUE | ACTIVE | `CONSTRAINT UQ_Permission_Code UNIQUE (Code)` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.QueryCategory

表級狀態：**ACTIVE**；建立來源：[database/migrations/011_query_category.sql](../database/migrations/011_query_category.sql)。

程式／SQL Repository 引用：[server/src/modules/queryCategory/queryCategory.repository.ts](../server/src/modules/queryCategory/queryCategory.repository.ts)、[server/src/modules/queryDefinition/queryDefinition.repository.ts](../server/src/modules/queryDefinition/queryDefinition.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `Id BIGINT IDENTITY(1,1) PRIMARY KEY` · [database/migrations/011_query_category.sql](../database/migrations/011_query_category.sql) |
| Code | NVARCHAR(100) | NOT NULL | ACTIVE | `Code NVARCHAR(100) NOT NULL` · [database/migrations/011_query_category.sql](../database/migrations/011_query_category.sql) |
| Name | NVARCHAR(100) | NOT NULL | ACTIVE | `Name NVARCHAR(100) NOT NULL` · [database/migrations/011_query_category.sql](../database/migrations/011_query_category.sql) |
| SortOrder | INT | NOT NULL | ACTIVE | `SortOrder INT NOT NULL CONSTRAINT DF_QueryCategory_SortOrder DEFAULT (0)` · [database/migrations/011_query_category.sql](../database/migrations/011_query_category.sql) |
| IsActive | BIT | NOT NULL | ACTIVE | `IsActive BIT NOT NULL CONSTRAINT DF_QueryCategory_Active DEFAULT (1)` · [database/migrations/011_query_category.sql](../database/migrations/011_query_category.sql) |
| CreatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_QueryCategory_CreatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/011_query_category.sql](../database/migrations/011_query_category.sql) |
| UpdatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_QueryCategory_UpdatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/011_query_category.sql](../database/migrations/011_query_category.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| (unnamed PK: Id) | PRIMARY KEY | ACTIVE | `Id BIGINT IDENTITY(1,1) PRIMARY KEY` · [database/migrations/011_query_category.sql](../database/migrations/011_query_category.sql) |
| DF_QueryCategory_SortOrder | DEFAULT | ACTIVE | `SortOrder INT NOT NULL CONSTRAINT DF_QueryCategory_SortOrder DEFAULT (0)` · [database/migrations/011_query_category.sql](../database/migrations/011_query_category.sql) |
| DF_QueryCategory_Active | DEFAULT | ACTIVE | `IsActive BIT NOT NULL CONSTRAINT DF_QueryCategory_Active DEFAULT (1)` · [database/migrations/011_query_category.sql](../database/migrations/011_query_category.sql) |
| DF_QueryCategory_CreatedAt | DEFAULT | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_QueryCategory_CreatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/011_query_category.sql](../database/migrations/011_query_category.sql) |
| DF_QueryCategory_UpdatedAt | DEFAULT | ACTIVE | `UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_QueryCategory_UpdatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/011_query_category.sql](../database/migrations/011_query_category.sql) |
| UQ_QueryCategory_Code | UNIQUE | ACTIVE | `CONSTRAINT UQ_QueryCategory_Code UNIQUE (Code)` · [database/migrations/011_query_category.sql](../database/migrations/011_query_category.sql) |
| UQ_QueryCategory_Name | UNIQUE | ACTIVE | `CONSTRAINT UQ_QueryCategory_Name UNIQUE (Name)` · [database/migrations/011_query_category.sql](../database/migrations/011_query_category.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.QueryDefinition

表級狀態：**ACTIVE**；建立來源：[database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql)。

程式／SQL Repository 引用：[server/src/modules/admin/admin.repository.ts](../server/src/modules/admin/admin.repository.ts)、[server/src/modules/audit/audit.repository.ts](../server/src/modules/audit/audit.repository.ts)、[server/src/modules/dashboard/dashboard.repository.ts](../server/src/modules/dashboard/dashboard.repository.ts)、[server/src/modules/dashboard/dashboardQuerySources.repository.ts](../server/src/modules/dashboard/dashboardQuerySources.repository.ts)、[server/src/modules/dashboard/dashboardLegacyLocks.ts](../server/src/modules/dashboard/dashboardLegacyLocks.ts)、[server/src/modules/dataset/dataset.repository.ts](../server/src/modules/dataset/dataset.repository.ts)、[server/src/modules/dataset/parameter.repository.ts](../server/src/modules/dataset/parameter.repository.ts)、[server/src/modules/dataset/datasetPublicDisplay.repository.ts](../server/src/modules/dataset/datasetPublicDisplay.repository.ts)、[server/src/modules/dataset/datasetSensitiveColumn.repository.ts](../server/src/modules/dataset/datasetSensitiveColumn.repository.ts)、[server/src/modules/queryCategory/queryCategory.repository.ts](../server/src/modules/queryCategory/queryCategory.repository.ts)、[server/src/modules/queryDefinition/queryAccess.repository.ts](../server/src/modules/queryDefinition/queryAccess.repository.ts)、[server/src/modules/queryDefinition/queryDefinition.repository.ts](../server/src/modules/queryDefinition/queryDefinition.repository.ts)、[server/src/modules/queryDefinition/reportColumn.repository.ts](../server/src/modules/queryDefinition/reportColumn.repository.ts)、[server/src/modules/version/version.repository.ts](../server/src/modules/version/version.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `Id BIGINT IDENTITY(1,1) PRIMARY KEY` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| Code | NVARCHAR(100) | NOT NULL | ACTIVE | `Code NVARCHAR(100) NOT NULL` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| Name | NVARCHAR(200) | NOT NULL | UNKNOWN | `Name NVARCHAR(200) NOT NULL` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| Description | NVARCHAR(1000) | NULL | UNKNOWN | `Description NVARCHAR(1000) NULL` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| Category | NVARCHAR(100) | NULL | UNKNOWN | `Category NVARCHAR(100) NULL` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| Icon | NVARCHAR(100) | NOT NULL | ACTIVE | `Icon NVARCHAR(100) NOT NULL CONSTRAINT DF_QueryDefinition_Icon DEFAULT ('Table2')` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| DatasetId | BIGINT | NOT NULL | ACTIVE | `DatasetId BIGINT NOT NULL` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| SortOrder | INT | NOT NULL | ACTIVE | `SortOrder INT NOT NULL CONSTRAINT DF_QueryDefinition_SortOrder DEFAULT (0)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| AllowExcelExport | BIT | NOT NULL | ACTIVE | `AllowExcelExport BIT NOT NULL CONSTRAINT DF_QueryDefinition_Excel DEFAULT (1)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| IsPublished | BIT | NOT NULL | ACTIVE | `IsPublished BIT NOT NULL CONSTRAINT DF_QueryDefinition_Published DEFAULT (0)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| IsActive | BIT | NOT NULL | ACTIVE | `IsActive BIT NOT NULL CONSTRAINT DF_QueryDefinition_Active DEFAULT (1)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| PublishedAtUtc | DATETIME2(0) | NULL | UNKNOWN | `PublishedAtUtc DATETIME2(0) NULL` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| PublishedByUserId | BIGINT | NULL | ACTIVE | `PublishedByUserId BIGINT NULL` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| CreatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_QueryDefinition_CreatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| UpdatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_QueryDefinition_UpdatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| CategoryId | BIGINT | NULL | ACTIVE | `CategoryId BIGINT NULL` · [database/migrations/011_query_category.sql](../database/migrations/011_query_category.sql) |
| IsArchived | BIT | NOT NULL | ACTIVE | `IsArchived BIT NOT NULL CONSTRAINT DF_QueryDefinition_Archived DEFAULT (0)` · [database/migrations/012_query_archive.sql](../database/migrations/012_query_archive.sql) |
| ArchivedAtUtc | DATETIME2(0) | NULL | UNKNOWN | `ArchivedAtUtc DATETIME2(0) NULL` · [database/migrations/012_query_archive.sql](../database/migrations/012_query_archive.sql) |
| ArchivedByUserId | BIGINT | NULL | ACTIVE | `ArchivedByUserId BIGINT NULL` · [database/migrations/012_query_archive.sql](../database/migrations/012_query_archive.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| (unnamed PK: Id) | PRIMARY KEY | ACTIVE | `Id BIGINT IDENTITY(1,1) PRIMARY KEY` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| DF_QueryDefinition_Icon | DEFAULT | ACTIVE | `Icon NVARCHAR(100) NOT NULL CONSTRAINT DF_QueryDefinition_Icon DEFAULT ('Table2')` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| DF_QueryDefinition_SortOrder | DEFAULT | ACTIVE | `SortOrder INT NOT NULL CONSTRAINT DF_QueryDefinition_SortOrder DEFAULT (0)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| DF_QueryDefinition_Excel | DEFAULT | ACTIVE | `AllowExcelExport BIT NOT NULL CONSTRAINT DF_QueryDefinition_Excel DEFAULT (1)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| DF_QueryDefinition_Published | DEFAULT | ACTIVE | `IsPublished BIT NOT NULL CONSTRAINT DF_QueryDefinition_Published DEFAULT (0)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| DF_QueryDefinition_Active | DEFAULT | ACTIVE | `IsActive BIT NOT NULL CONSTRAINT DF_QueryDefinition_Active DEFAULT (1)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| DF_QueryDefinition_CreatedAt | DEFAULT | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_QueryDefinition_CreatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| DF_QueryDefinition_UpdatedAt | DEFAULT | ACTIVE | `UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_QueryDefinition_UpdatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| UQ_QueryDefinition_Code | UNIQUE | ACTIVE | `CONSTRAINT UQ_QueryDefinition_Code UNIQUE (Code)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| FK_QueryDefinition_Dataset | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_QueryDefinition_Dataset FOREIGN KEY (DatasetId) REFERENCES uqp.Dataset(Id)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| FK_QueryDefinition_PublishedBy | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_QueryDefinition_PublishedBy FOREIGN KEY (PublishedByUserId) REFERENCES uqp.AppUser(Id)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| FK_QueryDefinition_Category | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_QueryDefinition_Category FOREIGN KEY (CategoryId) REFERENCES uqp.QueryCategory(Id)` · [database/migrations/011_query_category.sql](../database/migrations/011_query_category.sql) |
| DF_QueryDefinition_Archived | DEFAULT | ACTIVE | `IsArchived BIT NOT NULL CONSTRAINT DF_QueryDefinition_Archived DEFAULT (0)` · [database/migrations/012_query_archive.sql](../database/migrations/012_query_archive.sql) |
| FK_QueryDefinition_ArchivedBy | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_QueryDefinition_ArchivedBy FOREIGN KEY (ArchivedByUserId) REFERENCES uqp.AppUser(Id) ON DELETE SET NULL` · [database/migrations/012_query_archive.sql](../database/migrations/012_query_archive.sql) |

| Index | 狀態 | 鍵／INCLUDE／filter／來源 |
|---|---|---|
| IX_QueryDefinition_CategoryId | UNKNOWN | `CREATE INDEX IX_QueryDefinition_CategoryId ON uqp.QueryDefinition(CategoryId);` · [database/migrations/011_query_category.sql](../database/migrations/011_query_category.sql) |
| IX_QueryDefinition_IsArchived | UNKNOWN | `CREATE INDEX IX_QueryDefinition_IsArchived ON uqp.QueryDefinition(IsArchived, IsPublished, IsActive);` · [database/migrations/012_query_archive.sql](../database/migrations/012_query_archive.sql) |

### uqp.QueryDefinitionVersion

表級狀態：**ACTIVE**；建立來源：[database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql)。

程式／SQL Repository 引用：[server/src/modules/version/version.repository.ts](../server/src/modules/version/version.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_QueryDefinitionVersion PRIMARY KEY` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| QueryDefinitionId | BIGINT | NOT NULL | ACTIVE | `QueryDefinitionId BIGINT NOT NULL` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| VersionNo | INT | NOT NULL | ACTIVE | `VersionNo INT NOT NULL` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| SnapshotJson | NVARCHAR(MAX) | NOT NULL | UNKNOWN | `SnapshotJson NVARCHAR(MAX) NOT NULL` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| Reason | NVARCHAR(100) | NULL | UNKNOWN | `Reason NVARCHAR(100) NULL` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| CreatedByUserId | BIGINT | NULL | ACTIVE | `CreatedByUserId BIGINT NULL` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| CreatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_QueryDefinitionVersion_CreatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| IsPinned | BIT | NOT NULL | ACTIVE | `IsPinned BIT NOT NULL CONSTRAINT DF_QueryDefinitionVersion_IsPinned DEFAULT (0)` · [database/migrations/015_version_retention.sql](../database/migrations/015_version_retention.sql) |
| IsPublishedSnapshot | BIT | NOT NULL | ACTIVE | `IsPublishedSnapshot BIT NOT NULL CONSTRAINT DF_QueryDefinitionVersion_IsPublishedSnapshot DEFAULT (0)` · [database/migrations/015_version_retention.sql](../database/migrations/015_version_retention.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| PK_QueryDefinitionVersion | PRIMARY KEY | ACTIVE | `Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_QueryDefinitionVersion PRIMARY KEY` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| DF_QueryDefinitionVersion_CreatedAt | DEFAULT | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_QueryDefinitionVersion_CreatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| FK_QueryDefinitionVersion_Query | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_QueryDefinitionVersion_Query FOREIGN KEY (QueryDefinitionId) REFERENCES uqp.QueryDefinition(Id) ON DELETE CASCADE` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| FK_QueryDefinitionVersion_CreatedBy | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_QueryDefinitionVersion_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES uqp.AppUser(Id) ON DELETE SET NULL` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| UQ_QueryDefinitionVersion | UNIQUE | ACTIVE | `CONSTRAINT UQ_QueryDefinitionVersion UNIQUE (QueryDefinitionId, VersionNo)` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| DF_QueryDefinitionVersion_IsPinned | DEFAULT | ACTIVE | `IsPinned BIT NOT NULL CONSTRAINT DF_QueryDefinitionVersion_IsPinned DEFAULT (0)` · [database/migrations/015_version_retention.sql](../database/migrations/015_version_retention.sql) |
| DF_QueryDefinitionVersion_IsPublishedSnapshot | DEFAULT | ACTIVE | `IsPublishedSnapshot BIT NOT NULL CONSTRAINT DF_QueryDefinitionVersion_IsPublishedSnapshot DEFAULT (0)` · [database/migrations/015_version_retention.sql](../database/migrations/015_version_retention.sql) |

| Index | 狀態 | 鍵／INCLUDE／filter／來源 |
|---|---|---|
| IX_QueryDefinitionVersion_Query_Created | UNKNOWN | `CREATE INDEX IX_QueryDefinitionVersion_Query_Created ON uqp.QueryDefinitionVersion(QueryDefinitionId, CreatedAtUtc DESC);` · [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) |
| IX_QueryDefinitionVersion_Retention | UNKNOWN | `CREATE INDEX IX_QueryDefinitionVersion_Retention ON uqp.QueryDefinitionVersion(QueryDefinitionId, VersionNo DESC, IsPinned, IsPublishedSnapshot, CreatedAtUtc);` · [database/migrations/015_version_retention.sql](../database/migrations/015_version_retention.sql) |

### uqp.QuickPinPolicy

表級狀態：**ACTIVE**；建立來源：[database/migrations/903_quick_pin_policy.sql](../database/migrations/903_quick_pin_policy.sql)。

程式／SQL Repository 引用：[server/src/modules/admin/quickPinPolicy.repository.ts](../server/src/modules/admin/quickPinPolicy.repository.ts)、[server/src/modules/auth/quickPin.service.ts](../server/src/modules/auth/quickPin.service.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | INT | NOT NULL | ACTIVE | `Id INT NOT NULL CONSTRAINT PK_QuickPinPolicy PRIMARY KEY CONSTRAINT CK_QuickPinPolicy_Singleton CHECK (Id=1)` · [database/migrations/903_quick_pin_policy.sql](../database/migrations/903_quick_pin_policy.sql) |
| PinLength | INT | NOT NULL | ACTIVE | `PinLength INT NOT NULL CONSTRAINT DF_QuickPinPolicy_PinLength DEFAULT (6) CONSTRAINT CK_QuickPinPolicy_PinLength CHECK (PinLength BETWEEN 4 AND 12)` · [database/migrations/903_quick_pin_policy.sql](../database/migrations/903_quick_pin_policy.sql) |
| UpdatedAtUtc | DATETIME2(3) | NOT NULL | ACTIVE | `UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_QuickPinPolicy_UpdatedAt DEFAULT SYSUTCDATETIME()` · [database/migrations/903_quick_pin_policy.sql](../database/migrations/903_quick_pin_policy.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| PK_QuickPinPolicy | PRIMARY KEY | ACTIVE | `Id INT NOT NULL CONSTRAINT PK_QuickPinPolicy PRIMARY KEY CONSTRAINT CK_QuickPinPolicy_Singleton CHECK (Id=1)` · [database/migrations/903_quick_pin_policy.sql](../database/migrations/903_quick_pin_policy.sql) |
| CK_QuickPinPolicy_Singleton | CHECK | ACTIVE | `Id INT NOT NULL CONSTRAINT PK_QuickPinPolicy PRIMARY KEY CONSTRAINT CK_QuickPinPolicy_Singleton CHECK (Id=1)` · [database/migrations/903_quick_pin_policy.sql](../database/migrations/903_quick_pin_policy.sql) |
| DF_QuickPinPolicy_PinLength | DEFAULT | ACTIVE | `PinLength INT NOT NULL CONSTRAINT DF_QuickPinPolicy_PinLength DEFAULT (6) CONSTRAINT CK_QuickPinPolicy_PinLength CHECK (PinLength BETWEEN 4 AND 12)` · [database/migrations/903_quick_pin_policy.sql](../database/migrations/903_quick_pin_policy.sql) |
| CK_QuickPinPolicy_PinLength | CHECK | ACTIVE | `PinLength INT NOT NULL CONSTRAINT DF_QuickPinPolicy_PinLength DEFAULT (6) CONSTRAINT CK_QuickPinPolicy_PinLength CHECK (PinLength BETWEEN 4 AND 12)` · [database/migrations/903_quick_pin_policy.sql](../database/migrations/903_quick_pin_policy.sql) |
| DF_QuickPinPolicy_UpdatedAt | DEFAULT | ACTIVE | `UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_QuickPinPolicy_UpdatedAt DEFAULT SYSUTCDATETIME()` · [database/migrations/903_quick_pin_policy.sql](../database/migrations/903_quick_pin_policy.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.ReportColumn

表級狀態：**ACTIVE**；建立來源：[database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql)。

程式／SQL Repository 引用：[server/src/modules/queryDefinition/reportColumn.repository.ts](../server/src/modules/queryDefinition/reportColumn.repository.ts)、[server/src/modules/version/version.repository.ts](../server/src/modules/version/version.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| QueryDefinitionId | BIGINT | NOT NULL | ACTIVE | `QueryDefinitionId BIGINT NOT NULL` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |
| ColumnName | NVARCHAR(256) | NOT NULL | ACTIVE | `ColumnName NVARCHAR(256) NOT NULL` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |
| DisplayLabel | NVARCHAR(256) | NOT NULL | UNKNOWN | `DisplayLabel NVARCHAR(256) NOT NULL` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |
| DisplayOrder | INT | NOT NULL | UNKNOWN | `DisplayOrder INT NOT NULL` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |
| IsVisible | BIT | NOT NULL | ACTIVE | `IsVisible BIT NOT NULL CONSTRAINT DF_ReportColumn_Visible DEFAULT (1)` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |
| Width | INT | NULL | ACTIVE | `Width INT NULL` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |
| DisplayFormat | NVARCHAR(100) | NULL | UNKNOWN | `DisplayFormat NVARCHAR(100) NULL` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |
| Alignment | NVARCHAR(10) | NOT NULL | ACTIVE | `Alignment NVARCHAR(10) NOT NULL CONSTRAINT DF_ReportColumn_Alignment DEFAULT ('LEFT')` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |
| GroupOrder | INT | NULL | UNKNOWN | `GroupOrder INT NULL` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |
| AggregateType | NVARCHAR(10) | NOT NULL | ACTIVE | `AggregateType NVARCHAR(10) NOT NULL CONSTRAINT DF_ReportColumn_Aggregate DEFAULT ('NONE')` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| DF_ReportColumn_Visible | DEFAULT | ACTIVE | `IsVisible BIT NOT NULL CONSTRAINT DF_ReportColumn_Visible DEFAULT (1)` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |
| DF_ReportColumn_Alignment | DEFAULT | ACTIVE | `Alignment NVARCHAR(10) NOT NULL CONSTRAINT DF_ReportColumn_Alignment DEFAULT ('LEFT')` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |
| DF_ReportColumn_Aggregate | DEFAULT | ACTIVE | `AggregateType NVARCHAR(10) NOT NULL CONSTRAINT DF_ReportColumn_Aggregate DEFAULT ('NONE')` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |
| PK_ReportColumn | PRIMARY KEY | ACTIVE | `CONSTRAINT PK_ReportColumn PRIMARY KEY (QueryDefinitionId, ColumnName)` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |
| FK_ReportColumn_Query | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_ReportColumn_Query FOREIGN KEY (QueryDefinitionId) REFERENCES uqp.QueryDefinition(Id) ON DELETE CASCADE` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |
| CK_ReportColumn_Alignment | CHECK | ACTIVE | `CONSTRAINT CK_ReportColumn_Alignment CHECK (Alignment IN ('LEFT','CENTER','RIGHT'))` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |
| CK_ReportColumn_Aggregate | CHECK | ACTIVE | `CONSTRAINT CK_ReportColumn_Aggregate CHECK (AggregateType IN ('NONE','SUM','AVG','MIN','MAX','COUNT'))` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |
| CK_ReportColumn_Width | CHECK | ACTIVE | `CONSTRAINT CK_ReportColumn_Width CHECK (Width IS NULL OR Width BETWEEN 40 AND 1000)` · [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.Role

表級狀態：**ACTIVE**；建立來源：[database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql)。

程式／SQL Repository 引用：[server/src/modules/admin/admin.repository.ts](../server/src/modules/admin/admin.repository.ts)、[server/src/modules/admin/workstationManagement.repository.ts](../server/src/modules/admin/workstationManagement.repository.ts)、[server/src/modules/auth/auth.repository.ts](../server/src/modules/auth/auth.repository.ts)、[server/src/modules/dashboard/dashboard.repository.ts](../server/src/modules/dashboard/dashboard.repository.ts)、[server/src/modules/dataset/datasetScopeManagement.repository.ts](../server/src/modules/dataset/datasetScopeManagement.repository.ts)、[server/src/modules/dataset/dataset923ScopeConfirmationGate.ts](../server/src/modules/dataset/dataset923ScopeConfirmationGate.ts)、[server/src/modules/queryDefinition/queryAccess.repository.ts](../server/src/modules/queryDefinition/queryAccess.repository.ts)、[server/src/modules/queryDefinition/queryDefinition.repository.ts](../server/src/modules/queryDefinition/queryDefinition.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `Id BIGINT IDENTITY(1,1) PRIMARY KEY` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| Code | NVARCHAR(100) | NOT NULL | ACTIVE | `Code NVARCHAR(100) NOT NULL` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| Name | NVARCHAR(200) | NOT NULL | UNKNOWN | `Name NVARCHAR(200) NOT NULL` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| Description | NVARCHAR(500) | NULL | UNKNOWN | `Description NVARCHAR(500) NULL` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| IsSystem | BIT | NOT NULL | ACTIVE | `IsSystem BIT NOT NULL CONSTRAINT DF_Role_IsSystem DEFAULT (0)` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| IsActive | BIT | NOT NULL | ACTIVE | `IsActive BIT NOT NULL CONSTRAINT DF_Role_IsActive DEFAULT (1)` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| CreatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_Role_CreatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| (unnamed PK: Id) | PRIMARY KEY | ACTIVE | `Id BIGINT IDENTITY(1,1) PRIMARY KEY` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| DF_Role_IsSystem | DEFAULT | ACTIVE | `IsSystem BIT NOT NULL CONSTRAINT DF_Role_IsSystem DEFAULT (0)` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| DF_Role_IsActive | DEFAULT | ACTIVE | `IsActive BIT NOT NULL CONSTRAINT DF_Role_IsActive DEFAULT (1)` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| DF_Role_CreatedAt | DEFAULT | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_Role_CreatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| UQ_Role_Code | UNIQUE | ACTIVE | `CONSTRAINT UQ_Role_Code UNIQUE (Code)` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.RolePermission

表級狀態：**ACTIVE**；建立來源：[database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql)。

程式／SQL Repository 引用：[server/src/modules/admin/admin.repository.ts](../server/src/modules/admin/admin.repository.ts)、[server/src/modules/admin/workstationManagement.repository.ts](../server/src/modules/admin/workstationManagement.repository.ts)、[server/src/modules/auth/auth.repository.ts](../server/src/modules/auth/auth.repository.ts)、[server/src/modules/dataset/datasetScopeManagement.repository.ts](../server/src/modules/dataset/datasetScopeManagement.repository.ts)、[server/src/modules/dataset/dataset923ScopeConfirmationGate.ts](../server/src/modules/dataset/dataset923ScopeConfirmationGate.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| RoleId | BIGINT | NOT NULL | ACTIVE | `RoleId BIGINT NOT NULL` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| PermissionId | BIGINT | NOT NULL | ACTIVE | `PermissionId BIGINT NOT NULL` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| CreatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_RolePermission_CreatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| DF_RolePermission_CreatedAt | DEFAULT | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_RolePermission_CreatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| PK_RolePermission | PRIMARY KEY | ACTIVE | `CONSTRAINT PK_RolePermission PRIMARY KEY (RoleId, PermissionId)` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| FK_RolePermission_Role | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_RolePermission_Role FOREIGN KEY (RoleId) REFERENCES uqp.Role(Id)` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| FK_RolePermission_Permission | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_RolePermission_Permission FOREIGN KEY (PermissionId) REFERENCES uqp.Permission(Id)` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.RoleQueryAccess

表級狀態：**ACTIVE**；建立來源：[database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql)。

程式／SQL Repository 引用：[server/src/modules/dashboard/dashboard.repository.ts](../server/src/modules/dashboard/dashboard.repository.ts)、[server/src/modules/queryDefinition/queryAccess.repository.ts](../server/src/modules/queryDefinition/queryAccess.repository.ts)、[server/src/modules/queryDefinition/queryDefinition.repository.ts](../server/src/modules/queryDefinition/queryDefinition.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| RoleId | BIGINT | NOT NULL | ACTIVE | `RoleId BIGINT NOT NULL` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| QueryDefinitionId | BIGINT | NOT NULL | ACTIVE | `QueryDefinitionId BIGINT NOT NULL` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| CanView | BIT | NOT NULL | ACTIVE | `CanView BIT NOT NULL CONSTRAINT DF_RoleQueryAccess_View DEFAULT (1)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| CanExecute | BIT | NOT NULL | ACTIVE | `CanExecute BIT NOT NULL CONSTRAINT DF_RoleQueryAccess_Execute DEFAULT (1)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| CanExport | BIT | NOT NULL | ACTIVE | `CanExport BIT NOT NULL CONSTRAINT DF_RoleQueryAccess_Export DEFAULT (0)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| DF_RoleQueryAccess_View | DEFAULT | ACTIVE | `CanView BIT NOT NULL CONSTRAINT DF_RoleQueryAccess_View DEFAULT (1)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| DF_RoleQueryAccess_Execute | DEFAULT | ACTIVE | `CanExecute BIT NOT NULL CONSTRAINT DF_RoleQueryAccess_Execute DEFAULT (1)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| DF_RoleQueryAccess_Export | DEFAULT | ACTIVE | `CanExport BIT NOT NULL CONSTRAINT DF_RoleQueryAccess_Export DEFAULT (0)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| PK_RoleQueryAccess | PRIMARY KEY | ACTIVE | `CONSTRAINT PK_RoleQueryAccess PRIMARY KEY (RoleId, QueryDefinitionId)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| FK_RoleQueryAccess_Role | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_RoleQueryAccess_Role FOREIGN KEY (RoleId) REFERENCES uqp.Role(Id) ON DELETE CASCADE` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| FK_RoleQueryAccess_Query | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_RoleQueryAccess_Query FOREIGN KEY (QueryDefinitionId) REFERENCES uqp.QueryDefinition(Id) ON DELETE CASCADE` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.SchemaMigration

表級狀態：**ACTIVE**；建立來源：[server/src/scripts/migrate.ts](../server/src/scripts/migrate.ts)。

程式／SQL Repository 引用：runner 的 Ledger 建立／比較／記錄。

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| FileName | NVARCHAR(255) | NOT NULL | ACTIVE | `FileName NVARCHAR(255) NOT NULL PRIMARY KEY` · [server/src/scripts/migrate.ts](../server/src/scripts/migrate.ts) |
| AppliedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `AppliedAtUtc DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()` · [server/src/scripts/migrate.ts](../server/src/scripts/migrate.ts) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| (unnamed PK: FileName) | PRIMARY KEY | ACTIVE | `FileName NVARCHAR(255) NOT NULL PRIMARY KEY` · [server/src/scripts/migrate.ts](../server/src/scripts/migrate.ts) |
| (unnamed DEFAULT: AppliedAtUtc) | DEFAULT | ACTIVE | `AppliedAtUtc DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()` · [server/src/scripts/migrate.ts](../server/src/scripts/migrate.ts) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.SharedWorkstation

表級狀態：**ACTIVE**；建立來源：[database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql)。

程式／SQL Repository 引用：[server/src/modules/admin/sharedWorkstation.repository.ts](../server/src/modules/admin/sharedWorkstation.repository.ts)、[server/src/modules/admin/workstationCredential.repository.ts](../server/src/modules/admin/workstationCredential.repository.ts)、[server/src/modules/admin/workstationManagement.repository.ts](../server/src/modules/admin/workstationManagement.repository.ts)、[server/src/modules/auth/workstationCredential.service.ts](../server/src/modules/auth/workstationCredential.service.ts)、[server/src/modules/dashboard/dashboardDevice.repository.ts](../server/src/modules/dashboard/dashboardDevice.repository.ts)、[server/src/modules/dashboard/dashboardQueryMode.repository.ts](../server/src/modules/dashboard/dashboardQueryMode.repository.ts)、[server/src/modules/dashboard/dashboardDeviceManagement.repository.ts](../server/src/modules/dashboard/dashboardDeviceManagement.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| WorkstationCode | NVARCHAR(100) | NOT NULL | UNKNOWN | `WorkstationCode NVARCHAR(100) NOT NULL UNIQUE` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| DisplayName | NVARCHAR(200) | NOT NULL | UNKNOWN | `DisplayName NVARCHAR(200) NOT NULL` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| IsActive | BIT | NOT NULL | ACTIVE | `IsActive BIT NOT NULL CONSTRAINT DF_SharedWorkstation_Active DEFAULT 0` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| PinLoginEnabled | BIT | NOT NULL | ACTIVE | `PinLoginEnabled BIT NOT NULL CONSTRAINT DF_SharedWorkstation_PinEnabled DEFAULT 0` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| CredentialVersion | INT | NOT NULL | ACTIVE | `CredentialVersion INT NOT NULL CONSTRAINT DF_SharedWorkstation_Version DEFAULT 1` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| CreatedAtUtc | DATETIME2(3) | NOT NULL | ACTIVE | `CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_SharedWorkstation_Created DEFAULT SYSUTCDATETIME()` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| UpdatedAtUtc | DATETIME2(3) | NOT NULL | ACTIVE | `UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_SharedWorkstation_Updated DEFAULT SYSUTCDATETIME()` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| PlatformCode | NVARCHAR(20) | NOT NULL | ACTIVE | `PlatformCode NVARCHAR(20) NOT NULL CONSTRAINT DF_SharedWorkstation_Platform DEFAULT ('UNKNOWN')` · [database/migrations/905_workstation_platform.sql](../database/migrations/905_workstation_platform.sql) |
| PurposeCode | NVARCHAR(30) | NOT NULL | ACTIVE | `PurposeCode NVARCHAR(30) NOT NULL CONSTRAINT DF_Workstation_Purpose DEFAULT 'SHARED_QUERY'` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |
| SortOrder | INT | NOT NULL | ACTIVE | `SortOrder INT NOT NULL CONSTRAINT DF_Workstation_Sort DEFAULT 0` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |
| RetiredAtUtc | DATETIME2(3) | NULL | ACTIVE | `RetiredAtUtc DATETIME2(3) NULL` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |
| LastUsedAtUtc | DATETIME2(3) | NULL | UNKNOWN | `LastUsedAtUtc DATETIME2(3) NULL` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| (unnamed PK: Id) | PRIMARY KEY | ACTIVE | `Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| DF_SharedWorkstation_Active | DEFAULT | ACTIVE | `IsActive BIT NOT NULL CONSTRAINT DF_SharedWorkstation_Active DEFAULT 0` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| DF_SharedWorkstation_PinEnabled | DEFAULT | ACTIVE | `PinLoginEnabled BIT NOT NULL CONSTRAINT DF_SharedWorkstation_PinEnabled DEFAULT 0` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| DF_SharedWorkstation_Version | DEFAULT | ACTIVE | `CredentialVersion INT NOT NULL CONSTRAINT DF_SharedWorkstation_Version DEFAULT 1` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| DF_SharedWorkstation_Created | DEFAULT | ACTIVE | `CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_SharedWorkstation_Created DEFAULT SYSUTCDATETIME()` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| DF_SharedWorkstation_Updated | DEFAULT | ACTIVE | `UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_SharedWorkstation_Updated DEFAULT SYSUTCDATETIME()` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| DF_SharedWorkstation_Platform | DEFAULT | ACTIVE | `PlatformCode NVARCHAR(20) NOT NULL CONSTRAINT DF_SharedWorkstation_Platform DEFAULT ('UNKNOWN')` · [database/migrations/905_workstation_platform.sql](../database/migrations/905_workstation_platform.sql) |
| CK_SharedWorkstation_Platform | CHECK | ACTIVE | `CONSTRAINT CK_SharedWorkstation_Platform CHECK (PlatformCode IN ('WINDOWS','ANDROID','IOS','UNKNOWN'))` · [database/migrations/905_workstation_platform.sql](../database/migrations/905_workstation_platform.sql) |
| DF_Workstation_Purpose | DEFAULT | ACTIVE | `PurposeCode NVARCHAR(30) NOT NULL CONSTRAINT DF_Workstation_Purpose DEFAULT 'SHARED_QUERY'` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |
| DF_Workstation_Sort | DEFAULT | ACTIVE | `SortOrder INT NOT NULL CONSTRAINT DF_Workstation_Sort DEFAULT 0` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |
| CK_Workstation_Purpose | CHECK | ACTIVE | `CONSTRAINT CK_Workstation_Purpose CHECK (PurposeCode IN ('SHARED_QUERY','DASHBOARD'))` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |
| CK_Workstation_Sort | CHECK | ACTIVE | `CONSTRAINT CK_Workstation_Sort CHECK (SortOrder BETWEEN 0 AND 10000)` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |
| CK_Workstation_Retired | CHECK | ACTIVE | `CONSTRAINT CK_Workstation_Retired CHECK (RetiredAtUtc IS NULL OR (IsActive=0 AND PinLoginEnabled=0))` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.SharedWorkstationAudience

表級狀態：**ACTIVE**；建立來源：[database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql)。

程式／SQL Repository 引用：[server/src/modules/admin/workstationManagement.repository.ts](../server/src/modules/admin/workstationManagement.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| WorkstationId | BIGINT | NOT NULL | ACTIVE | `WorkstationId BIGINT NOT NULL REFERENCES uqp.SharedWorkstation(Id)` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |
| AudienceId | BIGINT | NOT NULL | ACTIVE | `AudienceId BIGINT NOT NULL REFERENCES uqp.WorkstationAudience(Id)` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| PK_SharedWorkstationAudience | PRIMARY KEY | ACTIVE | `CONSTRAINT PK_SharedWorkstationAudience PRIMARY KEY (WorkstationId,AudienceId)` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.SharedWorkstationCredential

表級狀態：**ACTIVE**；建立來源：[database/migrations/904_workstation_device_credentials.sql](../database/migrations/904_workstation_device_credentials.sql)。

程式／SQL Repository 引用：[server/src/modules/admin/workstationCredential.repository.ts](../server/src/modules/admin/workstationCredential.repository.ts)、[server/src/modules/admin/workstationManagement.repository.ts](../server/src/modules/admin/workstationManagement.repository.ts)、[server/src/modules/auth/workstationCredential.service.ts](../server/src/modules/auth/workstationCredential.service.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | UNIQUEIDENTIFIER | NOT NULL | ACTIVE | `Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_SharedWorkstationCredential PRIMARY KEY` · [database/migrations/904_workstation_device_credentials.sql](../database/migrations/904_workstation_device_credentials.sql) |
| WorkstationId | BIGINT | NOT NULL | ACTIVE | `WorkstationId BIGINT NOT NULL` · [database/migrations/904_workstation_device_credentials.sql](../database/migrations/904_workstation_device_credentials.sql) |
| SecretHash | VARBINARY(32) | NOT NULL | UNKNOWN | `SecretHash VARBINARY(32) NOT NULL` · [database/migrations/904_workstation_device_credentials.sql](../database/migrations/904_workstation_device_credentials.sql) |
| CredentialVersion | INT | NOT NULL | UNKNOWN | `CredentialVersion INT NOT NULL` · [database/migrations/904_workstation_device_credentials.sql](../database/migrations/904_workstation_device_credentials.sql) |
| IsRevoked | BIT | NOT NULL | ACTIVE | `IsRevoked BIT NOT NULL CONSTRAINT DF_SharedWorkstationCredential_Revoked DEFAULT (0)` · [database/migrations/904_workstation_device_credentials.sql](../database/migrations/904_workstation_device_credentials.sql) |
| CreatedAtUtc | DATETIME2(3) | NOT NULL | ACTIVE | `CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_SharedWorkstationCredential_Created DEFAULT SYSUTCDATETIME()` · [database/migrations/904_workstation_device_credentials.sql](../database/migrations/904_workstation_device_credentials.sql) |
| RevokedAtUtc | DATETIME2(3) | NULL | ACTIVE | `RevokedAtUtc DATETIME2(3) NULL` · [database/migrations/904_workstation_device_credentials.sql](../database/migrations/904_workstation_device_credentials.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| PK_SharedWorkstationCredential | PRIMARY KEY | ACTIVE | `Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_SharedWorkstationCredential PRIMARY KEY` · [database/migrations/904_workstation_device_credentials.sql](../database/migrations/904_workstation_device_credentials.sql) |
| DF_SharedWorkstationCredential_Revoked | DEFAULT | ACTIVE | `IsRevoked BIT NOT NULL CONSTRAINT DF_SharedWorkstationCredential_Revoked DEFAULT (0)` · [database/migrations/904_workstation_device_credentials.sql](../database/migrations/904_workstation_device_credentials.sql) |
| DF_SharedWorkstationCredential_Created | DEFAULT | ACTIVE | `CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_SharedWorkstationCredential_Created DEFAULT SYSUTCDATETIME()` · [database/migrations/904_workstation_device_credentials.sql](../database/migrations/904_workstation_device_credentials.sql) |
| FK_SharedWorkstationCredential_Workstation | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_SharedWorkstationCredential_Workstation FOREIGN KEY (WorkstationId) REFERENCES uqp.SharedWorkstation(Id)` · [database/migrations/904_workstation_device_credentials.sql](../database/migrations/904_workstation_device_credentials.sql) |
| CK_SharedWorkstationCredential_Revocation | CHECK | ACTIVE | `CONSTRAINT CK_SharedWorkstationCredential_Revocation CHECK ((IsRevoked=0 AND RevokedAtUtc IS NULL) OR (IsRevoked=1 AND RevokedAtUtc IS NOT NULL))` · [database/migrations/904_workstation_device_credentials.sql](../database/migrations/904_workstation_device_credentials.sql) |

| Index | 狀態 | 鍵／INCLUDE／filter／來源 |
|---|---|---|
| IX_SharedWorkstationCredential_Workstation | UNKNOWN | `CREATE INDEX IX_SharedWorkstationCredential_Workstation ON uqp.SharedWorkstationCredential (WorkstationId, IsRevoked);` · [database/migrations/904_workstation_device_credentials.sql](../database/migrations/904_workstation_device_credentials.sql) |

### uqp.SharedWorkstationSession

表級狀態：**ACTIVE**；建立來源：[database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql)。

程式／SQL Repository 引用：[server/src/modules/admin/quickPinPolicy.repository.ts](../server/src/modules/admin/quickPinPolicy.repository.ts)、[server/src/modules/admin/sharedWorkstation.repository.ts](../server/src/modules/admin/sharedWorkstation.repository.ts)、[server/src/modules/admin/workstationCredential.repository.ts](../server/src/modules/admin/workstationCredential.repository.ts)、[server/src/modules/admin/workstationManagement.repository.ts](../server/src/modules/admin/workstationManagement.repository.ts)、[server/src/modules/auth/quickPin.service.ts](../server/src/modules/auth/quickPin.service.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | UNIQUEIDENTIFIER | NOT NULL | ACTIVE | `Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| WorkstationId | BIGINT | NOT NULL | ACTIVE | `WorkstationId BIGINT NOT NULL` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| UserId | BIGINT | NOT NULL | ACTIVE | `UserId BIGINT NOT NULL` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| SessionSecretHash | VARBINARY(32) | NOT NULL | UNKNOWN | `SessionSecretHash VARBINARY(32) NOT NULL` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| AuthMethod | NVARCHAR(20) | NOT NULL | ACTIVE | `AuthMethod NVARCHAR(20) NOT NULL` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| AuthenticatedAtUtc | DATETIME2(3) | NOT NULL | ACTIVE | `AuthenticatedAtUtc DATETIME2(3) NOT NULL` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| LastActivityAtUtc | DATETIME2(3) | NOT NULL | UNKNOWN | `LastActivityAtUtc DATETIME2(3) NOT NULL` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| ExpiresAtUtc | DATETIME2(3) | NOT NULL | ACTIVE | `ExpiresAtUtc DATETIME2(3) NOT NULL` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| RevokedAtUtc | DATETIME2(3) | NULL | ACTIVE | `RevokedAtUtc DATETIME2(3) NULL` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| TokenVersion | INT | NOT NULL | UNKNOWN | `TokenVersion INT NOT NULL` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| PinVersion | INT | NULL | UNKNOWN | `PinVersion INT NULL` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| (unnamed PK: Id) | PRIMARY KEY | ACTIVE | `Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| FK_SharedWorkstationSession_Workstation | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_SharedWorkstationSession_Workstation FOREIGN KEY (WorkstationId) REFERENCES uqp.SharedWorkstation(Id)` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| CK_SharedWorkstationSession_Method | CHECK | ACTIVE | `CONSTRAINT CK_SharedWorkstationSession_Method CHECK (AuthMethod IN ('PASSWORD','PIN','STEP_UP'))` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| CK_SharedWorkstationSession_Expiry | CHECK | ACTIVE | `CONSTRAINT CK_SharedWorkstationSession_Expiry CHECK (ExpiresAtUtc > AuthenticatedAtUtc)` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |

| Index | 狀態 | 鍵／INCLUDE／filter／來源 |
|---|---|---|
| IX_SharedWorkstationSession_Workstation | UNKNOWN | `CREATE INDEX IX_SharedWorkstationSession_Workstation ON uqp.SharedWorkstationSession(WorkstationId, RevokedAtUtc, ExpiresAtUtc);` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| IX_SharedWorkstationSession_User | UNKNOWN | `CREATE INDEX IX_SharedWorkstationSession_User ON uqp.SharedWorkstationSession(UserId, RevokedAtUtc);` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| UX_SharedWorkstationSession_OneActive | ACTIVE | `CREATE UNIQUE INDEX UX_SharedWorkstationSession_OneActive ON uqp.SharedWorkstationSession(WorkstationId) WHERE RevokedAtUtc IS NULL;` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |

### uqp.SharedWorkstationUser

表級狀態：**ACTIVE**；建立來源：[database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql)。

程式／SQL Repository 引用：[server/src/modules/admin/sharedWorkstation.repository.ts](../server/src/modules/admin/sharedWorkstation.repository.ts)、[server/src/modules/admin/workstationManagement.repository.ts](../server/src/modules/admin/workstationManagement.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| WorkstationId | BIGINT | NOT NULL | ACTIVE | `WorkstationId BIGINT NOT NULL` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| UserId | BIGINT | NOT NULL | ACTIVE | `UserId BIGINT NOT NULL` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| IsAllowed | BIT | NOT NULL | ACTIVE | `IsAllowed BIT NOT NULL CONSTRAINT DF_SharedWorkstationUser_Allowed DEFAULT 1` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| CreatedAtUtc | DATETIME2(3) | NOT NULL | ACTIVE | `CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_SharedWorkstationUser_Created DEFAULT SYSUTCDATETIME()` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| DF_SharedWorkstationUser_Allowed | DEFAULT | ACTIVE | `IsAllowed BIT NOT NULL CONSTRAINT DF_SharedWorkstationUser_Allowed DEFAULT 1` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| DF_SharedWorkstationUser_Created | DEFAULT | ACTIVE | `CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_SharedWorkstationUser_Created DEFAULT SYSUTCDATETIME()` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| PK_SharedWorkstationUser | PRIMARY KEY | ACTIVE | `CONSTRAINT PK_SharedWorkstationUser PRIMARY KEY (WorkstationId, UserId)` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| FK_SharedWorkstationUser_Workstation | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_SharedWorkstationUser_Workstation FOREIGN KEY (WorkstationId) REFERENCES uqp.SharedWorkstation(Id)` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.SystemSetting

表級狀態：**ACTIVE**；建立來源：[database/migrations/008_system_settings.sql](../database/migrations/008_system_settings.sql)。

程式／SQL Repository 引用：[server/src/modules/audit/audit.repository.ts](../server/src/modules/audit/audit.repository.ts)、[server/src/modules/systemSettings/systemSettings.repository.ts](../server/src/modules/systemSettings/systemSettings.repository.ts)、[server/src/modules/version/version.repository.ts](../server/src/modules/version/version.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| SettingKey | NVARCHAR(100) | NOT NULL | ACTIVE | `SettingKey NVARCHAR(100) NOT NULL PRIMARY KEY` · [database/migrations/008_system_settings.sql](../database/migrations/008_system_settings.sql) |
| SettingValue | NVARCHAR(1000) | NOT NULL | UNKNOWN | `SettingValue NVARCHAR(1000) NOT NULL` · [database/migrations/008_system_settings.sql](../database/migrations/008_system_settings.sql) |
| Description | NVARCHAR(500) | NULL | UNKNOWN | `Description NVARCHAR(500) NULL` · [database/migrations/008_system_settings.sql](../database/migrations/008_system_settings.sql) |
| UpdatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_SystemSetting_UpdatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/008_system_settings.sql](../database/migrations/008_system_settings.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| (unnamed PK: SettingKey) | PRIMARY KEY | ACTIVE | `SettingKey NVARCHAR(100) NOT NULL PRIMARY KEY` · [database/migrations/008_system_settings.sql](../database/migrations/008_system_settings.sql) |
| DF_SystemSetting_UpdatedAt | DEFAULT | ACTIVE | `UpdatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_SystemSetting_UpdatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/008_system_settings.sql](../database/migrations/008_system_settings.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.UserQueryAccess

表級狀態：**ACTIVE**；建立來源：[database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql)。

程式／SQL Repository 引用：[server/src/modules/admin/admin.repository.ts](../server/src/modules/admin/admin.repository.ts)、[server/src/modules/dashboard/dashboard.repository.ts](../server/src/modules/dashboard/dashboard.repository.ts)、[server/src/modules/queryDefinition/queryAccess.repository.ts](../server/src/modules/queryDefinition/queryAccess.repository.ts)、[server/src/modules/queryDefinition/queryDefinition.repository.ts](../server/src/modules/queryDefinition/queryDefinition.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| UserId | BIGINT | NOT NULL | ACTIVE | `UserId BIGINT NOT NULL` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| QueryDefinitionId | BIGINT | NOT NULL | ACTIVE | `QueryDefinitionId BIGINT NOT NULL` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| CanView | BIT | NOT NULL | ACTIVE | `CanView BIT NOT NULL CONSTRAINT DF_UserQueryAccess_View DEFAULT (1)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| CanExecute | BIT | NOT NULL | ACTIVE | `CanExecute BIT NOT NULL CONSTRAINT DF_UserQueryAccess_Execute DEFAULT (1)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| CanExport | BIT | NOT NULL | ACTIVE | `CanExport BIT NOT NULL CONSTRAINT DF_UserQueryAccess_Export DEFAULT (0)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| DF_UserQueryAccess_View | DEFAULT | ACTIVE | `CanView BIT NOT NULL CONSTRAINT DF_UserQueryAccess_View DEFAULT (1)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| DF_UserQueryAccess_Execute | DEFAULT | ACTIVE | `CanExecute BIT NOT NULL CONSTRAINT DF_UserQueryAccess_Execute DEFAULT (1)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| DF_UserQueryAccess_Export | DEFAULT | ACTIVE | `CanExport BIT NOT NULL CONSTRAINT DF_UserQueryAccess_Export DEFAULT (0)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| PK_UserQueryAccess | PRIMARY KEY | ACTIVE | `CONSTRAINT PK_UserQueryAccess PRIMARY KEY (UserId, QueryDefinitionId)` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| FK_UserQueryAccess_User | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_UserQueryAccess_User FOREIGN KEY (UserId) REFERENCES uqp.AppUser(Id) ON DELETE CASCADE` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |
| FK_UserQueryAccess_Query | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_UserQueryAccess_Query FOREIGN KEY (QueryDefinitionId) REFERENCES uqp.QueryDefinition(Id) ON DELETE CASCADE` · [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.UserQueryFavorite

表級狀態：**ACTIVE**；建立來源：[database/migrations/017_user_query_favorite.sql](../database/migrations/017_user_query_favorite.sql)。

程式／SQL Repository 引用：[server/src/modules/queryDefinition/queryDefinition.repository.ts](../server/src/modules/queryDefinition/queryDefinition.repository.ts)、[server/src/modules/queryDefinition/queryFavorite.repository.ts](../server/src/modules/queryDefinition/queryFavorite.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| UserId | BIGINT | NOT NULL | ACTIVE | `UserId BIGINT NOT NULL` · [database/migrations/017_user_query_favorite.sql](../database/migrations/017_user_query_favorite.sql) |
| QueryDefinitionId | BIGINT | NOT NULL | ACTIVE | `QueryDefinitionId BIGINT NOT NULL` · [database/migrations/017_user_query_favorite.sql](../database/migrations/017_user_query_favorite.sql) |
| CreatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_UserQueryFavorite_CreatedAtUtc DEFAULT (SYSUTCDATETIME())` · [database/migrations/017_user_query_favorite.sql](../database/migrations/017_user_query_favorite.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| DF_UserQueryFavorite_CreatedAtUtc | DEFAULT | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_UserQueryFavorite_CreatedAtUtc DEFAULT (SYSUTCDATETIME())` · [database/migrations/017_user_query_favorite.sql](../database/migrations/017_user_query_favorite.sql) |
| PK_UserQueryFavorite | PRIMARY KEY | ACTIVE | `CONSTRAINT PK_UserQueryFavorite PRIMARY KEY (UserId, QueryDefinitionId)` · [database/migrations/017_user_query_favorite.sql](../database/migrations/017_user_query_favorite.sql) |
| FK_UserQueryFavorite_User | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_UserQueryFavorite_User FOREIGN KEY (UserId) REFERENCES uqp.AppUser(Id) ON DELETE CASCADE` · [database/migrations/017_user_query_favorite.sql](../database/migrations/017_user_query_favorite.sql) |
| FK_UserQueryFavorite_Query | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_UserQueryFavorite_Query FOREIGN KEY (QueryDefinitionId) REFERENCES uqp.QueryDefinition(Id) ON DELETE CASCADE` · [database/migrations/017_user_query_favorite.sql](../database/migrations/017_user_query_favorite.sql) |

| Index | 狀態 | 鍵／INCLUDE／filter／來源 |
|---|---|---|
| IX_UserQueryFavorite_QueryDefinitionId | UNKNOWN | `CREATE INDEX IX_UserQueryFavorite_QueryDefinitionId ON uqp.UserQueryFavorite(QueryDefinitionId, UserId);` · [database/migrations/017_user_query_favorite.sql](../database/migrations/017_user_query_favorite.sql) |

### uqp.UserQuickPin

表級狀態：**ACTIVE**；建立來源：[database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql)。

程式／SQL Repository 引用：[server/src/modules/admin/quickPinPolicy.repository.ts](../server/src/modules/admin/quickPinPolicy.repository.ts)、[server/src/modules/auth/quickPin.service.ts](../server/src/modules/auth/quickPin.service.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| UserId | BIGINT | NOT NULL | ACTIVE | `UserId BIGINT NOT NULL PRIMARY KEY` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| PinHash | NVARCHAR(512) | NOT NULL | UNKNOWN | `PinHash NVARCHAR(512) NOT NULL` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| PinVersion | INT | NOT NULL | ACTIVE | `PinVersion INT NOT NULL CONSTRAINT DF_UserQuickPin_Version DEFAULT 1` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| IsEnabled | BIT | NOT NULL | ACTIVE | `IsEnabled BIT NOT NULL CONSTRAINT DF_UserQuickPin_Enabled DEFAULT 0` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| FailedAttempts | INT | NOT NULL | ACTIVE | `FailedAttempts INT NOT NULL CONSTRAINT DF_UserQuickPin_Failed DEFAULT 0` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| LockedUntilUtc | DATETIME2(3) | NULL | UNKNOWN | `LockedUntilUtc DATETIME2(3) NULL` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| CreatedAtUtc | DATETIME2(3) | NOT NULL | ACTIVE | `CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_UserQuickPin_Created DEFAULT SYSUTCDATETIME()` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| UpdatedAtUtc | DATETIME2(3) | NOT NULL | ACTIVE | `UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_UserQuickPin_Updated DEFAULT SYSUTCDATETIME()` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| (unnamed PK: UserId) | PRIMARY KEY | ACTIVE | `UserId BIGINT NOT NULL PRIMARY KEY` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| DF_UserQuickPin_Version | DEFAULT | ACTIVE | `PinVersion INT NOT NULL CONSTRAINT DF_UserQuickPin_Version DEFAULT 1` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| DF_UserQuickPin_Enabled | DEFAULT | ACTIVE | `IsEnabled BIT NOT NULL CONSTRAINT DF_UserQuickPin_Enabled DEFAULT 0` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| DF_UserQuickPin_Failed | DEFAULT | ACTIVE | `FailedAttempts INT NOT NULL CONSTRAINT DF_UserQuickPin_Failed DEFAULT 0` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| DF_UserQuickPin_Created | DEFAULT | ACTIVE | `CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_UserQuickPin_Created DEFAULT SYSUTCDATETIME()` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| DF_UserQuickPin_Updated | DEFAULT | ACTIVE | `UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_UserQuickPin_Updated DEFAULT SYSUTCDATETIME()` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |
| CK_UserQuickPin_Failed | CHECK | ACTIVE | `CONSTRAINT CK_UserQuickPin_Failed CHECK (FailedAttempts >= 0)` · [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.UserRole

表級狀態：**ACTIVE**；建立來源：[database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql)。

程式／SQL Repository 引用：[server/src/modules/admin/admin.repository.ts](../server/src/modules/admin/admin.repository.ts)、[server/src/modules/admin/workstationManagement.repository.ts](../server/src/modules/admin/workstationManagement.repository.ts)、[server/src/modules/auth/auth.repository.ts](../server/src/modules/auth/auth.repository.ts)、[server/src/modules/dashboard/dashboard.repository.ts](../server/src/modules/dashboard/dashboard.repository.ts)、[server/src/modules/dataset/datasetScopeManagement.repository.ts](../server/src/modules/dataset/datasetScopeManagement.repository.ts)、[server/src/modules/dataset/dataset923ScopeConfirmationGate.ts](../server/src/modules/dataset/dataset923ScopeConfirmationGate.ts)、[server/src/modules/queryDefinition/queryDefinition.repository.ts](../server/src/modules/queryDefinition/queryDefinition.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| UserId | BIGINT | NOT NULL | ACTIVE | `UserId BIGINT NOT NULL` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| RoleId | BIGINT | NOT NULL | ACTIVE | `RoleId BIGINT NOT NULL` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| CreatedAtUtc | DATETIME2(0) | NOT NULL | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_UserRole_CreatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| DF_UserRole_CreatedAt | DEFAULT | ACTIVE | `CreatedAtUtc DATETIME2(0) NOT NULL CONSTRAINT DF_UserRole_CreatedAt DEFAULT (SYSUTCDATETIME())` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| PK_UserRole | PRIMARY KEY | ACTIVE | `CONSTRAINT PK_UserRole PRIMARY KEY (UserId, RoleId)` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| FK_UserRole_User | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_UserRole_User FOREIGN KEY (UserId) REFERENCES uqp.AppUser(Id)` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |
| FK_UserRole_Role | FOREIGN KEY | ACTIVE | `CONSTRAINT FK_UserRole_Role FOREIGN KEY (RoleId) REFERENCES uqp.Role(Id)` · [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.WorkstationAudience

表級狀態：**ACTIVE**；建立來源：[database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql)。

程式／SQL Repository 引用：[server/src/modules/admin/workstationManagement.repository.ts](../server/src/modules/admin/workstationManagement.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| Id | BIGINT | NOT NULL | ACTIVE | `Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |
| Kind | NVARCHAR(20) | NOT NULL | ACTIVE | `Kind NVARCHAR(20) NOT NULL` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |
| Code | NVARCHAR(100) | NOT NULL | UNKNOWN | `Code NVARCHAR(100) NOT NULL UNIQUE` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |
| DisplayName | NVARCHAR(200) | NOT NULL | UNKNOWN | `DisplayName NVARCHAR(200) NOT NULL` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |
| IsActive | BIT | NOT NULL | ACTIVE | `IsActive BIT NOT NULL DEFAULT 1` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |
| Revision | INT | NOT NULL | ACTIVE | `Revision INT NOT NULL DEFAULT 1` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| (unnamed PK: Id) | PRIMARY KEY | ACTIVE | `Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |
| (unnamed DEFAULT: IsActive) | DEFAULT | ACTIVE | `IsActive BIT NOT NULL DEFAULT 1` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |
| (unnamed DEFAULT: Revision) | DEFAULT | ACTIVE | `Revision INT NOT NULL DEFAULT 1` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |
| CK_WorkstationAudience_Kind | CHECK | ACTIVE | `CONSTRAINT CK_WorkstationAudience_Kind CHECK (Kind IN ('DEPARTMENT','GROUP'))` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

### uqp.WorkstationAudienceMember

表級狀態：**ACTIVE**；建立來源：[database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql)。

程式／SQL Repository 引用：[server/src/modules/admin/workstationManagement.repository.ts](../server/src/modules/admin/workstationManagement.repository.ts)

| 欄位 | 型別 | NULL | 狀態 | 完整宣告／來源 |
|---|---|---|---|---|
| AudienceId | BIGINT | NOT NULL | ACTIVE | `AudienceId BIGINT NOT NULL REFERENCES uqp.WorkstationAudience(Id)` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |
| UserId | BIGINT | NOT NULL | ACTIVE | `UserId BIGINT NOT NULL REFERENCES uqp.AppUser(Id)` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |

| Constraint | 類型 | 狀態 | 宣告／來源 |
|---|---|---|---|
| PK_WorkstationAudienceMember | PRIMARY KEY | ACTIVE | `CONSTRAINT PK_WorkstationAudienceMember PRIMARY KEY (AudienceId,UserId)` · [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) |

明確 CREATE INDEX：無；PK/UQ 的隱含索引見上表。

## 其他物件

| 物件 | 類型 | 狀態 | 判據 |
|---|---|---|---|
| uqp | SCHEMA | ACTIVE | runner／001 建立，Runtime 固定限定 |
| uqp.TR_DashboardDevice_Lifecycle | TRIGGER | ACTIVE | 926 宣告，dashboardDeviceLifecycleSchema 驗證，更新時強制永久終止狀態 |
| uqp.DatasetSecurityDecisionSeq | SEQUENCE | ACTIVE | 923 renderer／draft；Decision.Id DEFAULT NEXT VALUE FOR，非無引用物件 |

應用 SQL 來源沒有 CREATE VIEW／CREATE PROCEDURE；不能推導正式環境沒有自建 View／SP。
SQL Server 的 `sys.sp_describe_first_result_set`、`sys.sp_describe_undeclared_parameters`、`sys.sp_executesql`、`sys.sp_getapplock` 是系統相依，不是本 Repository 的可清理物件。
外部報表／SQL Agent／其他應用程式及正式 Catalog 增設的 View、SP、Trigger：UNKNOWN，保留。
測試用 f3.ControlledDdl 等物件見依賴圖，不冒充正式結構。

## 可核對的來源指紋

下列是所有 tracked SQL（含驗收查詢）及 Ledger runner 的 SHA-256，不是正式 Ledger 的歷史 SHA 證明。
`node tools/validate-database-schema-inventory.mjs` 只讀檔，驗證來源集合、雜湊、表／欄位數與 Migration pin，不載入 DB 設定或執行 SQL。

| SOURCE | Path | SHA-256 |
|---|---|---|
| SOURCE | database/acceptance/catalog-probe.sql | 7667ce492379c20fd67b76bcab4dae118d29044bfe051a69b5fd1536e372e5d4 |
| SOURCE | database/acceptance/production-migration-ledger-readonly.sql | 92972a41de342855d7946f529175de2eb47075ecbb5ce5d9732c4e2a81537626 |
| SOURCE | database/acceptance/production-schema-readonly-inventory.sql | 935254cec51251772acad9ed08b9a85f96cfc96c0e3d72f5ac41862b8dd62bf8 |
| SOURCE | database/drafts/924_dataset_security_scope_binding.sql | 9d37c02255acfe88614eb6e19780a7b6a502e95a3bfcf1ef996c6f64ec83c107 |
| SOURCE | database/migrations/001_platform_identity.sql | a22767cd7ed8d2db23d7b68ecc37a04cd689f5949a8a56cf6474c4915f3af658 |
| SOURCE | database/migrations/002_datasource.sql | 80cbba3f540735325fa35a7411050f545574654cc8e79f96aa6c56d6c57c1c33 |
| SOURCE | database/migrations/003_dataset_query_designer.sql | bca7503ff9a004b8cb158d057cbbe3fce65c4f272fda3d47adaddb652d75a744 |
| SOURCE | database/migrations/004_parameter_designer.sql | 88c23bc549fe1aadcd4dcd3e4c7689329f682fa24fa66febf089995f9b25590f |
| SOURCE | database/migrations/005_query_definition_and_access.sql | 327151da9341eb30f527d7579e3c200a4212883ae73e4b18d2ca036908f4adf5 |
| SOURCE | database/migrations/006_audit_log.sql | 43824193c3c5a2a658af4949b9fa9a4a6fa724fcf925a613993b5db06001a03e |
| SOURCE | database/migrations/007_report_designer.sql | 7a347bb93f8b8a082e2fe82facd6d94216fa0d6b6291ed9cbfd27c91d91ea815 |
| SOURCE | database/migrations/008_system_settings.sql | 56a5c8fa7ddfda69d3487def780a77f40cc69b064917634de4eb34d12e6c17d6 |
| SOURCE | database/migrations/009_mysql_postgresql_datasource.sql | bfb0fe7e70bcf8242a8b8ba1ed4f395ab44348c2efae6d299d74fb55b356c6ba |
| SOURCE | database/migrations/010_odbc_datasource.sql | b989d01416c8e04ee0b051bb6eb22d2ee4789358801564c63a79fb220cf4c8c1 |
| SOURCE | database/migrations/011_query_category.sql | ab3200d0df12c6bfc5c6f7603edac23e5741ad509ff005f675781e7e2b02b32a |
| SOURCE | database/migrations/012_query_archive.sql | 7df5873ee2340c2d0c48132a6b6974ef5c11b92a611b28e2c0eddd9b19d3973c |
| SOURCE | database/migrations/013_dataset_archive.sql | 42a0bd84f45a83efaa6739b10433afeb8f55a491466fa14c308b31577d722961 |
| SOURCE | database/migrations/014_version_history.sql | f21fc10329189924cc3d0d2992ee080fed3e537de85b868be37c764073774822 |
| SOURCE | database/migrations/015_version_retention.sql | f5cdac721d85f1043f6aef5648a66b4b061b125eceeb2f9e95b4f1d7fced1ca5 |
| SOURCE | database/migrations/016_audit_retention.sql | 66d8497d163d4fbf91171b0fbdec80e25e830acc851952bb6a64dea02fdc0dc2 |
| SOURCE | database/migrations/017_user_query_favorite.sql | 95cce0911530c141097a4757f93f20c284b5ac294fc871fc091064e390c534ba |
| SOURCE | database/migrations/018_recent_query_usage_index.sql | af22a006bc03a2f27e1d03291941fb5861b821886fcf2ec223ebb1806ae4b3b9 |
| SOURCE | database/migrations/019_user_token_version.sql | e3c06d3bac3f53e0290fe8eae80f2850a049d5c847647a5c8092ecf03382208f |
| SOURCE | database/migrations/020_dashboard_base.sql | 78e67a17320ff77aeb6b85797e3865d3b794b7f7ec8d32f382f7d49a3f3b8795 |
| SOURCE | database/migrations/021_dashboard_display_layout.sql | 903c601f83ce2eafb49414c07e437f63ef5186e794e26656b47421503ae03330 |
| SOURCE | database/migrations/022_dashboard_layout_designer.sql | 6cebdd45a02108aad26f8188253313ff6cadf66cd3beb5405151da99295241e5 |
| SOURCE | database/migrations/023_dynamic_date_parameters.sql | 3ed5c80efeda1922b9bec413e1dac9883e79cd116f417906eb65510618684a5d |
| SOURCE | database/migrations/024_dashboard_visual_styling.sql | 836acf741b2bd7a07125c4e334783e69e9a334b658302ee45c16f1a9546dac20 |
| SOURCE | database/migrations/025_dashboard_display_device.sql | e9382df5566a26e38e27ab7afc985d85d7ea74b6192a3d8170d584c24dca125c |
| SOURCE | database/migrations/026_dashboard_device_ip_restriction.sql | 898fe6baddb3e68eb9cb485f72794a2f04a8b6aba42915b4f0543884445f21b0 |
| SOURCE | database/migrations/900_dashboard_device_archive.sql | b3dcf810d6981e225c1631f2d8b63d69ec1b70399441cce56786d326d66c8b07 |
| SOURCE | database/migrations/901_dashboard_device_playback_settings.sql | 77689591eb55c0a1ca10b3eecb0fd24ebc8bf02f5f1fb74ea6a7504fa479e394 |
| SOURCE | database/migrations/902_shared_workstation_foundation.sql | 2e1027ad002b3f3444ca986e9970aaac1f6c88b13383d1806cde4aa6c94b7b69 |
| SOURCE | database/migrations/903_quick_pin_policy.sql | bced4553572224b4aec465a59df0b3bef1f2d6267395ab2a756ecb78e1808529 |
| SOURCE | database/migrations/904_workstation_device_credentials.sql | e2d746bf0ec8432f914496d3395c23e4d94a38542c9503988fd1e7b2d8405546 |
| SOURCE | database/migrations/905_workstation_platform.sql | ce8627e3502c4c4d80ec79618ec9261f3b4eebd712c93e265ac63cf7c4bd2cbd |
| SOURCE | database/migrations/906_patient_list_disclosure_audit.sql | 26e672c1ca72dc2138141069f4b53a566b7d47d07d37fa1084852feede6f9d57 |
| SOURCE | database/migrations/907_dataset_patient_audit_config.sql | 5dddfaa493941d6709b2c8deb96533706a0ca3a8390c1b88114904ac6e24cb76 |
| SOURCE | database/migrations/908_patient_audit_hmac_key_version.sql | 935016e9e08334a9644c7cdb6ce18528a671ff9cdf2533aca662f816990efb5b |
| SOURCE | database/migrations/909_dashboard_device_disclosure.sql | b9b4794104e5df53477181c326743bf0a0b93017e73eb8b4f84dc56e38a8d385 |
| SOURCE | database/migrations/910_dataset_sensitive_columns.sql | 84a133ffa1032f1aae4391ce4e0c127e3f46e234c2ef1ecb4e6c043be7374327 |
| SOURCE | database/migrations/911_verify_dataset_sensitivity.sql | 152e5d7e10a3b315acbc4ee7f77aa9e5420c5c57e98687a0989a484846db5a8a |
| SOURCE | database/migrations/912_custom_device_mask.sql | 75332997320d23216564c0fa8fd929e1bf12c17d37f56c9251f3cdc7c330a705 |
| SOURCE | database/migrations/913_dashboard_multi_dataset_sources.sql | 25a7af0994b8289fb93ac996feb0f7c86cabbbd176bde0521715a5c0aaf06e8a |
| SOURCE | database/migrations/914_dashboard_source_paging.sql | c841d79f8b35f1dfe6baa3a6203d1c4a43279879f87ffc7abe9d6fe4f583eabd |
| SOURCE | database/migrations/915_dashboard_security_reconciliation.sql | ab2ec386e304be07fa62aadcad55260fc70660e4db6d8aff57b64337edae6867 |
| SOURCE | database/migrations/916_workstation_management.sql | 904998104010be84278bffd608ad82e9184db8ac52df045f3b4c6d63a0bb2b61 |
| SOURCE | database/migrations/917_dashboard_query_source_model.sql | 54cdc861ff7c7eb95669085c8a054aebfbc063ba701b0c9b32c952d881b322bc |
| SOURCE | database/migrations/918_dashboard_query_playback_mode.sql | cc7ad656ff726448a89e5e168f6dac5d5e3bf83e41b8684366e3b6b61855b813 |
| SOURCE | database/migrations/919_dashboard_dataset_security_contract.sql | 49ff0779c31d563a800a0fed624817a9d6194a63c547dda985be0d317ed325cc |
| SOURCE | database/migrations/920_dataset_definition_rowversion.sql | f8d6b9d50881c12407d453f1d3ccf4e7054efd931c2f19f8cb1f7316b791880b |
| SOURCE | database/migrations/921_datasource_native_parameter_versions.sql | db373cf73186869d814d848fb1e8444fd03e8cf7729b327d21f66d87e8fe3f2e |
| SOURCE | database/migrations/926_dashboard_device_lifecycle.sql | f2d17b2a24963860e646a620f9548b22ff6a1a296e077071e8fb50237c8cfd43 |
| SOURCE | tools/sqlserver-acceptance/d0_catalog_readonly.sql | d96163eec0714fbfa10082d76af795cf7c023260e6be32bc3dfc447729d300e6 |
| SOURCE | tools/sqlserver-acceptance/drafts/923/923_catalog_readonly.sql | 0e7ea4cc793d09b41880a56433d4d7ed8f0d267c55df55253aeed3ca15811625 |
| SOURCE | tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql | a6569770d1e2a3b553814d540df640081c50f60a8a7ef9f53d3d278b2810815f |
| SOURCE | tools/sqlserver-acceptance/drafts/923/923_f1a_environment_readonly.sql | 5417d5e861c7816742b395517a9ecbd29d781f1481ec1c9da7ee246637f9052e |
| SOURCE | tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql | c073e595eb56d6e11b8b2c46ef168711d4aae61ee6c370800b6da5c4e33f0a0c |
| SOURCE | server/src/scripts/migrate.ts | 52a3831f2af648d60c6df95275fe4b8b8f87716a5eb9c9684332915e5f21e794 |
