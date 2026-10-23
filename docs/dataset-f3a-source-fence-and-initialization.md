# F3-A：已儲存欄位描述與 Source Fence 驗收

**可信 SOURCE_BOUND 與資料列交付仍 BLOCKED。** 此階段以完整 001–921＋923＋924 CI Schema 實測受控來源 Gate，並保存 923 原本允許的 `DESCRIBED` 候選 Snapshot。不把 Snapshot、Digest、TTL、UUID、Gate 成功或合成 Registry 升級成可信權限。沒有新的 Migration，不改已安裝 923／924。

## 已接入的最小子流程

- `/api/dataset-field-initialization/:datasetId` 的 GET 讀去敏欄位狀態、POST 收集已儲存欄位。沿用 924 管理交易 owner、SERIALIZABLE、XACT_ABORT、Scope Gate、有效 Binding、即時 TokenVersion 與最後授權／版本重驗。使用者同時需要 DESIGN_QUERY、CONFIRM_DATASET_CLASSIFICATION 與指定 Dataset 的有效 Owner／Reviewer；SYSTEM_ADMIN 字串或單一全域能力不能替代 Scope。
- POST 固定欄位只有 requestId、definitionVersion、configurationVersion、expectedSnapshotVersion。SQL、Actor、來源 identity、Fence 狀態均不能由前端宣稱。Dataset 必須 active、未封存、來源 active SQLSERVER、完整參數集合為空；921 合約若存在只能 UNCONFIRMED，不推定 Native bind 已驗證。
- 首版僅接受 `SELECT 明確欄位 [AS 別名], ... FROM schema.table`，最多128欄。拒絕 SELECT *、跨 DB／Server、join／CTE、where／hint、動態 SQL、所有 Function／View／Synonym、computed／UDT／加密欄位、RLS／external／temporal／memory-optimized table 及未知依賴。這是明確限縮，並非通用 SQL parser。
- 描述只呼叫 `sys.sp_describe_first_result_set`，不執行 SELECT 資料查詢。檢查可見欄位的名稱、順序、來源 DB/schema/table/column、別名唯一性及有限 Native Type。metadata 帳號須完整 DB VIEW DEFINITION 以免隱藏 RLS／依賴；來源 requestTimeout 必須有限且不超過5秒，Gate 等待1秒。
- 正常收集：平台鎖定已儲存 SQL／D/S RV／參數範圍／合約版本 → 取得來源共享 Gate → 原生 metadata 與觀測 → 重驗 → INSERT DESCRIBED Snapshot → 精確 AuditLog INSERT/OUTPUT及關聯重讀 → immutable Decision INSERT → 來源與授權重驗 → 平台 commit → 釋放來源交易。Snapshot／Decision／Audit 在同一平台交易；**來源交易沒有被宣稱成跨 DB 原子提交**。
- 新 Snapshot 是 INSERT，不覆寫舊欄位／政策。RequestId 全 Ledger 唯一、相符重放只讀原精確 Audit 關聯，衝突／過期權限拒絕；最新 Snapshot RV CAS 拒絕競爭。中途 Audit／Decision／來源錯誤 rollback，不留下成功 Snapshot。來源 release／commit unknown 可能已提交候選列，回報未知並保留 RequestId，不自動重送。
- Snapshot 的 SourceIdentity／Incarnation／Generation／LeaseVersion 是**觀測值**。generation／ID 使用 canonical SQL BIGINT 字串；版本使用真實 RV bytes，不經 JS Number。SourceEvidenceJson 明記 authority=NONE、externalDdl=BLOCKED。15分鐘 ExpiresAt 只是描述保存期限，不能充當 Lease 或 DDL 保護。

## Source Gate 與可信邊界

來源介面只允許後端明確註冊 Provider；預設沒有 Provider，回 `SOURCE_PROVIDER_NOT_REGISTERED`，不自行搜尋替代資料庫、不使用前端憑證／SQL／CONFIRMED 標記。沿用既有 Scope 管理預設關閉設定，沒有 `.env` 變更或公開註冊 API。此次可操作子功能限於核准、注入真實 SQL Provider 的隔離 CI。

CI 專用來源 DB `UQP_F3_CI_SOURCE` 與平台 DB 分開。`f3.FenceState`、受控 DDL procedure 和權限只在該可銷毀來源 DB 建立，**不是正式來源安裝或平台 Migration**。Collector 與 DDL Writer 使用不同受限登入；DDL Writer 只能呼叫固定操作 procedure，不能任意 ALTER。procedure 先取 transaction-owned Exclusive Gate，再執行固定 ALTER/DROP/GRANT/REVOKE 及 generation/leaseVersion 推進，同交易提交；Collector 持 Shared Gate。來源 generation A→B→A 會推進，與 ROWVERSION +1 無關。

原生 `service_broker_guid` 只能作本次 DB identity 觀測，不是完整 restore incarnation；CI Registry UUID 也不是備份外權威。外部 DBA／db_owner／sysadmin 可忽略此 Gate、改 Registry、授權別人、還原／clone、停用受控程序或 KILL。即使 selected descriptor/hash 回復相同，未受控 ALTER ABA 也可能不變 generation。因此 **acquireControlledMetadataLease 永遠回 BLOCKED_PRIVILEGED_DDL_PATHS，沒有 SOURCE_BOUND／VERIFIED 發證分支**。不得把本 Provider 直接註冊成正式可信來源。

## SQL Server 2019 實測矩陣

各實際結果以 PR 對應 CI 的 `F3_*` 輸出判定；未跑為 NOT_RUN。一般 Mock 不能取代以下實測。

| 路徑 | 驗收結果條件 |
|---|---|
| 共享 Gate vs 受控 ALTER／DROP／REVOKE | 第二獨立連線 timeout／rollback；描述與 generation 不變 |
| 受限 DDL 登入直接 ALTER | 權限拒絕，不能繞過 procedure |
| 受控 ADD→REMOVE | 描述可相同，generation 不同，舊觀測失效 |
| DBA 直接 ALTER ABA | 實證可繞過 Gate／generation 時，trusted issuance **BLOCKED**；描述比對不能當 ABA 防護 |
| DBA 改欄位型別／DROP | 重驗拒絕，不把未知依賴當成功 |
| REVOKE SELECT | Collector 描述拒絕；GRANT 後 generation 改變 |
| KILL Collector session | 來源失去 ownership／連線，後續重驗拒絕 |
| Exclusive Gate held | Collector 1秒 timeout，沒有猜測 Lease 有效 |
| 合法已儲存觀測 | DESCRIBED Snapshot＋Decision＋精確 >2^53 Audit ID 同交易；authority=NONE／deliveryAllowed=false |
| 重放／新 RequestId 舊 CAS／雙 Collector | 重放不增加寫入；其他僅一筆 CAS 可成功 |
| Audit／Decision INSERT 拒絕 | Snapshot、Audit、Decision 計數不變，無孤兒成功證據 |
| API／UI | 缺能力／失效 Token／假 Fence 拒絕；候選欄位只供顯示；版本失效警示、unknown 停止重送；不寫政策、不查資料列 |

Server／Client／Browser 全量回歸保護既有 Dataset、Query、Dashboard、Excel、患者稽核及遮蔽。原 923／924 Catalog 最後仍須 EXACT_MATCH。CI 不連使用者 SQL Server／HIS／Oracle；正式 Source TLS、Windows source deployment、完整 SQL_LOCK_VERIFIED 未驗收。

## 下一階段准入

**尚未達到 A 類可信分類＋安全資料列預覽的完整前提。** 首先需 DBA／管理員提供可驗證的來源權威／restore incarnation、受控 Writer 與 GRANT／REVOKE 覆蓋、不可被未納管身分繞過的 DDL Fence 邊界，並補 describe→確認→執行→交付跨平台 commit 的失效保護。無法約束的 DBA／外部 Writer 必須明示阻擋，不能用另一個 checkbox 解除。

已有的 923／924、候選 Snapshot 寫入與顯示不需重做；前提建立後，最小實作是單一無參數、單表、合成 A 類 Dataset 的 Owner/Reviewer 明確分類及政策確認，再經既有 delivery／稽核／遮蔽 Gate 實測預覽。B/C 類仍需自訂敏感規則與患者識別/HMAC/揭露稽核；不以欄名自動分類、不因空政策推定安全。若前提未成立，停止可信發證／預覽接線，不擴充下一輪純合成權威模型。
