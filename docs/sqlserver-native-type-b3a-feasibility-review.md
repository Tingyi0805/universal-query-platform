# Native Type Review B3-A 可行性審查

基準 `2774c03e9edf1a92c405ae11c13b3bc0a3315992`；開工核對 PR #66 為 Draft、CI #873 成功。
僅靜態閱讀 [B1](sqlserver-native-type-confirmation-design-2b3c1d-b1.md)、[B2](sqlserver-native-type-review-contract-2b3c1d-b2.md) 及下列具名 writer／契約；未執行 Migration、DB 連線或改動程式／設定。
**結論：正式 sidecar 確認與 Runtime 接線 BLOCKED；三表設計僅 CONDITIONAL。** 主要阻擋為授權 writer／鎖順序未閉合、精確稽核與歷史保存未定案，以及來源 identity／generation／lease 無實作與實機證據。沒有任何已證明可用的正式發證路徑。

## 1. 922 最小設計：保留 920／921，另建三個物件

[920](../database/migrations/920_dataset_definition_rowversion.sql) 與 [921](../database/migrations/921_datasource_native_parameter_versions.sql) 保持原樣。921 reader 嚴格檢查八欄、約束、FK／index 及無 trigger；sidecar 不得往舊表加欄／trigger、放寬 UNCONFIRMED 或讓 `requireVerifiedNativeParameterContract` 接受新狀態。新 reader 必須另驗證完整 922 catalog；未安裝、部分安裝、未知形狀／權限皆拒絕，不能自動修補或退回 hash／legacy coercion。

| 物件 | 建議最小 schema 與約束（尚未建立） |
| --- | --- |
| `NativeTypeAuthorizationEpoch` | singleton `TINYINT` PK＋CHECK key=1、`ROWVERSION NOT NULL`；預先建立一列，缺列即拒絕。僅受控 touch，不准 DELETE／重建回復舊 epoch；不是 ACL 內容 hash |
| `DatasetNativeTypeReview` | `ReviewId UNIQUEIDENTIFIER` PK；DatasetId／DataSourceId 為 BIGINT FK NO ACTION；捕捉 Definition／Configuration／Authorization RV 各 BINARY(8)，BaseContract RV 可空且以明確 existence discriminator 區分；ProposedBy／Reviewer 身份與 TokenVersion 為 BIGINT、scope RV 為 BINARY(8)；三種 digest BINARY(32)＋各自 format version；NativeTypes／Evidence JSON NVARCHAR(MAX)＋ISJSON；UTC times DATETIME2(3)；State NVARCHAR(16) 預設 PENDING、StateRowVersion ROWVERSION。JSON 包含來源 identity／generation／lease reference、collector／codec／plan／driver 與 descriptor profile，不能放 runtime 值／憑證 |
| `DatasetNativeTypeDecision` | append-only DecisionId BIGINT IDENTITY PK、ReviewId FK NO ACTION、RequestId UNIQUEIDENTIFIER unique、ActorId、action／reason、from/to state、前後 BINARY(8) RV、完整快照 digest、決策 UTC time、AuditLogId BIGINT。actor／reviewer 對 AppUser 的 NO ACTION FK 可保護歷史，但必須同步調整刪除影響判定；不得 cascade 消失。稽核關聯見下段，**不直接 FK 到線上 AuditLog** |

CHECK 限合法 state/action、positive IDs、時間順序與必要 null 組合；CONFIRMED 必須有 reviewer／TokenVersion／scope／完整有效證據；每 Dataset 最多一個 CONFIRMED（filtered unique index），Dataset＋time 的歷史索引及 FK 索引。Dataset↔Source 對應、JSON semantic／native type／arity／digest、身份授權、snapshot 不可變與狀態轉移，不能靠 ISJSON／CHECK 證明，須限權 Repository／必要 procedure 強制；實際 grants 與 FK／filtered-index catalog 表現**待驗證**。若 parent Dataset RV 無法涵蓋所有參數 writer，三表不足，須另設 parameter-set epoch，不能靠 digest 補足。

狀態：PENDING→CONFIRMED／REJECTED／INVALIDATED；CONFIRMED→REVOKED／INVALIDATED；terminal 不復活，修正或再審建立新 ReviewId。所有 payload 自建立起不可改寫，只能 CAS state／RV。CAS 必須鎖定且比對 ReviewId、state、RV 與捕捉的全部版本，affectedRows=1；filtered index 只處理並行唯一性，不能代替授權／版本檢查。替換確認需在同交易追加舊 review 失效及新確認兩筆決策。RequestId 綁 actor＋action＋完整快照；相同鍵不同內容拒絕，同內容重試仍重驗當前授權與撤銷狀態，不重放舊批准。

**稽核有明確相容性缺口。** [audit.repository.ts](../server/src/modules/audit/audit.repository.ts#L35) 的 write/start 回 Number，不能事後 String() 修復 BIGINT 精度；須新限域 adapter 在 SQL 輸出即保留精確十進位字串，再以 B2 receipt 規則驗證。通用 ParametersJson 截至 20,000 字元，不能承載核心證據；tryWrite 吞錯不可沿用。state＋Decision＋強制 AuditLog 寫入／精確關聯＋最後重驗須同交易 commit，任何失敗 rollback；DB 故障下的人工緊急撤銷仍需持久 deny-hold／停用方案，**待驗證**。

[006](../database/migrations/006_audit_log.sql) 的線上 AuditLog 以 FK 限制 user/query/dataset 刪除；[016](../database/migrations/016_audit_retention.sql) 的 AuditLogArchive 複製身份顯示資訊且沒有這些 FK。[archiveOldAuditLogs](../server/src/modules/audit/audit.repository.ts#L296) 以 SERIALIZABLE 複製後刪除線上非 STARTED 記錄，包含 important；[cleanupAuditArchive](../server/src/modules/audit/audit.repository.ts#L344) 可在 importantPermanent=false 時刪除重要事件。預設 365／1825 天、重要永久是可變設定，不能當不可刪保證。新 Decision 應自存限長、去敏且不可覆寫的完整決策事件及精確 AuditLogId，作同交易邏輯關聯；保存期限、權限／防竄改及查詢 online/archive 的方式需先定案。直接 FK 到 AuditLog 會令封存 DELETE 失敗；cascade 或解除 FK 後丟掉歷史都不可接受。既有 deleteUser/deleteDataset/deleteQuery 的歷史計數主要看線上資料，新增 sidecar FK／歷史引用前須補足影響分析，不能以「已封存」推定可安全刪除。

安裝／rollback：只接受「全無」或「全部精確相符」，在受審交易中完整建立並驗證 catalog／ledger；半套拒絕、不採認來源不明物件。重跑、DDL rollback 與 migration runner 的 GO／內外交易互動需實機驗收。sidecar 存在不代表 writers 已升級；混合 binary／舊腳本仍可漏推進 epoch，必須維持功能關閉。回退先關閉確認／使用 gate、保留 Decision 歷史與 921 限制，不能降級後繼續使用舊確認。平台 DB restore 也可能同時倒退 AE、D／S 與 review；需 DB 外部不可隨備份回復的 platform incarnation／重審程序，B2 尚未綁定此證據，不能僅禁止 DELETE 就聲稱防止復活。

## 2. Writer Coverage Matrix

狀態針對「建議的版本控制」：**COVERED**＝具體程式已有該局部版本推進（以 920／921 實際正確安裝為前提），不代表整體 Native Review 已安全；**GAP**＝已看到 writer 而缺少必要控制；**UNKNOWN**＝部署／DB 外部行為無法證明。**目前沒有任何正式 AuthorizationEpoch writer。**
AE＝全域授權 epoch；D＝Dataset Definition RV（含參數集合）；S＝Source Configuration RV；Q＝Query 綁定／可用性 mutation revision（目前無獨立可信版本）。表內 RC 指 `.begin()` 未指定 isolation；單句為現有 autocommit SQL，不宣稱周邊檢查原子。

| 資料物件 | 寫入函式／路徑（具體證據） | 現有交易 | 現有版本推進 | 建議 Epoch／版本 | 狀態 | 風險 |
| --- | --- | --- | --- | --- | --- | --- |
| Query user/role ACL | [queryAccess](../server/src/modules/queryDefinition/queryAccess.repository.ts#L61) `replaceQueryAccess` | RC | 同交易 advanceDashboardAccessEvidence；ACL hash 本身無世代 | AE；保留 Dashboard→ACL 相對順序 | GAP | Dashboard RV 僅涵蓋相關 Dashboard，pre-919 甚至不推進；非通用 AE |
| AppUser／UserRole bootstrap | [admin](../server/src/modules/admin/admin.repository.ts#L17) `createInitialAdmin` | SERIALIZABLE | 新身份／初始 token | AE 初始化邊界；啟用後不得繞過 | GAP | bootstrap/restore 後不應沿用既有審查 |
| AppUser／UserRole create | [admin](../server/src/modules/admin/admin.repository.ts#L130) `createUser` | RC | 新身份／初始 token | AE（身份／role membership） | GAP | 無原子 AE；不能只看現有 reviewer token |
| AppUser／UserRole update | [admin](../server/src/modules/admin/admin.repository.ts#L154) `updateUser` | SERIALIZABLE，先鎖 AppUser | role／active 改變才 TokenVersion+1；刪除重插 UserRole | AE 僅身份啟停／角色變化；純 displayName 不需 | GAP | TokenVersion 非全域 epoch；role A→B→A 必須留世代 |
| Role／RolePermission create | [admin](../server/src/modules/admin/admin.repository.ts#L235) `createRole` | RC | 無通用 mutation version | AE | GAP | 未來分派後影響 reviewer；不能遺漏新建角色 |
| Role／RolePermission update | [admin](../server/src/modules/admin/admin.repository.ts#L257) `updateRole` | RC | active／permissions 改變推進成員 TokenVersion | AE 僅授權欄位改變 | GAP | SYSTEM_ADMIN 更新會讀取全部 Permission 再授權；新增 review permission 不能當作顯式 reviewer assignment |
| AppUser＋UserQueryAccess＋UserRole delete | [admin](../server/src/modules/admin/admin.repository.ts#L351) `deleteUser` | SERIALIZABLE，先鎖 AppUser | 無 AE／無 advanceDashboardAccessEvidence | AE；另保護 decision actor 歷史 | GAP | **ACL 的旁路 writer**，不能只修 replaceQueryAccess |
| 密碼／session 撤銷 | [auth](../server/src/modules/auth/auth.repository.ts#L100) `updateOwnLocalPassword`；[admin](../server/src/modules/admin/admin.repository.ts#L221) `resetUserPassword`、`revokeUserSessions` | 單句 | TokenVersion+1 | reviewer TokenVersion＋每次 session 重驗；無 role/scope 異動不必 AE | COVERED（局部） | 現有 reader/revoke receipt 使用 Number；精確 adapter 與溢位處理仍 GAP |
| Permission catalog／Role grants | [001](../database/migrations/001_platform_identity.sql#L60)、[008](../database/migrations/008_system_settings.sql#L37) seed；`updateRole` 使用 catalog | Migration SQL／runner outer tx；非同一管理 API | seed 不更新 AE／token | 啟用後 catalog/grants 變更需 AE 或停用／重審 | GAP | 沒有一般 Permission CRUD 不代表不存在 SQL writer；新增 permission 自動授權風險 |
| Query 建立／改綁 | [queryDefinition](../server/src/modules/queryDefinition/queryDefinition.repository.ts#L69) `createQueryDefinition`、`updateQueryDefinition` | 建立單句；更新 SERIALIZABLE，先鎖 Query | UpdatedAtUtc／history；改變會 unpublish，無 Q | 建立新身份；改 DatasetId→AE＋Q；純顯示不直接 AE | GAP | Query↔Dataset A→B→A 沒有可用 mutation epoch；timestamp/history 不等於 RV |
| Query publish／unpublish | [queryDefinition](../server/src/modules/queryDefinition/queryDefinition.repository.ts#L180) `publishQueryDefinition`、`unpublishQueryDefinition` | publish SERIALIZABLE；unpublish 單句 | publish 寫 Query／DatasetVersion snapshots；未更新 Dataset 本體 | Q＋當前 ACL/可用性；本身不改 reviewer scope，非一律 AE | GAP | Dataset 沒有獨立 publish writer；不得誤稱 publish 推進 D |
| Query archive／restore／delete | [queryDefinition](../server/src/modules/queryDefinition/queryDefinition.repository.ts#L255) `deleteQueryDefinition`、`archiveQueryDefinition`、`restoreQueryDefinition` | 單句（部分先讀 impact） | flags／UpdatedAtUtc，無 Q | Q／身份存在性；若刪除引發 ACL cascade，該授權異動需 AE | GAP | [005](../database/migrations/005_query_definition_and_access.sql) 的 Query ACL FK 有 cascade；archive→restore 不能靠內容 hash 防 ABA |
| Query 歷史還原 | [version](../server/src/modules/version/version.repository.ts#L459) `restoreQueryVersion` | SERIALIZABLE，先鎖 Query | snapshot＋改 DatasetId／flags，無 Q | 跨 Dataset restore→AE＋Q；其餘 Q | GAP | 可改關聯且不經 updateQueryDefinition；未見同交易 restore 管理 audit |
| ReportColumn 間接 unpublish | [reportColumn](../server/src/modules/queryDefinition/reportColumn.repository.ts#L60) `replaceReportColumns` | RC | history＋Query unpublish | Q；版面本身非 AE | GAP | 純看 Query repository 會漏掉 availability writer |
| Dataset 建立／更新 | [dataset](../server/src/modules/dataset/dataset.repository.ts#L62) `createDataset`、`updateDataset` | 建立單句；更新 SERIALIZABLE | 新 D／UPDATE 自動推進 D；可能取消 Query 發佈 | D；間接 publication 用 Q，不是所有 Dataset 寫入都 AE | COVERED（D）；GAP（Q） | SQL／Source 換綁受 sensitivity guard；D 不涵蓋外部物件 |
| Dataset archive／unarchive | [dataset](../server/src/modules/dataset/dataset.repository.ts#L154) `archiveDataset`、`restoreDataset` | archive RC；restore 單句 | Dataset UPDATE→D；archive 亦 unpublish lookup 使用者 Query | D＋相關 Q；非 AE | COVERED（D）；GAP（Q） | lookup 依賴必須重查；restore 保持 inactive，不恢復舊 proof |
| Dataset delete | [dataset](../server/src/modules/dataset/dataset.repository.ts#L232) `deleteDataset` | SERIALIZABLE | 刪除身份；FK／引用檢查 | 身份存在性＋禁止復用 proof；非一般 AE | COVERED（現有引用檢查） | sidecar／歷史／可能重新建檔需額外保護；實際 DBA identity reseed UNKNOWN |
| Parameter save | [parameter](../server/src/modules/dataset/parameter.repository.ts#L136) `saveDatasetParameters` | SERIALIZABLE，鎖 Dataset／集合 | 同交易 touchDatasetDefinition→D＋unpublish | D（或另案 parameter epoch）；不因 scalar 設定更新就 AE | COVERED（D）；GAP（Q） | 單獨直接 SQL 改參數不會觸碰 parent |
| Parameter sync | [parameter](../server/src/modules/dataset/parameter.repository.ts#L78) `syncDatasetParameters` | SERIALIZABLE | 有增刪才 D＋unpublish；無變更不推進 | D＋必要 Q；非 AE | COVERED（D）；GAP（Q） | preview token 是完整性檢查，不是 mutation epoch |
| Dataset＋Parameter 歷史還原 | [version](../server/src/modules/version/version.repository.ts#L313) `restoreDatasetVersion` | SERIALIZABLE | UPDATE Dataset→D，再換參數、失效 metadata、unpublish；同交易強制 audit | D＋Q；不恢復舊 review | COVERED（D／audit）；GAP（Q） | 不可把 history version number 當現行 proof |
| 歷史 snapshot pin／清理 | [version](../server/src/modules/version/version.repository.ts#L554) `setDatasetVersionPinned`、`setQueryVersionPinned`、`cleanupOldVersions` | pin 單句；cleanup SERIALIZABLE | 僅歷史列，不推進 D／S | 獨立 artifact retention；非 AE | GAP（Native 證據保存） | pin 可解除、未 pin／非 published 的舊 snapshot 可清理；[014](../database/migrations/014_version_history.sql) parent DELETE 可 cascade history，不能直接當永久審查 artifact |
| Audit archive／清理／retention settings | [audit](../server/src/modules/audit/audit.repository.ts#L296) `archiveOldAuditLogs`、`cleanupAuditArchive`；[settings](../server/src/modules/systemSettings/systemSettings.repository.ts#L116) `updateVersionRetentionSettings`、`updateAuditRetentionSettings` | archive SERIALIZABLE；cleanup 單句；settings RC | 無不可變稽核世代 | 保護 Decision／artifact 的獨立保存政策；非 AE | GAP（新決策保存） | 可移除線上 FK 保護並最終刪 Archive；重要永久不是不可修改政策 |
| DataSource 建立／設定／停用 | [datasource](../server/src/modules/datasource/datasource.repository.ts#L70) `createDataSource`、`updateDataSource` | INSERT／UPDATE 單句；update 先另讀舊設定 | 新 S／UPDATE 自動推進 S（含 credentials／TLS／active） | S＋當前啟用檢查；非 AE | COVERED（S） | 無更新 CAS，舊設定讀取與寫入非整體原子；S 只證明最終列變更，不防 lost update |
| DataSource delete | [datasource](../server/src/modules/datasource/datasource.repository.ts#L175) `deleteDataSource` | 單句 | 刪除身份／FK 限制 | Source 存在性、重新綁定；非 AE | COVERED（程式路徑） | 新 review FK NO ACTION／歷史保留及新身份驗收仍待完成 |
| 敏感／患者政策、column metadata | [sensitivity](../server/src/modules/dataset/datasetSensitiveColumn.repository.ts#L48) replace、[column](../server/src/modules/dataset/column.repository.ts#L11) sync、既有 patient policy writer | 各自交易／Dataset 鎖 | sensitivityVersion／patientAuditVersion 等獨立控制；column refresh 非 DDL epoch | 保留既有 policy/version gates；非 AE，metadata 不作來源 proof | COVERED（既有獨立 gates） | 不把遮蔽／患者政策改成 Native Type 權限，亦不放寬既有 gate |
| Review scope／reviewer assignment | B2 只有 scopeAllowed／reviewNativeType observation，沒有正式 writer | 無 | 無 scope schema／epoch writer | 新 scope RV＋AE，明確互動式 reviewer 政策 | GAP | 全部布林值為合成輸入，不能直接接 production |
| PIN／workstation／device 管理 | quickPin、sharedWorkstation、workstationManagement repositories | 各自交易／credential/session 版本 | 非 Native reviewer scope | 不自動 AE；先禁止這些身份發證，重驗 session | UNKNOWN（Native reviewer 身份映射） | 沒有真實 interactive 身份分類；不能假設一般 JWT 足以區分認證強度 |
| 直接 SQL／Migration runner／外部管理 | [migrate](../server/src/scripts/migrate.ts#L172) batch＋ledger；部署腳本／SQL Agent／DBA／備份還原 | runner 有 outer tx；外部 UNKNOWN | 920／921 對本列 UPDATE 產生 RV；直接 Parameter／ACL DML 不保證 | 受控寫入／明確 epoch；DB restore 需新信任世代 | GAP（已知 bypass）；UNKNOWN（實際權限與外部 writer） | grep 不能證明部署完整性；禁止讓 UNKNOWN 過 gate |

盤點方式是追蹤上述資料物件的 TS SQL literal／alias UPDATE 與 migrations，不宣稱涵蓋未提供的動態 SQL、部署／DBA 行為。001／008 為找到的 permission/grant seed；其他 003／004／005／012／013／019／023 等 schema／FK/default 演進及任何未來修補仍須部署清單審查。[parameterTestFixture](../server/src/modules/dataset/parameterTestFixture.ts) 是測試 fake SQL dispatcher；離線 inventory／rehearsal 工具不是正式 writer，但 `migrate.ts` 可執行 batch，不能把整個 scripts 目錄視為唯讀。

**責任收斂（較 B1 的粗略全域 epoch 更精確）**：AE 只涵蓋 ACL、RBAC、review scope／適格身份及 Query↔Dataset 授權映射變更；SQL／參數／Source 設定以 D／S 為主。Query 單純 publish／可用性不改型別契約與草稿 review scope，不應無差別全域失效；但 delivery 仍需 Q 的防 ABA 規則與當前 ACL。若選擇新增 Q，已超出原三表的完整能力，須另審 schema／observation，不能假定現有 UpdatedAtUtc 已解決。已證明 D／S 的路徑，不等於直接參數 DML、權限往返或來源 restore 已覆蓋。

## 3. 鎖順序與來源 lease：尚不可啟用

[replaceQueryAccess](../server/src/modules/queryDefinition/queryAccess.repository.ts#L78) 是 Dashboard→ACL；[lockLegacyBindings](../server/src/modules/dashboard/dashboardLegacyLocks.ts#L28) 是 Dataset IDs 升序→Dashboard→source range，approval 再讀 session／ACL；updateUser/deleteUser 先鎖 AppUser；Query update/restore 先鎖 Query，再讀 Dataset。B1 的 AE→identity→Dataset 只是提案，**未證明與整體鎖圖相容**。若在舊 writer 尾端補 AE，可能形成「新 reader 持 AE 等 ACL，舊 writer 持 ACL 等 AE」循環。需以統一 outer acquisition 與所有 conditional writer 規則重排，保留既有 Dashboard／ACL 相對安全順序；SQL Server 實際 S/U/X／range locks、deadlock 與重試後重驗均待驗收，不能只改單一 helper。

[SQL Server adapter](../server/src/modules/datasource/adapters/sqlServerAdapter.ts#L26) 每次 describe 自建／關閉 pool，RPC 輸入明確 `tsql`／`params`，只回 name/type/ordinal 候選。它沒有來源 UUID 驗證、dependency collector、DDL generation 或 lease；TLS 直接採 config，route 的預設 encrypt=false／trustServerCertificate=true 也不是來源身份保證。**Source generation／lease＝BLOCKED**，不能把平台 SERIALIZABLE、RV、modify_date、TTL、相同 descriptor hash／採樣結果當等效替代。

| 項目 | 可行性／必要 DBA 或系統管理員證據 |
| --- | --- |
| View／Table／Function | 需完整解析巢狀依賴、computed／function 呼叫及實際 object identity；未解析／metadata 不可見即拒絕。sys catalog 可作來源資料，不能單憑輸出欄位證明輸入參數宣告 |
| Synonym／跨 DB／遠端 | 必須解析到實際 target 並涵蓋每一 DB／server 的身份與變更世代；不可把同 DB name、database_id 或 endpoint 名稱當不可重用身份。無法協調相依來源則拒絕該 SQL |
| ALTER／DROP／CREATE、GRANT／REVOKE | 候選方案為來源端受控 DDL/security generation＋受限部署 protocol；需證明事件涵蓋、同來源交易原子推進、無停用／繞過與完整 permission inheritance／role/login 變更覆蓋。trigger／DDL audit／event notification 的存在不等於完整性，async log 不能自行當 fence；目前未建立 |
| A→B→A／restore／failover | generation 必須不可回復／重用；原內容復原仍新世代。備份還原可能連 epoch 一起倒退，需外部 deployment/source incarnation 及驗證機制；schema hash／RV equality 不足 |
| lease／fence | `sp_getapplock` 可研究作合作式 shared/exclusive protocol，但任意 DDL 不會自動遵守 app lock；所有部署／DBA／安全異動必須受同一 fence。需明確 holder、scope、fencing token、失連／expiry／renew/release、時間來源與阻斷未授權 DDL 的權限；B2 字串期限不是 lease |
| 探測→人工確認→執行→交付 | 必須重新取得並驗證有效 lease／同世代，不靠跨人工審查期間維持舊 pool；之後需覆蓋 descriptor、實際 bind、結果比較、最終授權／稽核與回應邊界。statement Sch-S 不證明多個 RPC／query 間穩定；現有 adapter 關閉 pool 不能續持鎖。平台與來源分開連線，不能假裝共用交易；同 instance 可行方案／DTC 均未驗證 |
| collector 最小權限／身份 | DBA 列出限定 metadata／依賴可見性與 RPC 執行 grants，確認 describe 權限足夠且不需給 collector 任意 DDL／管理權；執行身份與 collector 差異亦須綁定。須驗證 TLS CA／hostname／trust 設定、DB incarnation、credential rotation／principal/role 改變。不能用測試連線成功代替這些證據 |

## 4. B2 Ports 到真實 Repository 的落差

[B2 實作](../server/src/modules/dataset/nativeTypeReview.ts) 的成功只為 consistency；SYNTHETIC_TEST_ONLY／SYNTHETIC_VALIDATED 與四個 synthetic profiles 不得改標籤後升級權威。真實資料要另定版本契約與 authenticated provider boundary，不能信任前端 observations／actor／matching digest。

- SnapshotReader 尚無真實 SQL／全部 parameter rows 的一致讀取、canonical 編碼／排序／null／Unicode 規格與 immutable 審查 artifact 保存；目前只比較摘要及有限投影。B1 的 PENDING reviewer 可空，B2 卻必須有 reviewer，真實 draft schema／reader 必須先定案。
- Authorization provider 缺 epoch writer、scope 儲存／授權政策、互動身份來源、exact TokenVersion reader；existing session helper 的 Number 必須限域替換，不能從失真 Number 產生精確字串。
- Transaction brand 只是 TypeScript 型別，沒有 runtime owner／isolation／XACT_ABORT／cancel／commit/rollback 證據。Decision port 缺已提交冪等查詢、完整 from/to state／reason／timestamp／snapshot、精確 decision/audit 關聯及歷史保護的持久契約；現有 Mock 只示範 PENDING→CONFIRMED staged copies。
- MandatoryAuditWriter 回 unknown，B2 receipt checker 只證明 BIGINT 字串格式，不能證明該 audit row 存在、屬於此 decision 或與 state 同交易。需明確 receipt binding 與真正失敗回滾驗收。
- SourceEvidenceProvider **沒有** platform transaction token 是正確邊界；仍缺 authenticated lease/generation issuer、deadline、renew/release、fencing 與外部失效處理，不能塞進同一 tx 參數假造跨 DB 原子性。
- CONFIRMED 僅人工 declaration 狀態，不是 runtimeBindVerified；metadata 仍候選，descriptor 詳細結構／精度／collation 與正式 typed bind 比對仍缺。`deliveryAllowed=false` 永遠保留，Oracle 含參數 Metadata 仍拒絕；Mock rollback 不證明 SQL rollback。

## 5. B3-B 範圍與真實 SQL Server 驗收門檻

**GO**：本次唯讀審查、writer 證據矩陣及離線合成驗證可用作後續設計輸入；不代表已涵蓋部署或發證安全。
**CONDITIONAL**：若另開 B3-B，最小安全前置可限於完整 saved snapshot 的 canonical 規格／合成 builder、精確 receipt／decision 契約與鎖順序測試計畫；不寫確認、不把 synthetic provider 接入 production。真正 sidecar／writer Repository 的實作建議，必須先完成下面 P0，不以再多 Mock 代替。
**BLOCKED**：尚不建議直接實作或啟用正式 CONFIRMED Repository、部署 922 或接 Runtime。P0 為（a）scope／身份、Q 與三表 schema／retention 定案；（b）全部 AE writer＋外部寫入／混合 binary 管控和一致鎖圖；（c）DBA 提供可驗證 source identity／generation／fence 方案。無可信 source 保證時最多保留不可交付候選，不降低要求發證。

日後必須在另行授權、隔離且僅合成資料的真實 SQL Server 驗收：922 首裝／重跑／部分安裝拒絕／DDL rollback／舊 921 reader 相容；CAS 雙 reviewer／冪等／撤銷競爭／deadlock／斷線與 audit/commit 失敗無半套成功；BIGINT receipt >2^53、線上封存與 Archive 清除、actor/source/dataset 刪除歷史；每條 writer 的 A→B→A（含直接 ACL、參數、restore、Query 換綁／publication、RBAC）；依賴物件與 GRANT 的 ABA、source restore／failover／credential/TLS 身份變化；lease 失連／到期／fence 違反及 metadata 到回應各時點競態。完整 typed bind／descriptor／實際結果、UTC／DECIMAL／Unicode 與原有 ACL／遮蔽／患者稽核／Dashboard gates 也須驗收。這些條件本階段均未在真實 DB 證明。
