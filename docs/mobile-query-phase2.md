# 第二階段：Query Publisher／行動多層查詢（獨立候選 PR）

基準：PR83 `fix/iis-https-kiosk-82`，HEAD `846483f6b1151eb12468d60369745fe77f0249b7`；沿用成功 CI1354
<https://github.com/Tingyi0805/universal-query-platform/actions/runs/42141491211>，不重建其 SQL／PIN／Windows 成功證據。
已比較 PR99 最新 `7e0c32af2b04b591bc311282358589f791c93916`：本功能使用的 QueryDelivery、Dataset policy、參數 compiler/coercion、PIN Service/Session/927 無必要差異；auth.middleware 增量是 CHART actor proof，未帶入。
沒有修改 PR83/99 分支、合併、部署、ZIP 或 C:\UQP；沒有連線使用者 DB。

## 實作及操作

- Query Publisher 選取**已發布** Query → 多層設定。有效 SYSTEM_ADMIN + 即時 PUBLISH_QUERY，且具各 Query 的 VIEW/EXECUTE ACL，才能保存。
- 逐節點選已發布 Query、TABLE／CARDS、每頁1–100筆、穩定排序鍵；逐關聯選父、子、既有參數映射、ROW／COLUMN／MORE、PAGE／PANEL／MODAL。
- 父鍵、觸發、搜尋和排序欄位必須出現在可見 Report 欄位，且 Dataset 確認政策明確為 NONE。CUSTOM/FULL/OMIT 不可拿來綁定或篩選，以免把遮蔽變成側通道。不新增自動敏感分類。
- 單一 ROW 預設、每個指定欄位一個 COLUMN 動作；多個額外動作用 MORE。最多32節點、64關聯、5層，拒絕循環／不連通／重複及超預算圖。
- QueryRuntime 仍保留原單層功能。完成配置後「開啟多層分頁查詢」以原主層表單值開始；各層有獨立 Report 欄位、版型、搜尋、排序與分頁。Back 由伺服器重新取父頁，不重播快取。
- 子層所有作用中 SQL 參數須完整映射，且型別一致；不新增參數。派生NUMBER鍵只接受safe integer；大整數須以既有STRING參數和精確字串來源映射，拒絕浮點／DECIMAL精度猜測。MULTISELECT 子層、遮蔽／隱藏鍵、需要低保證 PIN 存取患者資料均拒絕，不以功能需求放寬保護。

## 伺服器權威與 API

`/api/queries/:root/hierarchy` 只接受原完整 Bearer JWT。簽章、到期、停用、TokenVersion、VIEW_QUERY/EXECUTE_QUERY 及每層 Query ACL 重新驗證。
Dataset 交付政策／版本／患者稽核使用原 QueryDelivery.open；基準並無另一套 Dataset row ACL，Dataset 可見範圍仍由已授權 Query 綁定和交付政策決定，不自行發放 Dataset 權限。

| 路徑 | 方法／body | 用途 |
|---|---|---|
| /capabilities | GET | 根層授權及設定是否可用；缺929為available=false，原API繼續運作 |
| /configuration | GET／PUT {graph,expectedRevision} | 管理員設定；MISSING或精確ROWVERSION CAS |
| /options | GET | 管理員取得已儲存且通過政策的欄位與參數名稱／型別；無SQL或資料列 |
| /contexts | POST {values} | 只有主層既有參數；建立JWT綁定context |
| /contexts/:opaque/navigate | POST {edge,rowRef} | 僅選保存edge及當頁伺服器rowRef；不能送child values、SQL、欄位名或權限 |
| /contexts/:opaque/page | POST {page,search,sort} | search/sort只可使用c0/c1等伺服器可用欄位key |
| /contexts/:opaque/back | POST {} | 回父層重新驗證、分頁及稽核 |
| /contexts/:opaque | DELETE {} | 撤銷context；在途回應不得復活 |

欄位/子參數版本在**管理員保存時**建立 server-only BindingJson：Query version、Dataset DefinitionRowVersion、DataSource ConfigurationRowVersion、完整 runtime 參數、政策及 Report metadata。
這是完整性／失效證據，不是獨立授權。第一次進入尚未開啟過的子層也須符合保存的binding；不能把已變更參數當成新基準默默轉型。
Actor 權限不存成通用授權，子層仍逐次檢查；未授權子層不繼承父層權限。設定 A→B→A 的 ROWVERSION 會變，舊context拒絕。

Context固定120秒、不滑動續期、最多100個、每個2MB/總20MB。只在目前程序保存已合法顯示之父鍵、必要參數與目前頁rowRef；不保存完整患者結果，不進瀏覽器storage。
多節點／重啟找不到context時404／410、回主層，不用sticky routing宣稱共享一致性。跨程序DELETE不是全域撤權證明；實際權限依每次live JWT/ACL重驗，前端另外Abort和generation fence阻止晚回應。

## 真正分頁及稽核

`datasetPaging.service.ts` 只讀已儲存 SQL，沿用 assertSelectOnlySql、runtimeParameterDefinitions、coerceRuntimeParameters、compileQuery、原Adapter與Driver bind。
SQL Server使用綁定OFFSET/FETCH；Oracle使用ROW_NUMBER範圍（兼容11.2語法，11g仍須正確Thick Client，實機未驗證）。
929驗收修訂：SQL Server的COUNT、唯一排序檢查、有限排序結果witness及頁查詢共用一個SERIALIZABLE來源交易；只抓該頁原始資料，不先抓整批再slice。保留Dataset.maxRows、timeout及明確capped提示；COUNT BIGINT字串不經不安全Number。
搜尋值、頁數、offset/limit均綁定；欄位只從保存設定和當前NONE政策取得，支援安全Unicode別名。內部Oracle順位欄位不交付。

每頁只對**實際頁raw rows**執行既有患者HMAC／PAGE disclosure，然後套Dataset遮蔽/OMIT，再投影本層可見欄位。
QUERY_EXECUTE start/final Audit沿用原finalizeDeliveryAudit；患者metadata的UPDLOCK及其他open/revalidate讀取均綁定相同owner transaction，不另開連線自我阻塞。最終交易重新驗身份、ACL、政策、版本、設定及row context；Audit不記參數、搜尋文字、患者鍵或原SQL。
Patient／一般Audit、SQL、CAS、DB或最終驗權失敗不得交付；設定Writer未知commit不盲目重試。既有Audit Number receipt不安全時拒絕，不String(Number)修復。

限制：只支援可安全包裝的單一SELECT。CTE、既存ORDER BY/OFFSET/FETCH、注釋、多敘述、未知dialect及不支援型別拒絕，不猜測改寫。
來源交易只涵蓋本頁，不持有跨HTTP交易；相同搜尋／排序後續頁及返回父層必須符合原COUNT及ordered-result witness，漂移時停止並清context。重複的設定排序鍵在SQL分組檢查時拒絕。witness最多涵蓋Dataset上限+1筆排序後資料，不傳瀏覽器；不是mutation epoch、外部DDL fence或SQL_LOCK_VERIFIED。來源值完全A→B→A恢復可相同，不宣稱偵測歷史世代。Oracle未具此來源交易證據，階層交付維持BLOCKED；原單層流程不變。

## PIN、清除及舊功能

WORKSTATION_PIN_RUNTIME 預設false及927不變。新階層API拒絕pinSession，不新增PIN allowlist、不用Device/Cookie代替JWT、不新增操作員JWT。
QueryRuntime/階層採原WorkstationIdentity取消與generation fence；登入/登出clear、PIN廣播、離線、hidden/pagehide、到期清結果/條件/堆疊，舊結果、錯誤、匯出blob不得交給新身分。
工作站跨分頁clear只可清資料；在舊JWT Query頁收到PIN身分廣播會登出，重新登入不恢復子層。React StrictMode不重複建立/稽核主層context。
原Dashboard公共播放、Dataset遮蔽、Query/Excel授權及PIN路由未改；原QueryRuntime資料交付仍走舊服務。新增apiDownload取消參數為選填，舊呼叫介面相容。

## 必要SQL：929審查來源，僅隔離CI安裝，未安裝至使用者環境

Inventory基準Runner已至927；923/924/925為既有專用草稿，928由CHART佔用。新增僅
`database/review/929_query_hierarchy.sql.txt`，不在Runner目錄、不寫SchemaMigration、不授權、不改舊資料。
新增一表QueryHierarchyConfiguration：RootQueryId PK、GraphJson、BindingJson、UpdatedByUserId、UpdatedAtUtc、AuditLogId、ROWVERSION；JSON/大小/正ID CHECK及兩個NO ACTION FK。
沒有線上AuditLog FK，避免破壞Archive；帳號或Root Query被配置參照時不可直接刪除，沿用封存或由現任管理員重存／另行審查清除，不cascade稽核。
Runtime做可見性、欄位型別／PK／FK trust／CHECK／default／額外trigger檢查；不把Mock稱為實際Catalog EXACT_MATCH。

實際安裝前：管理員/DBA先核對當時inventory及明確測試Instance/DB，驗證備份與回復，審閱草稿，在自有交易執行並唯讀核對Catalog；失敗完整rollback。
本PR**不提供使用者環境自動安裝器、不在使用者資料庫執行DDL**；下列受控CI只在新建可銷毀DB安裝。Runtime需原UQP讀取/稽核權限，加新表SELECT/INSERT/UPDATE與必要VIEW DEFINITION；DDL權限僅安裝者，不要求sa/db_owner/VIEW SERVER STATE。
SQL Server與Oracle來源帳號維持既有最小唯讀權限，不接正式HIS驗收。

## 本次驗證／CI邊界及實機條件

以合成資料驗證Graph、保存binding、真SQL頁面編譯、原QueryDelivery遮蔽/披露、API JWT/ACL、Config CAS/Audit/rollback/commit unknown Mock、三層導航、三種事件與容器、搜尋排序、到期、離線、晚回應、多分頁清除、原Date/PIN回歸。
本機結果：Server針對性140/140、Client安全單元18/18、Browser23/23通過；其中階層10、既有Date6、PIN7。另重驗390px右側面板與卡片1/1。Server/Client typecheck及build通過；0失敗、0跳過。Browser使用合成HTTP及本機Chromium，沒有實際資料庫。Client單元使用test-isolation=none並確認18個具名案例，沒有把本機受限子程序僅回報的4個檔案套件當成實際單元驗證。
專屬branch只跑針對性CI；source guard鎖定846483f已成功基準，禁止修改927、PIN/Policy/Compiler核心及lockfiles。
其他分支原CI不變；本分支不重跑不相關SQL/Windows全量或封裝，不把原workflow的有意SKIPPED稱為新實測PASS。

f9ac203基準時上述實機均NOT_RUN；本次SQL2019已取得下列真實CI證據。仍NOT_RUN：Oracle11g/THICK、Windows/IIS多程序、實際部署環境的來源索引/執行計畫/負載、929人工安裝與備份回復。不得把這些條件算為本次PASS。
只在獨立合成環境經核准執行；禁止現有共用正式DB或C:\UQP。需驗證頁曝光與子層遮蔽符合實際資料擁有者設定，不能以姓名/病歷號判定安全。

結論：可審查、可用Fixture驗收的第二階段功能候選；不是整體實機驗收完成，也不是部署許可。
PIN多層／患者低保證存取、隱藏鍵映射、不相容SQL、正式資料庫安裝保持BLOCKED；沒有再拆新增開發Gate。

## PR100：929真SQL驗收（沿用既有合成證據）

新增專屬`Query Hierarchy 929 SQL2019 acceptance` workflow，只在GitHub-hosted runner新建SQL2019容器及帶run marker的可銷毀合成DB。固定loopback與identity檢查，非現有Docker socket或醫院DB。安裝全部50份真baseline來源；不安裝CHART928、不改927／928契約。各案預設NOT_RUN，真assertion後才PASS；失敗artifact保留去敏report。執行方法及A–F範圍見`tools/sqlserver-acceptance/hierarchy-929/README.md`。

修正影響分頁、context witness、Config鎖定及PAGE稽核識別字；最終重驗受影響27個案例及Server typecheck/build。首輪舊workflow因PR整體diff曾自動觸發一次，已修正為相對f9ac203判斷新增變更；後續不重跑原140/18/23。Runtime/PIN開關與患者政策不變。實際SQL結果以新workflow及其report artifact為準，尚未執行／未取得結果不算PASS。Oracle11g/THICK無合格環境為NOT_RUN。Windows/IIS與多worker仍需另外的實機條件，不能因SQL CI通過就直接覆蓋C:\UQP。

### 已取得的SQL2019證據（2026-11-17，台北時間16:30–16:31）

- 實際程式SHA：`85941f21637f2fa169f339dcb2d72306d7bdda55`。
- [真SQL CI #4](https://github.com/Tingyi0805/universal-query-platform/actions/runs/44047200088)：Success；Server typecheck/build、受影響27/27通過。
- 環境：GitHub-hosted Ubuntu新runner、獨立`uqp929-ci` SQL Server2019 Developer容器、Engine15.x、Compatibility150；新建`UQP929_DISPOSABLE_SYNTHETIC`，結束後已銷毀。完整實際ProductVersion/Edition與50份baseline來源hash保存於report.json。
- 固定Image digest：`mcr.microsoft.com/mssql/server@sha256:debdc21628cddd1a4433371c601c8dee9bad3533ae8b18fe9dc8c5596368b10d`。
- [去敏Artifact](https://github.com/Tingyi0805/universal-query-platform/actions/runs/44047200088/artifacts/14311204067)：`hierarchy-929-SQL2019-44047200088-1`，SHA256 `40b80d9b8feab140d449e3aa9f3f44be11e6f9135e7ba858779e1076f21d819f`，保存至2026-12-01；不含SQL原文、資料列、PIN、Credential或HMAC key。

|範圍|實際結果|證據內容|
|---|---|---|
|環境／真baseline|2 PASS|實際identity/Engine核對、全部50份001–921/926/927原始Migration；沒有替代父表|
|A|6 PASS|owner交易必要、DDL rollback、安裝Catalog、repeat拒絕、缺FK／額外欄位拒絕且還原|
|B|6 PASS|非dbo受限帳號成功CAS寫入；無db_owner/sysadmin/VIEW SERVER STATE；DDL/DELETE/帳號密碼/角色/直接來源讀寫/metadata visibility越權拒絕|
|C|8 PASS|並行CAS一勝、ACL/TokenVersion撤銷、真1222與1205、Audit/final validation rollback、真TDS COMMIT已送達但ACK攔截斷線仍拒絕成功且不重試|
|D|9 PASS|COUNT/OFFSET/FETCH、bind、empty metadata、非唯一排序拒絕、插入漂移、等COUNT換鍵、非鍵值變更、ABA恢復語意、真編譯SQL來源交易barrier擋住另一連線INSERT|
|E|6 PASS|兩層Query ACL、CUSTOM/FULL/OMIT、真患者PAGE HMAC/subject/page number、未確認政策拒絕、指定SQL229稽核故障禁止交付、既有archive函式保存receipt關聯|
|F|1 NOT_RUN|無合格Oracle11g/THICK環境；階層交付仍BLOCKED|

合計37 PASS、0 FAIL、1 NOT_RUN。先前失敗run保留，不當作通過證據。沒有Mock計入上述SQL案例。C_COMMIT_UNKNOWN使用真SQL已commit、TDS回應被測試proxy丟棄的情境，不是包裝commit()假造成功。

必要最小修正：COUNT/witness/page同一來源交易且拒絕漂移；空JSON使用明確[]；每個受保護RPC同批SET LOCK_TIMEOUT/XACT_ABORT（獨立SET RPC會失效）；已由SQL自動rollback時不重複rollback掩蓋原錯誤；患者稽核INSERT只將保留字RowCount改成[RowCount]，其他稽核程式不改，scope檢查鎖定此單一差異。

B帳號只證明929功能及live JWT重驗所需的最小權限，**不是**完整UQP登入/使用者管理/匯出/維護帳號的權限清單。Archive另以隔離CI migrator執行既有maintenance函式；未授予feature帳號DELETE或封存管理能力。不得直接用此測試帳號取代現有UQP登入DB帳號。

可開始準備**SQL Server限定**的Windows合成測試交付；本次沒有製作ZIP，不可直接覆蓋C:\UQP。仍需人工核准929目標/備份/回復、Windows Node24/IIS與真來源受限帳號的UI驗收。Oracle、PIN多層、正式Source Fence及SQL_LOCK_VERIFIED不解鎖；不合併、不部署。
