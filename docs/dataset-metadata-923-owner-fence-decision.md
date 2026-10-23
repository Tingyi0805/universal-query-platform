# BUG-002：923、Owner Scope 與 SQL Server 2019 Fence 決策

基準 `e08ac9f063ce8756d79e327c6905ab8e5a2914e2` / CI #888 Success / Draft PR #66。承接 [前稿](dataset-metadata-initialization-next-stage.md)；本文覆蓋其 Schema／授權尚未定案部分。不改程式、API、Migration 001–921、JWT_SECRET 或 Native Runtime，不連 DB、不執行 Migration。

## 決策

| 項目 | 判定 | 實作決策／解除條件 |
|---|---|---|
| 原三表＋Sequence 前稿 | NEEDS_CHANGE | 加逐 Dataset Scope、明確授權向量、首次 CAS、來源世代型別、狀態分層與歷史約束；以下為修訂後規格 |
| 修訂後 923 Schema | GO | 可批准進入**Migration 原始碼、catalog validator 與離線測試**實作；不代表准許套用或啟用確認／交付 |
| Dataset Owner Scope | GO | 必須新增 DatasetSecurityScope；直接指定 AppUser，不以 Role 或全域 Permission 自動取得 Dataset 範圍 |
| Source Fence 與正式初始化／交付 | BLOCKED | 缺實際來源管理端、封閉 DDL/權限 Writer 邊界、有效鎖持有證據及隔離雙連線驗收；下列 F1–F6 全部通過才可另案批准接線 |

**923 不依賴 922，不建立或冒用全域 AuthorizationEpoch。** 922 未裝時仍可單獨安裝空的 923 sidecar；任何正式功能仍由獨立 readiness gate 關閉。不得把 sidecar 安裝成功、SOURCE_BOUND、Owner 確認或 Fixture 成功解讀為 runtimeBindVerified、SQL_LOCK_VERIFIED 或 deliveryAllowed。

## 1. 最終資料物件與型別

最小範圍為 **四張表＋一個 Sequence**。既有 DatasetSensitiveColumn／PatientAuditConfig 不移轉、不自動清空。前稿三表未在 DB 建立，以下是設計替換，不是變更已安裝 Schema。

共同規格：ID 為正 SQL BIGINT；SQL 層 CONVERT(VARCHAR(20),ID) 後以 canonical 十進位字串讀取，禁止 Number 反轉。真 ROWVERSION 與採集版本分開：自己的狀態列用 ROWVERSION，引用的 Definition/Configuration/Scope 版本用 BINARY(8)，對外固定 16 碼 hex，不能推測 +1。Digest 用 BINARY(32)；UUID 用 UNIQUEIDENTIFIER；UTC 時間 DATETIME2(7)；識別符／固定 enum 使用明確 BIN2 collation（Latin1_General_100_BIN2），不繼承不明 collation。

| 物件 | 最終欄位（未另標 NULL 者 NOT NULL） |
|---|---|
| DatasetFieldSnapshot | Id BIGINT IDENTITY；DatasetId/DataSourceId BIGINT；PlatformIncarnation UNIQUEIDENTIFIER；DefinitionVersion/ConfigurationVersion BINARY(8)；BaseContractVersion BINARY(8) NULL；SqlDigest/ParameterDigest/NativeTypesDigest/ColumnsDigest BINARY(32)；ColumnsJson/NativeBindingsJson NVARCHAR(MAX)；ParameterMode NVARCHAR(16)；CollectorVersion/CodecVersion/PlanVersion/DriverVersion NVARCHAR(64)；CollectedAt/ExpiresAt DATETIME2(7)；State NVARCHAR(16)；StateRowVersion ROWVERSION；SourceIdentity/SourceIncarnation/LeaseId UNIQUEIDENTIFIER NULL；SourceGeneration/LeaseVersion BIGINT NULL；SourceCollation NVARCHAR(128) NULL；CollectorEvidenceDigest BINARY(32) NULL；SourceEvidenceJson NVARCHAR(MAX) NULL |
| DatasetSecurityScope | DatasetId/UserId BIGINT；ScopeKind NVARCHAR(8)；BoundDataSourceId BIGINT；State NVARCHAR(8)；ParentOwnerUserId BIGINT NULL；ParentOwnerKind NVARCHAR(8) NULL；ChangedByUserId BIGINT（歷史 reference）；LastRequestId UNIQUEIDENTIFIER；LastReasonCode NVARCHAR(32)；GrantedAt/ChangedAt DATETIME2(7)；ScopeRowVersion ROWVERSION |
| DatasetSecurityConfirmation | DatasetId/SnapshotId BIGINT；State NVARCHAR(16)；StateRowVersion ROWVERSION；DecisionId BIGINT；Classification NVARCHAR(24) NULL；SensitivityVersion BIGINT NULL；PolicyDigest BINARY(32) NULL；PatientConfigurationVersion BIGINT NULL；PatientKeyAlias NVARCHAR(128) NULL；ReviewerId/OwnerUserId BIGINT NULL；ApproverScopeKind NVARCHAR(8) NULL；ReviewerTokenVersion/OwnerTokenVersion BIGINT NULL；ActorScopeEpoch/OwnerScopeEpoch BINARY(8) NULL；AuthorizationModelVersion NVARCHAR(32)（固定 DATASET_SCOPE_AUTH_V1）；PlatformIncarnation UNIQUEIDENTIFIER |
| DatasetSecurityDecision | Id BIGINT（Sequence default）；DatasetId BIGINT；Kind NVARCHAR(16)；SnapshotId BIGINT NULL；SubjectUserId BIGINT NULL；ScopeKind NVARCHAR(8) NULL；RequestId UNIQUEIDENTIFIER；CommandDigest BINARY(32)；ActorId BIGINT；ActorTokenVersion BIGINT；Action/ReasonCode NVARCHAR(32)；PreviousState/NextState NVARCHAR(16)；PreviousStateVersion BINARY(8) NULL；NextStateVersion BINARY(8)；SnapshotDigest/PolicyDigest/SourceOperationEvidenceDigest BINARY(32) NULL；AuthorizationEvidenceJson/DetailsJson NVARCHAR(MAX)；AuditLogId BIGINT；TransactionReference/PlatformIncarnation UNIQUEIDENTIFIER；DecidedAt DATETIME2(7) |
| DatasetSecurityDecisionSeq | AS BIGINT START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 NO CYCLE；不得重新起號或以它預測 ROWVERSION。rollback 留 gaps 合法 |

SourceGeneration 從前稿 BINARY(8) 改為**來源管理端明定的正 BIGINT 世代**，LeaseVersion 同樣為正 BIGINT；都以精確字串收發。不是來源 table ROWVERSION 或 modify_date。目前 52 Fixture/B2 的 hex generation/lease version 仍只是舊合成契約；正式 SOURCE_BOUND witness 必須另定 V1 codec/port，不能把 hex、雜湊或合成 provenance 偷轉為可信 BIGINT 世代。無法提供這個契約的來源不支援 V1，不能截斷或自行雜湊代替。SourceIdentity 對應管理端 registry 的實體 server/database 身分，SourceIncarnation 是 restore/recreate 後必須更換的世代身分。PlatformIncarnation 由 DB 備份之外的核准 registry 提供；缺 registry 或與持久證據不符即拒絕，不能只讀備份內的舊 UUID 假裝未還原。

### 不可省略的鍵、CHECK 與索引

- **Snapshot**：PK(Id)；UQ(DatasetId,Id)，供同 Dataset 複合 FK；FK DatasetId→Dataset、DataSourceId→DataSource，全部 NO ACTION。State 僅 DESCRIBED/SOURCE_BOUND/INVALIDATED/EXPIRED；不使用含糊 INITIALIZED。ParameterMode 僅 NO_PARAMETERS/UNPROVEN。CHECK ExpiresAt>CollectedAt、兩個必備 JSON 的 ISJSON=1 且 DATALENGTH<=1048576；SourceEvidenceJson NULL 或 ISJSON=1 且 <=65536 bytes。SourceGeneration/LeaseVersion NULL 或 >0。SOURCE_BOUND 必須 ParameterMode=NO_PARAMETERS，且所有 Source/Evidence nullable 欄位非 NULL；完整來源驗證不能只靠這個 CHECK。IX_FieldSnapshot_DatasetState(DatasetId,State,Id) INCLUDE(DefinitionVersion,ConfigurationVersion,ExpiresAt)。另建 IX_FieldSnapshot_Source(DataSourceId,DatasetId,Id) 支援來源 FK/反向失效。payload immutable；SOURCE_BOUND 必須由 verifier INSERT 新的完整證據列，不把 DESCRIBED 原列升級。既有列只允許以 CAS 推進失效／過期狀態，禁止修改內容或延長 expiry。
- **Scope**：PK(DatasetId,UserId,ScopeKind)；UQ(LastRequestId)；FK DatasetId→Dataset、UserId→AppUser、BoundDataSourceId→DataSource，NO ACTION。ScopeKind 僅 OWNER/REVIEWER，State 僅 ACTIVE/REVOKED。OWNER 的 ParentOwnerUserId/Kind 均 NULL；REVIEWER 必須 ParentOwnerUserId 非 NULL、ParentOwnerKind='OWNER' 且 UserId<>ParentOwnerUserId。自參照 FK(DatasetId,ParentOwnerUserId,ParentOwnerKind)→Scope PK，NO ACTION，保證不跨 Dataset。IX_SecurityScope_User(UserId,State,DatasetId,ScopeKind) INCLUDE(BoundDataSourceId,ParentOwnerUserId)；IX_SecurityScope_Parent(DatasetId,ParentOwnerUserId,ParentOwnerKind,State,UserId)。另建 IX_SecurityScope_Source(BoundDataSourceId,DatasetId,UserId,ScopeKind) 支援來源 FK。撤銷保留 tombstone，禁止 DELETE；新 RequestId 的 regrant/rebind 必須更新 ScopeRowVersion，不能復用舊 epoch。
- **Confirmation**：PK(DatasetId)；複合 FK(DatasetId,SnapshotId)→Snapshot(DatasetId,Id)，NO ACTION。State 僅 PENDING/ACTIVE/REJECTED/REVOKED/INVALIDATED；Classification NULL 或 NON_PATIENT_PUBLIC/NON_PATIENT_SENSITIVE/PATIENT；ApproverScopeKind NULL 或 OWNER/REVIEWER。正值欄位若非 NULL 必須 >0。ACTIVE 必須 Classification、policy/version、actor/owner、ApproverScopeKind、兩個 TokenVersion、兩個 ScopeEpoch 皆非 NULL；OWNER 直接確認時 reviewer=owner 且兩套 token/epoch 相同，REVIEWER 時兩個 user 必須不同；PATIENT 另需正 PatientConfigurationVersion 與非空 PatientKeyAlias，A/B 兩者必須 NULL。CHECK 必須寫明 IS NOT NULL，不能讓 SQL UNKNOWN 使不完整 ACTIVE 列通過。Snapshot 的 SOURCE_BOUND、A 的空規則、B 的非空規則、所有版本／digest 與 C 的 key/HMAC/OMIT 由同交易 Reader 驗證；CHECK 不假裝可跨表或驗證外部來源。DecisionId **不建回指 FK**，提交前必須驗證完整 ledger reference。IX_SecurityConfirmation_Snapshot(SnapshotId,DatasetId)。
- **Decision**：PK(Id)、UQ(RequestId)；FK DatasetId→Dataset、複合 FK(DatasetId,SnapshotId)→Snapshot，NO ACTION；Kind=SCOPE 時 SubjectUserId/ScopeKind 非 NULL 且 SnapshotId NULL，FK(DatasetId,SubjectUserId,ScopeKind)→Scope PK；Kind=SNAPSHOT 或 CONFIRMATION 時 SubjectUserId/ScopeKind NULL、SnapshotId 非 NULL。Kind 僅 SNAPSHOT/SCOPE/CONFIRMATION。Action 僅 COLLECT_METADATA/GRANT_SCOPE/REVOKE_SCOPE/CONFIRM/REJECT/REVOKE/INVALIDATE，且與 Kind 對應：SNAPSHOT 只可 COLLECT_METADATA/INVALIDATE，SCOPE 只可 GRANT_SCOPE/REVOKE_SCOPE，其餘為 CONFIRMATION。ReasonCode V1 固定 METADATA_COLLECTED/OWNER_APPOINTED/REVIEWER_APPOINTED/SCOPE_REBOUND/SCOPE_REVOKED/CLASSIFICATION_ACCEPTED/POLICY_REJECTED/AUTHORIZATION_REVOKED/EVIDENCE_CHANGED。PreviousState=MISSING **iff** PreviousStateVersion NULL；其餘必須非 NULL，不用假零版本。Snapshot 的 NextState 僅 DESCRIBED/SOURCE_BOUND/INVALIDATED/EXPIRED；Scope 的 NextState 僅 ACTIVE/REVOKED；Confirmation 的 NextState 為前述非 MISSING 狀態。PreviousState 只允許 MISSING 或該 Kind 的有效狀態；合法 transition 再由 Writer 驗證。必備 JSON 均 ISJSON=1、DATALENGTH<=16384。Actor/Reviewer 歷史 reference 不設 AppUser cascade FK，當前存取仍須找到有效 AppUser。AuditLogId>0，**無 online AuditLog FK**。IX_SecurityDecision_Dataset(DatasetId,Id)；IX_SecurityDecision_Snapshot(SnapshotId,Id)；UX_SecurityDecision_CollectionSnapshot(SnapshotId) WHERE Kind='SNAPSHOT' AND Action='COLLECT_METADATA'，確保每個 Snapshot 僅有一筆建立決策，Scope/確認共用同一個 RequestId namespace。

保留最小索引：不先建逐 actor/owner 的確認反查、跨 Dataset 主體歷史報表索引；撤權靠即時授權向量失效，不靠背景掃描 head。實際 workload/plan 顯示需要時另案補強，不能將索引存在視為 key-range 已驗收。

Snapshot/Scope/Confirmation 的保守 default 分別為 DESCRIBED/REVOKED/PENDING，不自動產生有效授權。引用的非 NULL 版本不得是全零 BINARY(8)。Scope 的 GrantedAt 保留初次指派時間；ChangedAt/ChangedByUserId/LastRequestId/LastReasonCode 描述最新異動，歷史由 Decision 保留，不以時間欄位充當 epoch。

四表 PK 均 CLUSTERED；其他 UQ/IX/UX 均 NONCLUSTERED，除 UQ/UX 外不強加唯一性。Snapshot 的 UQ(DatasetId,Id) 為複合 FK 所需，不能因 Id 自身唯一而省略。表名對應 PK_<Table>；UQ/CK/FK 在 DDL 原始碼中給固定名稱，catalog validator 必須比對欄位順序、定義、trust/disabled/filter，而非只看同名存在。這些型別、ISJSON、Sequence、filtered unique index 與單表單 ROWVERSION 均為 SQL Server 2019 支援的語法；不使用 deferred FK、JSON 原生型別或 cascade，沒有 JSON/MAX 欄位作 index key。實際 catalog/lock 行為仍以 F1 驗收，不把語法相容當鎖定證明。

所有 identity/decision/reference ID 必須 >0；Snapshot/Decision 引用將阻止 Dataset/Source 硬刪，不可用 cascade 清歷史。第一版不提供歷史清除 Writer。既有 deleteUser 只查 online AuditLog/PublishedQuery、會刪 UserRole/UserQueryAccess/AppUser；有 Scope tombstone 的使用者須保留帳號列並停用，硬刪由 FK 拒絕。啟用 Scope 管理前需補明確拒絕與停用指引，不能關 FK 或自動刪 Scope 來維持舊刪除行為。

## 2. Owner／Reviewer 授權與失效

1. `CONFIRM_DATASET_CLASSIFICATION` 是能力門檻，與 DESIGN_QUERY 分離，**能力 ∩ 指定 Dataset Scope ∩ 現行帳號／角色有效性**才可確認。Dataset 建立者、SYSTEM_ADMIN、相同單位名稱／代碼或持有全域 Permission 均不自動得到 Owner Scope。組織單位不由 Dataset 名稱或 Source 名稱推測；SYSTEM_ADMIN 根據核准的責任指派 reference，明確選 Dataset/User。
2. 管理 Scope 須後端即時驗證 active AppUser 持有 active、IsSystem=1、Code=SYSTEM_ADMIN 的真實 Role，並具獨立 MANAGE_DATASET_SECURITY_SCOPE；不能只信 JWT permission 字串或讓其他角色轉授。管理員可以明確指派自己，但仍是可稽核的指派，不能直接略過 Scope 確認。923 seed Permission 時不新增 Owner/Reviewer grant；未授予管理權限前 Writer 拒絕。
3. OWNER 可直接確認；REVIEWER 是 SYSTEM_ADMIN 指派、綁同一 Dataset OWNER 的委任 reviewer，也可確認；本版**不新增強制雙簽流程**。Reader 同時驗證 reviewer 與 parent OWNER 的 active scope、帳號／能力、BoundDataSourceId 等於目前 Dataset.DataSourceId。改綁 Source ID 後必須先由管理員 rebind scope；不得沿 Query/Dashboard 自動移轉。
4. 授權向量 V1=`PlatformIncarnation + DatasetId + BoundDataSourceId + ActorScopeEpoch + OwnerScopeEpoch + ReviewerTokenVersion + OwnerTokenVersion`，加即時有效 Role/Permission/scope 判斷。ScopeEpoch 是所指 scope 列的 ScopeRowVersion；OWNER 直接確認時兩個 scope epoch/TokenVersion 指向同一 owner。移除前稿的全域 AuthorizationEpoch 欄位，不把局部值填進 Native Review B2 的全域 epoch 契約，也不以 ACL hash/UpdatedAtUtc 當 epoch。
5. grant/revoke/reparent/rebind 同交易更新對應 Scope 列＋Decision＋強制 Audit；revoke OWNER 不必改寫所有 reviewer，但 parent 狀態／epoch 已使其確認立即失效。任何 actor/owner 停用、角色／能力異動或 TokenVersion 變化，同樣使舊確認失效；恢復後必須新決策，不能讓 ACTIVE 舊列自動復活。Reader **每次准入重驗簽署者向量**；背景把 head 標 INVALIDATED 只是維護，不是撤權生效的必要條件。
6. 既有 `updateUser` 對角色／啟用異動推進 TokenVersion；`updateRole` 對權限／啟用異動推進成員 TokenVersion；reset password/logout 也會失效 session。Migration 019 定義 TokenVersion 為正 INT：溢位必須 rollback/拒絕，不可歸零。這些是具體可沿用機制，**不是所有 Writer 已覆蓋的證明**。直接 UserRole/RolePermission/Permission SQL、外部 DBA、舊 Worker、mixed deployment 未納入或未經停機重驗時，正式確認／交付 gate 必須關閉；將來 922 全域 AE 只能作額外條件，不能取代逐 Dataset scope。
7. Author/collector 仍按既有 DESIGN_QUERY+EXECUTE_QUERY 管理權限取候選；Owner/Reviewer 的確認能力不要求能編輯 SQL 或執行資料查詢。未來可信欄位/政策審查入口只回傳獲授權 Dataset 的必要 metadata，不能順帶授予資料列權限；現有 Designer/敏感 API 的 guard 不直接放寬。政策實際改寫需由新 owned confirmation transaction 驗證 scope、可信欄位、預期 policy version，更新規則/版本並與 Head/Decision/Audit 一起提交，保留原 Dashboard guard；不得呼叫會自開/自提交交易的既有 helper 冒充原子更新。
8. 首版不提供 Role-based Owner grant、跨 Dataset delegation 或單位自動繼承。沒有直接 scope，確認其他 Dataset 即拒絕；授予全域 Permission 也不能改變此結果。查詢／預覽／匯出使用者仍另須通過原 RBAC/Query ACL；Owner 授權不等於資料查閱權。

## 3. CAS、冪等、稽核與安裝

- RequestId 全 ledger 唯一；CommandDigest 覆蓋 Kind、actor、目標、完整期望版本、payload/reference。相同 RequestId＋相同 digest 僅回讀既有結果，**不重寫 head/scope、不再次推進 revision**；不同內容衝突。冪等恢復仍須驗證呼叫者／原 actor 對應與目前的歷史讀取權限，不能只憑 UUID 查其他 Dataset。回讀歷史決策也不授予目前交付資格。
- 新 Scope／Confirmation 的首次 CAS 允許 expected=MISSING + PreviousStateVersion=NULL；必須在共同 owner 的 SERIALIZABLE 交易鎖住 PK 空 predicate，唯一鍵衝突使其中一方失敗。既有列要求 expected ROWVERSION、affectedRows=1。不得在缺列時猜一個舊版本。
- Writer 先取 G、識別完整 scope 與既有 Dataset→Dashboard／Dashboard→ACL 保護，再依共同 acquisition 協定鎖定；確認時另持有效 Source Fence。Sequence 在 SQL 層預留 ID → 單次 CAS 寫 head 的 DecisionId（或 scope 的 LastRequestId）並 OUTPUT 真正新 ROWVERSION → 同 transaction 精確 Audit INSERT/OUTPUT → 用真實 AuditLogId INSERT 完整 Decision → 最終版本／授權／source 重驗 → commit。DecisionId 無回指 FK，避免 SQL Server 無 deferred FK 造成循環，也避免補寫 head 再改 ROWVERSION。
- Snapshot 建立同樣寫入 Kind=SNAPSHOT 的 immutable Decision 與精確 Audit；Snapshot INSERT OUTPUT 取得 Id/RV 後即可寫 ledger，無回指 FK。Snapshot 建立、Scope 或分類確認任一步失敗都不能留下無對應 ledger/audit 的成功列。
- Scope/Confirmation 狀態可 CAS 變更；Decision payload 提交後永不 UPDATE/DELETE。application principal 不得直接 DML/ALTER 四張表或 RESTART Sequence，只准受控、審核的 module 執行；DB owner/sysadmin 不屬於這個不可覆寫保證。Writer/簽署 module/grants 的實際驗收未完成前，不能宣稱 append-only 已成立。1205、1222、rollback failure、commit unknown 均不回報成功；unknown 依 RequestId 做去敏恢復查證，不直接重送新 RequestId。
- AuditLog archive 以原 Id 移至 Archive；Decision 保留相同精確 AuditLogId，未來 Reader 查 online/archive。Archive 清理後必須回報 AUDIT_HISTORY_MISSING，不能偽造 durable proof；Decision 的去敏核心與 digest 獨立保留。不得倚賴 ParametersJson 的 20,000 字元截斷欄位。AuditWriter 回傳 Number 或 audit 失敗則整筆拒絕；不直接沿用既有 Number receipt 當精確證據。
- **安裝順序**：檢查 001 身份/Permission、既有 Dataset/Source/敏感政策/919/920/921 的必要 catalog → Sequence → Snapshot → Scope（含 parent FK）→ Decision → Confirmation → 索引/約束/權限種子 → 精確 catalog 驗證 → 最後寫 SchemaMigration。全部由核准 migrator 於 owned transaction + XACT_ABORT 執行，非本階段執行。只接受全無或完全一致；partial/同名異物/不同 CHECK、collation、disabled/untrusted FK/index/意外 trigger 一律拒絕，不自動修復。完全相同可安全重入；不修改或清理舊 Migration 紀錄。
- 922 是否安裝不影響 923 catalog 判定：不建立 922 物件、不引用其表或 fake AE。舊版 migrator 若要求連續編號或會採納已存在 partial schema，須先修正驗證；不能補一筆假的 922 記錄。回復以關閉 feature／新 principal 與停止 Writer 為先，不刪 Decision/Scope；舊版程式不得重新發證。實際安裝計畫必須先有備份與隔離還原演練，不將帶有有效授權的 DB 還原後直接上線。

## 4. 來源 Identity／Generation／Lease 與 DDL Fence V1

**選定最小支援集合**：SQL Server 2019、單一 Database、Table 與只依賴同 DB Table 的 schema-bound View；第一版拒絕非 schema-bound View、所有 user/CLR/外部 Function、Synonym、動態 SQL、暫存物件、三／四段名稱與跨 DB 依賴。若 catalog 無法證明完整 closure 或 SELECT 中有未受控依賴，拒絕；不能因 describe 成功而推定安全。來源支援清單與 SQL 受限 parser 尚未實作／驗收，故仍 BLOCKED。跨 DB 未來須對完整 closure 依固定實體 identity 排序取得每個 fence，不能用一個平台鎖或單一 DB TTL 代替。V1 物件名稱須明確 schema-qualified 兩段式，不依 default schema 解析；排除 RLS、external/temporal table、會引入 Function/CLR 的 computed column 或其他無法封閉的隱含依賴。Metadata 與執行端的有效 database principal、SET options、collation 與 driver profile 必須有相同／經證明等效的綁定 witness，不能假設不同 metadata 帳號的解析／權限等同 Runtime。

- Identity：由獨立管理端 registry 綁實體 SQL Server service/database、資料庫身分、受信 TLS server certificate／service principal 與 SourceIncarnation；collector 驗證簽署 witness 及實際連線目標一致。DataSourceId、主機名稱或資料庫名稱單獨不夠；本機自填 UUID 不算見證。
- Generation：來源管理端在**每個受控 DDL／GRANT／REVOKE／角色／模組／依賴異動**下持 Exclusive Source Gate，推進正 BIGINT generation（同內容恢復仍新世代），於同個來源事務執行異動與記錄。無法涵蓋的 security/instance/cross-DB 事件須先 quiesce/revoke leases、關 gate 並重新見證，否則該來源不支援。失敗交易可以留下 generation gap，但不可讓已提交異動沒有新世代。
- Fence：資料操作前由可信 provider 持**獨立來源 session-owned Shared Gate**，DDL 管理端先取 Exclusive Gate、再取得 schema/DDL 鎖。Source Gate 為合作式：必須撤除其他帳號的直接 DDL/權限變更能力，並涵蓋所有管理腳本；sysadmin/DBA 維護是顯式 quiesce 邊界。DDL trigger／Event Notification 可作補充診斷，不能單獨提供這個同步 fence。
- Lease：簽署 capability 綁 identity/incarnation/generation、Gate 資源、持鎖 session nonce、issuer/verifier version、valid interval 與 operation。provider 必須能證明該 session 仍持鎖，並證明描述／執行連線是同一來源；不能只看 SPID、TTL 或 UUID。現有 adapter 描述後會 close 私有 pool，不持續保有 fence；不可把此 pool 當 lease。需要另外的受控 lease session/provider，未提供前不發 SOURCE_BOUND。
- Window：collection 持 fence 到保存 witness 完成；confirmation 取得新 fence、驗證 snapshot 同 identity/incarnation/generation；每次 Preview/Execute/Export 再取得新 fence，維持至稽核、最終驗證及資料交付結束。歷史收集 lease 過期不作目前權限；舊 snapshot 只能在其 ExpiresAt 內，經**新且有效**同世代 lease 重驗後使用，不能修改舊 lease/expiry。live lease 失去 ownership、過期、斷線、provider 無法查證時拒絕；TTL 不能延長失效鎖。
- Delivery／撤權線性化：Platform G 先於 Source Gate，來源 DDL Writer 不得持 Source Gate 回取 Platform G。平台授權 Gate 與完整 Writer 協定須讓 revoke commit 之前完成／中止已准入交付，之後不得再傳輸；僅「commit 前最後檢查」不足以消除 res.send 前競態。已有輸出開始後不能撤回 bytes，故必須持有效 fence/gate 至交付完成並定義中止行為。此操作／實體鎖可行性須實測，不能由排序或 Mock 宣稱 deadlock-free。
- ALTER/DROP/CREATE、alias/型別變更、View 定義或權限變更使 generation 改變：舊 snapshot 不再准入，head 即使仍標 ACTIVE 也無權交付，保留所有舊規則並要求新證據／確認。還原、recreate、clone、來源切換或 provider registry 失去可靠性時換 SourceIncarnation；平台還原換 PlatformIncarnation，兩者都不能只沿用備份內值。

### 欄位設定與資料交付是兩個不同閘門

DESCRIBED 候選不能直接改 CONFIRMED。未來受控 verifier 只有在來源 witness、完整已儲存 SQL/參數版本、受限 SQL/型別/別名/順序、上述 fence 與 mandatory audit 全成立後，才能產生獨立的 **SOURCE_BOUND_FIELD_EVIDENCE_V1**。它只授權顯示欄位、編輯政策草稿，不代表 Native Binding Verified。

既有 candidate 的 requiresExecutionComparison=true 保留；不修改其 trust 字串或用人工分類取代比較。初始化不執行資料 SQL。實際資料查詢只能在分類／政策／患者前提完成後的 Preview/Execute/Export 路徑發生；結果名稱、順序、完整 native type 必須在交付前與證據相符。現有結果 metadata 完整性尚未證明，因此即使未來可選欄位，交付 gate 仍不能自動啟用。參數／LIST 在可信 Native Binding 契約未具備前繼續拒絕，不能以零參數推定 confirmed empty Native contract。

## 5. A／B／C 准入定案

| 類型 | 初始化與 Owner/Reviewer | 政策／患者前提 | Preview／Execute／Export 與失效 |
|---|---|---|---|
| A 普通非患者 | SOURCE_BOUND 欄位證據；有效直接 Owner 或委任 Reviewer 以指派 scope、完整版本及 audit 確認 NON_PATIENT_PUBLIC | 明確確認空敏感政策，正版本；patient fields NULL。沒有自動推論無敏感性 | 仍須原 RBAC/ACL、有效確認向量、新 fence、交付前完整結構比對與 operation audit；新流程未驗收前三者皆不解鎖 |
| B 非患者敏感 | 同上，確認 NON_PATIENT_SENSITIVE，不能以未設定患者稽核當作分類 | 使用者選敏感欄位，非空 CUSTOM/FULL/OMIT 規則及正 policy version/digest；patient fields NULL | 同 A，先套政策再交付；不能用患者模式作初始化捷徑 |
| C 患者敏感 | 同上，確認 PATIENT；別名不能依 NAME/MRN/PHONE/PAT_NAME 推定 | 使用者明選 key、HMAC/keyring 可用、患者 config 確認版本、audit-only key OMIT、敏感遮蔽有效 | 每次原有患者 disclosure 必須成功，再套遮蔽（既有獲授權 RAW_DESIGN 仍受原專用保護）；A/B 不可覆蓋 C |

V1 不支援 C→A/B 降級：A/B Reader 必須確認不存在患者配置（包括停用配置）及既有患者分類決策；不能藉刪配置、改成空政策或換 owner 降級。已有 C 的重新分類要另案設計，不能混入本階段。

共同：任何 SQL/Definition、Source/Configuration/identity/incarnation/generation、完整參數/LIST、policy、patient、owner/reviewer scope/token、PlatformIncarnation 變動均拒絕舊證據；保留舊規則與歷史，要求新確認。A→B→A 不復活。敏感欄位與 CUSTOM/FULL/OMIT 均由使用者設定，不新增名稱分類器；無規則不等於 A。Owner scope 本身不讓其略過任何既有遮蔽、ACL、患者稽核或 Dashboard guard。

## 6. 隔離 SQL Server 2019 最小驗收與 Writer 順序

以下均 **NOT_RUN／待驗證**。必須指定與使用者 DB/HIS 分離的 Instance/Database、合成 fixture、SQL Server 2019/compatibility 150、完整 catalog、專用 migrator/runtime/metadata/DDL-manager 帳號、TLS 驗證、兩條以上獨立 connection、去敏輸出保存與故障回復規則。Schema 001–921 與登入既有驗收不重做；只驗新增 sidecar、受控依賴與本次安全條件。

| 閘門 | 最小 barrier／預期結果 | 必須留存的證據／解除條件 |
|---|---|---|
| F1 Schema/CAS | 923 全無安裝、精確重入、部分安裝拒絕；兩 connection 同插空 head/scope 與相同 expected RV 更新，只能一方成功；scope revoke/regrant 取新真 RV | catalog PK/FK/CHECK/collation/index、affectedRows、精確 OUTPUT、rollback 後無局部 head/Decision/Audit；與 922 缺席及存在都測 |
| F2 Scope/撤權 | A 只有全域 permission 無 scope 拒絕；Owner of Dataset X 不能確認 Y；委任 reviewer 的 owner 在 barrier 被撤銷/停用/改角色/TV 後拒絕舊確認；Source rebind 不移轉 scope | actor/owner 向量、新 epoch/TV、no SUCCESS；deleteUser/last-admin/ACL 旁路及 Gate 順序回歸。直接 SQL/舊 Writer 不受控則 gate 不准開 |
| F3 Source Fence | C1 Shared Gate 覆蓋 describe→確認或執行→交付；C2 DDL manager Exclusive Gate 必須等至釋放。模擬 ALTER/DROP/GRANT/REVOKE、同內容 ABA | 去敏 lock/session ownership、blocking/timeout、generation/lease/incarnation；session 斷線、lease 到期或 provider 查證失敗不得交付。能繞過 Gate 的 DDL 帳號存在即 FAIL |
| F4 依賴/描述 | Table/schema-bound View 的 metadata-only RPC 無 rows query；嘗試 function/synonym/非 schema-bound/cross-DB/未知依賴須拒絕，或證明 source 不支援 | native RPC/plan、完整 closure、name/order/type/duplicate 檢查；未知 collation/依賴不能升級 SOURCE_BOUND |
| F5 原子性/歷史 | audit/decision 失敗、1205/1222、斷線/rollback failure/commit unknown；同 RequestId 相同/不同內容重放；移到 Archive 後仍能關聯、清理後報缺證 | 同交易可見性、immutable ledger/grants、精確 Audit ID >2^53、不安全 Number 拒絕；unknown 不回報成功。不是 Mock rollback 證據 |
| F6 Delivery/還原 | 延遲首 byte 與 streaming barrier 並行撤權/DDL；新增/重排/改型別欄位；平台/來源還原、clone、mixed version Worker | 無未驗證資料輸出、固定版本失效、原規則不清空；registry incarnation 不符拒絕；完整患者 audit/HMAC/遮蔽與 Dashboard 回歸。Native Runtime 仍不啟用 |

最小實作順序與可獨立驗收結果：

1. **第一個任務：只實作 923 DDL 原始碼＋精確 catalog validator＋離線測試**，依本文件四表/Sequence/索引/空 predicate/nullable CHECK 規則；不套用、不新增 API、不 seed Scope，不啟用 SOURCE_BOUND/ACTIVE Writer。此交付不依賴來源 Fence 可先審查。
2. 精確 ID/ROWVERSION/Audit Reader 與 owned transaction/CAS port；先在指定隔離 Instance 完成 F1/F5，不能把合成成功當 DB 驗收。
3. Scope Writer、SYSTEM_ADMIN 即時授權、完整稽核與 referenced-user 刪除保護；收斂 admin/UserRole/RolePermission/Permission/reset/logout 等授權 Writer 與 G，完成 F2。未完成前禁止正式確認。
4. 來源管理端 registry/generation/lease/fence 與受限 SQL verifier，完成 F3/F4；才能產生 SOURCE_BOUND 並接欄位／政策**草稿** UI。
5. 版本綁定分類確認、結果結構比對及資料准入，完成 F6 與既有 guards 回歸後另案批准 Preview/Execute/Export。D0B SQL_LOCK_VERIFIED 仍由獨立驗收決定，不由本設計、923 安裝或 CI 發放。

本次為文件決策，未安裝帳號、環境、Schema、provider 或任何 Writer；上述外部條件一項未知就維持對應 gate 關閉。**GO 僅限修訂設計進入第一項實作；正式初始化及交付仍 BLOCKED，沒有以設計結論替代實機證據。**
