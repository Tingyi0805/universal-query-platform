# BUG-002 下一階段：版本綁定收集與 Schema 審查稿

> Schema、Owner Scope 與 Fence 的定案以 [923 決策](dataset-metadata-923-owner-fence-decision.md) 為準；本稿保留收集 Fixture 及前版設計歷史。

基準 `5c16edee3e6d9a784d9f635395c2a0dbc4cca923` / CI #887 Success / Draft PR #66。本稿沿用 [BUG-002 根因](dataset-sensitive-initialization-bug002.md)，不重新提出既有可行性研究。

## 本次實作邊界

`createSavedDatasetMetadataCollection` 是 **SYNTHETIC_TEST_ONLY、未掛載 API、未建立正式 Repository 的收集子流程**。Fixture 呼叫既有 `SqlServerAdapter.describeQuery`，以 Mock `mssql.ConnectionPool` 驗證實際 adapter 呼叫的 RPC／參數；不是另做一個假描述器，也沒有連真實 SQL Server。Port 沒有 executeQuery、同步欄位、分類確認或交付方法。

流程：

1. Command 只能指定已儲存 Dataset 的精確 BIGINT 字串 ID、actor/request ID 與預期 Definition／Configuration RowVersion；不能傳 SQL、參數值、欄位或 CONFIRMED。
2. Reader 提供明確投影的合成 saved snapshot。檢查 Dataset／Source 啟用狀態、SQLSERVER／engine major 15、來源 ID、完整已存參數、base contract MISSING／UNCONFIRMED、來源 reference。所有 ID、TokenVersion、revision 禁止 Number 修復。
3. 使用既有 SQL_UTF8_EXACT_V1／SAVED_PARAMETER_SNAPSHOT_V1 digest，綁定原始 SQL bytes、來源 ID、兩個真實版本欄位的模型值及完整參數投影，不使用既有 Number mapper。空集合的 digest 仍不是 confirmed empty native contract。
4. 第一版僅允許**無 token 且已存參數集合為空**。現有 921 無可信 native declaration issuer，所以 SCALAR／FIXED_LIST、未使用但仍保存的參數、未知 bind、Oracle／其他版本來源均在 RPC 前拒絕；不猜型別、不選樣本值、不建立新 LIST 展開規則。未改 A2／A3 或 Runtime。
5. 合成授權 provider 必須回傳當前 DESIGN_QUERY + EXECUTE_QUERY、active、scopeAllowed、TokenVersion、AuthorizationEpoch、scope revision 與 actor/dataset/source 對應。重驗前後不得改變；**這些 provider 尚無正式實作**。
6. 外部 SourceEvidenceProvider port 與平台 Reader 分開；只驗證既有 B2 合成 source identity/generation/lease 契約及有效區間。沒有聲稱它們共用交易。來源觀測必須與 snapshot 的 source reference 相符，過期、identity/generation/lease 改變即拒絕。
7. 重驗後只發出 `sys.sp_describe_first_result_set` RPC，原有 adapter 使用 typed `tsql/params/browse_information_mode`，不呼叫資料 query，不讀原始資料列，完成 close 才處理結果。
8. 投影只有 name/type/ordinal；拒絕空或不連續欄位、大小寫重複別名、控制字元、不良 Unicode、hidden/error 欄位、不完整型別及額外 rows／CONFIRMED payload。暫支援 int/bigint/bit/date/datetime2(0..7)、nvarchar(1..4000|max)、varchar(1..8000|max)、decimal(p<=38,s<=p)，其餘明確拒絕。不依 NAME/MRN/PHONE/PAT_NAME 推定任何分類。
9. 描述後及合成 attempt audit 後再次完整重讀比對。Attempt 只記錄 actor/request/dataset、binding/columns digest，精確 Audit ID 不能是 Number；不保存 SQL／參數值，不把 receipt 格式有效視為持久化。失敗不產生收集結果；既有規則完全不動。

輸出是帶版本 reference 的 **UNBOUND_CANDIDATE**，仍保留 requiresExecutionComparison=true、metadataState=NOT_INITIALIZED、classificationState=UNCONFIRMED、authority=NONE、runtimeBindVerified=false、deliveryAllowed=false、persistence=NOT_PROVEN、productionSafetyProven=false。沒有 CAS 更新或持久交易；預期版本／重讀比對只驗證模型的 optimistic precondition，**不是 SQL CAS、SQL rollback 或 absence-of-ABA 證明**。合成 attempt audit 不是 Decision/Audit durable proof；final revalidation 失敗時先前 attempt 仍可能存在。

## 真正解除初始化需要的最小 Schema

**需要新 Migration；本次只提交設計，沒有 Migration 檔或 DDL。建議暫用 923（待維護者核准編號）**，避免占用 B1/B3 已規劃的 922 Review/AuthorizationEpoch sidecar。923 不得假設 922 已安裝，不改 001–921，不能放寬 921 的 UNCONFIRMED CHECK。精確 catalog／安裝狀態不符則整個功能停用。

下列三張表與一個決策 ID Sequence 為審查起點；正式 DDL／Repository 必須在核准後另案製作。

| 物件 | 欄位與型別 | 約束／索引 |
|---|---|---|
| DatasetFieldSnapshot | Id BIGINT IDENTITY；DatasetId/DataSourceId BIGINT NOT NULL；PlatformIncarnation/SourceIdentity UNIQUEIDENTIFIER NOT NULL；DefinitionVersion/ConfigurationVersion BINARY(8) NOT NULL；BaseContractVersion BINARY(8) NULL；SqlDigest/ParameterDigest/NativeTypesDigest/ColumnsDigest/CollectorEvidenceDigest BINARY(32) NOT NULL；SourceGeneration/LeaseVersion BINARY(8) NOT NULL；LeaseId UNIQUEIDENTIFIER NOT NULL；SourceCollation NVARCHAR(128) NOT NULL；NativeBindingsJson/ColumnsJson NVARCHAR(MAX) NOT NULL；Collector/Codec/Plan/DriverVersion NVARCHAR(64) NOT NULL；CollectedAt/ExpiresAt DATETIME2(7) NOT NULL；State NVARCHAR(16) NOT NULL；StateRowVersion ROWVERSION | PK Id；FK Dataset/Source NO ACTION；CHECK State IN(DESCRIBED,INITIALIZED,INVALIDATED,EXPIRED)、ExpiresAt>CollectedAt、ISJSON(NativeBindingsJson)=1、ISJSON(ColumnsJson)=1；IX(DatasetId,State,Id) INCLUDE(DefinitionVersion,ConfigurationVersion)；NativeBindingsJson 保存型別、SCALAR/FIXED_LIST 與固定長度，須對應 NativeTypesDigest；兩個 JSON 分別 DATALENGTH<=1048576，ColumnsJson 限 4096 欄，完整結構與唯一 ordinal/alias 由受控 Writer 驗證。INITIALIZED **不能只由 descriptor 或 UI 寫入** |
| DatasetSecurityConfirmation | DatasetId BIGINT PK/FK NO ACTION；SnapshotId BIGINT FK NO ACTION；Classification NVARCHAR(24) NOT NULL；SensitivityVersion BIGINT NOT NULL；PolicyDigest BINARY(32) NOT NULL；PatientConfigurationVersion BIGINT NULL；PatientKeyAlias NVARCHAR(128) NULL；AuthorizationEpoch BINARY(8) NOT NULL；ReviewerId BIGINT NOT NULL；ReviewerTokenVersion BIGINT NOT NULL；ReviewScopeVersion BINARY(8) NOT NULL；DecisionId BIGINT NOT NULL；State NVARCHAR(16) NOT NULL；StateRowVersion ROWVERSION | CHECK Classification IN(NON_PATIENT_PUBLIC,NON_PATIENT_SENSITIVE,PATIENT)、SensitivityVersion>0、TokenVersion>0、State IN(PENDING,ACTIVE,REJECTED,REVOKED,INVALIDATED)；PATIENT 必須有正 patient version/key，A/B 必須兩者 NULL；FK Snapshot NO ACTION；DecisionId 為精確 reference、不建回指 FK，須同交易 Reader 驗證存在，避免 SQL Server 不支援 deferred FK 的循環；IX(SnapshotId,DatasetId)。跨表 Dataset/Source 對應、policy digest 與版本一致性須同交易 Reader 驗證 |
| DatasetSecurityDecision | Id BIGINT PK，DEFAULT NEXT VALUE FOR uqp.DatasetSecurityDecisionSeq；DatasetId/SnapshotId BIGINT FK NO ACTION；RequestId UNIQUEIDENTIFIER NOT NULL UNIQUE；ActorId BIGINT NOT NULL；ActorTokenVersion BIGINT NOT NULL；AuthorizationEpoch/ReviewScopeVersion BINARY(8) NOT NULL；Action/ReasonCode NVARCHAR(32) NOT NULL；PreviousState/NextState NVARCHAR(16) NOT NULL；Previous/NextStateVersion BINARY(8) NOT NULL；Snapshot/PolicyDigest BINARY(32) NOT NULL；AuditLogId BIGINT NOT NULL；TransactionReference/PlatformIncarnation UNIQUEIDENTIFIER NOT NULL；DecidedAt DATETIME2(7) NOT NULL | CHECK 正 ID/TokenVersion、Action IN(CONFIRM,REJECT,REVOKE,INVALIDATE)、固定去敏 reason enum／合法狀態轉移；IX(DatasetId,Id)。append-only 需 DB grants、Writer/CAS 與禁止 UPDATE/DELETE 契約，不能僅靠命名保證。AuditLogId 不對 online AuditLog 建 FK，以保留 archive/retention 能力 |

必要補充規則：

- `DatasetSecurityDecisionSeq` 為 BIGINT Sequence，START WITH 1、INCREMENT BY 1、MINVALUE 1、MAXVALUE 9223372036854775807、NO CYCLE。只由 Writer 在 SQL 層預留精確 ID；Sequence 不具交易 rollback 保證，gaps 合法，不代表 ROWVERSION 或持久化證據。

- Snapshot 是 immutable payload；失效只推進 state/version，不覆寫內容。租約完整可驗證證據置於核准 evidence store，以 CollectorEvidenceDigest 關聯，不把 UUID/hash/TTL 當權威。source generation 實際型別與 incarnation 協定須由可信 collector/DBA 驗收後定案；若無單調 BINARY(8) 合約，必須先調整設計，不能截斷成此型別。
- 新確認權限建議 `CONFIRM_DATASET_CLASSIFICATION`，必須由管理員明確授予經核准的資料負責人角色；DESIGN_QUERY 不自動包含。審查 actor、Dataset/Source scope、TokenVersion、權限與 scope revision 都由後端重讀，不接受前端布林聲明。若需要逐 Dataset owner grant 而非核准的全域 reviewer role，另需 scope table；不能假裝現有 ACL 已提供這個功能。
- Reader 在 SQL 層 CONVERT(VARCHAR(20), BIGINT) 取得精確 ID；BINARY(8)/ROWVERSION 轉固定 16 碼 hex。禁止 Number 反轉。Audit/Decision 精確 receipt、archive reader 與保存策略仍為未實作前提。
- 歷史 ActorId 不由 current AppUser 刪除 cascade 清空；使用 immutable actor reference，帳號刪除／匿名化須另訂保存政策。Decision 保存去敏核心證據，不依賴可截斷 ParametersJson；Snapshot 刪除須受引用／保留規則限制。

描述契約目前要求 execution comparison。不得為了啟動初始化而先執行正式資料 SQL；必須另證明 metadata-only 的受限 SQL／Binding 集合足以建立可信 metadata，或以核准隔離驗收補足必要證據。未解決這個前提前，即使 Schema 已裝也不能寫 INITIALIZED。

## CAS／分類確認及保留規則

核准後才能建立 owned SERIALIZABLE + XACT_ABORT Writer：共同 owner/gate 與完整 scope → 讀預期 Snapshot/StateRowVersion、Dataset/Source/Parameter/Policy/Patient 版本 → 重驗當前 reviewer 權限 → 驗證外部 source lease → CAS affectedRows=1 → immutable Decision + mandatory Audit → 最終授權/版本/source 重驗 → commit。Writer 先由 SQL Sequence 預留 DecisionId；單次 CAS 寫入該 reference 並以 OUTPUT 取得真正 NextStateVersion，再 INSERT 完整 immutable Decision、Audit，最終 Reader 驗證所有 reference。Confirmation 不對 Decision 建立即時 FK；避免循環 FK、未知 ROWVERSION 的佔位值，或補寫 head 導致第二次 ROWVERSION。Decision 提交後禁止修改。

這是**待實作交易設計**。不能將外部 source observation 宣稱屬於平台 DB transaction；必須由真實 DDL fence/lease 覆蓋描述、確認、執行、交付窗口。Gate 為合作式；外部 DBA、舊 Worker、混合版本、FK/trigger 寫入及 lock order 未驗證時 fail-closed。1205/1222、rollback failure、commit unknown 不回報成功；RequestId 只允許相同決策冪等讀取，不可用新內容重放。

- A：trusted initialized field snapshot + 具授權且綁版本的 owner decision + 已確認空政策；沒有 checkbox 解鎖路徑。
- B：同上，由使用者選欄位／CUSTOM/FULL/OMIT，再確認 policy version；沒有患者設定是未分類狀態，不能視為 B。
- C：同上，另須明確患者 key、有效 HMAC/config version、audit-only OMIT 與逐次 disclosure 成功。普通模式不能覆蓋 C。
- SQL、來源配置／identity／generation、參數、LIST arity、policy、reviewer/ACL 或 incarnation 變動均使舊確認失效；A→B→A 也須新 revision。保留舊敏感規則與歷史，停止交付；欄位消失不能自動清規則。殘留舊列不代表有效 evidence。

## 來源 DDL 與驗收閘門

目前沒有正式 generation/lease provider，**BLOCKED**。需要 DBA 驗證依賴集合（View/Table/Function/Synonym/跨 DB）、來源及還原 incarnation、DDL/GRANT/REVOKE 的可信世代推進和可強制 fence。ROWVERSION、modify_date、descriptor digest、TTL、平台 SERIALIZABLE 不等效。只有描述後重讀版本，無法防止觀測不到的來源 A→B→A 或確認後 DDL。

| 驗收 | Fixture 能證明 | 真實 SQL Server 2019 還缺 |
|---|---|---|
| Metadata-only | adapter 只 execute describe RPC、typed inputs、close，不 query/讀 rows；投影欄位嚴格檢查 | 隔離 Instance／TLS／最小權限帳號、RPC 可用性、取消／超時／cleanup、限制 SQL 的副作用與索引/Plan 證據 |
| 綁定與失效 | command/saved snapshot、SQL/完整參數 digest、source reference、權限與重驗 drift 拒絕 | 精確 Repository projection、DB-generated revisions、snapshot 完整性、可信 Native Binding 與固定 LIST、執行結果交付前結構比對 |
| DDL/權限 | 合成 identity/generation/lease 變更或過期會拒絕 | 雙連線 barrier、跨 DB DDL/GRANT/REVOKE、ABA、外部 Writer、備份還原，fence 覆蓋至交付完成 |
| CAS/Audit | 只有 optimistic model precondition 與 attempt receipt 格式；無持久化保證 | 新 Schema、共同 lock order、原子 CAS/Decision/Audit、精確 Reader、1205/1222/斷線/commit unknown、archive/retention |

**判定**：收集子流程 Fixture 可測；A/B/C 新建網站初始化、欄位選擇與正式預覽仍 BLOCKED，沒有新成功操作入口。UI 僅補充具體前提，不將 Fixture 欄位加入敏感或患者選單。既有設定回歸保留；D0B SQL_LOCK_VERIFIED 與正式 Native Runtime 限制未解除。

下一個最小階段：先審查 923 persistence／owner confirmation 設計與逐 Dataset scope 需求，再指定隔離 SQL Server 2019 驗收環境及可信 source generation/fence 方案。未核准前不產生／套用 DDL，不新增正式 Writer 或 evidence issuer；參數與 LIST 繼續拒絕。

本機驗證：收集 Fixture 52 項（包含於 Server 全量 1,510／1,510）、Client 單元 37／37、Playwright 123／123；Server/Client typecheck、build 通過。這些是合成／Mock 回歸結果，不代表真實 SQL Server 驗收、CAS rollback 或 D0B SQL_LOCK_VERIFIED。
