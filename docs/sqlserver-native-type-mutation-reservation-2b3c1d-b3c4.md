# Δ／Expected Post-State／Union Reservation V2（2B-3C-1D-B3-C4）

基準 `20f5de7040162af3ff24d962ce4712bee69c5df6`；開工 PR #66 為 Draft、未 Merge，CI #880 成功。只新增 [V2 純模型](../server/src/modules/dataset/nativeTypeMutationReservationV2.ts)、[合成測試](../server/src/modules/dataset/nativeTypeMutationReservationV2.test.ts) 與本文件；[C2](../server/src/modules/dataset/nativeTypeAcquisitionPrototype.ts) 完全不動。依據 [C3](sqlserver-native-type-mutation-reservation-design-2b3c1d-b3c3.md)、[C1](sqlserver-native-type-common-acquisition-design-2b3c1d-b3c1.md)、[B3-B3](sqlserver-native-type-writer-lock-contract-2b3c1d-b3b3.md)。沒有 DB、DDL、SQL adapter、正式 Writer／Runtime 接線或 evidence issuer。

**判定：有限合成模型可為 MODEL_CONSISTENT；正式安全仍 BLOCKED。** 不存在可產生 `PRODUCTION_SAFETY_PROVEN` 的分支。成功／拒絕均固定 `authority=NONE, runtimeBindVerified=false, deliveryAllowed=false, persistence=NOT_PROVEN, productionSafetyProven=false`。

## 1. 固定流程與輸入邊界

`C → validated Δ → E=derive(C,Δ) → U=union(C,E,reservations) → independent synthetic P → final validation`。

- Request 固定 `scope=SYNTHETIC_TEST_ONLY`、`format=MUTATION_REQUEST_V2`，含 request/context、C 及 Δ；Δ 僅允許列舉 operation、必要 target/desired fields、expected generation/AE/target revision。caller 的 E、U、complete、未知欄位／operation 一律拒絕。
- C/P 是有限圖，包含 Dataset、Query、Parameter、AppUser、Role、Permission、UserRole、RolePermission、RoleACL、UserACL、Dashboard、ManagedSource 12 類；另有明示 retained user references。全部正向 FK 必可解析，反向 predicate 由固定表推導；重複 row/composite/natural key、lookup cycle、未知資源拒絕。
- ID/TokenVersion 為 canonical positive SQL BIGINT 十進位字串；以 BigInt 比較／排序，不經 Number。版本是非零 16 位小寫 hex；domain/incarnation/request/owner/transaction/gate 為小寫 UUID。名稱只容許合成 `SYN_[A-Z0-9_]{1,24}`；不宣稱等價於 SQL collation。
- 最多 96 nodes、32 retained references、768 reservations；lookup 深度 12／走訪 2048，輸入複製另限深度 16／80000 values。讀 descriptor 並先拒絕 Proxy、accessor、symbol、非普通 prototype、稀疏／額外屬性陣列；不呼叫 getter、toJSON。錯誤只輸出固定 code，不回顯輸入；輸出凍結。模型無 SQL／參數值／憑證／患者欄位，不提供日誌。

## 2. 六類受限 Δ／E／副作用

下表是本版**明示合成規則**，不是對正式 Repository 的語意等價證明。每次成功 Δ 推進 model generation；同一內容 A→B→A 仍須新版本。`revision +1`／新 row 初始 1 都是模型分配規則，絕非預測 SQL ROWVERSION、Identity 或正式 AE/Q。未列分支保持拒絕，不能套用成通用 executor。

| 類別／固定 operation | E 的唯一允許差異 | 版本及限制 |
| --- | --- | --- |
| Query Dataset A→B：QUERY_REBIND | 指定 Query 換 Dataset、unpublish／清 publisher；引用此 Query 的 source effective Dataset 投影隨之更新，historical Dataset 保留 | Query revision（模型 Q）及 AE 推進；Dataset 版本不變。舊新 Dataset、lookup、受影響 Query/Source/Dashboard/ACL 都在 U；approval binding-change、archived/no-op 拒絕 |
| Parameter：ADD／DELETE／LOOKUP | 新增 symbolic Parameter、只刪指定列或只改 lookup；owner Dataset revision（D）推進，直接綁 owner 的 published Query unpublish／Q 推進 | 新增 parent/name reservation；舊 lookup/被刪 row 保留 U；無全域 AE。active/archive、lookup cycle、重名／no-op 拒絕。參數完整語意欄位、間接業務 effects 尚未建模，不能取代正式 save/sync |
| 新增 User／Role：CREATE_USER／CREATE_ROLE | 一個新 symbolic entity，及列出的 UserRole 或 RolePermission tuples | AE 推進；新 User token=1，Role 非 systemAdmin；新 membership/grant 列初始模型版本。固定自然鍵、parent、FK/count 約束；不產生真 Identity |
| UserRole／RolePermission：grant/revoke | 只增刪指定 tuple；UserRole 更新 target User token/revision；RolePermission 更新 Role 與全體現有 members 的 token/revision | AE 推進；last-admin、inactive Role、no-op 拒絕。actor 自改 membership、actor 所在 Role／systemAdmin Role 權限改動保守 BLOCKED，保留 final auth |
| ACL_REPLACE／DELETE_USER | Query 的完整 ACL 集合換成 desired tuples，保留 tuple 亦取得新模型 revision；引用 Query 的 Dashboard evidence revision 推進。deleteUser 僅允許無其他 references 的 User＋UserRole＋UserACL 刪除，並推進受影響 Dashboard revision | AE 推進；Query Q 不因 ACL 一律變動。重複 principal 拒絕。任何 Audit/Decision/Version/Favorite/其他保留 FK、publisher、Dashboard creator 引用均 BLOCKED；不推測 SET NULL/cascade，不宣稱一般 deleteUser 已完整 |
| Managed Source 換 Query：SOURCE_REBIND | 只改指定 source Query、effective Dataset、source/binding revision 及 parent Dashboard revision | 無 AE/Q/D/S 推進；只支援 inactive LEGACY mode、已 MANAGED 的 parent。QUERY_ONLY／LEGACY_ONLY writer 不支援；approval、in-use、pending conversion mismatch、Query 未發佈／不可用、Dataset 不可用、ACL 不足均拒絕 |

授權只在此圖內檢查 active actor＋精確 token＋active Role 的 MODEL_ADMIN grant；Source 再需 MODEL_DESIGN、primary/desired/全部剩餘 bound sources 的 view/execute access。C、E、P 都重驗，不因 Δ 合法而跳過授權。這不是正式 RBAC/ACL/遮蔽、患者、approval、layout 等 policy 的完整實作。

## 3. U 與 symbolic identity

U 採**整個有限合成圖**的 C/E union（保守寬範圍），不是 caller 宣稱的 closure：所有舊新 ROW、composite tuples、natural keys、每種 entity 的 CATALOG RANGE，以及每個 old/new parent 的各 incoming-FK BY_PARENT RANGE，包含空集合。刪最後一列也保留舊 ROW/RANGE；未變的 actor、授權及其他 row 同樣在 U。AE guard 最先，後按固定 resource 順序及精確 ID/key 排序去重；acquired inventory 必須逐項及順序相同。未知 predicate、漏空範圍、晚補／重排均拒絕。

新 Parameter/User/Role 只容許一個 `$NEW` slot，固定 entity、natural/composite key、parent（無 parent 明示 null）、新增 entity count=1 及完整允許 FK inventory；UserRole/RolePermission 新 tuples 亦由 E 精確列出。U 在該 entity ROW 前另含 `ENTITY_SPACE/ALL_IDENTITIES`，並含新自然鍵 gap、symbolic ROW、後續 FK/composite predicates。這只是模型宣告，**沒有建立真 key-space reservation**。

獨立 `SYNTHETIC_ALLOCATION_OBSERVATION` 必須提供同 context、完整原 slot metadata 及精確字串 ID；缺／重複 slot、數字 ID、同 entity 既有 ID 衝突、錯 parent/key/count、額外或少 FK 一律拒絕。不猜測 Identity，也不從 P 取得 ID 回填 E。可在模型 entity-space 內配置小於舊 ID 的新值；這不證明 reseed、restore、INSERT FIRST acquisition 或 SQL OUTPUT 安全，正式 Identity 路徑仍 BLOCKED。

## 4. Managed Source historical／effective Dataset

`storedHistoricalDatasetId` 與 `effectiveQueryDatasetId` 分開；後者必等於目前 Query.datasetId，pending query=null 時 effective 必 null。範例 source60：historical=20、Query31→Dataset21；換 Query32→Dataset22 後 historical **仍為20**、effective=22，U 保留 Dataset20/21/22 及各自反向 predicate。

依 [service patch](../server/src/modules/dashboard/dashboardQuerySources.service.ts#L171) 與 [repository UPDATE](../server/src/modules/dashboard/dashboardQuerySources.repository.ts#L119)：既有 source 換 Query 不覆寫 stored Dataset。pending conversion 僅在 stored=desired effective 時允許；已有 source approval／layout reference 拒絕換綁，mode/availability/access guards 不跳過。sourceKey/identity 不可改；P 偷改 historical 或新增 binding 一律 drift。實際 parameters、sensitivity、approval provenance、layout references、session/ACL locks 並未由布林合成欄位證明，正式 guards 完全不動。

## 5. 獨立 observation／CAS／Final

Final 不接受先前 planner preview 作權威，重新從 request.C+Δ 推導 E/U。`SYNTHETIC_POST_OBSERVATION` 的 before 須完整等於 C（含 identity/incarnation/所有版本），CAS generation/targetRevision 必相符且 affectedRows=1；allocation 與 observation context 皆須同 owner/tx/gate/actor/token。

順序 inventory 固定 `GATE → RESERVE_UNION → REVALIDATE_CURRENT → CAS → MUTATE → REVISIONS → FINAL_OBSERVE → COMMIT`。綁定 slots 後，只接受正規排序的 P **完整等於 E**；舊新 binding、scope 增減、未觸及 row、ACL、FK、授權／版本的任何未宣告 drift 皆拒絕。P 來自獨立 golden fixture；測試沒有拿 planner.E 當觀測資料。符號名稱、UUID、輸入 provenance、inventory 相符皆非 ownership/可信 collector 證據。

Commit unknown（P 全有／全無皆同）及 rollback failure 永不回成功，也不推定 rollback；無 DML、真正 Gate 或交易。仍無可驗證的 operation/column/affected-row 寫入歷程，無法偵測偽造相同版本的隱藏往返／中間額外 effects；相符 C/P 不證明未發生其他寫入。合成 AE/Q/D 只能驗證提供的模型版本不衝突，不能封住外部 Writer／真實 A→B→A。

## 6. 驗證與下一步

- C4 93 tests：13 個獨立 golden Δ/E/P（涵蓋六類及 add/delete/lookup/grant/revoke），union/空 RANGE、>2^53 排序及 ID、slot/FK、historical≠effective、所有 source guards、ABA/版本/CAS、額外 rows/side effects、未知欄位、getter/Proxy、commit unknown／rollback failure；成功亦檢查非交付限制。
- 針對性 C4＋C2／B3-B3 共 239/239、Server 全量 1373/1373 通過；typecheck/build 通過，CI 見本次提交回報。測試載入離線連線 guard；沒有連線 SQL Server/Oracle，沒有執行 SQL Server lock／rollback 驗收。

下一最小階段 **CONDITIONAL**：仍限隔離模型，補逐 operation 的 write/column/count inventory、獨立中間事件觀測與 revision receipts 契約，驗證 net-zero 額外寫入也拒絕；先明列未建模 policy/history/cascade 再決定是否支援，不能放寬 E/P 或 final auth。不要直接接正式 Writer。

正式功能 **BLOCKED**：Identity/key-space、自然鍵 collation；C3 reverse Predicate/Index/FK/Trigger/Cascade Catalog 與雙連線 key-range/1205/1222/commit-unknown 驗收；真 owned owner/G/isolation/完整 scope；精確 Reader/DB-generated revision receipts；AE writer 旁路及 Q 尚未建立；完整授權/患者/遮蔽/Dashboard policy；Decision/Audit 精確持久 Reader/保存/原子性；混合部署、外部 DBA/舊 Worker、restore incarnation；Source identity/generation/lease/DDL fence。G 只保護合作 Writer，不是外部寫入隔離。無任何 `PRODUCTION_SAFETY_PROVEN` 或正式交付資格。
