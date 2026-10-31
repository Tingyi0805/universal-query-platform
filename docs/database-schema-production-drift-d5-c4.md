# 正式 SQL Schema 核對與未使用物件判定（D5-C-4-C）

Repository 基準：`9f8dfb244c5b5b831df021e955bad27cd6f30b8b`；PR #83 維持 Draft，不合併。
本輪只更新文件，不更動 SQL、Migration、Runtime、權限或正式環境；未連線資料庫、未讀正式 .env／密碼、未執行 db status／installer／Migration。

## 證據來源與判定口徑

- **正式事實**：本次使用者提供的 SQL Server 唯讀調查摘要；不是本代理重新執行的查詢，也沒有附完整原始 Catalog resultsets。證據未提供查詢擷取時間／執行主體／完整可見性資訊，不自行填造。
- **目標環境**：Database `UniversalQueryPlatform`、SQL Server `15.0.2180.2`、Edition `Express`、Schema `uqp`。本輪未提供 compatibility level，不從 major version 猜測為 150。
- **Repository 預期**：基準 Commit 的 DDL、Catalog validator 與 installer；預期結構不等於正式已安裝物件。
- **Runtime 依賴**：掛載 API → repository → SQL／共用 gate 的靜態追查；不把程式可用性宣稱為正式有流量。
- **歷史來源**：Ledger 只能證明提供的名稱／時間，不能證明當年 SQL byte 或現行結構。
- **外部相依性**：未提供報表／排程／第三方／DB module 全量證據，維持 UNKNOWN；零筆資料不能轉成 UNUSED_CONFIRMED。

## 各版本判定

| 版本 | 正式事實（本輪） | Repository／Runtime 結論 | 判定與處置 |
|---|---|---|---|
| 922 | 尚未取得獨立 Ledger 查詢證據 | 可達 Git history 無 922 路徑；現有 scanner／inventory 無 entry；Runtime／923–925 installer 無 922 prerequisite | **UNKNOWN（正式 Ledger／歷史內容）**；不新增空 Migration，不推定已安裝、不推定可刪或不需要 |
| 923 | Ledger 名稱／時間、四表＋Sequence、87 欄位／Constraint／Index／Sequence 結構相符；四表均 0 筆 | 現行 DDL 對照 PASS；欄位初始化／Scope 與 exact Catalog 契約仍有依賴 | **正式結構比對 PASS（依提供證據）**；歷史原始部署檔仍 UNKNOWN，保留所有物件 |
| 924 | ScopeBinding NOT_FOUND；924 Ledger 無紀錄；Permission 資料未確認 | 可選 Scope API 及 923 欄位初始化依賴；不是 Server 啟動必備 | **未安裝／功能前置缺口**；目前是否必須正式部署 UNKNOWN，絕不自動安裝或授權 |
| 925 | 三表存在；Template.CreatedBy／UpdatedBy 均 NULL allowed | 三表有 Runtime SELECT／INSERT，Policy／Template 有 UPDATE；既有 exact validator 必須保留 | **部分已核對，完整一致性 UNKNOWN／待證據**；CreatedBy／UpdatedBy 的 NULL 設定相符，不是 Drift |
| 926 | 本輪未提供當前 Ledger／欄位／Constraint／Trigger 結果 | 有歷史 Migration、machine pin、Runtime 生命週期 attestation；沒有獨立 926 installer | **當前正式安裝狀態 UNKNOWN**；先前「尚未執行」只保留為歷史陳述，不當成本輪現況驗證 |

## 923：已證實結構與歷史來源分離

正式 Ledger：`923_dataset_metadata.sql`；AppliedAtUtc：`2026-10-23 13:08:48`（照提供值記錄，不另換時區）。

| 物件／類別 | 使用者提供的正式證據 | Repository 對照 |
|---|---|---|
| DatasetFieldSnapshot | 存在；30 欄位；0 筆 | 欄位型別／長度／NULL／Identity／Default 相符 |
| DatasetSecurityScope | 存在；13 欄位；0 筆 | 同上 |
| DatasetSecurityDecision | 存在；25 欄位；0 筆 | 同上 |
| DatasetSecurityConfirmation | 存在；19 欄位；0 筆 | 同上；exact Catalog／安裝相容性仍要求保留 |
| CHECK | 24；啟用、Trusted | 相符 |
| DEFAULT | 4 | 相符 |
| PK／UNIQUE | 7 | 相符 |
| FOREIGN KEY | 10；啟用、Trusted | 相符 |
| 明確一般／條件 Index | 9，含 UX_SecurityDecision_CollectionSnapshot | 相符 |
| DatasetSecurityDecisionSeq | START=1、INCREMENT=1、MIN=1、MAX=9223372036854775807、NO CYCLE、NO CACHE | 相符 |

結構 PASS 依使用者明確提供的核對結論，不聲稱本輪已執行 `render923CatalogSql()` 或取得其完整輸出。
[923 DDL](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) 是本 HEAD 的預期；`installDataset923.ts` 執行 renderer 並以固定檔名記 Ledger，不能推定此 OFFLINE DRAFT 就是 2026-10-23 的原始部署檔。
目前缺部署包 commit／manifest／原 byte hash；這是**來源證據缺口**，不把已報告結構 PASS 降格為不存在，也不據此重跑安裝。
各表 0 筆只能描述此次資料量，不能排除功能旗標、未啟用流程、保留要求或外部依賴。

## 924：Runtime、啟動與部署必要性

### 呼叫路徑與完整搜尋範圍

追查 `server/src` 的 table literal、Catalog 的 `bindingTable`、Permission 名稱與 import／呼叫關係；將 scripts／acceptance 與掛載 Runtime 分開。外部應用未在此搜尋範圍內。

| 路徑 | 對 ScopeBinding 的使用 | 缺表影響 |
|---|---|---|
| app.ts → `/api/dataset-security` → datasetScopeManagement.routes／repository | options／list／history／mutate 共用 owned gate；scopes() 兩次 LEFT JOIN；GRANT 以 DELETE＋INSERT 更新 binding | 通過認證／功能條件後，ready gate 不成立時 503 `SCOPE_924_OR_IMMUTABLE_LEDGER_REQUIRED`；不繞過、不自建 |
| app.ts → `/api/dataset-field-initialization` → datasetFieldInitialization.repository → management.withMetadataOwner() | status() 與 collect() 都依賴有效 ScopeBinding，前後重驗 Scope／Dataset 版本 | **923 欄位初始化的 GET／POST 也受影響**；不是只有 924 管理 UI 不能用 |
| dataset923ScopeConfirmationGate.require923DatasetConfirmationScope | 直接使用 923 Scope 與 CONFIRM_DATASET_CLASSIFICATION，沒有直接查 binding | 目前呼叫者為隔離 acceptance，未找到掛載 Runtime 呼叫者；不能用它宣稱正式初始化可避開 924 |
| installDataset924／Catalog renderer／ephemeral acceptance | 檢查／宣告／測試 binding | 維護／驗收用途，不在 Server 啟動自動執行 |

### Feature Flag 與安全 gate

- `DATASET_SECURITY_SCOPE_MANAGEMENT` 在 env schema 預設 false；`DATASET_SECURITY_PLATFORM_INCARNATION` 必須是有效非零 UUID。
- Flag 未啟用／incarnation 無效時，owned() 在取得 DB pool 前回覆 503 `SCOPE_MANAGEMENT_NOT_CONFIGURED`。正式值未知，未讀 .env。
- Scope API route 先要求 live 認證及 `MANAGE_DATASET_SECURITY_SCOPE`；交易內重驗 active SYSTEM_ADMIN、User／TokenVersion 及明確權限。
- Metadata route 要求 `DESIGN_QUERY`＋`CONFIRM_DATASET_CLASSIFICATION`，並經 withMetadataOwner 有效 Owner／Reviewer、binding／版本與前後重驗。
- Runtime ready gate 檢查 10 欄位形狀、trusted FK 及受限 DB 身分；不等同 installer 的完整 exact Catalog 驗收。禁止把簡化 Runtime gate 當 exact validator。
- 相關工作使用 SERIALIZABLE／applock，並拒絕具 Decision UPDATE／DELETE／ALTER、DB CONTROL 等不安全權限的身分；不能用 dbo 繞過。
- collect() 還需要來源 Metadata Provider；目前 production factory 未注入 source，collect 會另受 `SOURCE_PROVIDER_NOT_REGISTERED` 阻擋。**只裝 924 不等於能啟用完整 923 初始化／交付。**

### 啟動、Permission 與部署結論

[server.ts](../server/src/server.ts) 啟動 HTTP 與裝置封存 timer；[health.routes.ts](../server/src/routes/health.routes.ts) 只報設定狀態，沒有 924 查表／installer／全域 schema bootstrap。
`app.ts` 掛載 router 與 factory 建立不執行 binding 查詢。因此**缺少 924 不是此版本 Server 啟動失敗的必要條件**，也沒有證據指出它會破壞 923 已安裝結構或所有既有查詢／Dashboard 功能。

| Permission | 實際消費者 | 判定 |
|---|---|---|
| MANAGE_DATASET_SECURITY_SCOPE | Scope route、交易內管理者 SQL；admin.repository 經 explicitSystemAdminCapabilities 限制自動授予 | 已有 Runtime 用途，不只是預留字串；正式 Permission／RolePermission 資料未知 |
| CONFIRM_DATASET_CLASSIFICATION | 欄位初始化 route、classifier、Scope 受指派人 eligibility、923 pre-confirmation helper；同樣需明確授予 | 已有 Runtime／guard 用途；定義存在不等於使用者已獲權 |

924 draft 只建立兩項 Permission 定義，不自動建立 RolePermission／UserRole／Scope；專用 installer 成功寫既有 SchemaMigration 的 `924_dataset_security_scope_binding.sql`，不是一般 migration scanner 或獨立 Ledger 表。
installer `inspect924()` 仍要求 48 份 001–921 基線；本 HEAD scanner 已有 49 份（含 926），會觸發 `924_BASELINE_MANIFEST_UNREVIEWED`。這是既有相容性限制，本輪只記錄，不修程式或執行 installer。

**部署必要性：條件式。** 若正式需求要啟用上述 Scope 管理／Owner-Reviewer 欄位初始化，924 是必要前置之一；目前未提供正式啟用規劃／Flag／Permission／受限 DB principal／Provider 證據，不能認定現在應部署。需要獨立審查的安裝相容性與安全驗收，不自動新增 924 或任何權限。

## 925：Repository 完整預期與正式證據逐項對照

正式只提供三表存在、CreatedBy／UpdatedBy 可 NULL；未提供其他欄位／Constraint／Index 的完整 resultsets。
因此下表完整列出**預期**，不將缺少的正式資料填成相符或 Drift。
來源：[925 DDL](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql)。NVARCHAR(n) 的 Catalog 長度是 2n bytes，MAX=-1；ROWVERSION 可呈現 timestamp、長度8；DATETIME2(3) scale3。
非文字 Collation 不適用；明確 Collation 為 BIN2；未指定文字 Collation 不猜測。所有欄位預期非 Computed。

### uqp.DatasetPublicDisplayPolicy

正式：表存在。

| 欄位 | 預期型別／長度 | NULL | Identity | Default | Collation | 正式比對狀態 |
|---|---|---|---|---|---|---|
| DatasetId | BIGINT | NOT NULL | 無 | 無 | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |
| DataSourceId | BIGINT | NOT NULL | 無 | 無 | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |
| DefinitionVersion | BINARY(8) | NOT NULL | 無 | 無 | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |
| ConfigurationVersion | BINARY(8) | NOT NULL | 無 | 無 | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |
| SensitivityVersion | BIGINT | NOT NULL | 無 | 無 | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |
| GrantsJson | NVARCHAR(MAX) | NOT NULL | 無 | 無 | 未指定（需 Catalog） | 待正式明細，不判 Drift／EXACT_MATCH |
| ConfirmedBy | BIGINT | NOT NULL | 無 | 無 | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |
| ConfirmedAtUtc | DATETIME2(3) | NOT NULL | 無 | DF_PublicDisplay_Confirmed：SYSUTCDATETIME() | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |
| UpdatedAtUtc | DATETIME2(3) | NOT NULL | 無 | DF_PublicDisplay_Updated：SYSUTCDATETIME() | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |
| RequestId | UNIQUEIDENTIFIER | NOT NULL | 無 | 無 | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |
| RequestDigest | CHAR(64) | NOT NULL | 無 | 無 | Latin1_General_100_BIN2 | 待正式明細，不判 Drift／EXACT_MATCH |
| AuditLogId | BIGINT | NOT NULL | 無 | 無 | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |
| RowVersion | ROWVERSION | NOT NULL | 無 | 無 | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |

### uqp.DatasetMaskTemplate

正式：表存在。

| 欄位 | 預期型別／長度 | NULL | Identity | Default | Collation | 正式比對狀態 |
|---|---|---|---|---|---|---|
| Id | BIGINT | NOT NULL | 1,1 | 無 | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |
| Name | NVARCHAR(100) | NOT NULL | 無 | 無 | Latin1_General_100_BIN2 | 待正式明細，不判 Drift／EXACT_MATCH |
| AliasesJson | NVARCHAR(4000) | NOT NULL | 無 | 無 | 未指定（需 Catalog） | 待正式明細，不判 Drift／EXACT_MATCH |
| MaskMode | VARCHAR(16) | NOT NULL | 無 | 無 | 未指定（需 Catalog） | 待正式明細，不判 Drift／EXACT_MATCH |
| CustomMaskJson | NVARCHAR(256) | NULL | 無 | 無 | 未指定（需 Catalog） | 待正式明細，不判 Drift／EXACT_MATCH |
| SuggestedPublicAllowed | BIT | NOT NULL | 無 | DF_MaskTemplate_Public：(0) | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |
| IsActive | BIT | NOT NULL | 無 | DF_MaskTemplate_Active：(1) | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |
| Revision | BIGINT | NOT NULL | 無 | DF_MaskTemplate_Revision：(1) | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |
| CreatedBy | BIGINT | NULL | 無 | 無 | 不適用 | NULL 設定相符；其餘屬性待證據，**不是 Drift** |
| UpdatedBy | BIGINT | NULL | 無 | 無 | 不適用 | NULL 設定相符；其餘屬性待證據，**不是 Drift** |
| CreatedAtUtc | DATETIME2(3) | NOT NULL | 無 | DF_MaskTemplate_Created：SYSUTCDATETIME() | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |
| UpdatedAtUtc | DATETIME2(3) | NOT NULL | 無 | DF_MaskTemplate_Updated：SYSUTCDATETIME() | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |
| RowVersion | ROWVERSION | NOT NULL | 無 | 無 | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |

### uqp.DatasetMaskTemplateUse

正式：表存在。

| 欄位 | 預期型別／長度 | NULL | Identity | Default | Collation | 正式比對狀態 |
|---|---|---|---|---|---|---|
| Id | BIGINT | NOT NULL | 1,1 | 無 | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |
| DatasetId | BIGINT | NOT NULL | 無 | 無 | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |
| ColumnName | NVARCHAR(256) | NOT NULL | 無 | 無 | Latin1_General_100_BIN2 | 待正式明細，不判 Drift／EXACT_MATCH |
| TemplateId | BIGINT | NOT NULL | 無 | 無 | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |
| TemplateRevision | BIGINT | NOT NULL | 無 | 無 | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |
| SensitivityVersion | BIGINT | NOT NULL | 無 | 無 | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |
| AppliedBy | BIGINT | NOT NULL | 無 | 無 | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |
| AppliedAtUtc | DATETIME2(3) | NOT NULL | 無 | DF_MaskTemplateUse_Applied：SYSUTCDATETIME() | 不適用 | 待正式明細，不判 Drift／EXACT_MATCH |

### 全部鍵／Constraint 與 Index

以下各項的正式詳細定義皆**尚未提供**；不將數量／名稱預期當正式實測。

| 表 | Constraint | 類別 | Repository 宣告 |
|---|---|---|---|
| DatasetPublicDisplayPolicy | PK_DatasetPublicDisplayPolicy | PRIMARY KEY | `DatasetId BIGINT NOT NULL CONSTRAINT PK_DatasetPublicDisplayPolicy PRIMARY KEY` |
| DatasetPublicDisplayPolicy | DF_PublicDisplay_Confirmed | DEFAULT | `ConfirmedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_PublicDisplay_Confirmed DEFAULT SYSUTCDATETIME()` |
| DatasetPublicDisplayPolicy | DF_PublicDisplay_Updated | DEFAULT | `UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_PublicDisplay_Updated DEFAULT SYSUTCDATETIME()` |
| DatasetPublicDisplayPolicy | FK_PublicDisplay_Dataset | FOREIGN KEY | `CONSTRAINT FK_PublicDisplay_Dataset FOREIGN KEY(DatasetId) REFERENCES uqp.Dataset(Id) ON DELETE CASCADE` |
| DatasetPublicDisplayPolicy | CK_PublicDisplay_Values | CHECK | `CONSTRAINT CK_PublicDisplay_Values CHECK(SensitivityVersion>0 AND ConfirmedBy>0 AND AuditLogId>0)` |
| DatasetPublicDisplayPolicy | CK_PublicDisplay_Json | CHECK | `CONSTRAINT CK_PublicDisplay_Json CHECK(ISJSON(GrantsJson)=1 AND DATALENGTH(GrantsJson)<=262144)` |
| DatasetPublicDisplayPolicy | UQ_PublicDisplay_Request | UNIQUE | `CONSTRAINT UQ_PublicDisplay_Request UNIQUE(RequestId)` |
| DatasetMaskTemplate | PK_DatasetMaskTemplate | PRIMARY KEY | `Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DatasetMaskTemplate PRIMARY KEY` |
| DatasetMaskTemplate | DF_MaskTemplate_Public | DEFAULT | `SuggestedPublicAllowed BIT NOT NULL CONSTRAINT DF_MaskTemplate_Public DEFAULT(0)` |
| DatasetMaskTemplate | DF_MaskTemplate_Active | DEFAULT | `IsActive BIT NOT NULL CONSTRAINT DF_MaskTemplate_Active DEFAULT(1)` |
| DatasetMaskTemplate | DF_MaskTemplate_Revision | DEFAULT | `Revision BIGINT NOT NULL CONSTRAINT DF_MaskTemplate_Revision DEFAULT(1)` |
| DatasetMaskTemplate | DF_MaskTemplate_Created | DEFAULT | `CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_MaskTemplate_Created DEFAULT SYSUTCDATETIME()` |
| DatasetMaskTemplate | DF_MaskTemplate_Updated | DEFAULT | `UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_MaskTemplate_Updated DEFAULT SYSUTCDATETIME()` |
| DatasetMaskTemplate | UQ_MaskTemplate_Name | UNIQUE | `CONSTRAINT UQ_MaskTemplate_Name UNIQUE(Name)` |
| DatasetMaskTemplate | CK_MaskTemplate_Revision | CHECK | `CONSTRAINT CK_MaskTemplate_Revision CHECK(Revision>0)` |
| DatasetMaskTemplate | CK_MaskTemplate_Aliases | CHECK | `CONSTRAINT CK_MaskTemplate_Aliases CHECK(ISJSON(AliasesJson)=1)` |
| DatasetMaskTemplate | CK_MaskTemplate_Mode | CHECK | `CONSTRAINT CK_MaskTemplate_Mode CHECK(MaskMode IN ('NONE','CUSTOM','FULL','OMIT'))` |
| DatasetMaskTemplate | CK_MaskTemplate_Custom | CHECK | `CONSTRAINT CK_MaskTemplate_Custom CHECK((MaskMode='CUSTOM' AND CustomMaskJson IS NOT NULL AND ISJSON(CustomMaskJson)=1) OR (MaskMode<>'CUSTOM' AND CustomMaskJson IS NULL))` |
| DatasetMaskTemplate | CK_MaskTemplate_Public | CHECK | `CONSTRAINT CK_MaskTemplate_Public CHECK(MaskMode<>'OMIT' OR SuggestedPublicAllowed=0)` |
| DatasetMaskTemplateUse | PK_DatasetMaskTemplateUse | PRIMARY KEY | `Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DatasetMaskTemplateUse PRIMARY KEY` |
| DatasetMaskTemplateUse | DF_MaskTemplateUse_Applied | DEFAULT | `AppliedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_MaskTemplateUse_Applied DEFAULT SYSUTCDATETIME()` |
| DatasetMaskTemplateUse | FK_MaskTemplateUse_Template | FOREIGN KEY | `CONSTRAINT FK_MaskTemplateUse_Template FOREIGN KEY(TemplateId) REFERENCES uqp.DatasetMaskTemplate(Id)` |
| DatasetMaskTemplateUse | CK_MaskTemplateUse_Values | CHECK | `CONSTRAINT CK_MaskTemplateUse_Values CHECK(DatasetId>0 AND TemplateRevision>0 AND SensitivityVersion>0 AND AppliedBy>0)` |

總計 3 PK、2 UQ、2 FK、8 CHECK、8 DEFAULT。PK 預期 Clustered，UQ Nonclustered，鍵方向 ASC。
`FK_PublicDisplay_Dataset` DELETE CASCADE／UPDATE NO ACTION；`FK_MaskTemplateUse_Template` DELETE／UPDATE NO ACTION。
MaskTemplateUse **刻意沒有 Dataset FK**，保留刪除 Dataset 後歷史，不能判為遺漏或補 FK。

| Index | 鍵（ASC） | INCLUDE | UNIQUE／Filter | 正式證據 |
|---|---|---|---|---|
| IX_MaskTemplateUse_Template | TemplateId,DatasetId | ColumnName,TemplateRevision,SensitivityVersion | 否／無 | 尚缺 |
| IX_MaskTemplateUse_Dataset | DatasetId,ColumnName,Id | 無 | 否／無 | 尚缺 |

三表預期無 Trigger；正式 Trigger／Computed 詳細結果尚缺。PK／UQ 的 backing indexes 另計，不能誤以「兩個明確 Index」排除它們。

### Runtime SQL 使用情況

| 表 | SELECT | INSERT | UPDATE／DELETE | 入口與安全依賴 |
|---|---|---|---|---|
| DatasetPublicDisplayPolicy | read() SELECT *；版本／敏感政策對照；get／getInTransaction | save() 初次確認寫入 | save() 以 RowVersion CAS 更新；未找到此 Repository 的直接 DELETE；Dataset FK 可 CASCADE | datasetPublicDisplay.routes 管理旗標；Dashboard query mode、device management、device page、query source execution 另讀 getInTransaction／get，不依管理旗標證明不用 |
| DatasetMaskTemplate | list／save 讀現況；recordTemplateApplications 重驗 Revision／active／mask | save() 寫 CreatedBy／UpdatedBy；獨立 DDL seed 可省略兩欄 | save() CAS 更新 Revision、UpdatedBy、UpdatedAtUtc；未找到 Runtime DELETE | maskTemplate.routes；MANAGE_SETTINGS／DESIGN_QUERY；exact Schema gate、Audit |
| DatasetMaskTemplateUse | 模板列表按 Dataset／Column 取最新歷史並標記 CURRENT／HISTORICAL／DELETED_DATASET 等 | datasetSensitiveColumn.repository.replaceDatasetSensitiveColumns → recordTemplateApplications，驗證模板後追加應用證據 | 未找到 Runtime UPDATE／DELETE；唯讀歷史不等於未使用 | 同一敏感政策寫入交易／版本；非空 applications 會要求 925 schema；不能因 mask 管理旗標關閉就推定此路徑不可到達 |

CreatedBy／UpdatedBy 的 NULL 與 seed 未指定操作者欄位相容；Runtime 新建時填 actor、更新時填 UpdatedBy，不構成要求既有 NULL 改為 NOT NULL。
三表均列 ACTIVE（Repository 功能／歷史證據用途），不宣稱正式流量或資料量已觀測。

### 既有 exact Catalog 與 Ledger

`datasetDisplaySchema.ts` 的 `displayCatalogSql` → `validateDisplayCatalog(sets,ddl)` → `requireDisplaySchema()` 同時供 Runtime／installDataset925 使用。
七組 resultsets 必須依序具備：3 表、34 欄位、16 CHECK/DEFAULT、13 index-column 列（7 個實體索引）、2 FK-column 列、0 Trigger、visible=1。
這些是預期，不是本次已收到的正式 row counts。
CHECK／DEFAULT 用既有 canonicalDisplayExpression 的受限語法比較，不能自行刪括號弱化布林／NULL 語意。
目前 validator 另有覆蓋界線：不查 Identity seed/increment、Computed 旗標；只強制明確指定的 Collation；PK/UQ 主要驗證 backing index，沒有獨立 sys.key_constraints 身分結果。完整矩陣應補充這些證據，不改 validator、不以三個表名代替 exact 判定。
`installDataset925` **不寫 SchemaMigration**；先前回合提供「925 無 Ledger」屬歷史資訊，本輪未提供新的 925 Ledger 明細。不能據無紀錄推論沒安裝或無用途。
結論：CreatedBy／UpdatedBy NULL 設定 **MATCH**；其餘正式一致性 **UNKNOWN／待證據**；目前沒有已確認的 925 Schema Drift，也不能回報完整 EXACT_MATCH。

## 922：歷史搜尋與正式證據缺口

本地 repository 不是 shallow；本輪執行 `git log --all -- '*922*'`，可達歷史沒有符合路徑。現有 migration inventory／prerequisites 沒有 922；server/src 的 922 精確文字只有 923 Catalog 的「無依賴／獨立結果集」註解，沒有找到 Runtime SQL／installer prerequisite。
這個範圍不涵蓋不可達／已刪除遠端分支、正式部署包或其他系統；也不能從空搜尋推出從未部署。
**更正 D5-C-3 的現況表述：本輪尚無獨立正式 922 Ledger 查詢證據，不能繼續把「Ledger 無紀錄」當已證實事實。**
922 的歷史內容／正式安裝狀態保持 UNKNOWN；不新增空 922、不猜物件名稱、不推定為 UNUSED_CONFIRMED，亦不從 923 Ledger 推導 922 狀態。

## 926：Repository 明確，當前正式狀態待證據

來源：[926 Migration](../database/migrations/926_dashboard_device_lifecycle.sql)，machine inventory 有原 SHA 與 prerequisites 025／900／918。
`migrate.ts` 掃描此 SQL，提供同一 `deviceLifecycleSchemaSql` 的完整性檢查；查狀態可能 bootstrap Ledger，本輪不執行 status／adopt／apply。
搜尋現有 installer，未找到獨立 926 installer；923／924／925 installer 不負責部署 926。
Runtime：[dashboardDeviceLifecycleSchema.ts](../server/src/modules/dashboard/dashboardDeviceLifecycleSchema.ts) attestation → dashboardDeviceManagement.repository.lifecycleReady()；失敗 503 `DASHBOARD_DEVICE_LIFECYCLE_SCHEMA_REQUIRED`，不自動安裝。

| 正式待核對物件 | Repository 預期 | 本輪正式證據 |
|---|---|---|
| SchemaMigration：926_dashboard_device_lifecycle.sql | 安裝事實與 Catalog 分開核對 | 尚缺當前 Ledger 結果 |
| DashboardDisplayDevice.SuspendedAtUtc | DATETIME2(0) NULL，非 Computed，無 DEFAULT | 尚缺 |
| DashboardDisplayDevice.ReenrollmentRequired | BIT NULL，非 Computed，無 DEFAULT | 尚缺 |
| CK_DashboardDevice_LifecycleTerminal | 不允許撤銷／封存裝置保持啟用 | 尚缺 definition／enabled／trusted／NFR |
| CK_DashboardDevice_LifecycleSuspended | 暫停狀態、重新註冊及 grant 清除契約 | 同上 |
| CK_DashboardDevice_LifecycleEnrollment | nullable legacy marker／重新註冊與終止狀態契約 | 同上 |
| TR_DashboardDevice_Lifecycle | AFTER UPDATE、啟用、非 NFR，保護不可逆終止時間 | 尚缺母表／事件／definition／hash；來源 attestation 固定 SHA2_256 0x0f3259251e812fdc2e3acc303e0c469cf2aaf4590035099336da72b0dae4abfb |

926 不新增表；不能從現有 DashboardDisplayDevice 表存在推定新增欄位／Constraint／Trigger 已安裝。先前提供「尚未正式執行」保留為歷史背景，本輪不冒稱已查當前不存在或已存在。

## 使用分類與可安全清理候選

沿用 D5-C-3 的來源使用分類／計數，不把正式存在與使用用途混為一談，也不把 924／926 未確認安裝的宣告計入正式物件數。

| 物件／來源 | 使用分類 | 保留理由 |
|---|---|---|
| 923 FieldSnapshot／Scope／Decision／Sequence | ACTIVE（Repository 功能） | 有 Runtime／宣告相依；正式存在，零筆資料不構成閒置證據 |
| 923 SecurityConfirmation | LEGACY_REQUIRED | exact Catalog／安裝相容性；尚無直接掛載 DML，不可刪 |
| 924 ScopeBinding 及專用來源 | ACTIVE（Repository 可選功能）；正式 NOT_FOUND | Scope／metadata 初始化依賴；不把草稿視為正式已安裝表 |
| 925 三表與獨立來源 | ACTIVE | 管理／播放政策讀取、CAS 寫入、模板使用歷史；nullable 操作者欄位合法 |
| 926 SQL 腳本 | MIGRATION_ONLY | 必須保留歷史升級來源；Runtime 欄位／Constraint／Trigger 另有用途，正式安裝狀態待證據 |
| 922 未知歷史與任何未具外部證據的清理候選 | UNKNOWN | 未取得獨立正式 Ledger／歷史內容或外部相依否定證據 |

**UNUSED_CONFIRMED：0；可安全清理候選物件：無；刪除檔案：0；Cleanup Migration 建議：無。**
SQL Server Express 本身不提供 SQL Server Agent，但不能因此排除 Windows Task Scheduler 或外部主機的排程。未取得正式 View／SP／Trigger／synonym、跨 DB consumer、外部 SQL Agent／Windows 排程、報表／ETL／ODBC／第三方相依性否定證據，不批准刪除任何欄位、索引、Constraint 或物件。

## 下一輪仍需的正式證據

1. 922 獨立 Ledger 查詢結果；若有紀錄，需實際檔名／時間與部署來源，不能補造 SQL。
2. 923 歷史部署檔／commit／manifest；結構 PASS 與來源證明分開。若要求重現 exact validator，另需原始結果、compatibility／可見性資訊，而不是使用 synthetic 測試 envelope 充當正式證據。
3. 924 正式功能啟用需求／非敏感旗標觀測、Permission／RolePermission 的唯讀證據、受限 DB principal 的有效權限、Provider 與獨立安裝相容性審查。
4. 925 全部 columns／CHECK／DEFAULT／PK/UQ／FK／Index／Trigger／visibility 結果；CreatedBy／UpdatedBy 可 NULL 已確認，不再列為待修 Drift。
5. 926 當前 Ledger 與上述新增欄位／Constraint／Trigger 的 Catalog 結果。
6. 外部報表、排程、第三方、DB module 依賴及查詢擷取 provenance。沒有這些證據仍保留 UNKNOWN。

## 本輪檢查與停止點

只執行離線清冊來源／hash／分類計數驗證、Markdown 連結及 git diff 檢查；不跑完整 Server／Client／Browser 回歸，不手動啟動完整 CI。
未更動 machine inventory／任何歷史 Migration／驗證工具／Runtime／權限；五份文件更新後提交目前 PR 分支並停止等待審查。
