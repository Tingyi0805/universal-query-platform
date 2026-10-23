# Dataset Owner／Reviewer 管理 API

基準 PR #66 `86bc0f08f9af9eed5f78e1b5358a8a3edfc738d5`。沿用 923 Scope、精確 Audit receipt 與既有 F2/F5 隔離測試；不改已安裝 923、001–921、JWT_SECRET、患者稽核／遮蔽／Dashboard 或 Native Runtime。管理頁為 `/admin/dataset-security`；只管理責任指派，所有回應 `runtimeBindVerified=false, deliveryAllowed=false`。

## 最小資料延伸與部署界線

[獨立 924 草稿](../database/drafts/924_dataset_security_scope_binding.sql) **不在 Migration Runner 掃描目錄，不提供自動套用入口，不寫 SchemaMigration**。只新增 DatasetSecurityScopeBinding、兩個 Permission 定義與 Decision UPDATE/DELETE 的 public DENY；沒有 UserRole/RolePermission/Owner/Reviewer grant，不重寫既有帳號或 Scope。需要另外審查部署版本及備份／回復程序，不能在使用中的 UQP 執行或覆蓋。

923 Scope 原本只記來源 ID，無法永久區分使用者停用後重啟、Owner revoke/regrant 與來源 A→B→A。Binding 保存 Scope 真 RV、subject TokenVersion、Dataset Definition RV、Source Configuration RV、Reviewer 的 parent RV/token 與 PlatformIncarnation；每次查有效性即時與當前角色／帳號／資料列比對。舊 Scope 沒有 Binding 時保持原列，但視為無效；須明確新指派，不自動承接。

Binding PK=(DatasetId,UserId,ScopeKind)，只向既有 Dataset/AppUser 建 NO ACTION FK。**不對已驗證的 923 表增加 inbound FK**，避免讓 923 精確 Catalog 失配；Scope 關聯由同交易 CAS、Binding.ScopeVersion=Scope.ScopeRowVersion、既有 immutable Decision→Scope FK 與即時 join 驗證，孤兒／不符 Binding 不授權。924 安裝後仍須驗證原 923 EXACT_MATCH。撤銷保留 Scope/Binding 與 Decision；不提供歷史刪除。被 Scope/FK 引用的帳號應停用，不刪 Scope 來強行刪帳號。

首版保守綁完整 Definition/Configuration RV：**任何 Dataset 定義或 Source 設定更新都使原指派失效**，即使內容改回也需重新指派。這比只綁來源 ID 嚴格，但不用改既有 Writer 即能檢出來源 ABA。Owner revoke/regrant 的新 RV 使舊 Reviewer 永久失效；帳號／角色／權限的受控異動必須照既有 Writer 推進 TokenVersion，不允許歸零。直接 SQL/DBA/舊 Worker 未涵蓋時仍是正式部署阻擋，不能把當前權限內容相同當作無版本變動。

功能預設關閉。獨立環境經批准後才可設定 `DATASET_SECURITY_SCOPE_MANAGEMENT=true` 與 `DATASET_SECURITY_PLATFORM_INCARNATION`；incarnation 必須由核准的 DB 備份外 registry／部署程序提供，不能由前端或每次請求產生。UUID 設定本身不證明 restore 安全；還原／clone／多 Worker 的停機、重驗及 incarnation 更新流程未核准前不得正式開啟。此次沒有修改 `.env`。

資料庫 application principal 必須可讀必要 metadata、使用交易鎖／session DMV，並有 Scope/Binding/Decision INSERT/Audit 所需權限，但不得 CONTROL DB/Decision、ALTER schema/Binding/Decision 或 UPDATE/DELETE Decision。**dbo/sysadmin 拒絕使用新 API**；DENY 無法限制 dbo/sysadmin。這不是要求修改使用中的 UQP 登入：請在獨立測試版本準備受限身分，先驗證其他既有功能回歸。

## API 與原子交易

均需簽章／期限有效的 JWT、即時帳號與 TokenVersion，且交易內兩次驗證有效 `SYSTEM_ADMIN`（IsSystem=1）與 `MANAGE_DATASET_SECURITY_SCOPE`。不信任 JWT 的 roles/permissions 字串。分類確認能力獨立為 `CONFIRM_DATASET_CLASSIFICATION`，與指定 Dataset 的有效 Scope 同時成立；全域能力不能建立 Scope。SYSTEM_ADMIN 角色編輯也不再隱含加入這兩個新能力，必須明確勾選；其餘既有能力行為保留。

| API | 契約 |
|---|---|
| GET `/api/dataset-security/options?search=` | 最多100筆 Dataset 與有確認能力的使用者；只回必要 ID/名稱，不讀 SQL、密碼、PIN 或患者資料。可搜尋 Dataset／輸入精確 ID，不以有限選單宣稱全量 |
| GET `/api/dataset-security/datasets/:id/scopes` | 目前 Dataset/Source RV、來源 ID、stored Scope 與即時 effective；無效或撤銷的列仍保留顯示 |
| PUT `/api/dataset-security/datasets/:id/scopes/:kind/:userId` | kind=OWNER/REVIEWER；嚴格 body：requestId UUID、action GRANT/REVOKE、expectedVersion=MISSING或16hex、definitionVersion/configurationVersion、parentOwnerUserId/parentOwnerVersion（不使用時必須NULL）；未知欄位／不安全 Number／零版本拒絕 |
| GET `/api/dataset-security/datasets/:id/decisions?requestId=` | 最多100筆去敏歷史或指定 RequestId；精確 Decision/Audit/Actor/Subject ID、動作與狀態。Audit ID 只標記 REFERENCE_ONLY，不宣稱永久保存 |

受指派者須 active、具當前確認能力；Reviewer 只能綁同 Dataset 當前有效 Owner，且不是自己，parent RV 必須相符。撤銷不要求 subject 仍 active，也不偷偷改綁來源／Owner。不能由 caller 指定 Actor、State、VERIFIED、Snapshot 或 delivery 權限。

新 Writer 自己建立 SERIALIZABLE transaction，設定 XACT_ABORT 與必要 index SET options，先取得 transaction-owned Scope-management application lock（全域資源 V1），再驗證 actor、Schema/權限、完整 expected RV 與 parent。Scope CAS affectedRows=1→Binding→精確 Audit INSERT/OUTPUT→immutable Decision INSERT→最終 Scope／授權重驗→commit；所有 helper 共用 transaction，不自行提交。RequestId 全 ledger 唯一，digest 涵蓋 actor/目標/完整 command/incarnation；同內容只回讀原紀錄，不改 head；異內容409。回讀仍需當前管理權限，並驗證 exact receipt 與 online/archive 的 Audit 事件關聯；retention 缺證就拒絕。

SQL BIGINT 的目標／receipt ID 由 SQL CONVERT(varchar(20),...) 讀取，寫入以字串參數在 SQL 層轉 BIGINT；不經 JS Number。沿用 923 receipt helper，只擴充 exact string entity ID，相容原安全整數呼叫者；不修改正式舊 Audit Repository 的 Number 介面。既有登入 identity 仍限制安全整數 actor ID，超出範圍拒絕，不假裝已修復整套 legacy auth 的 BIGINT。

1205/1222/鎖失敗／CAS衝突不自動重試。commit unknown／rollback failure回503，不回成功；UI保留 RequestId、停止進一步寫入，供管理員用決策查詢／稽核查證。不能只因記憶體 rollback 或 receipt 字串有效就宣稱 DB 持久性。Scope Gate 資源只覆蓋新 Scope Writer，不宣稱舊 ACL/Dashboard/RBAC Writer 共用同一把鎖或 deadlock-free。

## 驗證與未解除項目

- 單元／API：JWT/session失效、前端假角色、能力缺席、嚴格欄位、CAS、RequestId重放／衝突、Audit/Decision失敗、最終Token變動、Mock1205/1222/commit unknown/rollback failure及診斷去敏。Mock不證明SQLrollback。
- Browser：Owner/Reviewer明確指派、撤銷、>2^53字串、版本衝突清空表單、unknown停止重送、無能力時不可進管理頁；不呼叫preview/metadata初始化。nonce使用安全getRandomValues，支援沒有randomUUID的瀏覽器，不使用Math.random。
- 現有 CI SQL Server 2019 disposable container：只在既有測試末端追加**新正式 repository 路徑**驗收；獨立非dbo principal、924無自動grant、原923 Catalog仍一致、精確大ID、真實Scope/Binding/Audit/Decision回滾、不可更新/刪Decision、同預期RV競爭、Owner/帳號/角色/來源ABA失效、stale session及歷史關聯。原923／低層F2/F5實作與測試不重寫。CI身分/DB全為合成，TLS自簽容器設定不是正式來源TLS見證。

目前只提供 PR 供審查，不在使用者 DB 套用924、變更帳密或要求覆蓋現用UQP。正式啟用管理仍需核准924與受限principal、完整授權Writer/TokenVersion覆蓋、外部incarnation與還原流程；真實kill/rollback failure/commit unknown的故障驗收不能由Mock取代。SOURCE_BOUND、SQL_LOCK_VERIFIED、可信欄位初始化、患者分類與資料列交付仍未解除。

下一個最小階段：先審查924安裝與上述獨立環境的管理功能UAT；再為Owner/Reviewer提供受版本綁定的分類確認入口。來源registry/generation/lease/DDL Fence與結果比對未成立前，不接資料列預覽。
