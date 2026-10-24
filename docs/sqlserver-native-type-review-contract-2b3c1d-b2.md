# Native Type Review 隔離契約（2B-3C-1D-B2）

基準：`814b271115ff535fb57f2e5819a0112025989ba1`；依據 [B1](sqlserver-native-type-confirmation-design-2b3c1d-b1.md)。
本階段只新增 [純驗證器／型別](../server/src/modules/dataset/nativeTypeReview.ts)、[ports](../server/src/modules/dataset/nativeTypeReview.ports.ts) 與 [合成測試](../server/src/modules/dataset/nativeTypeReview.test.ts)。沒有實際 Repository、SQL、DB transaction、collector、Migration、API／UI、發證或 Runtime 接線；920／921、舊 coercion、ACL、遮蔽、患者稽核、Dashboard 與 A2/A3 均不修改。

## Envelope 與格式

`ReviewEvidenceEnvelope` 與獨立 `ReviewObservations` 必須明示 `SYNTHETIC_TEST_ONLY`。這是排除真實使用的測試標記，**不是可信簽章**。`validateNativeTypeReview` 不讀時鐘、DB 或設定、不呼叫 provider、不寫入或變更輸入；時間由 observations 明確提供。

| 資料 | 規則 |
| --- | --- |
| DatasetId、DataSourceId、ReviewerId、TokenVersion | 正值 canonical SQL BIGINT 十進位字串，至 9223372036854775807；禁止 Number、bigint 值、前導零或溢位 |
| Definition／Configuration／State RV、AuthorizationEpoch、scope RV、Schema generation、lease version | 非零、16 位 lowercase hex 字串；不經 Number；Schema generation 在此只是合成 revision，未實作來源端 DDL epoch |
| BaseContractRowVersion | `{state:MISSING}` 或 `{state:PRESENT,rowVersion}`；明確 MISSING 只允許於此欄，需與 snapshot 的「不存在」一致，不能當作已確認契約 |
| Review／Source identity／lease ID | lowercase UUID；review state 只接受可比較的 PENDING／CONFIRMED；REJECTED／REVOKED／INVALIDATED 拒絕使用，UNKNOWN／STALE／MISSING／VERIFIED 及未知格式拒絕 |
| SQL 完整性 | `SQL_UTF8_EXACT_V1`＋64 位 lowercase SHA-256；預期為未正規化 SQL 的原始 UTF-8 bytes，tokenNames 由獨立 snapshot reader 提供；B2 不持有／解析實際 SQL |
| 參數定義完整性 | `SAVED_PARAMETER_SNAPSHOT_V1`＋SHA-256；未來 reader 必須涵蓋完整儲存定義（含 defaults、日期及 options／lookup 等），固定排序／編碼須在實作該 reader 前定案。B2 只比較獨立完整性證據及 name/dataType/controlType/dateOutputMode 投影，不宣稱已實作完整定義收集或 hashing |
| NativeTypes 完整性 | `NATIVE_TYPES_V1`；按名稱 ASCII 順序排序，JSON UTF-8 tuples `[name,type,length或null,precision或null,scale或null,kind,listLength或null]` 的 SHA-256。兩份 declarations 均重算，不只比較 caller digest |
| Native declaration | A2 型別集合與 length／precision／scale 範圍；SCALAR 或 FIXED_LIST 1–128；完整投影名稱唯一、Token／definition／declaration 集合一致、generic/date mode 相容；拒絕 generated-name collision、超長名稱或超過 2000 binds。STRING binary codec 尚不支援 |
| Reviewer／scope | 與獨立觀察的 identity／TokenVersion／scope RV 完全相同，scope 同 Dataset／Source；active、interactive、DESIGN_QUERY、review permission、scopeAllowed 都必須 true，且不是 manifest 作者 |
| 來源／lease | 獨立 provider 的 identity／generation 與 lease reference 一致；lease 必須為 SYNTHETIC_VALIDATED，identity／generation／ID／version 全匹配，且覆蓋 evidenceAt 至 expiresAt，於 now 未過期；未知或無法驗證的 lease 拒絕 |
| collector／codec／plan／driver | 僅支援四個明示的合成契約 profile：SYNTHETIC_COLLECTOR_V1、A3_ISOLATED_V1、A2_ISOLATED_V1、SYNTHETIC_MSSQL11_V1。不是實際部署版本或驅動驗收聲明；未知 profile 拒絕 |
| EvidenceAt／ExpiresAt／now／lease times | 嚴格有效的 `YYYY-MM-DDTHH:mm:ss.sssZ`，年份 0001–9999；evidenceAt ≤ now < expiresAt，lease 同樣採排他到期邊界 |

小型 length／scale／arity 是結構數量，可用受限整數；它們不是版本。所有物件 strict，拒絕未知欄位、accessor、symbol、自訂 prototype、sparse array、hook／cycle 與超過資源預算的圖形；先複製 data descriptors，避免 getter／toJSON 被呼叫。上限為深度 16、每次 snapshot 40,000 節點、array 2000、object 64 欄、字串 4096。

輸出為 frozen 固定欄位 `ISOLATED_REVIEW_CONSISTENCY`：consistent／固定 reason，以及永遠為 `authority=NONE`、`runtimeBindVerified=false`、`deliveryAllowed=false`。不回傳 envelope、SQL、原輸入、Zod issues／driver causes，不建立正式 VERIFIED 或 confirmation handle；結果也不能作為 A2/A3 輸入或 plan。

## 失效及可信邊界

Dataset／Source／BaseContract／Review 任一版本或身份不符、完整性不符、授權 epoch 改變、reviewer／scope 撤回、時間失效、來源／lease drift 或未知版本均 fail-closed。AuthorizationEpoch 是獨立 revision，64 位 ACL hash 不能代替；權限內容 A→B→A 恢復仍因 epoch 改變拒絕。空參數仍需要完整有效 observations。

matching version、digest、CONFIRMED 字串與相同 JSON **均不能證明來源可信**。完全偽造的 envelope 與 observations 若彼此相符，純函式無法分辨；成功只代表這些合成輸入一致。真正的 SQL／parameter snapshot reader、授權 epoch writer、reviewer scope、可信時間、source identity／generation／lease issuer 都未實作，正式交付繼續阻擋。前端不可提供被當作權威的 observations；未來任何接入須另行設計認證與版本重驗。Oracle 未開放。

## Ports、CAS 與強制稽核

- `ReviewSnapshotReader`：在同一 transaction token 內讀取 saved snapshot；`AuthorizationEpochProvider`：重讀 session／permission／scope 及 epoch，不能使用舊 ACL hash。
- `SourceEvidenceProvider`：取得外部觀察；刻意**不接受平台 transaction token**，避免暗示跨 DB 原子性。
- `ReviewDecisionRepository`：只定義 owned unit-of-work、CAS 與 appendDecision。未來實作須 SERIALIZABLE／XACT_ABORT、單一受控 transaction、expected ReviewId/state/revision、affectedRows 恰一、不可復活 terminal state，並以 requestId 綁定 actor／action／精確快照。
- `MandatoryAuditWriter`：必須在同 transaction 寫入、不吞錯；receipt 是 unknown，須用 `isExactReviewAuditReceipt` 驗證為僅含 `auditId` 的正值 SQL BIGINT **字串**。所有 Number（即使安全）、額外 self-assertion 欄位都拒絕；未修改既有回 Number 的 audit helper。
- 未來 read／authorize → CAS → append decision → mandatory audit → final snapshot／authorization／source revalidation → commit 必須作為整體；任一失敗回滾，沒有成功回應。ports 不開啟交易，不執行 SQL，也不提供正式決策 orchestration；型別 brand 不是 runtime 權威。

## Mock 能證明與不能證明

交易模型僅存在 `.test.ts`，只接受 fixture 中明確加入的合成 reviewer，以 queue／staged copies 模擬 PENDING→CONFIRMED。它檢查操作順序、exact receipt、CAS、兩個 stale reviewer、冪等鍵碰撞、audit／decision／commit 故障及最後權限／來源重驗；只有所有步驟通過才把 staged arrays 換成模型狀態。未知 actor 拒絕，重放不返回成功；尚未實作冪等成功重取、完整 REJECT／REVOKE／INVALIDATE 工作流或任何真實寫入。

Mock 成功的 CONFIRMED **只在測試記憶體內**，回傳仍不可 Runtime delivery。Mock rollback 只證明測試模型丟棄 staged copies；queue 不證明 SQL isolation／locks，receipt 不證明 durable audit，provider 標記不證明 lease／DDL fence，最後重驗不證明跨 DB 原子性或 commit-to-delivery 競態已封閉。

後續 B3 最小範圍仍須另行授權：先驗收 922 sidecar／稽核 schema、所有授權與參數 writer 的 epoch 覆蓋、reviewer scope，以及來源端 generation／lease 的可行性；再做限權 backend Repository／collector 與隔離 SQL Server 交易、ABA、rollback／locking 驗收。來源保證、可靠撤銷、descriptor／實際結果比對及 A3 未解語意仍是正式接線阻擋；不得由 B2 測試成功推導交付資格。
