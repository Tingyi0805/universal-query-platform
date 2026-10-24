# 精確 Audit Receipt／Decision 關聯（2B-3C-1D-B3-B2）

基準 `a6694d0134650dfd1a656a76ad972929c97f80fd`；開工 PR #66 為 Draft、未 Merge，CI #875 成功。僅新增 [純驗證器](../server/src/modules/dataset/nativeTypeDecisionAudit.ts) 與 [合成測試](../server/src/modules/dataset/nativeTypeDecisionAudit.test.ts)；[B2 Ports](../server/src/modules/dataset/nativeTypeReview.ports.ts)、正式 Audit Repository 與所有 Migration 保持原樣。[B3-A](sqlserver-native-type-b3a-feasibility-review.md) 安全阻擋未解除。

## 三層意義與固定投影

1. `validateSyntheticAuditReceipt` 只檢查格式：恰為 `{auditId: string}`，與 B2 `isExactReviewAuditReceipt` 相容。canonical positive SQL BIGINT 為 ASCII 十進位 1–9223372036854775807；所有 Number（含安全整數）、bigint 值、前導零、正負號、空白、指數、溢位、缺欄／多欄均拒絕。只以 BigInt 檢查字串範圍，不從 Number 修復。
2. `validateSyntheticDecisionAudit` 只比較 caller 提供的合成投影。完整輸入恰為 `scope=SYNTHETIC_TEST_ONLY, decision, audit, receipt, cas, requestHistory`；標記、matching digest 與 transaction correlation UUID 均不是 provenance 或權限證明。完全偽造但互相吻合的輸入可能通過。
3. **兩者均不能證明資料列存在、commit 或持久化。** frozen 輸出只含固定 kind、formatValid 或 consistent/reason，以及 `authority=NONE, runtimeBindVerified=false, deliveryAllowed=false, persistence=NOT_PROVEN`；沒有 evidence handle、輸入回聲、日誌、SQL、參數值、driver cause 或正式確認。

| 固定欄位 | V1 格式／規則 |
| --- | --- |
| Decision format | `SYNTHETIC_NATIVE_TYPE_DECISION_V1`；Audit format 為 `SYNTHETIC_NATIVE_TYPE_AUDIT_V1`，不接受其他版本 |
| decisionId／actorId／auditLogId | 同上精確正 BIGINT 字串；receipt.auditId 必須等於 decision.auditLogId |
| reviewId／requestId／transactionCorrelationReference | lowercase canonical UUID；correlation 僅供關聯，不是 SQL transaction token／durability receipt |
| action／reasonCode | CONFIRM/REVIEW_ACCEPTED、REJECT/REVIEW_REJECTED、REVOKE/AUTHORIZATION_REVOKED、INVALIDATE/EVIDENCE_INVALIDATED，嚴格成對；不收自由文字 |
| previousState／nextState | PENDING→CONFIRMED/REJECTED/INVALIDATED；CONFIRMED→REVOKED/INVALIDATED；terminal 無 outgoing edge；重新審查需新 ReviewId |
| previousStateRowVersion／nextStateRowVersion | 非零 16 位 lowercase hex，next 必須大於 previous；不經 Number。僅限同 DB incarnation 的合成排序，不證明 restore 安全 |
| snapshotIntegrity | 恰含 sql、parameterDefinition、nativeTypes，各為 `{format,digest}`；formats 為 SQL_UTF8_EXACT_V1、SAVED_PARAMETER_SNAPSHOT_V1、NATIVE_TYPES_V1；digest 為 64 位 lowercase hex。前兩者可取 [B3-B1](sqlserver-canonical-snapshot-digest-2b3c1d-b3b1.md) 的 integrity；不重算或採認來源，不包含原始 SQL／參數 |
| Audit record | 除上述全部關聯欄位外，eventType 固定 DATASET_NATIVE_TYPE_DECISION；eventStatus 僅 SUCCESS/FAILED/STARTED，只有 SUCCESS 能一致。成功記錄「拒絕決策」與 FAILED attempt 不同 |
| cas | 恰含 reviewId、前後 state／StateRowVersion、affectedRows=1，須完全匹配 Decision；不是 DB 執行證據 |
| requestHistory | 恰含 scope=COMPLETE_SYNTHETIC_LEDGER、decisions（最多 100）。此 completeness 標記僅供合成模型，不能認證真實歷史完整性 |
| audit observation | ONLINE/ARCHIVE＋完整 record；或 MISSING/PURGED＋auditLogId。後兩者一律 AUDIT_HISTORY_UNAVAILABLE，不憑 receipt 補出資料列 |

Decision 與 Audit 所有關聯欄位逐一相等，包括 IDs、actor/action/reason、前後狀態／版本、三種完整性與 correlation。ledger 禁止重複 RequestId／DecisionId／AuditLogId；同 RequestId 同完整紀錄也拒絕為 REQUEST_REPLAY，不提供成功重放；不同內容為 REQUEST_COLLISION。每 Review 依 RV 排序後必須從 PENDING 連續銜接、snapshot 不變，當前 CAS 必須接在最後決策之後；不能跳過撤銷而復活舊 PENDING。新 Review 或首次決策不可自稱已有 CONFIRMED 歷史。真實冪等重取仍須另設計當前授權／撤銷重驗。

所有物件 strict，拒絕未知欄位／型別／狀態、accessor、Proxy、symbol、hidden field、自訂 prototype、cycle、sparse／附加屬性 array。先複製 own data descriptors，不執行 getter/toJSON；深度 12、節點 10,000、object 24 欄、array 100、字串 128 units 為隔離資源限制。只輸出固定 reason，絕不回傳 Zod issues／原始例外。

## SQL／Repository 的未來邊界（僅設計，未實作）

新的限域 adapter 必須在受控平台交易內 INSERT/OUTPUT，直接由 SQL 將 INSERTED.Id 投影成 `varchar(20)` 的 auditId（例如 OUTPUT 的 CONVERT 表達式或 OUTPUT INTO 後同交易精確 SELECT）；檢查恰一列、字串型別及範圍。Driver 必須實機證明不先轉 Number；DecisionId、ActorId 等 BIGINT Reader 同理。不沿用回 Number 的 [writeAuditEvent](../server/src/modules/audit/audit.repository.ts#L35)，也不呼叫會吞錯的 tryWrite。**精確 OUTPUT 即使成功仍可能隨後 rollback，不是 durable proof。** 實際 SQL／trigger 相容性與 commit acknowledgement 不確定性待驗證。

最小未來 Port（非現有介面的替換）：`ExactAuditAppender.append(sanitizedEvent, ownedTx) → unknown receipt`；`DecisionEvidenceReader.readByRequestId(requestId, ownedTx) → exact retained projection | absent`；`AuditHistoryReader.readExact(auditId, ownedTx) → ONLINE | ARCHIVE | MISSING | AMBIGUOUS`。真實 Reader 還須回報未知／缺欄／重複雙位置／catalog 不相容並 fail-closed，不能複製 Decision 欄位冒充 Audit 觀察；本合成函式不提供 DB Reader 或位置唯一性證明。

未來 owned transaction 先驗證 schema／精確讀 snapshot、歷史與授權，再按已審定鎖順序 CAS、追加 Decision、強制 Audit 及精確 receipt 關聯；若 DecisionId 先分配而 AuditLogId 後取得，需在同交易完成不可對外可見的關聯，不能 commit 半筆。最後重讀版本、epoch、reviewer/session/scope、snapshot 與有效來源證據；任一步失敗整體拒絕。RequestId unique、鎖定歷史／review、affectedRows=1 與 append 限權須由未來 SQL 強制。commit 結果不明不能回成功，重試不得重新批准；需獨立持久化查核設計。外部 SourceEvidenceProvider 不屬平台 transaction，最後重驗也不證明跨 DB 原子性或租約覆蓋交付。

## 保存、封存與刪除

[006](../database/migrations/006_audit_log.sql) 的 AuditLog 為 BIGINT IDENTITY，對 user/query/dataset 有 FK；[016](../database/migrations/016_audit_retention.sql) Archive 保留相同 Id 與去正規化名稱，沒有這些 FK。[archiveOldAuditLogs](../server/src/modules/audit/audit.repository.ts#L296) 在 SERIALIZABLE 中複製再刪除線上非 STARTED 列；[cleanupAuditArchive](../server/src/modules/audit/audit.repository.ts#L344) 可清理 archive，importantPermanent=false 時也能刪重要事件。預設保留設定不是不可刪／永久保存承諾，既有事件亦可被 completeAudit 更新；未證明 append-only。

未來 Decision 必須獨立保存去敏的上述完整決策欄位、精確 AuditLogId、事件 type/status、schema 版本及必要 Dataset/Source 身份／版本上下文，不依賴顯示名稱或可變主資料。不得直接 FK 到線上 AuditLog 阻擋 archive DELETE，不用 cascade 清掉 Decision；採同交易邏輯關聯與可解析 online/archive 的生命週期 Reader。不得以 ParametersJson 的 20,000 字元截斷內容保存核心證據。**現有 Archive 沒有本契約專用完整欄位**，合成完整 ARCHIVE record 只是將來規格，不代表可從目前資料安全重建。

清理後 retained Decision 可保留可解釋的決策與 audit ID，但無法證明對應 Audit 列仍存在；若 Decision 亦被清除，證據鏈可能永久遺失。User/Dataset/Query 刪除的線上 audit 計數／FK 不足涵蓋 archive／未來 sidecar；保存期限、legal hold、actor tombstone、禁止 cascade、平台 restore incarnation、審計防竄改及受控刪除政策均待設計／驗證，不在本階段宣稱安全。歷史缺失、位置歧義或讀取不完整均拒絕當作確認證據。

## Mock 範圍、驗收與下一步

測試覆蓋 >2^53／BIGINT 上限、格式與未知欄位、全部關聯欄位、CAS、狀態、RequestId 碰撞／重放、歷史鏈、封存缺欄／清理、固定去敏輸出與不執行 unsafe hooks。test-only staged-copy 模型檢查 read→CAS→decision→audit→receipt→final revalidation→commit 順序；decision/audit/final/commit 失敗只丟棄記憶體 copies，雙 stale reviewer 至多一次模型成功。**不證明 SQL rollback、鎖定、跨 DB 原子性、真正持久化或正式交付。**

本地驗證：新增 93 項；含 B2／B3-B1 的針對性測試 198/198、Server 全量 1134/1134、typecheck 與 build 通過。測試以離線 guard 阻擋外部及 DB TCP，只允許既有測試的 loopback Mock；未連線真實 DB。

真實 SQL Server 驗收仍需：精確 INSERT/OUTPUT/Reader 與 >2^53；constraint/CAS 並行與冪等衝突；audit/decision/commit 故障與 commit 結果不明；實際 rollback／deadlock；封存競態／雙位置／清理／FK 刪除／restore；受限帳號 append／刪除策略。另有 writer/epoch 完整覆蓋、reviewer scope、來源 identity/generation/lease／DDL fence 及 driver/descriptor 一致性阻擋，均未解除。

B3-B3 最小建議為 **Writer／Lock Order 靜態盤點與隔離契約／Mock**：針對 B3-A 具名 writer 區分全域 AuthorizationEpoch 與局部 Dataset/Source/Parameter revisions，列出 Dashboard／ACL／身份現有鎖順序、旁路與 transaction owner，設計共同偏序及失敗注入。先解決缺口與鎖循環，再另行授權任何 migration／SQL adapter；不得由本次成功直接進入正式確認或 Runtime。
