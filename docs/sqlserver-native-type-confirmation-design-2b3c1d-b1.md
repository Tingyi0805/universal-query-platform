# SQL Server 可信 Native Type 確認設計（2B-3C-1D-B1）

基準：`1d6bb698d8a222f0794d2be20bc944ac9eb90350`；PR #66 開工時為 Draft，CI #871 成功。
本文件僅為唯讀調查與後續提案；未建立確認功能、Migration、資料庫連線或正式 Runtime 接線。
文中「建議／必須」是未來實作條件，不代表現有能力；無法由程式證明者標示「待驗證」。
所有 A2/A3 handle 維持 `deliveryAllowed=false`，人工確認亦不得直接取得交付資格。

## 1. 已確認的基礎與缺口

| 現有來源 | 可沿用 | 尚缺／限制 |
| --- | --- | --- |
| [920](../database/migrations/920_dataset_definition_rowversion.sql)、[921](../database/migrations/921_datasource_native_parameter_versions.sql) | Dataset `DefinitionRowVersion`、DataSource `ConfigurationRowVersion`；契約獨立 `ContractRowVersion`；精確 catalog 檢查 | 921 僅允許 UNCONFIRMED，恰為八欄且拒絕未知約束／trigger；不得改寫或繞過此限制 |
| [Native Parameter Version Repository](../server/src/modules/dataset/nativeParameterVersion.repository.ts)、[Source Version Repository](../server/src/modules/datasource/datasourceVersion.repository.ts)、[交易工具](../server/src/modules/datasource/versionFoundation.ts) | opaque 8-byte 版本、精確字串 BIGINT ID、來源啟用／設定完整性檢查、expected-version 比對、HOLDLOCK、owned SERIALIZABLE transaction、固定錯誤碼；可加入 caller transaction | 只回 MISSING／UNCONFIRMED；`requireVerifiedNativeParameterContract` 永遠拒絕。設定完整不等於來源連線或權限有效；外部交易僅檢查 active，不證明其 isolation 等級；Native reader 可讀 inactive Dataset，不是執行授權 |
| [Parameter Repository](../server/src/modules/dataset/parameter.repository.ts)、[Version Repository](../server/src/modules/version/version.repository.ts) | save/sync 在交易內推進 Dataset 定義版本；restore 更新 Dataset、失效 metadata、取消發佈，並強制同交易稽核 | 無獨立 parameter-set revision；所有寫入路徑及 DB 寫入權限覆蓋率**待驗證**。歷史 snapshot 不得恢復舊確認 |
| [JWT/RBAC](../server/src/modules/auth/auth.middleware.ts)、[Session Reader](../server/src/modules/auth/auth.repository.ts)、[Admin Writer](../server/src/modules/admin/admin.repository.ts) | JWT 檢查目前 active／TokenVersion、重讀 permission；session reader 支援 transaction；既有角色／帳號異動會按條件推進 TokenVersion | 尚無 Native Type reviewer 權限及 Dataset／Source 審查 scope；route middleware 不是交易內最終授權。所有 RBAC writer 的競態／世代覆蓋**待驗證** |
| [Query ACL](../server/src/modules/queryDefinition/queryAccess.repository.ts)、[Effective Access](../server/src/modules/queryDefinition/queryDefinition.repository.ts) | user／role 權限聯集、已發佈 Query 與 Dataset／Source 啟用檢查；ACL writer 與 Dashboard 919 evidence 同交易推進 | `getQueryAccessRevision` 是內容 hash，可 A→B→A；Dashboard evidence 不是通用 Native ACL epoch。published-only helper 不適合直接授權草稿審查 |
| [Audit Repository](../server/src/modules/audit/audit.repository.ts)、[Delivery Finalizer](../server/src/modules/audit/deliveryAudit.repository.ts) | `writeAuditEvent(input, tx)` 可強制同交易寫入；restore 提供管理操作原子稽核範例；finalizer 在 SUCCESS commit 前再次驗證 | `tryWriteAuditEvent` 吞錯，不能用於確認；通用 ParametersJson 會截至 20,000 字元，不可放完整證據。append-only／防竄改／保存與刪除權限**待驗證** |
| [A2](sqlserver-typed-bind-plan-2b3c1d-a2.md)、[A3](sqlserver-typed-runtime-normalization-2b3c1d-a3.md) 與對應 compiler／normalizer | 精確型別、值、Token／名稱對應、固定 LIST、opaque plan、同 plan 描述／Request preparation | CONFIRMED／EXPLICIT_RUNTIME_BIND／matching version 都只是輸入前提；未驗證來源或新鮮度。現有 descriptor 為 UNBOUND_CANDIDATE，正式 SQL Server 仍有推論型別路徑；不能發證 |

## 2. 證據來源與可信邊界

- **DATABASE_DECLARATION 候選**：未來由後端以受控唯讀身份取得真正的參數宣告，保留 server/database/object identity、參數名稱、native type、length／precision／scale、collector 版本及取得時間。只有能證明 SQL Token 與該宣告一對一對應時才可採用。View 欄位型別、SELECT 輸出 metadata、隱含轉型或 `sp_describe_undeclared_parameters` 建議，均不能直接證明輸入參數契約；支援範圍及權限**待驗證**。
- **EXPLICIT_RUNTIME_BIND 候選（建議先做）**：受控後端保存、具版本的明確 bind manifest，列出每個 Token 的 native type、SCALAR／FIXED_LIST 長度及 codec 規則，由授權人員審查並完成驅動驗收。後端重讀／驗證 manifest；瀏覽器只提交 ReviewId、expected versions 與決策，不得提交被信任的 evidence/state/actor。manifest 作者、reviewer 身份及變更紀錄須可追溯。
- A2 僅接受 `origin=EXPLICIT_RUNTIME_BIND`。DATABASE_DECLARATION 不可改標籤後直接餵入；須在保留原始 provenance 的前提下，另建立、審查並驗證相符的 explicit bind manifest，或另案擴充受控 adapter。
- `sp_describe_first_result_set` 證明的是**在所提供 declarations 下**的候選輸出結構，不證明 declarations 的權威性、實際執行成功或交付安全。generic NUMBER／STRING、UI 控制項、測試值、前端按鈕與 CONFIRMED／VERIFIED 字串都不是證據。零參數也必須明確審查空 manifest 與對應 SQL。
- 平台 DB／後端服務及經授權的來源 collector 為擬定信任根；實際 service account、TLS／來源身份、DB grants、credential rotation 與 DBA 外部寫入管控皆**待驗證**。不可把密碼、連線字串、實際參數或患者資料寫入證據／稽核／錯誤。
- Oracle 含參數 Metadata 維持拒絕；不改 SQL、不執行 query、不以採樣／字串代入作 fallback。

## 3. 必須一起綁定的版本與失效條件

一份審查快照至少綁定：DatasetId＋DefinitionRowVersion、DataSourceId＋ConfigurationRowVersion＋SQLSERVER 類別、921 契約存在性＋ContractRowVersion（允許明確 missing）、**精確 SQL**、完整已儲存參數定義、逐 Token native declaration＋LIST 長度、授權 epoch、reviewer TokenVersion、外部來源身份／Schema generation、descriptor、collector／normalizer／plan／driver 格式版本及證據有效期。

SQL digest 使用明訂編碼的原始字串，不以去空白／正規化推定語意一致；參數 digest 涵蓋名稱、generic/control type、required/default、日期模式／曆法／格式及 options／lookup 等已儲存設定。canonical JSON／digest 格式必須有版本。digest 只供完整性比對，不能代替 mutation epoch 或來源身份；快照由後端在鎖內重新產生，不能採信前端摘要。原始 SQL／default 不放通用稽核；需要保留的審查材料須限權且不含 runtime 值。

- Dataset／Source／參數／manifest／LIST 長度 A→B→A，必須有新的不可回復 mutation revision；原內容恢復仍須新審查。已知參數 writer 可沿用 parent Dataset RowVersion；若無法限制所有參數 writer 都推進 parent，須另加 parameter-set epoch，未完成前禁止確認。delete/recreate、restore、撤銷後重審亦不得重用舊 ReviewId／版本。
- 建議先採**單一全域 AuthorizationEpoch**（較粗但最小）：任何 Query ACL、review scope、UserRole、RolePermission、角色／使用者啟停及 Query↔Dataset 綁定變更，都在同交易推進 epoch；即使 ACL 內容恢復亦不同。比較 epoch 並重查當前權限；不能只比 ACL hash 或 TokenVersion。所有 writer／舊程序覆蓋未完成時 fail-closed，不聲稱已具備此能力。
- Dataset RowVersion **不涵蓋外部 View**。後續需要來源端可信、單調且不可回復的 Schema generation／DDL 紀錄，涵蓋相依 View／function／table、drop/recreate、synonym／跨 DB 依賴及相關 GRANT／REVOKE；只看 modify_date、欄位 hash、TTL 或前後兩次相同描述均不足以防外部 A→B→A。未解析依賴、metadata 權限不足或無 generation 都拒絕。
- metadata 探測、確認及後續執行需來源端可驗證的 schema-stability lease／DDL fence；平台 SERIALIZABLE 無法鎖住另一個來源 DB。來源機制與確認 commit／最終交付間競態如何封閉均**待驗證**；不能用平台交易或定時重探測宣稱跨 DB 原子性。沒有此保證時保持不可交付。
- 權限撤回／reviewer 不再適格、來源停用／rotation／身份改變、版本不符、證據逾時、格式／driver 升級或 drift：讀取即拒絕，不能等待背景失效作業。背景作業可補寫 INVALIDATED 紀錄，但不決定安全性。任何衝突均要求重新讀取及重新審查，不自動重試舊 approval。

## 4. 若後續需要 Migration 922：最小 sidecar 提案

**本階段不新增 DDL。** 建議另建 sidecar，保留 921 八欄、UNCONFIRMED 約束與既有 reader 完全不動；不得把確認塞入 921 JSON、鬆綁 catalog validator 或建立替代 VERIFIED。以下為邏輯最小集合，SQL 型別／約束實機表現**待驗證**：

| 新物件 | 建議欄位／約束 |
| --- | --- |
| `NativeTypeAuthorizationEpoch` | 固定 singleton key、ROWVERSION。只允許更新既有列、不刪除／重建；所有受影響授權 writer 同交易 touch，未知／missing 即拒絕 |
| `DatasetNativeTypeReview` | 不重用 ReviewId（UUID）；DatasetId／DataSourceId FK、捕捉的 Definition／Configuration／可空 BaseContract RV（BINARY(8)）；AuthorizationEpoch、ProposedByUserId、ReviewerId／TokenVersion（確認前可空）；SqlDigest、ParameterDefinitionDigest；NativeTypesJson（含固定 arity）、EvidenceSource／EvidenceJson（含來源身份、Schema generation、collector／driver／codec／plan 版本、descriptor digest）；EvidenceAt／ExpiresAt；State（預設 PENDING）、StateRowVersion |
| `DatasetNativeTypeDecision` | append-only DecisionId、ReviewId、RequestId／冪等鍵、ActorId、動作、前後 state／revision、ReasonCode、精簡版本摘要、CreatedAtUtc、同交易 AuditLogId；保存歷次 CONFIRM／REJECT／REVOKE／INVALIDATE，不覆蓋舊事件 |

建議 State 僅 PENDING／CONFIRMED／REJECTED／REVOKED／INVALIDATED，**無 VERIFIED**。確認僅表示人工審查的 declaration 被接受，不等於 runtimeBindVerified 或 deliveryAllowed。
PENDING 可確認／拒絕／失效；CONFIRMED 可撤銷／失效；terminal state 不重新確認，建立新 ReviewId。快照內容不可原地改寫；變更生成新 review。

必要約束：每 Dataset 最多一個 CONFIRMED（filtered unique index）；FK 不 cascade 刪除稽核；ISJSON 只是語法檢查，後端仍須嚴格解析 native type、Token 唯一名稱／集合、精度、scale、list 1–128、總 bind 上限及 schema version；欄位長度／null 組合／時間順序 CHECK，CONFIRMED 必須具非空 reviewer、TokenVersion 與完整證據。決策、actor、有效 evidence 與版本檢查在 Repository 同交易完成，不能靠 State CHECK 證明。
限制 service identity 直接寫 review／decision，僅走受控 Repository／必要時限權 procedure；DB 實際 grants 與 audit append-only、保留／刪除政策**待驗證**。通用 AuditLog 可能有 retention，長期決策紀錄不得依賴其永遠存在；AuditLogId 關聯與 retention 相容性須先驗收。
目前 `writeAuditEvent` 回傳 Number ID；新 Repository 必須拒絕非正安全整數 receipt，或另案加入精確字串 ID adapter，不能把可能失真的值寫成 decision 關聯。新 sidecar reader 不得讓現有 `requireVerifiedNativeParameterContract` 改成接受 CONFIRMED；B3 仍保留該拒絕 gate。

向下相容：不自動確認既有 Dataset，不將空參數視為已確認；schema 未裝／部分安裝／未知版本拒絕新功能，舊路徑照舊。922 sidecar 雖不改 921 形狀，舊 binary 仍不會推進新授權 epoch；因此混合版本部署時不得啟用確認，須等所有 writer 升級或有經驗收的 DB enforcement。rollback 關閉新功能並保留決策歷史，不刪證據、不回灌 921 狀態。

## 5. 授權、確認及原子稽核流程（未實作）

審查人員必須為有效互動式使用者，具 DESIGN_QUERY＋建議新增的 Native Type review permission，且有明確 Dataset／Source review scope；不把 MANAGE_DATASOURCE、SYSTEM_ADMIN 名稱或 Query CanExecute 當作單獨發證權。scope／reviewer assignment 與作者不得自審為新增政策，核准與實作均**待驗證**；不得由裝置憑證確認。現有 Query ACL 只沿用到後續實際 query 的 CanView／CanExecute／CanExport 與 query-dataset 綁定檢查，不能代替草稿審查 scope。

1. **準備**：驗證 session／scope，讀取一致平台版本快照，後端收集來源證據與同 A2 plan 的 descriptor，檢查來源 generation／lease。外部 I/O 不冒稱在平台交易內完成；ReviewId 綁定不可變快照及有效期。來源不可驗證則只產生候選或拒絕。
2. **決策**：使用專用 owned SERIALIZABLE＋XACT_ABORT 交易；若支援外部交易，必須證明 isolation／rollback 所有權，不能僅依 `versionTransaction` 的 active 檢查。訂定所有 writer 一致的鎖順序（AuthEpoch → identity/scope → Dataset → Source → parameters／base contract → review → decision/audit），與既有 Dashboard→ACL 順序相容性及 deadlock **待驗證**。
3. **重驗**：鎖內重讀目前 session／TokenVersion／permission／scope 與 reviewer 資格，重讀全部平台版本／saved definitions／SQL／declarations／arity；驗證來源 lease、generation 與 evidence 有效性。CAS expected review revision／state、affected rows 恰一。任一缺漏、衝突、超時或權限異動拒絕；後端從 current evidence 組裝候選，忽略 caller 自報 CONFIRMED。
4. **原子寫入**：更新 sidecar state＋追加 decision＋強制 `writeAuditEvent(..., tx)`，最後再次驗證必要授權／版本後 commit。建議事件 `DATASET_NATIVE_TYPE_CONFIRMED/REJECTED/REVOKED/INVALIDATED`，既有分類會歸 CONFIG／important。Audit 僅含 IDs、固定 reason、版本／digest／collector 參考；限長且不可截斷核心證據，不放 SQL、參數值、憑證或患者資料。audit/state/CAS/commit 任一失敗皆 rollback，回 code-only error；不得 `tryWriteAuditEvent`、commit 後補寫成功、或審計失敗仍成功。
5. **失敗與冪等**：REJECT 是已授權、成功提交的拒絕決策，與衝突／未授權 FAILED attempt 分開。rollback 後可另記固定碼 FAILED attempt，但不能留下 CONFIRMED／成功回應；若稽核 DB 本身不可用，不能保證該次 attempt 已持久化，須回不可用並用既有安全診斷告警，不能宣稱零遺失。同冪等鍵僅允許同 actor／動作／快照的已提交結果；回應遺失後仍重查當前授權與狀態，不復活已撤銷結果。
6. **撤銷／失效**：明確 reason、CAS revision、decision＋audit 同交易；替換有效確認須同交易使舊 review 失效。版本／權限異動的失效稽核即使寫入失敗，read-time mismatch 仍拒絕使用。純人工撤銷若交易失敗則未完成撤銷，必須回失敗而非謊稱已生效；若要求故障期間也能立即封鎖，尚需跨程序持久 deny-hold／維運停用機制，**待驗證且為接線阻擋**，不能用本機旗標宣稱已解決。舊 approval 永不自動恢復。

## 6. 描述與 Runtime 一致性及驗收矩陣

未來後端僅從版本重驗後的持久證據構造 A3 輸入，保留原始精確值、不先走 legacy coercer；A3→A2 產生**同一 opaque plan**供 description／Runtime Request。建議 A2/A3 declaration version 取已提交確認的 sidecar StateRowVersion（16-hex），完整 evidence binding 另由 Repository 重驗；不得誤用 Dataset RV 或 hash 作確認版本。記錄 plan 格式、expanded names／arity、宣告與 driver／codec 版本；不能分別重建或依 sample／null 推論。
使用明確 mssql native type（含 null）、已驗證 UTC context；實際結果欄位名稱／ordinal／native type 與描述逐一比較，任何 drift 或 unsupported metadata 拒絕。現有 descriptor 僅 name/dataType/ordinal，是否足以涵蓋 length、precision、scale、nullability、collation 的變化**待驗證**，不足須另案擴充；一次執行相符也不取代來源 generation。
最後仍須既有 ACL、SQL review、mask／CUSTOM／OMIT、患者稽核及 final version revalidation，禁止把型別確認當成整體安全確認。

| 必要測試 | Mock／CI | 日後隔離真實 SQL Server 驗收（本階段未執行） |
| --- | --- | --- |
| 來源／權限 | 前端假 state／origin、空 manifest、未知 catalog／schema、Oracle 有參數、collector 權限不足均拒絕；草稿 scope 與執行 ACL 分離 | 實際唯讀身份／TLS／catalog 可見性、跨 DB／synonym／nested dependencies、GRANT／REVOKE、來源身份切換 |
| 版本／ABA | Dataset／Source／parameters／arity／review／ACL／RBAC A→B→A；同內容 hash 但新 epoch、delete/recreate、restore、writer 漏推進、混合 binary 均失效 | ROWVERSION 及全部 writer 覆蓋、參數集合鎖、ACL delete/insert／角色移除再加回、來源 rotation |
| 交易／稽核 | 任一 write／CAS／audit／commit 失敗回滾；雙 reviewer、revoke-v-confirm、冪等碰撞／回應遺失、過期、無外部交易 isolation 保證 | SERIALIZABLE／key-range locks、約束與 filtered index、deadlock／timeout／斷線、審查狀態與 AuditLog 無半套 commit；922 安裝／重跑／部分安裝／舊 reader 相容 |
| 外部 drift | 探測前後及執行／最終檢查各時點變更、相同形狀但 DDL 世代不同、TTL 內 drift、缺 lease 均拒絕 | View ALTER／drop-recreate／底層物件與同型別語意變更、DDL ABA、metadata／execution 間 drift；驗證來源 lease 真能覆蓋確認與最終回應邊界 |
| plan／值／資料界線 | A2/A3 名稱／版本衝突、BIGINT／DECIMAL 精度、Unicode、Boolean、null／default、日期 STRING/NATIVE、固定清單；同 plan 型別一致、無真實 DB／delivery／敏感 log | synthetic-only typed bind round-trip、driver bytes／precision／scale、UTC／ROC、Unicode／collation／MAX、null、list arity 與實際 descriptor 差異；保持原遮蔽與患者稽核檢查 |

## 7. B2／B3 最小切分與未解除的阻擋

- **B2 建議**：只做 backend-only 的 review snapshot／evidence envelope 型別、純驗證／失效判定與 CAS／audit Repository **介面＋Mock**；加入來源 collector／authorization epoch provider 抽象，測試 ABA、偽造來源、衝突與原子 rollback。資料來源一律合成、沒有實際 DB collector／寫入／發證、Migration、API／UI 或 Runtime；921 guard 與 deliveryAllowed=false 不動。
- **B3 建議（須另行授權）**：先審核／驗收 922 sidecar、全 writer 授權 epoch、reviewer scope 與來源 Schema generation／lease；再做後端 transaction Repository、必要 collector、強制管理稽核及隔離 SQL Server 驗收。不預設有可啟用的確認 API，更不接正式 Runtime；尚未具備來源保證時只保存 PENDING 候選／拒絕。
- **正式 Runtime 前仍阻擋**：可信 evidence issuer、授權與參數 mutation 覆蓋、外部 Schema／權限 ABA 及跨 DB 競態、review／audit durability、driver 真實精度／日期／collation、descriptor 細節與實際結果比較、A3 未支援的 defaults／list／temporal 語意。上述均未由本階段證明；既有遮蔽、患者稽核、Legacy Dashboard 保護及 delivery gate 必須全部保留。
