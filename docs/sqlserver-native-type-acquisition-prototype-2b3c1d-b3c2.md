# Owner／Gate／Scope 隔離原型（2B-3C-1D-B3-C2）

基準 `a9c0fccf7b1aae58339ca9389fa709acf49d369a`；開工 PR #66 為 Draft、未 Merge，CI #878 成功。只新增 [純函式](../server/src/modules/dataset/nativeTypeAcquisitionPrototype.ts)、[test-local Mock／測試](../server/src/modules/dataset/nativeTypeAcquisitionPrototype.test.ts) 與本文件；不更動 [B2 Ports](../server/src/modules/dataset/nativeTypeReview.ports.ts)、[B3-B3](sqlserver-native-type-writer-lock-contract-2b3c1d-b3b3.md) 或正式程式。[C1](sqlserver-native-type-common-acquisition-design-2b3c1d-b3c1.md) 的正式阻擋未解除。

## Owner／Gate：純事件重播，不開交易

`evaluateSyntheticAcquisition` 僅接受 `scope=SYNTHETIC_TEST_ONLY, format=ACQUISITION_TRACE_V1, domainId, events`。每次呼叫從空 ledger 重播有限事件，沒有共享 mutex／ticket issuer、SQL、adapter、I/O 或正式 transaction；一份 trace 只代表一個封閉的合成域。另一份 trace 或另一個程序不受它排他控制。所有結果 frozen，固定保留 `authority=NONE, runtimeBindVerified=false, deliveryAllowed=false, persistence=NOT_PROVEN`。

正常狀態為 `DISCOVERED→BEGUN→GATED→PRELOCKED→REVALIDATED→CAS_OK→MUTATED→REVISIONED→FINAL_OK→COMMITTED_PENDING_RELEASE→COMMITTED_MODEL`。唯一 Owner 控制 BEGIN/Gate/COMMIT/ROLLBACK/RELEASE；Helper 只能使用同 Owner/transaction/ticket 的 live context 執行受保護步驟，不得自行開始、提交、回滾、取得／釋放 Gate 或使用分離 transaction。交易 ID／ticket 不重用、不重入；同域最多一個 holder，另一 Writer 只能等待的合成 TIMEOUT／DENIED 或在釋放後成功，假造同時 ACQUIRED 拒絕。

Gate 必須先於整份 prelock plan；AE guard 是 plan 第一項，缺失／挪到尾端／亂序／漏 RANGE 均拒絕。Owner 失敗後為 ABORT_REQUIRED，只能 cleanup，不能補鎖、重 BEGIN 或原地 DISCOVER。模型成功 rollback 後需 release 才為 ROLLED_BACK_MODEL；同 RequestId 只能於此後以新 Owner/tx/ticket、相同 profile/roots/incarnation 重新 discovery，不能改成另一個 mutation。錯誤 reason 保留第一次失敗；trace 曾有任何 abort 即整體 success=false，個別 Owner 的模型完成狀態仍可觀察。

Gate ownership 遺失、早放／不明釋放、ROLLBACK_UNKNOWN、COMMIT_UNKNOWN 會 quarantine 合成域，不能讓後續 Writer 繼續。COMMIT_UNKNOWN 不允許用事後 rollback 或 release 改寫成成功／已回滾；commit 後 release 不明同樣保守失敗。這些只是模型狀態，不能證明實際鎖已釋放、SQL rollback、commit 或持久化。完全虛構但相符的 UUID／資料可通過一致性檢查，從不升級為權威。

## 三類 Scope：只相對於明示的有限資料集

`discoverSyntheticAcquisitionScope` 接受 ACQUISITION_GRAPH_V1：profile/roots，以及 graph 的 domainId/incarnation、graph revision、authorizationEpoch、恰三個支援的 writer profile、完整固定 predicateRevisions 與 nodes。沒有 complete=true 或 caller 指定邊；未知欄位、Writer、predicate、資源／格式皆拒絕。三種 profile **不是具名正式 Writer 的 adapter**，不採認部署實際 writer 覆蓋。

合成列只有 canonical positive SQL BIGINT 字串 id、非零 16 位 lowercase hex revision 與下表必要關聯／狀態；IDs 範圍 1–9223372036854775807，拒絕 Number、前導零及溢位，以 BigInt 比較。Domain/incarnation/Owner/transaction/ticket/request 是 lowercase UUID。未引入 SQL、參數值、患者欄位或憑證。

| Profile | 計算方式及 row/range 範圍 |
| --- | --- |
| QUERY_DATASET | roots 限 Query/Dataset。Query→Dataset；Dataset→全部綁定 Query、Parameter、反向 lookup Parameter；Parameter→owner Dataset／lookup Dataset，計算固定點以包含受間接影響 Query。每個 Dataset 都建立 DATASET_QUERIES／DATASET_PARAMETERS／LOOKUP_PARAMETERS RANGE，即使為空。 |
| USER_ROLE | roots 限 AppUser/Role/Permission。UserRole 的雙向 user/role membership、RolePermission 的 role/permission 反向關聯閉包；另從完整 Permission catalog、SYSTEM_ADMIN role 範圍與 active admin AppUser predicate 開始。涵蓋所有目前／新增成員與 grant；LAST_ADMIN 包含 active user＋active system-admin role 的成員集合（不是批准修改 last-admin 的業務規則）。 |
| DASHBOARD_ACL | roots 限 Query/Dashboard/AppUser/Role。聯集上述 Query/Dataset／身份閉包，再雙向追蹤 Dashboard↔Query、DashboardDataSource→Dashboard/Query/Dataset，Query/User/Role↔UserQueryAccess/RoleQueryAccess，涵蓋 deleteUser 等 ACL 旁路。補齊 Query→Dashboard/source/ACL、Dashboard→sources 與 user/role→ACL predicates；supplemental Dataset 必須匹配其 Query。 |

12 種固定 node：Permission、Role、RolePermission、AppUser、UserRole、Dataset、Parameter、Query、Dashboard、DashboardDataSource、RoleQueryAccess、UserQueryAccess。全資料集先檢查 FK、重複 identity／membership/grant/ACL tuple、單一 system-admin role 及一致 binding；不相連的壞資料也拒絕。Parameter 僅模擬 owner/lookup 關聯，不含真實已儲存參數契約，不能取代 B3-B1 digest 或 SnapshotReader。

17 個固定 RANGE predicates：DATASET_QUERIES、DATASET_PARAMETERS、LOOKUP_PARAMETERS、USER_MEMBERSHIPS、ROLE_MEMBERSHIPS、ROLE_PERMISSIONS、PERMISSION_ROLES、QUERY_DASHBOARDS、DASHBOARD_SOURCES、QUERY_SOURCES、QUERY_ROLE_ACL、ROLE_QUERY_ACL、QUERY_USER_ACL、USER_QUERY_ACL、SYSTEM_ADMIN_ROLES、PERMISSION_CATALOG、LAST_ADMIN。每項鎖範圍自動計算 key／ALL、member identities（空集合明示 []）及對應合成 predicate revision，不能用 ROW 代替 RANGE。

ROW 只輸出 resource/key/revision 及 strict canonical 投影 SHA-256，涵蓋關聯與 active/systemAdmin；不輸出原始 node。Hint 綁 profile、排序去重 roots、domain/incarnation、graph revision、完整 plan 與非交付旗標。ROW/RANGE 按 resource 類別、精確 numeric key（ALL 優先）、種類／predicate 序穩定排序；AE singleton guard 在前。Roots 去重；資料列重複與 ambiguous relationship 拒絕，不 silent dedup。Predicate revision 是 caller 提供的合成世代，**沒有真實 allocator 或可信來源**；與 member 集合一起比較，不能作授權證據。

限制：128 nodes、8 roots、lookup path 深度 12、lookup traversal／closure 各 4096 visits、256 prelocks、128 trace events；scope closure 的已知 reverse references 以 visited set 收斂，**directed lookup cycle 一律拒絕**。Whole-input descriptor snapshot 另限深度 18、100,000 nodes、array 256、object 24 欄、string 128 units。先拒絕 Proxy／accessor／symbol／hidden field／custom prototype／sparse 或附加屬性 array，不執行 getter/toJSON；cycle／超限失敗只回固定 reason，不輸出原始例外或 Zod issues。

## Discovery／Prelock／Revalidation

1. 交易外 DISCOVER 只建無權威 Hint；BEGIN 後先 Gate，再 PRELOCK 恰為該 Hint 自行計算的**完整** plan，不能少一個空 predicate。
2. 同 Owner 重新解析當前有限圖、重算閉包；比對完整 Hint（身份、roots、ROW integrity／revision、RANGE members／revision、graph epoch）。任何增加、減少、改綁、版本漂移、未知依賴即 abort，不能在舊 tx 補鎖。
3. CAS 必須 expected=observed=Owner 的 modelRevision、affectedRows=1；Mutation、Revision、final revalidation 都須 live Gate/context 且順序正確。modelRevision 必須嚴格增加，不經 Number。
4. 此處 Mutation 僅為 staged marker，**不修改關聯圖、AE、Q、D、S**；modelRevision 與 relationship graph revision 是兩個不同概念。FINAL_REVALIDATE 重新比對相同關聯快照及新 modelRevision。刻意改 binding／新增資料列的寫入、proposed scope reservations 尚未模擬，不可拿此模型接正式 Writer。
5. A→B→A 恢復內容仍因新 row/predicate/graph revision 而失效；如果 caller 連所有 revision 一起偽造回原值，純函式無法辨認，測試明示此限制。需要真實 mutation epochs／incarnation，不能以內容 digest 防 ABA。

## 測試與未證明範圍

test-local ExclusiveGate Mock 交錯兩個 Writer，失敗者 rollback、成功者只在模型 commit/release；staged-copy Mock 檢查 Mutation/Revision 失敗不發佈局部狀態，commit unknown 的 applied/not-applied 兩個 fixture 均拒絕成功。測試亦涵蓋改綁／lookup／grant／last-admin／ACL／Dashboard drift、空 RANGE、>2^53 排序、循環／資源上限、Helper／Owner 錯配、非法 Gate 順序／重入／遺失／release、CAS、rollback failure、unsafe hooks 與去敏序列化。

本地結果：新增 85 項；含 B3-B3/B2 的針對性測試 213/213、Server 全量 1280/1280、typecheck 與 build 通過。離線 guard 阻擋外部／DB TCP，僅允許既有 loopback Mock 測試；未連 SQL Server／Oracle。

這組測試只證明**輸入有限資料集＋trace** 的模型一致性，不證明真實 SQL 查詢的完整 read/write set、索引、FK/cascade、trigger、phantom/range/escalation、isolation／deadlock-free、Gate、rollback、持久化或跨程序排他。C1 所述 broad ACL helper、Source/policy/history/layout/Review/Decision/Audit 等真實範圍未被這 12 種 nodes 完整表達；未知 production Scope 仍 BLOCKED，不允許回退成有限投影後聲稱完整。

判定：GO 僅限這個合成原型；正式共同 acquisition／Native confirmation／Runtime 仍 **BLOCKED**。下一最小階段 CONDITIONAL 為補齊 proposed mutation/reservation、完整具名 Writer scope 清單／predicate/index 規格及相容 owner protocol 的隔離契約／驗收準備；不得自行建立 SQL adapter 或正式 Writer。真正 AE/Q、DB 外 incarnation、精確 Decision/Audit Reader／保存、部署旁路與 source identity/generation/lease/fence 均未解除。
