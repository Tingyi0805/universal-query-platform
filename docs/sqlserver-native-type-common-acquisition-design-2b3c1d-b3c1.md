# 共同 Acquisition／Transaction Owner 設計（2B-3C-1D-B3-C1）

基準 `1d4b33cdb43750e5a428da541648e73eff6b67b8`；開工 PR #66 為 Draft、未 Merge，CI #877 成功。依 [B3-A](sqlserver-native-type-b3a-feasibility-review.md)、[B3-B3 矩陣／鎖圖](sqlserver-native-type-writer-lock-contract-2b3c1d-b3b3.md) 與 [純模型](../server/src/modules/dataset/nativeTypeWriterLocks.ts) 的具名路徑作靜態設計；本次只新增此文件，沒有程式、Migration、DB 連線或實機測試。

**判定：共同協定僅 CONDITIONAL，正式 Writer／確認／Runtime 仍 BLOCKED。** 提案為所有參與者共同的 transaction-owned acquisition gate＋完整 scope prelock＋失效整筆 abort；不是已證明可部署的 deadlock-free 協定。現有 Writer 未遵循此協定，缺 Q、可信 ownership／scope／部署證據與 SQL Server 實機驗收；不能據此啟動正式改造。`authority=NONE, runtimeBindVerified=false, deliveryAllowed=false` 保持不變。

## 1. 唯一 owner 與 FIRST acquisition

建議未來 `runOwnedMutation(command, discoveryHint, work)` 自建平台 DB connection／SERIALIZABLE transaction，設定 XACT_ABORT ON、有限 lock timeout，負責唯一 commit／rollback。helpers 只接 owner 控制的 Request，禁止自行 begin/commit、另取 pool、獨立 audit 或接受外部 transaction；B2 type brand／UUID 相同不是 ownership 證明。實際 connection/transaction identity、isolation 與 session SET options 的驗證介面／權限**待驗證**。rollback 失敗不得宣稱已回滾；清理失敗的 connection 不可帶殘留交易／SET options 回 pool。

**G：平台 DB 範圍、固定名稱／principal 的單一 Exclusive acquisition gate**，候選 primitive 為 SQL Server transaction-owned application lock。須在任何受保護業務 row/range、AE、Dashboard 或歷史鎖之前取得；catalog／owner 檢查若也可能持鎖，須納入驗收。只接受經驗證的成功 return code 0/1，timeout/cancel/deadlock/未知結果全拒絕並由 owner 清理（application-lock deadlock 回碼不代表已替 caller rollback）；不採 session-owned、不提前 release、不在尾端補取得。此為設計，未建立 procedure／執行 SQL。

G 與 AE 分開：G 序列化**合作式** acquisition，不是 mutation epoch、授權、source DDL fence 或 durable evidence。所有相關 mutator、未來 Review owner、需要此保證的 Dashboard 管理／approval owner 都必須先 G；只讓新 Reader 取得 G 或只在 ACL 尾端 touch AE 皆無效。外部 DBA／舊 binary／trigger 不會自動遵守 applock；未知參與者不能假裝被 G 保護。既有非參與 Runtime／其他 reader 也可能持 S/range lock，仍須實機分析，**本階段不修改 Runtime**。此粗粒度方案以吞吐／等待代價換取較容易審查的協作邊界，不建議現在分片 gate 或持有它等待人工審查／外部來源 I/O。

候選首次取得順序（只取預先列出的 scope）：

`G → AE guard → Permission/catalog ranges → Role → RolePermission ranges → AppUser → UserRole ranges → Source → Dataset IDs → Parameter／Dataset policy artifacts → Query IDs／Query artifacts → Dashboard IDs → DashboardDataSource／layout ranges → Query ACL ranges → Review／Decision → mandatory Audit`。

AE guard 在可能需 AE 的 command class 一開始取得，僅實際授權異動才推進；不得先持 identity/ACL 再判斷要不要取得 AE。D/S writer 的必要授權基線可前置讀 AE，但不因參與 G 就 touch AE。所有既有正 BIGINT ID 由 SQL **直接投影精確十進位字串**，用 BigInt 數值排序／比較，禁止 Number mapper、String(Number)、locale 或字典序代替數值序；同類 IDs 去重後逐 scope 取得。排序只是邏輯要求，ORDER BY、逐筆 SQL 與 applock 均不能證明 optimizer/FK/trigger 的實體順序。

B3-B3 V1 只比較合成資源 ordinal／revision，不包含 G、完整真實 key-set、ownership 或 SQL range 證明；本文件不是該模型已通過的新實作。未來隔離原型需另定版本與 scope 編碼，不能把 V1 成功提升為本協定驗收或可信 evidence。

新 createUser/createRole 的 ID 尚不存在：在相應 entity stage 先保護 Username／Code 的 uniqueness predicate 與必要 membership 空範圍，再 INSERT、精確取得 ID；不猜 Identity、不把已失真值補成字串。新列專有性、索引／FK 影響及 reseed/restore 的排序前提待驗證；若新 ID 引出未保護的早期 scope，整筆 abort，不能晚補鎖或先 commit 半個 identity。

## 2. Discovery、scope 與 abort 規則

交易外 discovery 只產生**無權威 hint**，不是授權／已持鎖證據。取得 G 後先按 hint prelock，再在同 owner 重新取得**全部關聯與 predicate 結果**；結果、存在性、版本或完整 key 集合不符便 rollback，釋放所有鎖後才可重新 discovery／新交易。即使只多一個較大 ID，也不得就地擴充 scope；不可在已持 Dashboard 後補 Dataset。採有界重試與總時間上限，超限 fail-closed；重試需重讀身份/token/scope，不能重放舊批准。初始無 hint 的新增命令也必須有受保護的自然鍵／空範圍契約。

| scope | 必須識別並在 owner 內驗證的集合／範圍 |
| --- | --- |
| A：Query／Dataset／lookup | 目標 Query、舊／proposed Dataset、restore artifact 指定的 Dataset；目前與 proposed Parameter 的 LookupDatasetId，含會被 helper 遞迴／反向讀取的依賴。補上綁定這些 Dataset、透過 lookup 受間接 unpublish 影響的 Query，以及 snapshot 的 published-status 判定會讀的 Query。以 visited set 收斂並設資源上限，缺定義／動態未知依賴／超限拒絕，不以空參數推定契約已確認。包含 Source、Parameter 名稱／集合範圍、ReportColumn、Dataset/QueryVersion artifact 與 version-number allocation range、敏感／患者 policy/artifact 及其 FK；restore 原文不可經 Number snapshot mapper 充當精確 review 證據。 |
| B：身份／授權 | actor＋target AppUser、舊／proposed roles、相關 Permission、RolePermission(按 RoleId)、UserRole(按 UserId 及 RoleId) 的完整列／空範圍。會改 admin 適格性時包含 SYSTEM_ADMIN role、全部 active admin 候選 AppUser 與 membership/status predicates；SYSTEM_ADMIN 自動補 grants 須涵蓋完整 Permission catalog（含新 code 的空範圍）。session revoke/password/token writer 亦是參與者，不可漏掉。 |
| C：Dashboard／ACL | A/B 閉包加上相關 Query 的 parent/supplemental Dashboard bindings、所有 DashboardDataSource、layout/profile/widget 範圍、既有／proposed RoleQueryAccess/UserQueryAccess、其 Role/User FK，以及 query/user 刪除涉及的歷史／referencing 範圍。deleteUser 從 UserQueryAccess 反查 Query，Query delete 枚舉所有 cascade／NO ACTION references；不得只看直接呼叫 replaceQueryAccess 的路徑。 |

空集合必須有可證明的 predicate/range 保護，不能以「查無資料」略過；AE singleton 缺列一律拒絕。Predicate 的主／反向索引、參數型別、key 編碼、collation、lock mode、FK/cascade/trigger／escalation 與 catalog 完整性，均為未解實機前置條件。沒有合適索引／catalog 不相符時不退回較弱保證；是否允許更粗範圍鎖須另審，不能假設 G 代替所有 SQL range lock。

尤其 [getEffectiveQueryAccess](../server/src/modules/queryDefinition/queryDefinition.repository.ts#L383) 目前先讀全部 accessible queries 再 find，不是單 Query reader；session／ACL JOIN 也會讀額外身份與 Source/lookup。C scope 必須涵蓋實際廣域讀取，或後續另審限域且語意一致的 reader；未完成前不能聲稱只 prelock 一個 Query 就足夠。權限不足以完整列舉、hint 漏列／關聯 ABA、review scope 不明，均拒絕。

## 3. 具名 Writer：改造前／後與交易責任

表內 `O` 均指第 1 節同一 owned SERIALIZABLE owner（含 G、XACT_ABORT、同交易版本與必要 audit、最終重驗、整體 rollback）；不是將現有 tx 包成 brand。調整後流程都是**先 prelock 完整 scope，後執行原業務檢查／DML**；後續重讀先前已持的 scope 不算新增 FIRST lock。現有 SER 是程式明示 begin(SERIALIZABLE)；DEFAULT／AUTO 不採認為已驗證 isolation。所有 proposed scopes 的實體鎖行為均未證明，最後一欄列額外特定風險。

| Writer／現有 owner 與順序（可追溯程式） | 建議 O 內順序／scope | 必須重驗、CAS／版本責任 | 反向依賴／尚未證明 |
| --- | --- | --- | --- |
| [updateQueryDefinition](../server/src/modules/queryDefinition/queryDefinition.repository.ts#L98)：本函式 SER，Query U/H→Dataset→history→Query UPDATE | A+B：先舊／新／lookup Dataset，再 Query/history；鎖齊才保留現有變更判定／unpublish | current binding、Dataset active/archive、actor/權限；expected Q/D/S、換綁時 AE；實際綁定／可用性改變推 Q | 現在 Query→D 對 D→Query；UPDATE/FK/影響 Query 集合待驗證 |
| [restoreQueryVersion](../server/src/modules/version/version.repository.ts#L459)：本函式 SER，Query→history artifact→Dataset→ReportColumn | A+B：artifact hint 不是證據；prelock Dataset、Query/版本/ReportColumn ranges，再備份／restore | artifact 身份／內容版本、現在及目的 binding、archive、actor；跨 Dataset AE+Q，同綁定依實際執行契約／可用性推 Q；保留 inactive/unpublished | 舊 artifact 可能引出不同 D；不能在 Query 鎖後補 D；history retention/FK 未驗證 |
| [updateDataset](../server/src/modules/dataset/dataset.repository.ts#L87)：本函式 SER，D→sensitivity/patient/history→D UPDATE→Query unpublish | A+B：所有 Source/D/lookup、Parameter/policy、受影響 Query/history prelock→原敏感／患者檢查→DML | SQL/source、policy/患者狀態、published Query closure 與 expected D/Q/S；D，自動 unpublish 實際受影響各 Q；非 AE | D→Query 對 Query-first；snapshot reverse reads、policy/FK 實體鎖未知，原保護不得跳過 |
| [saveDatasetParameters](../server/src/modules/dataset/parameter.repository.ts#L137)：本函式 SER，D→Parameter→history→未排序 lookup D→Parameter→touch D→Query | A+B：先目前／proposed lookup D 精確升序，再 Parameter ranges、Query/history；全部驗證後 save | preview、完整名稱集合、lookups 非 archived、完整保存內容、expected D/Q/S；同交易 touch D、實際 unpublish 各 Q | 目前晚 lookup 可反向；DisplayOrder/Id ORDER BY 不保證鎖序，參數空集合亦需 range |
| [syncDatasetParameters](../server/src/modules/dataset/parameter.repository.ts#L78)：本函式 SER，D→Parameter→history/DML→touch D→Query | 同 A+B；新增／移除名稱與目前 lookup 亦在 scope，再執行原 preview/removal 檢查 | SQL/token/preview、removeNames、上限、expected D/Q；確有增刪才 D＋實際受影響 Q，no-op 不冒稱新 epoch | 目前 Parameter→Query 與 Q→D 反向；新增／移除名稱 gap 及 helper 讀集未驗證 |
| [restoreDatasetVersion](../server/src/modules/version/version.repository.ts#L313)：本函式 SER，D→artifact/policy→Source/lookup D→snapshot→D/Parameter→Query→audit | A+B：Source 與所有目前／snapshot lookup D 前置，再 Parameter/Query/artifact/policy；原 restore／mandatory audit 同 O | artifact、現在 SQL/source、敏感與患者 gate、lookup/archive、完整 closure、expected D/Q/S；D＋實際各 Q；audit 不可吞錯 | 現在 D→Source／額外 D；精確 audit/history reader 與 rollback 未證明 |
| [publishQueryDefinition](../server/src/modules/queryDefinition/queryDefinition.repository.ts#L180)：本函式 SER，多表 UPDATE→Q/D/lookup snapshots | A+B：Source、完整 D/lookup、Parameter、Query/history 先取得，再原 publish 與全部 snapshots | Query/D/Source active/archive、lookup、ACL、expected Q/D/S；發布可用性變動 Q，snapshot 本身不推 D/AE | joined UPDATE／DISTINCT lookup／版本 allocation 可能不同 physical order；不能因為有 snapshots 說已鎖齊 |
| [unpublish](../server/src/modules/queryDefinition/queryDefinition.repository.ts#L244)、[archive](../server/src/modules/queryDefinition/queryDefinition.repository.ts#L265)、[restoreQueryDefinition](../server/src/modules/queryDefinition/queryDefinition.repository.ts#L290)：AUTO Query UPDATE | A+B→Query prelock，O 內保留各 flags／archive 拒絕規則，必要 history | current flags/binding、expected Q、當前權限；實際可用性變動 Q，不無條件 AE；restore 仍 inactive/unpublished | AUTO 與外部 impact/read 不原子；另含 report-column、Dataset archive 等間接 Q writer，不可漏接 |
| [createUser](../server/src/modules/admin/admin.repository.ts#L130)：DEFAULT，AppUser INSERT→UserRole SELECT Role | B：Permission/Role/RolePermission→現有 AppUser/admin predicates＋Username gap→新 user INSERT→已保護 membership 範圍 | role active／可指派、actor、Username uniqueness、admin/scope 政策；新 token 初始化與 AE 同 O | 新 Identity／UserRole FK、role 輸入順序原無保證；新列 stage 規則見第 1 節 |
| [updateUser](../server/src/modules/admin/admin.repository.ts#L154)：SER，AppUser→Role/membership/last-admin→AppUser→UserRole | B（若帶 ACL 影響併 C）：Role/grants→所有候選 AppUser→membership，然後原 user/role DML | 原 role/active、全部 admin predicates、proposed role active、actor；securityChanged 才 token+AE，純 displayName 不 AE；CAS/token 精確 | 現 AppUser→Role 對 updateRole→AppUser；最後一位 admin 必須在同 O 的受保護集合計算 |
| [deleteUser](../server/src/modules/admin/admin.repository.ts#L351)：SER，AppUser→admin/history Query→User ACL DELETE→UserRole→AppUser | B+C：身份／membership prelock→相關 D/Query→全部 Dashboard/source→ACL，才刪除及 evidence 更新 | last-admin、actor/target/token、ACL closure、online/retained history 與 FK；AE＋必要 Dashboard evidence 同 O；有歷史按既有規則拒絕 | 明確 ACL 旁路；不可只改 helper。archive/Decision 歷史 Reader 未備，不能把線上 audit=0 當可刪證明 |
| [createRole](../server/src/modules/admin/admin.repository.ts#L235)：DEFAULT，Role INSERT→Permission/grants | B：Permission/catalog 與 Code gap 前置→新 Role→RolePermission ranges | permission 存在／可授權、Code uniqueness、SYSTEM_ADMIN 保護及 actor；role/grant 建立 AE 同 O | 新 role identity／FK 與 Permission 新增並行仍待驗證；不把自動 grant 當明確 reviewer scope |
| [updateRole](../server/src/modules/admin/admin.repository.ts#L257)：DEFAULT，Role→RolePermission→securityChanged 時成員 AppUser token UPDATE | B：完整 Permission→Role→grants→所有成員/admin AppUser→雙向 membership ranges，再原 grants/token DML | 原 role active/system、permission catalog、完整成員／admin 集合；securityChanged 原子 token+AE；SYSTEM_ADMIN 不可停用、完整 grants 重驗 | 現 Role→AppUser 對 updateUser；空 grant／新 member phantom、批次 token UPDATE 的實體鎖序待驗證 |
| [replaceQueryAccess](../server/src/modules/queryDefinition/queryAccess.repository.ts#L61)：DEFAULT，Query 檢查→Dashboard evidence→ACL DELETE/INSERT | B+C：Role/User FK→D/Query→所有 Dashboard/source→ACL ranges；原 evidence 更新與替換同 O | Query 存在／binding、舊新 actor/ACL、Dashboard closure及 schema、expected AE/Q/D；ACL 實際異動 AE；保留 Dashboard→ACL | 不可尾端補 AE；無 Dashboard／空 ACL 也需範圍；advanceDashboardAccessEvidence 的多列 UPDATE 順序待驗證 |
| [deleteQueryDefinition](../server/src/modules/queryDefinition/queryDefinition.repository.ts#L255)：外部 impact＋AUTO DELETE／ACL cascade | A+B+C：舊 Dataset→Query/reference/history→Dashboard/source→全部 ACL；在同 O 再做 impact 與 DELETE | binding、全部引用/歷史、actor、expected AE/Q；有 NO ACTION reference 仍拒絕；真正 ACL/映射消失 AE、Query 身份失效 | cascade 在原 helper 外；FK/trigger 可能取得額外鎖；不能拆 FK、刪 Dashboard 或 cascade Decision 以通過 |
| [Legacy binding](../server/src/modules/dashboard/dashboardLegacyLocks.ts#L30)、[replaceDashboardDataSources](../server/src/modules/dashboard/dashboardDataSource.repository.ts#L42)：SER，D↑→Dashboard→parent Q→source range | B+C：D↑→Query（首次提前）→Dashboard→sources；再呼叫原 legacy guard／signature re-read，原 D/Dashboard 鎖可重讀 | seed/current/proposed bindings、mode/schema／enable guards、完整 source keys及政策；binding-change abort 不變；保留既有 approval revisions | prelock 不能授權 seed；新 binding scope 未預識別必須 abort；模式互斥不代表跨 Dashboard 共用 Query 無衝突 |
| [Dashboard approval](../server/src/modules/dashboard/dashboardApproval.repository.ts#L22)：SER/XACT_ABORT，legacy locks→LOCK_TIMEOUT 0→晚 session/ACL/policy→update/audit | B+C：actor/grants/AppUser/token、D/policy、Q、Dashboard/source、ACL 全部先取得；原 read/guard 再執行 | 原 DESIGN_QUERY、canView/canExecute、token、binding/policy/approval versions 與 evidence；原 CAS/update/audit 同 O | 晚讀只可重讀已涵蓋 scope；保留 LOCK_TIMEOUT 0 的失效 abort 行為，未知 helper scope 不藉放寬 timeout 通過 |
| [managed source store](../server/src/modules/dashboard/dashboardQuerySources.repository.ts#L50)：SER，Dashboard→sources/layout→Query/session/ACL/D；未明設 XACT_ABORT | B+C：新 outer 先 actor、所有 D/lookup→Q，再原 readState 的 Dashboard/source/layout→ACL，所有 service 分支共用 O | current/proposed mode、bindings、parameters/limits、Query availability/ACL/政策與 existing guard；各既有 source/mode/approval revisions 同 O，不自動 AE | 舊 readState-first API 需未來重構，不能內外兩個 tx 或取消 guard；廣域 ACL helper、layout/FK 範圍未知 |

上述任一 helper 若在 revalidation 才發現新的 key／不可列舉 JOIN 範圍，皆按第 2 節 abort，不能讓目前 caller-controlled scope 或 B3-B3 合成 order 當正式白名單。所有 conditional branch（no-op、no rows、缺 actor、historical restore、SYSTEM_ADMIN）都要有完整 scope 或明確拒絕。

## 4. 版本、未消除循環與部署阻擋

| 責任 | 必須同 O 執行／不代表的事 |
| --- | --- |
| AE | ACL/RBAC、review scope／適格身份及 Query↔Dataset 授權映射實際異動；含 deleteUser、Query ACL cascade、Permission seed/管理旁路。不同實際 mutation 往返仍新 revision；純顯示欄位不任意推進。先 guard 後資料，禁止尾端追加；目前無正式 AE writer。 |
| Q | 每 Query 綁定／可用性／相關使用契約的 revision；包含 restore、publish/unpublish、archive/restore、Dataset/Parameter/report-column 間接 unpublish 的實際受影響 Query。各 Q 精確 CAS、各自推進；目前無 Q schema，UpdatedAtUtc／history number 不能替代。 |
| D／S | Dataset SQL/source/完整 Parameter 存檔/restore 用 D；Parameter 自己 DML 必須同 O touch parent D。Source 設定/active/credentials/TLS 用 S。直接 child DML 不能假設有 D；Q snapshot 不自動推 D；平台 S 不代表外部 source generation。 |
| Token／artifact／Decision | TokenVersion 保留原撤銷規則；audit/Decision/精確 Reader 與 history retention 另有 [B3-B2](sqlserver-native-type-decision-audit-contract-2b3c1d-b3b2.md) 要求。Native sidecar 狀態字串、digest、G 或精確 receipt 都不等於持久化／正式 VERIFIED。 |

撤銷不能改成非同步 token/AE 補寫、略過 last-admin／scope，或在 G 等待／timeout 後回「已撤銷」。失敗／commit unknown 仍須拒絕成功；若要求 DB 故障時緊急撤銷，需另有持久 deny-hold／功能停用協定，目前尚無可驗證保證。Query 刪除後的 Q/身份 tombstone 與不可重用規格也待定，不能以 row 消失假定舊確認永不復活。

現存 `Query→Dataset→Query`、`AppUser→Role→RolePermission→AppUser`、`Dashboard/source→identity/Query/Dataset` 反向依賴仍在。提案把有關 FIRST accesses 前置，G 讓**完整參與集合中的** mutator 不彼此交錯；只是一個可檢驗的消環假說。未納入的 reader、FK/trigger/range/escalation、非受控 DML 仍可形成等待循環；`AE-first Reader→ACL` 對 `ACL→tail AE` 尤其禁止。不能由固定順序、單次成功或合成 DAG 推論無 deadlock。

正式功能維持停用的最小改造／部署順序（均未執行）：

1. 先補**設計與驗收前置**：完整 Writer/reader/trigger/SQL Agent/DBA 清單、exact index/FK/catalog／權限、精確 IDs／snapshot readers、Q/AE/scopes／incarnation 的 schema 契約與阻擋模式；任何不完整維持停用。
2. 收斂唯一 owner/G 與 scope acquisition／abort 的隔離原型，再同批設計 Query/Dataset/Parameter/restore/publish、User/Role/token、ACL/deleteUser/Query cascade、Legacy/managed/approval 的參與協定。不可先開 AE Reader，再逐條在舊 Writer 尾端補 AE。患者／敏感／ReportColumn/版本清理/Source/Session 與其他 helper 的相關路徑也必須查核。
3. 未來另經授權的實作／migration 必須在正式確認與 typed delivery **保持關閉**下完成；部署期間停止受影響管理寫入或採已驗收的相容寫入協定，排空舊 workers/jobs/連線，禁止混合版本／舊腳本使用受保護 DML。G 不會強制 DBA 合作，必須有受限寫入與變更協定，未證明就不開啟。只看到新 binary 或 schema 存在不算 writer 覆蓋。
4. rollback 先停用／排空並確認無待決 unknown commit，不允許舊 writer 繼續產生可用確認；保留 Decision/Audit/版本歷史與 921 UNCONFIRMED 限制，不 drop/cascade 新證據物件。必要時保持管理寫入停用，直到恢復一致的 owner 協定；不靠還原舊 epoch 值復活確認。平台 backup/restore/failover 必須取得不可隨備份倒退的外部 incarnation 並使舊 review 失效，此證據機制尚無實作。

Source identity/generation/lease/DDL fence 仍 **BLOCKED**；平台 G／SERIALIZABLE／TTL/hash 不能替代。Decision/Audit 真正持久性、精確 DB Reader、mandatory audit 與 commit unknown 查核亦未完成，無正式交付資格。

## 5. 真實 SQL Server 驗收矩陣（僅規格，未執行）

僅合成 schema／帳號／資料；測試人員須在另行授權的隔離 SQL Server 環境，以兩個以上獨立 connection、可控 barriers／故障注入，保存去敏的版本/操作順序、transaction/isolation/lock/deadlock 診斷。不得記錄 SQL 原文、參數值、憑證或患者資料。每項須驗證 DB 最終狀態與相關 audit/versions，不能只看 HTTP 或 Mock result。

| 情境／注入 | 預期結果與通過條件 |
| --- | --- |
| Owner／G／isolation | 所有具名入口在業務 row/range 前取得同 DB/principal/name 的 transaction-owned G；驗證真實 SERIALIZABLE/XACT_ABORT、同 connection/tx、helper 不另開 pool/commit；外部 tx／G 失敗／catalog 不符整筆拒絕，鎖與 SET options 不洩漏至 pool。 |
| Query/Dataset 同時 update／restore／publish | 控制 Q↔D／lookup 相反 discovery 時序；每個已提交版本對應一致 binding/snapshot/availability，另一方等待後全量重驗或整筆 abort；不得混合舊 D/新 Q，不得略過 sensitive/patient gate；history/indirect unpublish 完整。 |
| Discovery 後改綁／新增 lookup／新增反向 Query | 分別在 G 前、prelock 後由受控／不受控 writer 注入；已知協作者不能繞過 G，scope/版本變動必 abort 並新交易重新 discovery；不得晚加 Dataset/Query 鎖或把舊 hint 當批准。 |
| User/Role 並行 grant/revoke／membership | updateUser/deleteUser 對 updateRole/createUser；Permission catalog／新 member phantom 均涵蓋。成功 mutation 必同時 AE/token 正確；撤銷後舊 session/reviewer 被拒，不可漏一名成員；同時移除最後兩位 admin 至少一方拒絕，SYSTEM_ADMIN 不可停用／偷換 scope。 |
| ACL replace／deleteUser／Query cascade | barrier 放在 discovery/evidence/DML；提交的 ACL、AE、必要 Dashboard evidence 全有或全無，cascade/旁路不漏；有歷史／NO ACTION reference 時保留原拒絕；缺 archive/Decision reader 不得當作可刪證明。 |
| Approval／managed source／ACL 並行 | Legacy/managed 各模式及不同 Dashboard 共用 Query；binding/mode/ACL/token/policy 變動時等待後重驗或原 timeout/binding-change abort。保留 Dataset→Dashboard、Dashboard→ACL、LOCK_TIMEOUT 0 及全部 guards；無舊 ACL／批准復活。 |
| 多列／>2^53 IDs／空集合／range | 反轉輸入 Dataset/Query/Role IDs、多 lookup、空 ACL/member/source、無 Dashboard、新 Username/Code；IDs 精確不經 Number；插入 phantom 被必要範圍阻擋或使 mutation 整筆失效；檢查實際 index/lock modes/FK/trigger/escalation，不以 ORDER BY 或 G 代替證據。 |
| AE/Q/D/S 各別 A→B→A | 分別測授權、Query 換綁／可用性、SQL/Parameter、Source 設定；內容恢復仍新相關 revision，舊 CAS/review 失效；不相關版本不亂推、no-op 規則明確。restore/reseed/incarnation 不明時拒絕。 |
| CAS／雙 Writer／request collision | stale expected 任一 revision 或 affectedRows≠1 不得部分提交；同 RequestId 不同 mutation 拒絕；如未來允許相同鍵重取，須查持久紀錄且重驗當前授權/撤銷，不重新批准。 |
| Deadlock 1205／Lock Timeout 1222／G negative code | 在 gate、prelock、晚期 helper 分別注入；owner 整筆拒絕、清理/rollback，沒有成功或 delivery；有界重試必用新 tx/新 scope/新授權，不重用 failed tx。實際 deadlock 診斷可解釋且不洩漏敏感 payload，不能把偶發成功當無死鎖證明。 |
| mutation/epoch/Q/D/S/audit/decision 各點失敗 | 在每一點及 rollback 時斷線；確認持久狀態全有或全無、mandatory audit 不可被 tryWrite 吞錯；rollback 不明時標記未知並封閉後續使用，無 durable proof。 |
| Commit acknowledgement 遺失 | 同時覆蓋整筆已 commit 與未 commit：都不回成功／可信確認；由未來持久 RequestId/Decision/Audit 精確 Reader 查核並重驗，不能先假設 rollback 或盲重播。此恢復介面未實作前阻擋正式寫入。 |
| 混合 binary／舊 script／直接 SQL／DBA／restore | 嘗試繞過 G/epoch、直接 Parameter/ACL DML、舊 worker 更新；必被權限/部署協定拒絕或維持整體功能停用，不能靜默成功沿用 review；platform incarnation 改變使全部舊證據失效。 |
| 安全回歸／Source 邊界 | 執行原 ACL/masking/patient audit/Dashboard legacy-mode、partial-schema、binding-change、mode/approval guards 回歸；所有拒絕條件保留。source generation/lease 缺失仍拒絕 native delivery；平台交易成功亦不建立跨 DB 穩定性／VERIFIED。 |

**下一階段：CONDITIONAL 只做 owner/G 與完整 scope 的隔離原型／驗收準備，須另行授權且不接正式 Writer。** 在完整參與／精確 reader/Q/AE/incarnation／保存政策及實機鎖與故障證據建立前，安全共同 acquisition 尚未證明，正式實作判定維持 **BLOCKED**。本文件與既有 Mock／CI 不提供 SQL rollback、deadlock-free、持久性或正式確認證明。
