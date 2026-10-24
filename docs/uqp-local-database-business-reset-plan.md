# 本機 DB 業務資料安全重建 DRY-RUN 規劃

參考 HEAD `3f41e1f5811f2c7b569a70d04a38a467efd20769`，PR #66／`fix/dashboard-managed-editor-flow`；開工確認 Draft、未 Merge。本文件僅分析原始碼並提出未來核准條件；**不連 DB、不探測、不讀取實際身份/患者/稽核資料或 secrets、不執行 db/Migration/任何資料或 Schema 變更**。沒有可自動執行的重建/破壞性腳本，不改正式程式、C2/C4/C5 或 `.env`。

**目前原 DB 全量業務重建：BLOCKED，不能證明安全。** 實際資料量、保留期限/legal hold、ledger/Schema、一致備份及還原結果均 UNKNOWN。若存在 AuditLog 或患者揭露歷史，必須保留其實體及邏輯 parent closure，不能承諾「只留五張身份表、其他全清」。推薦保留舊 DB 與歷史，另案建立乾淨測試 DB；替代方案的身份匯入、環境隔離與 ledger baseline 也未獲實作授權。

沿用 [D0A](sqlserver-native-type-isolated-acceptance-readiness-2b3c1d-d0a.md)／[C3](sqlserver-native-type-mutation-reservation-design-2b3c1d-b3c3.md)／[D0 Catalog](../tools/sqlserver-acceptance/d0_catalog_readonly.sql) 的既有結構規格，不重做完整結構比對。此處只補重建所需保存/相依；本會話未提供本機實測 Catalog/Manifest，因此不將靜態來源當成實際 DB 相符證據。

## 1. 全表分類（預設不動原庫）

掃描全部 **48 份 Migration（001–026、900–921）**與 production TS SQL references：45 張 Migration 宣告表，加 runner 建立的 SchemaMigration，共 46 張。P＝保留，A＝稽核/歷史保存，M＝人工決策且預設保留，R＝僅在獲准、無保留相依的範圍可重建。**R 不是刪除批准**；被 A/M 參照的 R rows 會升級為保留 closure。分類對所有原列生效，不自行挑選/匿名化或判斷過期。

| 分類 | 完整表名（均為 uqp） | 保存/重建界線 |
| --- | --- | --- |
| P | AppUser、Role、Permission、UserRole、RolePermission | 五表完整資料、精確 ID/tuple、hash 原 bytes、AuthProvider/active/system flags、TokenVersion/時間及角色權限集合保持；不重新編號、重雜湊、重設密碼或補授權 |
| P | SchemaMigration | 原庫 ledger 原樣保留；不是 reset 開關，不刪紀錄、不虛報已套用 |
| A | AuditLog、AuditLogArchive | online/archive 成對保留及精確 Id 關聯；STARTED/FAILED 亦非可刪雜訊，ParametersJson/錯誤內容可能敏感，不輸出 |
| A | PatientListDisclosure、PatientListDisclosureSubject | 原 Id、全部交付上下文、KeyVersion/PatientKeyHash 及關聯完整保存；hash 仍是患者相關資料，不作測試 fixture |
| A | DashboardDeviceArchiveHistory | 保留 DeviceId/DashboardId/actor/時間與非破壞性 archive 語意；沒有 FK 不代表可丟失 parent 身份 |
| A | DatasetVersion、QueryDefinitionVersion | 可能含原 SQL/參數與稽核佐證，先保存；pin/retention 不是永久保留承諾，不先跑 cleanup |
| M | DataSource | EncryptedPassword/端點與外部加密依賴不可搬到測試；原稽核來源身份須可解釋，新庫只建另准合成 Source |
| M | SystemSetting | 含 retention/安全等政策；不能全表還原預設或讓 purge 自動開始，逐 key 由責任人決定 |
| M | UserQuickPin、QuickPinPolicy | 不讀/匯出 PIN hash、不自行清鎖定/失敗次數或重設 policy；詳第 3 節 |
| M | SharedWorkstation、SharedWorkstationUser、SharedWorkstationSession、SharedWorkstationCredential | 身份、允許使用者、secret hashes、credential/session versions 與歷史不可拆散；新庫不復用舊 token/session/credential |
| M | WorkstationAudience、WorkstationAudienceMember、SharedWorkstationAudience | 使用者/工作站範圍授權，原庫保留；不可把舊 audience 自動套到新資源 |
| M | DashboardDisplayDevice、DashboardAuthenticationPolicy、DashboardDeviceArchivePolicy、DashboardDevicePlaybackSettings | 裝置 token/歷史、登入/保留與播放政策；是否退役/撤銷需另外核准，不以清表代替 |
| M | RoleQueryAccess、UserQueryAccess | 業務 Query ACL 非全域 RolePermission；需保存原授權佐證，禁止依重用 ID/同 Code 自動授權新 Query |
| M | DatasetPatientAuditConfig、DatasetPatientAuditMetadata、DatasetSensitiveColumn、DatasetSensitivePolicyVersion | 保存患者/遮蔽政策與各自版本；清空不等於「無敏感資料」，不得停用 guard 以便重建 |
| M | DatasetNativeParameterContract | 舊 D/S/Contract RV 與來源證據不得搬成新庫可信狀態；921 仍僅 UNCONFIRMED，新空表也不表示已確認 |
| R | Dataset、DatasetParameter、DatasetColumn | 新合成定義/metadata 可重建；原 Audit/FK/HMAC/版本/政策 closure 有引用時仍須保留 |
| R | QueryCategory、QueryDefinition、ReportColumn、UserQueryFavorite | 新合成 Query/報表/收藏；不復用歷史身份來接舊 ACL/稽核，不自動發布 |
| R | Dashboard、DashboardDisplayProfile、DashboardWidget、DashboardDataSource | 僅合成、inactive 的新 binding/layout；保留歷史/effective Dataset 差異及原 approval/legacy/managed 拒絕規則 |

分類數 P=6、A=7、M=22、R=11。未知額外表、動態物件、DBA/其他 schema 物件及新發現的關聯全部 **M/UNKNOWN**，不是自動納入可重建清單。

## 2. FK／邏輯相依與禁止切斷的 closure

以下為 48 份來源內 **55 條 FK**的完整分組；箭頭是「child → parent」，括號 C=ON DELETE CASCADE、S=SET NULL、N=NO ACTION；沒有宣告額外 ON UPDATE action。建立必須 parent-first，移除的反向順序只是一項必要條件，**不是操作清單或刪除權限**。實際 Catalog 及跨 schema/trigger 所增依賴仍 UNKNOWN。

| Child | 全部實體 FK parents／欄位／刪除 action | Migration |
| --- | --- | --- |
| UserRole／RolePermission | UserRole.UserId→AppUser(N)、RoleId→Role(N)；RolePermission.RoleId→Role(N)、PermissionId→Permission(N) | 001 |
| Dataset | DataSourceId→DataSource(N)、ArchivedByUserId→AppUser(S) | 003/013 |
| DatasetParameter | DatasetId→Dataset(C)、LookupDatasetId→Dataset(N)；同一 parent 的兩種不同關係 | 003/004 |
| QueryDefinition | DatasetId→Dataset(N)、PublishedByUserId→AppUser(N)、CategoryId→QueryCategory(N)、ArchivedByUserId→AppUser(S) | 005/011/012 |
| RoleQueryAccess／UserQueryAccess | 各自 RoleId→Role(C)／UserId→AppUser(C)，兩表 QueryDefinitionId→QueryDefinition(C) | 005 |
| AuditLog | UserId→AppUser(N)、QueryDefinitionId→QueryDefinition(N)、DatasetId→Dataset(N) | 006 |
| DatasetColumn／ReportColumn | DatasetColumn.DatasetId→Dataset(C)；ReportColumn.QueryDefinitionId→QueryDefinition(C) | 007 |
| DatasetVersion／QueryDefinitionVersion | 各自 DatasetId→Dataset(C)／QueryDefinitionId→QueryDefinition(C)，兩表 CreatedByUserId→AppUser(S) | 014 |
| UserQueryFavorite | UserId→AppUser(C)、QueryDefinitionId→QueryDefinition(C) | 017 |
| Dashboard | QueryDefinitionId→QueryDefinition(N)、CreatedByUserId/UpdatedByUserId→AppUser(N，兩條) | 020 |
| DashboardDisplayProfile／DashboardWidget | Profile.DashboardId→Dashboard(C)；Widget.ProfileId→DashboardDisplayProfile(C) | 022 |
| DashboardDisplayDevice | DashboardId→Dashboard(C)、CreatedByUserId→AppUser(N)、SharedWorkstationId→SharedWorkstation(N) | 025/916 |
| DashboardDeviceArchivePolicy／DashboardDevicePlaybackSettings | Policy.DashboardId→Dashboard(C)；Playback.DeviceId→DashboardDisplayDevice(N) | 900/901 |
| SharedWorkstationUser／SharedWorkstationSession／SharedWorkstationCredential | 各自 WorkstationId→SharedWorkstation(N，三條)；前兩者 UserId 沒有本來源宣告的 AppUser FK | 902/904 |
| PatientListDisclosureSubject／PatientListDisclosure | Subject.DisclosureId→PatientListDisclosure(N)；Disclosure.DashboardDeviceId→DashboardDisplayDevice(N) | 906/909 |
| DatasetPatientAuditConfig／DatasetSensitiveColumn／DatasetSensitivePolicyVersion／DatasetPatientAuditMetadata | 各自 DatasetId→Dataset(C，四條) | 907/910/919 |
| DashboardDataSource | DashboardId→Dashboard(C)、DatasetId→Dataset(N)、QueryDefinitionId→QueryDefinition(N) | 913/917 |
| WorkstationAudienceMember／SharedWorkstationAudience | Member.AudienceId→WorkstationAudience(N)、UserId→AppUser(N)；SharedWorkstationAudience.WorkstationId→SharedWorkstation(N)、AudienceId→WorkstationAudience(N) | 916 |
| DatasetNativeParameterContract | DatasetId→Dataset(N)、DataSourceId→DataSource(N) | 921 |

其餘表無本來源宣告 FK：AppUser、Role、Permission、DataSource、SystemSetting、QueryCategory、AuditLogArchive、DashboardDeviceArchiveHistory、SharedWorkstation、UserQuickPin、DashboardAuthenticationPolicy、QuickPinPolicy、WorkstationAudience、SchemaMigration。**沒有 FK 不代表沒有保存/安全相依**：

- AuditLog(N)→Query/Dataset→DataSource，使保留稽核與全量移除業務 rows 衝突；不得先 archive 來迴避 FK。Archive 無同樣 FK，仍須保留 Id/名稱及歷史 context，不能清空後宣稱可還原。
- PatientListDisclosure 的 AuditLogId/UserId/WorkstationId/SessionId/QueryDefinitionId/DatasetId 多為邏輯引用；Subject(N)→Disclosure(N)→Device(C-parent)→Dashboard→Query→Dataset→DataSource。保留 disclosure 可阻擋 device/dashboard cascade；工作站與 session 即使無 FK 也要可解釋。
- HMAC 的 sourceScope 包含 DataSource ID；managed Dashboard 路徑另含 Dashboard ID/source key（[delivery](../server/src/modules/dashboard/dashboardQuerySourceExecution.ts)）。因此原 ID/來源對照及歷史 key versions 不能由重用新 ID 代替。
- DashboardDeviceArchiveHistory 的 DeviceId/DashboardId/actor，Playback 的 DashboardId，DashboardAuthenticationPolicy.DashboardId、UserQuickPin.UserId、工作站/session UserId 及政策 UpdatedBy 等部分未設 FK；需納入人工 closure。
- [workstation removeUnused](../server/src/modules/admin/workstationManagement.repository.ts) 會檢查 credentials、sessions、disclosures、devices／retired/last-use，不能以純 FK 排序取代；[deleteUser](../server/src/modules/admin/admin.repository.ts) 有 last-admin/history 拒絕，保留身份五表也不授權繞過這些保護。
- managed source 的 StoredHistoricalDatasetId 與 effective Query.DatasetId 必分開保全；重建 layout/source 不得自動覆寫歷史 Dataset、核准、in-use/pending conversion 或模式限制。

**Trigger/View/Index 範圍**：全部 Migration 未找到 CREATE TRIGGER/VIEW/PROCEDURE/SYNONYM 宣告，production TS 未找到額外 View/Trigger 建立；這不證明實際 DB 沒有。未提供/不明的 schema-bound View、trigger、server trigger、job、外部 Writer 必須先停止重建並由 DBA 補相依見證，不能停用/拆除來通過。表內 PK/UQ/CHECK/default 連同 FK 必須按各 Migration 保留；不能只備份資料列。

全部 **32 個 explicit indexes** 的重建來源/依賴如下（PK/UQ 自帶的索引另隨原約束，沒有省略為 heap 的批准）；沿用既有結構比對，不另複製完整 key 定義：

| Migration | Index owners／完整名稱 |
| --- | --- |
| 006 | AuditLog：IX_AuditLog_CreatedAtUtc、IX_AuditLog_UserId_CreatedAtUtc、IX_AuditLog_QueryDefinitionId_CreatedAtUtc |
| 011/012/013 | QueryDefinition：IX_QueryDefinition_CategoryId、IX_QueryDefinition_IsArchived；Dataset：IX_Dataset_IsArchived |
| 014/015 | DatasetVersion：IX_DatasetVersion_Dataset_Created、IX_DatasetVersion_Retention；QueryDefinitionVersion：IX_QueryDefinitionVersion_Query_Created、IX_QueryDefinitionVersion_Retention |
| 016/018 | AuditLog：IX_AuditLog_EventCategory_CreatedAtUtc、IX_AuditLog_EventType_CreatedAtUtc、IX_AuditLog_User_Query_Event_Status_CreatedAtUtc；AuditLogArchive：IX_AuditLogArchive_CreatedAtUtc、IX_AuditLogArchive_Category_CreatedAtUtc |
| 017 | UserQueryFavorite：IX_UserQueryFavorite_QueryDefinitionId |
| 020/022/025 | Dashboard：IX_Dashboard_QueryDefinitionId、IX_Dashboard_IsActive_Name；Profile：IX_DashboardDisplayProfile_Dashboard；Widget：IX_DashboardWidget_Profile；Device：IX_DashboardDisplayDevice_Dashboard |
| 900/902/904 | ArchiveHistory：IX_DashboardDeviceArchiveHistory_Dashboard；Device：IX_DashboardDisplayDevice_ArchiveSweep；Session：IX_SharedWorkstationSession_Workstation、IX_SharedWorkstationSession_User、UX_SharedWorkstationSession_OneActive；Credential：IX_SharedWorkstationCredential_Workstation |
| 906/908/909/910 | Disclosure：IX_PatientListDisclosure_UserTime、IX_PatientListDisclosure_DashboardDeviceId；Subject：IX_PatientListDisclosureSubject_Patient、IX_PatientListDisclosureSubject_PatientVersion；SensitiveColumn：IX_DatasetSensitiveColumn_Type |

Index 必須等 owner table/所需新增欄位後才可建立；908 另變更 Subject PK 為 DisclosureId/KeyVersion/PatientKeyHash。unique/filtered keys（尤其 OneActive、ArchiveSweep、DashboardDeviceId）及 reverse-index GAP 不能忽略；不存在的反向 index 不自行補。Schema-bound View 若實際存在須先審其 dependency 拓樸，不以「最後重建全部 View」臆測順序。

## 3. 身份、PIN、Session 與稽核保存邊界

身份保留以五表原資料逐欄及 exact IDs 為基線，包括有效/停用 user/role、system flag、全部 Permission 與兩個 join 集合；SQL Server BIGINT 只能由核准 reader 取得精確字串，不使用現有 Number mapper 回轉或重新編 ID。SQL login/DB user/SID 是另一層，不在 AppUser 備份中；其 mapping/權限亦須 DBA 見證。

[QuickPin policy writer](../server/src/modules/admin/quickPinPolicy.repository.ts) 改長度會停用全部 PIN、推進 PinVersion 並撤銷 session；[PIN service](../server/src/modules/auth/quickPin.service.ts) 登錄/撤銷需驗密碼/TokenVersion，改 PIN 也影響 session。保全 Session 必須關聯 AppUser active/TokenVersion、PinVersion、Workstation CredentialVersion、允許使用者/audience、過期/撤銷狀態；已確認 Schema 版本欄位、credential 驗證與多條撤銷 writer，但未找到完整 SharedWorkstationSession 發行/驗證 reader，該安全性 **UNKNOWN**，不能從欄位存在推定已安全。SessionSecretHash/SecretHash/TokenHash 不是一般可重建設定。原庫預設不改政策/鎖定/版本/撤銷狀態，不沿用 active sessions 到新庫。若需全 session 失效，必須獨立核准且記錄，不能暗中 bump 原 AppUser.TokenVersion 違反保留基線；新庫身份保留與 signing/issuer 隔離方案未定前不得開放服務。

[audit lifecycle](../server/src/modules/audit/audit.repository.ts) 的 archive 是複製後移除 online，cleanup 可移除 Archive；重要永久設定並非不可刪保證。[version cleanup](../server/src/modules/version/version.repository.ts) 也會清歷史；Device archive sweep 會改裝置狀態/新增歷史（[server](../server/src/server.ts) 每小時執行）。備份/比對窗口須由負責人另准停寫與停止這些 job/worker，不能啟動 server 來「只看一下」。不自行執行 archive/purge/version cleanup、revoke、bootstrap 或登入（登入驗證另案會產生狀態/稽核）。

[908](../database/migrations/908_patient_audit_hmac_key_version.sql) 只存 KeyVersion，**不把 HMAC key material 存 DB**；[keyring](../server/src/modules/audit/patientAuditKeyring.ts) 的歷史查找需保留版本對應的外部金鑰及 sourceScope。不得換 key 後重寫舊 hashes、重設 KeyVersion 或讀患者值重算。秘密保管者另行備份/復原所需歷史 keyring、active-version 對照與 Source 解密依賴；不交給 Codex、不放 Git/SQL/本報告。只備份 DB 不足證明稽核可查；新測試庫不得引入原患者 HMAC records 或正式 keyring。

## 4. SchemaMigration 與安全建置順序（不是執行指令）

[runner](../server/src/scripts/migrate.ts) 的 `apply` 為預設，會跑所有未記錄檔案，不能假定只套 920/921；普通 apply 也沒有 scoped mode 的 target attestation。`status`/`adopt` 路徑先連 DB，且可能先建立 uqp schema/SchemaMigration。ledger 僅記 FileName/AppliedAtUtc，沒有內容 checksum；已記錄即跳過，**不完整驗證實際 Schema**。目前完整手動採認 verifier 只列 900；不可假借 adopt 採認 001/920/921。range/resume 僅限 916–919、有精確 baseline/target 條件，不能拿來跑 920/921，也不能為新 DB 假冒其固定 target。

server/package.json 沒有獨立 `db` script；任何工具/別名/外部部署腳本未知，不可試跑找行為。未 import/執行 runner（模組會直接 main），也不調用 db:migrate/status/adopt。未獲授權前，ledger/Schema 一致性只列 UNKNOWN。

未來只補**重建相關差異**：核准 DBA 將既有 baseline/evidence ID、48 個 file/checksums、ledger、下列依賴與新增 drift 一併對照。ledger有/物件缺、ledger無/物件存在、同名內容變更、partial install/額外物件均停止；不刪 ledger 迫使重跑。原庫保留五表時絕不能重跑 001，它無條件建身份表並 seed Role/Permission/RolePermission；008 也會 seed Permission/grants，不能默認「必要權限」可以覆寫現況。

候選建置順序僅適用**另案批准、已確認完全空的新 DB**；不在本階段執行，也不把以下分組當跨檔大交易：

| 階段 | 全部 Migration 順序／前提 |
| --- | --- |
| 身份與核心 | 001（只允許新空 target 一次）；002 Source→003 Dataset/Parameter→004 lookup→005 Query/ACL→006 Audit→007 columns→008 settings/grants→009/010 source types |
| 版本/權限/版面 | 011 category→012/013 archive/user FK→014 versions→015/016 retention/archive→017 favorites→018 usage index→019 TokenVersion→020/021/022 Dashboard/layout→023 dates→024 styling→025/026 device/IP |
| 裝置/工作站/患者 | 900 archive→901 playback→902 workstation/PIN/session→903 PIN policy→904 credential→905 platform→906 disclosure→907 patient config→908 HMAC-version PK/index→909 device reference |
| 安全/多來源 | 910 sensitivity→911 validation→912 mask→913 source→914 paging→915 reconciliation→916 audiences/workstation management→917 Query source→918 mode→919 patient config version/metadata、Dashboard/Source Approval RV |
| Native foundations | 920：Dataset 已存在，唯一 DefinitionRowVersion 必為原生非空 ROWVERSION(8)、無 alias/computed/conflict。921：DataSource/Dataset/Parameter 前提、唯一 ConfigurationRowVersion、contract 與 Source RV 原子且精確同裝；contract 恰八欄、PK/兩可信 NO ACTION FK/四 CHECK/default/無 trigger，State 僅 UNCONFIRMED。920/921 不靠 seed 業務資料發證。**922 一律 BLOCKED** |

此順序保留每份檔案本身的 GO/內部交易、資料 backfill/seed 語意；各 Migration 可已逐份 commit，出錯不能聲稱全部 rollback。911/915/919 等不能省略成只補欄位；部分套用與 runner 內外交易需獨立 review/還原演練。不修改/重跑已記錄的 920/921，不借用原庫 RV/contract/approval 當新庫證據；restore 後即使 bytes 相同也需新 platform/source incarnation，現有可信機制仍 BLOCKED。

## 5. 選項與原庫重建阻擋

| 選項 | 本次判定與具體條件 |
| --- | --- |
| 原 DB 僅留五表，其餘重建 | **BLOCKED**：保留 A 及 parent closure 與全清互斥；audit/disclosure/device/history FK 或邏輯引用不能拆除。即使 FK 暫無阻擋，也未證明沒有應保存記錄/隱藏 trigger/view/工作站/session/HMAC 關聯；不能自動 archive、匿名化、清空或 null references |
| 原 DB 僅重建已證明無引用的少數合成 rows | **另案 CONDITIONAL，尚非允許執行**：需資料責任人證明行級範圍、保留 closure 完整、policy/ACL/session 不變、備份/演練/rollback 可行。這不是達成「所有其他業務全重建」，本次不產生操作清單 |
| 保留舊 DB／建立新測試 DB（推薦） | 舊庫身份與全部歷史原樣保存，核准後以受控唯讀保管/查核與網路隔離維持可追溯；不是直接拿含患者資料的整庫 restore 當 D0B fixture。新庫只建合成業務、預設 inactive/unpublished/無舊核准，不搬舊 Source 密文、患者資料/PIN/session/device credentials |

替代方案須先解決兩個問題，不能宣稱已可執行：

1. **身份 seed/import**：新空 DB 首次 001/008 會產生 Role/Permission/grants，可能與原 ID/集合碰撞；不得直接 overlay/自動去重/按 Code 對號、清 seed 或擴權。DBA 另交精確五表移轉與 seed reconciliation 方案：只在新 target、父 U/R/P 後 join UR/RP、精確 ID/完整欄位比對、identity allocator 不碰撞、seed 的每項必要 postcondition 可解釋。任何清 seed/credential import/ledger 認定均需獨立批准；目前沒有此工具或批准。schema-only baseline 亦需完整 manifest/語意核驗，不能複製舊 ledger 冒充新庫已執行。
2. **D0B 與敏感身份**：保留原庫帳號不等於授權把真 PasswordHash/PIN/使用者資料複製到 acceptance DB。最低風險是原庫五表不動，新庫使用另外批准的合成身份；若要求新庫仍用原帳號登入，須身份/資安責任人另准精確 credential 移轉、最小暴露與 test-only auth/keys 邊界，且確認不違反 D0A 合成資料規格，否則 **BLOCKED**。同一現有本機 instance 新 DB 也不自動構成隔離；若可達舊敏感庫/HIS、跨庫/DBA/舊 Worker 未隔離，DB_TEST_ENV_READY 仍不成立，不自行新裝 instance。

## 6. 備份、驗證、回復檢查表（全部待核准/NOT_RUN）

- [ ] 指定 source/target 的本機 operator、DBA、資料/稽核/資安 owner、精確 DB 身份與核准範圍；核實非 HIS/正式來源與外連封鎖。附既有 Catalog baseline，不重新做整套比對；未知物件只補依賴/保存差異。
- [ ] 核准停寫窗口，凍結 schema/migration/登入與背景 jobs，保留 ongoing audit/session 的一致時間點；具體 freeze 方法需審核，不能為停止 job 先修改正式設定。
- [ ] DBA 做一致完整 user-DB 備份＋依 recovery model 所需 log chain、checksum/LSN/版本/加密證明；另保全 server login SID/DB principals、外部 keyring/解密與應用認證依賴。備份含敏感資料，僅加密受控保存，保留期限/legal hold/權限/RPO/RTO 未定就停止；不由 Codex讀取備份或金鑰。
- [ ] 先在核准的**敏感資料復原隔離區**做實際 restore、DB完整性及 dependency/ledger驗證，不能只以備份成功或 VERIFYONLY 宣稱可還原；這個復原區不是 D0B 合成測試 DB。記錄耗時、步驟與 recovery point，不啟用原外連/Worker。
- [ ] 五表 pre/post：精確 ID/tuple 集合與每欄原值相符、AuthProvider/active/system/token flags、完整有效授權結果及 last-admin 邊界；hash/password bytes 僅由核准工具在安全邊界內比較，輸出 mismatch counts/pass，不讀出或公布 hash/使用者清單/秘密摘要。現有 Number mapper 不作 >2^53 證明。
- [ ] 由原帳號持有人在核准窗口做 LOCAL 登入/角色允許與拒絕案例（不提供密碼給 Codex、不重設密碼），登入新增 audit/session 需事先列入預期差異；非 LOCAL 不改 AuthProvider/不探測 AD/Oracle，未測即 NOT_RUN。PIN/舊 session/裝置 token 測試需另准，不以「可登入」證明所有權限等價。
- [ ] 保存資料 pre/post：Audit online/archive IDs及狀態、Disclosure/Subject關聯/KeyVersion、history/device/workstation parent context、policy/版本/retention，全部由核准者去敏核對，不能輸出患者值。外部 keyring 歷史查核可行由秘密保管者見證；若缺 key/來源 scope 保持 BLOCKED。
- [ ] Migration 前後：48-file/checksum＋ledger＋已核准 baseline差異，PK/UQ/FK/trigger/view/index/dependency及920/921 exact shape，無未宣告 backfill/seed/權限/政策變動；記錄每份完成與失敗邊界。禁止移除 ledger、改 Migration、disable FK/trigger 或放寬 guard。922/AE/Q/正式 confirmation/Runtime 不在範圍。
- [ ] 新測試庫隔離驗證：僅合成業務來源、獨立連線與 TLS/metadata權限/DB identity，舊 ACL/核准/contract/session 不復活；獨立 incarnation 未有可信實作，不放行 Native Type。D0B R0/R1 先驗，符合才 R2–R8，不直接執行整份 SQL。
- [ ] 失敗/CAS/缺件/commit unknown/rollback不明立即停止與 quarantine；保留去敏證據，不盲重跑 migration。新庫失敗不影響舊庫，回退採核准應用 target/版本回切方案（本次不改設定）；若原庫未來曾動過，必須依演練完成的備份/log方案復原**整個一致點**，不能只還原身份五表或倒填舊 RV。處理窗口後新 audit/交易的RPO與保存不得臨時忽略。

執行前必須取得：DBA/source/target 精確授權、身份/credential/PIN/session 遷移或保留決策、資料/患者稽核保存/legal hold、秘密保管者復原見證、停寫/背景job窗口、seed/ledger reconciliation、備份還原演練簽核、隔離網路/TLS、失敗回復與證據保存責任。**本文件不是這些批准，也不授權 db/SQL 操作。**

## 7. DRY-RUN 結論

僅產出規劃與原始碼追溯，沒有任何 DB 查核/修改/備份/登入/還原實測；實際 index/FK/schema drift、資料量與保存決策 UNKNOWN。原庫全量業務 reset **BLOCKED**；下一最小步是收齊既有 baseline、保留/閉包與身分移轉決策、還原演練及環境授權，由 DBA 提交另案可審查執行方案；不得先破壞再補證據。

PR 保持 Draft/未 Merge；authority=NONE、runtimeBindVerified=false、deliveryAllowed=false、persistence=NOT_PROVEN、productionSafetyProven=false。920/921 僅 foundation；922、Native Type 正式確認/Runtime/交付的既有阻擋不變。
