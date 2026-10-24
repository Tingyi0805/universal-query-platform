# D0B-R7 索引缺口精簡審查

審查基準 `9254ca927a5d4c5ece1436ddae68b668a8e30329`；開工 PR #66 Draft、未 Merge，CI #884 success。本次只新增文件及註解式 SQL 草案，不連 DB、不執行 DDL、不建立 Migration、不改 001–921、Writer/Runtime/JWT/權限/稽核或既有資料庫。

直接採用使用者提供的完成證據，不重驗：SQL Server 2019/compatibility 150、48/48 Migration、46 tables、920/921 成功、5 位舊帳號及角色關聯移轉、原帳號登入/管理員管理正常、backend port 3200。JWT_SECRET 不變；不探測該 port。本次 R7 輸入為 24 predicates：11 CANDIDATE_ONLY_PLAN_AND_RANGE_UNKNOWN、13 GAP_NO_EXPLICIT_KEY_PREFIX、0 ABSENT_OR_INVISIBLE_REQUIRES_DBA。

**結論：優先建議 8 項索引候選，暫緩 5 項；目前實際新增 0。** 8 項是依現有具名查詢縮減的方案，不是未看計畫就保證必建/有效；若既有等效索引可用，實際新增應再減少。5 項仍是結構/未來 scope 的待決缺口，不能因此宣稱 R7 全過、SQL_LOCK_VERIFIED 或 Native Runtime 可用。

## 1. 先處理 R7 的檢查邊界與重複風險

[R7 SQL](../tools/sqlserver-acceptance/d0_catalog_readonly.sql#L135) 要求 key_ordinal=1/2 都明示匹配；它沒有推導 implicit clustered key，因此 GAP 只代表「沒有被此規則辨認的顯式兩欄前綴」。11 個 candidate 也不代表已驗 plan/鎖。

- [001](../database/migrations/001_platform_identity.sql)、[003](../database/migrations/003_dataset_query_designer.sql)、[005](../database/migrations/005_query_definition_and_access.sql)、[014](../database/migrations/014_version_history.sql)、[913](../database/migrations/913_dashboard_multi_dataset_sources.sql)、[921](../database/migrations/921_datasource_native_parameter_versions.sql) 的相關 PK 未指定 NONCLUSTERED；按來源的空表建置順序通常形成 clustered PK。實際 clustered shape/額外索引未附於這次 R7 摘要，未重新連線確認；不能把預期直接當實測。
- 若實際 clustered PK=(Id)，nonunique NCI `(DataSourceId)` 通常隱含 Id，可已有 `(DataSourceId,Id)` 的有效排序；同理 Query 的 DatasetId/PublishedByUserId、Version 的 CreatedByUserId。若 clustered PK=(RoleId,QueryDefinitionId)，nonunique NCI `(QueryDefinitionId)` 可隱含 RoleId；UR/RP/Contract 的反向索引同理。不能同時建立這種單 key 與等效雙 key 版本；heap/不同 clustered key/unique NCI 的情況不能套同一推論。
- 掃描全部 48 份 Migration 未找到下列 13 組的明示 leading-key 索引；但來源掃描及 R7 摘要不能排除本機額外的單 key、其他名稱或較寬等效索引。Migration 前只補核對**這 13 組**的既有 R3/index metadata：type、unique、key ordinal/direction、implicit clustered locator、INCLUDE、filter、disabled/hypothetical；不重做已完成的建置/登入驗證。
- INCLUDE 不能當 key 排序；`(DashboardId,SourceKey)`、`(DatasetId,Name)` 不能反過來 seek QueryDefinitionId/LookupDatasetId。相同名稱不代表相同定義，filtered/disabled index 亦不能默認等效。遇同名異形或不明 constraint 先停，不重建/刪除既有 index。

## 2. 逐項決策（編號沿用使用者的 13 個 GAP）

與 [C3 Predicate/Index/FK 契約](sqlserver-native-type-mutation-reservation-design-2b3c1d-b3c3.md#L41) 相比，這裡區分「現在有具名 predicate」與「未來完整 scope/FK 維護需求」，不把 C3 候選全轉成 DDL。所有建議都需要下節驗收，未取得 actual plan/IO/lock 證據。

| #／Table：Key1,Key2 | 既有 PK/UQ/Index 能否替代 | 決策、用途與特定風險 |
| --- | --- | --- |
| 1 DashboardDataSource：DatasetId,DashboardId | PK(Id)、UQ(DashboardId,SourceKey)，均非 DatasetId leading | **暫緩**。現有 legacy/managed helpers 依 DashboardId 讀取，UQ 已有正向路徑；historical Dataset 反查主要是 C3 完整 scope/FK parent-delete 候選。若 Dataset FK 檢查/完整 reverse closure 的實機計畫需要，再提 `(DatasetId,DashboardId)`；不把 stored historical D 與 effective Query D 混成一個 index/證據 |
| 2 DashboardDataSource：QueryDefinitionId,DashboardId | 同上；UQ 可按 DashboardId seek 後 residual Query，不能視為一般 Query→Dashboard 反查 | **優先 S1**。ACL evidence 的 OR EXISTS 及 Query→supplemental Dashboard 用途；但每 Dashboard source 有限，既有 parent seek 也可能較便宜。需 actual plan 證明新路徑有益，不能保證 OR EXISTS 必採用；nullable/pending 分支不能被 filter 排除 |
| 3 Dataset：DataSourceId,Id | PK(Id)、UQ(Code)、IX_Dataset_IsArchived(IsArchived,IsActive)，均非 Source leading | **優先 S2**。[Source delete impact](../server/src/modules/datasource/datasource.repository.ts#L184) 的 DatasetCount 與 FK 檢查；Id 可為 implicit clustered locator，先排除已有等效單 key。不能改善 Source 本身 CAS/lease |
| 4 DatasetNativeParameterContract：DataSourceId,DatasetId | PK(DatasetId)；若 clustered，DatasetId 可隱含於新的 Source NCI，但目前無明示 Source key | **暫緩**。[現有 reader](../server/src/modules/dataset/nativeParameterVersion.repository.ts#L55) 依 DatasetId 命中 PK；Source 反查主要屬未來 invalidation/FK 維護，尚無正式 confirmation writer。表空/UNCONFIRMED 不能當安全證據；日後看 FK 成本/Source invalidation 設計再評估 `(DataSourceId,DatasetId)` |
| 5 DatasetParameter：LookupDatasetId,DatasetId | PK(Id)、UQ(DatasetId,Name) 只支援 owner 方向 | **優先 S3**。[archive/delete/impact](../server/src/modules/dataset/dataset.repository.ts#L188) 的反向 lookup EXISTS、owner Query unpublish；不另建單 Lookup 與此雙 key 重複版本。NULL/新增 usage/owner 查詢方向均須保留，不能以此取代既有 UQ |
| 6 DatasetVersion：CreatedByUserId,Id | PK(Id)、UQ(DatasetId,VersionNo)、014/015 parent/time/retention indexes 均非 author leading | **暫緩**。現有 list/restore/retention 按 DatasetId/VersionNo，[author join](../server/src/modules/version/version.repository.ts#L256) 是 v→AppUser，不是 author→versions。AppUser 刪除仍可能觸發 FK SET NULL；若此成本/鎖證據顯著，再評估 `(CreatedByUserId,Id)`，暫緩不表示不需保留歷史 |
| 7 QueryDefinition：DatasetId,Id | PK(Id)、UQ(Code)、CategoryId/IsArchived indexes，不能反查 Dataset | **優先 S4**。Dataset/Parameter save/restore 的 unpublish、Dataset delete/impact 及 D→Q closure；先不猜測加 IsPublished key/INCLUDE，實際更新可能仍需 lookup 與其他鎖 |
| 8 QueryDefinition：PublishedByUserId,Id | 同上，沒有 publisher leading | **優先 S5**。[user delete impact/拒刪檢查](../server/src/modules/admin/admin.repository.ts#L324) 的 publisher COUNT 及 NO ACTION FK。保留 NULL；不能因 index 存在就解除 USER_HAS_HISTORY 或刪資料；未涉及 ArchivedBy 等其他 predicates 的結論 |
| 9 QueryDefinitionVersion：CreatedByUserId,Id | PK(Id)、UQ(QueryDefinitionId,VersionNo)、014/015 parent/time/retention indexes 非 author leading | **暫緩**。與 #6 同理；實際列表先按 QueryDefinitionId 篩選。另列 author SET NULL 的實機成本，必要時提 `(CreatedByUserId,Id)`，不與 #6 合併為跨表索引 |
| 10 RolePermission：PermissionId,RoleId | PK(RoleId,PermissionId) 支援目前 Role→grants；不能反向 seek Permission | **暫緩**。管理/登入以 RoleId 取權限、依 Permission PK 取 Code；未找到一般 Permission delete/update API 的反向 Writer，C1 未來 Permission-catalog closure 仍需此方向。若開放該路徑/FK維護或計畫證明需求，才提 `(PermissionId,RoleId)`；不以暫緩當完整 RBAC scope 已驗 |
| 11 RoleQueryAccess：QueryDefinitionId,RoleId | PK(RoleId,QueryDefinitionId) 方向相反，Role PK/UQ 不能代替 | **優先 S6**。[ACL list/replace](../server/src/modules/queryDefinition/queryAccess.repository.ts#L61) 按 Query 篩選/整批 DELETE；空範圍與 Query cascade 驗收。先不加 flags INCLUDE，避免未量測的寫入成本 |
| 12 UserQueryAccess：QueryDefinitionId,UserId | PK(UserId,QueryDefinitionId) 已支援 deleteUser，未支援 Query→users | **優先 S7**。Query ACL list/replace/cascade；保留正向 PK，不把此 index 當 deleteUser 旁路已修復；User 名稱排序仍可能需 sort |
| 13 UserRole：RoleId,UserId | PK(UserId,RoleId) 支援 User→roles，不能直接 Role→members | **優先 S8**。[updateRole](../server/src/modules/admin/admin.repository.ts#L305) 依 RoleId 更新全體 members TokenVersion、admin membership 查詢。不得改 unique/PK、TokenVersion 或 last-admin 規則；批次 AppUser 更新的實體鎖順序仍未知 |

優先組 **#2/#3/#5/#7/#8/#11/#12/#13 = 8**；暫緩 **#1/#4/#6/#9/#10 = 5**。被暫緩的 FK/cascade/SET NULL 仍可能掃描/鎖較大範圍；此方案只縮減當前 index 優先級，**不是完整共同 acquisition 的 GO**。C1/C3 未來 scope 若確定依賴其反查，須先補證據/索引設計再接 Writer。

## 3. 建議名稱與 Migration SQL 草案（只在文件，全部註解）

下列全部為 **NONUNIQUE、NONCLUSTERED、ASC、unfiltered、無 INCLUDE** 的一組候選，不與單 key 版本併建。明示第二 key 便於審查與 R7 對照；其與 implicit clustered key 重複時 SQL Server 不需再額外重複儲存同一 locator column，但仍須核對實際 index shape。索引都在原表，不含敏感原文/帳密/SQL/MAX 欄位；所有寫入將多維護 B-tree/log，建置可能取得 Sch-M、耗費空間、改變計畫/鎖順序，不能視作零風險。

**這不是 Migration 檔、不含自動執行 wrapper、未執行，也沒有指定 922。** 名稱相符時不得直接 skip；正式 Migration 的精確 Catalog/等效去重/同名異形拒絕及部署回復前提需另案審核。

```sql
-- DRAFT ONLY / NOT EXECUTED. S1 (#2)
-- CREATE NONCLUSTERED INDEX IX_DashboardDataSource_QueryDefinitionId_DashboardId
-- ON uqp.DashboardDataSource (QueryDefinitionId ASC, DashboardId ASC);
-- S2 (#3)
-- CREATE NONCLUSTERED INDEX IX_Dataset_DataSourceId_Id
-- ON uqp.Dataset (DataSourceId ASC, Id ASC);
-- S3 (#5)
-- CREATE NONCLUSTERED INDEX IX_DatasetParameter_LookupDatasetId_DatasetId
-- ON uqp.DatasetParameter (LookupDatasetId ASC, DatasetId ASC);
-- S4 (#7)
-- CREATE NONCLUSTERED INDEX IX_QueryDefinition_DatasetId_Id
-- ON uqp.QueryDefinition (DatasetId ASC, Id ASC);
-- S5 (#8)
-- CREATE NONCLUSTERED INDEX IX_QueryDefinition_PublishedByUserId_Id
-- ON uqp.QueryDefinition (PublishedByUserId ASC, Id ASC);
-- S6 (#11)
-- CREATE NONCLUSTERED INDEX IX_RoleQueryAccess_QueryDefinitionId_RoleId
-- ON uqp.RoleQueryAccess (QueryDefinitionId ASC, RoleId ASC);
-- S7 (#12)
-- CREATE NONCLUSTERED INDEX IX_UserQueryAccess_QueryDefinitionId_UserId
-- ON uqp.UserQueryAccess (QueryDefinitionId ASC, UserId ASC);
-- S8 (#13)
-- CREATE NONCLUSTERED INDEX IX_UserRole_RoleId_UserId
-- ON uqp.UserRole (RoleId ASC, UserId ASC);
```

風險控制：不刪/換 PK、UQ 或舊 index，不加 UNIQUE、不加 NULL filter，不假設 INDEX hint/ONLINE 支援、不改 SQL/Writer 順序。S3 第二 key 是 owner Dataset 而非 Id，仍需別的 locator；不能錯用 implicit Id 取代 owner。S1 第二 key 是 DashboardId，不是 Source.Id，亦不能用 Source PK 代替。

## 4. 回歸與建立 Migration 的門檻

本次靜態檢查通過：13 項不重複分類、8 優先/5 暫緩、8 組名稱/key pairs、SQL 區塊全為註解、既有 Migration 無相同新名稱、文件連結；Server/Client CI 見提交回報。以下 SQL parse/plan/lock/DDL 實測全部 **NOT_RUN**，需獨立隔離 SQL Server Instance（對應 2019/150），不得在已成功建置的本機 DB 試 DDL/並行/故障注入。沿用 [D0 T1–T10](../tools/sqlserver-acceptance/d0_acceptance_matrix.md)，不重做使用者已完成的建置/登入驗證。

| 回歸項目 | 通過條件／仍不代表的能力 |
| --- | --- |
| 精確去重/Schema | 核對這 13 predicates 的 R3/PK/UQ/clustered/implicit/INCLUDE/filter/disabled 資訊；等效單 key/較寬 index 能滿足時不重複新增；同名異形與 metadata 不完整 fail-closed。包含單 key NCI＋clustered composite、heap/不同 clustered key 的反例，不能只靠 index 名稱 |
| 8 項 before/after plan | 另准合成 fixture 為 0/1/多列及 NULL/non-NULL；核對列集合/affectedRows 不變、actual index access/residual/key lookup/sort、IO/時間/寫入成本。S1 的 parent seek vs reverse Query index、S4 的 IsPublished residual 特別比較；無收益可縮減，不硬湊 8 |
| 功能/授權 | 合成帳號的 Query ACL replace（同 grants 仍 DELETE/INSERT）、role grant/revoke/token/last-admin、Source/Dataset delete impact、lookup unpublish、Dashboard evidence/approval/legacy/managed/pending conversion 與歷史 Dataset 差異均保持原允許/拒絕；不對原 5 個帳號或 JWT_SECRET 做變更 |
| FK/歷史/暫緩組 | NO ACTION/SET NULL/cascade、author histories、historical Dataset/source、native contract 的既有保護不變；若 #1/#4/#6/#9/#10 仍出現不可接受掃描/阻塞或未來 scope 需要，另提第二批，不掩蓋這五個 GAP、不清歷史來過測 |
| T1/T6/T7 及故障 | 在獨立 instance 的兩連線 barrier 驗空/非空範圍、phantom、新 FK/member/ACL、natural key/identity；蒐集 plan/lock/wait/1205/1222/rollback/commit-unknown 去敏證據。固定排序或看到 seek 不等於完整鎖序、lease 或 deadlock-free，不能標 SQL_LOCK_VERIFIED |
| 建置/回復 | 另案驗新 index 建置時間/空間/log/Sch-M、重跑/部分安裝/同名異形拒絕、保留已存在 index 的來源與擁有權；回復只針對該案實際建立的 index 且須批准，不自動 drop 舊索引/補 ledger，不改 920/921 語意或任何業務資料 |

**何時才適合建立 Migration：** 先以既有 R3 或 DBA 去敏證據完成等效去重，定案實際剩餘數量與 names/keys；再經獨立 instance 的最小 plan/寫入/鎖/回復驗收、DBA/部署與保留規則簽核，取得明確 Migration 範圍及編號批准，才另案產生正式檔案。不得因本文件或 CI 成功直接建立/套用 922，亦不得在目前本機 DB 補 index。

正式 Native Runtime 仍 **BLOCKED**：AE/Q 全 Writer、真正 owner/transaction、精確 revision/Audit/Decision 持久 Reader、Source generation/lease/DDL fence、混合部署/外部 Writer/incarnation 等未由索引解決。PR 保持 Draft、未 Merge；authority=NONE、runtimeBindVerified=false、deliveryAllowed=false、persistence=NOT_PROVEN、productionSafetyProven=false。
