# Write Inventory／Event Observation／Revision Receipt（2B-3C-1D-B3-C5）

基準 `a45e1667477f85f699d663961b06a19b7067e365`；開工 PR #66 Draft、未 Merge。已核對 CI #881 workflow 為 completed/success，Server、Client 均成功。只新增 [V3 純契約](../server/src/modules/dataset/nativeTypeWriteInventoryV3.ts)、[測試](../server/src/modules/dataset/nativeTypeWriteInventoryV3.test.ts) 及本文件；不改 [C4](sqlserver-native-type-mutation-reservation-2b3c1d-b3c4.md)、C2 或正式程式，沒有 SQL／DB／Migration／真事件攔截器。

**結論：有限模型可 MODEL_CONSISTENT，正式路徑 BLOCKED。** 全部結果固定 `authority=NONE, runtimeBindVerified=false, deliveryAllowed=false, persistence=NOT_PROVEN, productionSafetyProven=false`。合成 provenance、UUID、digest、完整事件 inventory 相符都不是可信來源、鎖、無其他 DML 或持久性證明；完全偽造但相互一致的輸入仍可能通過模型檢查。

## 1. 固定來源與逐 operation 寫入

`prepareSyntheticWriteInventoryV3` 只接受 C4 strict Request：C、受限 Δ、expected revisions 及合成 context。先呼叫 C4 純驗證／E 推導，再由固定 operation 分支建立寫入 schedule；不接受 caller inventory、E/U 或 complete。逐事件於局部 copy 重播宣告效果，最後必等於 E 的 stored-model projection，不能漏掉 E 的副作用；不從 P 補 E、columns、versions 或事件。

Resource/Table 是封閉 `MODEL_*` enum，**不是正式 SQL Table/Column 或 SQL statement 的執行規格**。一個 row INSERT/UPDATE 為一事件；ACL/user 清除的 DELETE 按一個 predicate batch 為一事件，列出完整、精確排序的 ROW/composite identities，含零列 batch。ID/identity/事件及 receipt ordinal 皆 canonical positive SQL BIGINT 字串（計數 affectedRows 是有界整數）；新 entity 在 preview 保持 `$NEW`，final 只用 C4 已驗過的獨立 allocation 綁定，不猜 ID。事件排序是 DML 的合成 schedule，不能當作 FIRST lock acquisition 順序。

| C4 操作族／operation | 固定 inventory（前至後；每項含精確目標及 before/after） | 已知未建模的正式 effects：BLOCKED |
| --- | --- | --- |
| Query：QUERY_REBIND | 指定 Query UPDATE datasetId/published/publisher/revision；AE；Generation；AuditIntent | QueryVersion history、完整 Query 欄位/時間及原 guards；source effective Dataset 隨 JOIN 改變，不建立 source UPDATE |
| Parameter：ADD／DELETE／LOOKUP | 指定 Parameter INSERT/DELETE 或 lookup/revision UPDATE；owner Dataset revision（D）；直接 owner 下原 published Queries unpublish/publisher/revision（Q）；Generation；AuditIntent | 完整 saved definition/parser/policy、間接 unpublish、history/versions 與時間；不能代替正式 save/sync |
| CREATE_USER／CREATE_ROLE | 新 entity INSERT；列出的 UserRole／RolePermission INSERT（精確排序）；AE；Generation；AuditIntent | Password/AuthProvider/DisplayName、Role 描述等正式欄位、Identity key-space/OUTPUT、SYSTEM_ADMIN 特殊流程 |
| USER_ROLE／ROLE_PERMISSION | UR 指定 tuple INSERT/DELETE，然後 target User token/revision。RP 先 Role revision、指定 tuple INSERT/DELETE，再全部既有 members 的 User token/revision；AE；Generation；AuditIntent | 正式 updateUser/updateRole 的其他整批 rewrite/時間/guards 不等價於此受限 grant/revoke；原自改及 systemAdmin 拒絕不放寬 |
| ACL_REPLACE／DELETE_USER | 先受影響 Dashboard revision。replace：RoleACL predicate DELETE、UserACL predicate DELETE、desired RoleACL INSERT、desired UserACL INSERT；即使 grants 相同仍 rewrite。deleteUser：UserACL DELETE、UserRole DELETE、AppUser DELETE。最後 AE、Generation、AuditIntent | 所有未建模 retained FK/history/cascade/SET NULL/trigger 一律 BLOCKED；C4 有 Audit/Decision/Version/Favorite/其他引用時已拒絕 deleteUser。Dashboard evidence 在模型明列，不宣稱現有 deleteUser 已涵蓋此旁路 |
| SOURCE_REBIND | source queryId/bindingRevision/revision UPDATE；Dashboard revision；Generation；AuditIntent（無 AE/Q/D/S） | 真 source UPDATE 還含 settings/parameters/UpdatedAtUtc、markManaged 及 mandatory AuditLog；完整 sensitivity/layout/approval/session guards 與真鎖未證明 |

ACL DELETE／INSERT rewrite 與先 Dashboard evidence 的程式證據：[replaceQueryAccess](../server/src/modules/queryDefinition/queryAccess.repository.ts#L61)。真 writer 按 caller 順序 INSERT；模型固定精確排序，是 V3 規格而非現有 SQL 逐項 trace 等價證明。空 predicate DELETE 仍須有 affectedRows=0 的事件；非空須等於列舉 rows 數，不能任意用「都是 1」。batch 拆成 N 個 row events 或把 rewrite 合併 UPDATE 均不符合本版格式。

## 2. 事件觀測及不洩漏邊界

`SYNTHETIC_WRITE_EVENT_OBSERVATION_V1` 固定 `{format,provenance=SYNTHETIC_TEST_ONLY,context,events}`，最多 256 events。每事件固定：eventId、context、writerOperation、eventType（ROW_WRITE/AUDIT_INTENT）、resource/tableType、INSERT/UPDATE/DELETE、identity（精確 rows＋nullable queryId/userId predicate）、固定 columns 白名單、beforeImage/afterImage、affectedRows、revisionDomains、effect（PRIMARY/DECLARED_SIDE_EFFECT/REVISION_ONLY/AUDIT_INTENT）。未知／額外／遺漏欄位拒絕。

Image 僅回傳 `SYNTHETIC_MODEL_IMAGE_SHA256_V1`＋64 位小寫 SHA-256；編碼為 stored-model rows 的 JSON UTF-8，object keys 固定字典排序、rows 依精確 identity 排序。空 image 為 `[]`。UPDATE 的 columns 是明示 SET 集合，包含合法但值不變的欄位；digest 包含完整該模型 stored row，不能藏其他欄位異動。它不是 SQL digest、版本世代或秘密保護機制；只接受受限合成名稱，不接真資料。

Final 同時呼叫 C4 final（保留完整 U、CAS、獨立 P、授權與版本重驗），再重新推導 **bound inventory**，與獨立 event observation 逐項／順序／digest／column／count 完全比較。測試 observations 與 P 由獨立 golden differences/specs 建立，不複製 V3 planner 輸出。P 保持 E 時，額外同列 UPDATE、C→B→C、額外 Audit/side-effect、DELETE＋INSERT 偽裝 UPDATE 仍因事件不等而拒絕；C=P 亦不能免除 Δ/CAS/Post 或事件驗證。

相符事件只證明 caller 提供的合成 trace 與模型一致，**無法證明資料庫未執行未觀測 DML、trigger、外部 writer 或中間往返**。沒有事件捕獲完整性認證、可信 issuer、commit proof 或真 rollback。

## 3. Revision Receipt 與 Audit Receipt 分離

`SYNTHETIC_REVISION_OBSERVATION_V1` 固定 context、provenance 與 receipts（最多 384）。每 receipt 恰為 `format=SYNTHETIC_REVISION_RECEIPT_V1, receiptId, origin=SYNTHETIC_COUNTER_V1, context, writerOperation, domain, entity(resource,identity), beforeRevision, afterRevision, affectedRows=1, eventIds=[單一必要事件]`。context 精確綁 request/owner/transaction/domain/incarnation。Receipt 針對每 entity/domain；batch DELETE 可多列，拆為各 entity 的 receipt，與 batch event 的 affectedRows 不混用。

| Domain | Entity／格式／來源 |
| --- | --- |
| AE | model AuthorizationEpoch guard identity=1，非零 16 位 lowercase hex |
| Q／D | Query／Dataset 的 model revision，分開比對身份及事件，非零 16 位 hex |
| S | 保留的獨立 domain，非零 16 位 hex；C4 沒有 DataSource mutation/row，故本版**不會產生 S receipt**，任何額外／替換 S 均拒絕，不把 D 冒充 S |
| TOKEN_VERSION | AppUser，canonical positive SQL BIGINT 十進位字串；>2^53 仍精確 |
| DASHBOARD_BINDING／DASHBOARD_APPROVAL | source.bindingRevision／Dashboard.revision，非零 16 位 hex；後者是模型 evidence revision，不簽發真 approval |
| MODEL_GENERATION／MODEL_ROW | model Generation identity=1／其他模型 row revision，非零 16 位 hex，不冒充 Q/D/S |

UPDATE before/after 須嚴格遞增並完全等於已宣告模型效果；INSERT before=null、DELETE after=null，只代表模型列建立／移除，兩者同 null 拒絕。rewrite 的同一 tuple 可有 DELETE receipt 與 INSERT receipt，分別關聯不同 event，不得合併成單個 UPDATE receipt。漏／多、重排、錯 domain/entity/operation/context/count/link、Number、前導零、回退/ABA/溢位／格式錯誤都拒絕。輸入假稱 DB_GENERATED 亦拒絕。

模型沿用 C4 的 counter +1／初始 1，**絕不推論 SQL Server ROWVERSION 會 +1**。未來 DB 版本須由同受控 owner 下可信精確 SQL Reader/Writer 取得，另建證據契約；本版不能拿 SQL RV 來當 counter 預測。所有 receipt 都只是 caller 合成關聯一致性。

AuditIntent 是 request 命名空間內 ordinal=1 的**模型意圖事件**，不是 AuditLog INSERT；沒有 AuditLogId、durable proof 或 B3-B2 receipt。不得拿它代替 [精確 Audit Receipt/Decision 契約](sqlserver-native-type-decision-audit-contract-2b3c1d-b3b2.md)、必要持久稽核／稽核保存。真 AuditLog 寫入、archive/retention reader、Decision 與 audit 原子性仍 BLOCKED。

## 4. 資源、安全、驗證與下一步

輸入先檢查 own data descriptors；Proxy/accessor/toJSON/symbol/hidden fields/自訂 prototype、稀疏或額外屬性陣列拒絕，不執行 hooks。複製深度 18／100000 values、物件 24 欄、array 768、字串 128 units；C4 原預算仍生效。所有錯誤只含固定 code，沒有 Zod issues、原例外、SQL、參數值、憑證或患者資訊回聲；輸出深度凍結。Commit unknown／rollback failure 永不成功，不推定 rollback。

測試包含六類的 13 個獨立 golden operation cases，另驗 inventory/column/count/order、重複/偽裝/net-zero DML、空/多列 DELETE、Audit intent、全部必要 domain、跨 owner/tx、BIGINT ID/token、revision 回退/ABA/溢位、DB-generated 冒稱、commit unknown/rollback failure、unsafe hooks/去敏錯誤；不重做 C4 scope/ACL 全矩陣。C5 65/65、含 C4/B3-B2 的針對性 251/251、Server 全量 1438/1438 通過，typecheck/build 通過；載入離線 guard 阻擋外部/DB 連線，僅允許原有 loopback Mock。CI 見提交回報。

**C5 後停止擴充純合成模型。下一步僅 CONDITIONAL：優先準備另行授權的隔離 SQL Server 驗收環境／檢查規格；本次不建環境、不連線。** 門檻至少包括：

- 隔離合成 DB、專用最小權限帳號、版本/driver/TLS 身份、外連封鎖、無患者/正式資料、可重建且有故障回復策略；先驗 exact Catalog/index/collation/FK/trigger/cascade，列正式完整 write/column inventory，未涵蓋就拒絕。
- C3/C1 的雙連線 barrier、ROW/空 RANGE/Identity reservation、實際執行 plan、optimizer/FK/lock escalation/1205/1222；不可用本版 model table、排序、G 或 digest 代替 SQL 證據。
- 可信事件觀測的完整性與交易歸屬、實際 SQL OUTPUT/Reader 精確 BIGINT/RV（含 >2^53）、AE/Q/D/S/Token 原子性與全 Writer 覆蓋；真 DML/trigger 額外 effects、ABA/restore incarnation、混合舊 Worker/DBA 旁路。
- 真 rollback、斷線與 commit unknown 的持久查核；Audit/Decision 精確 Reader/保存/同交易寫入；原 ACL/遮蔽/患者/Dashboard guards 回歸。Source identity/generation/lease/DDL fence 依然 BLOCKED。

未具備上述證據，正式 Repository、Native Type 確認、Runtime 與交付一律 **BLOCKED**；本次沒有解除任何限制。
