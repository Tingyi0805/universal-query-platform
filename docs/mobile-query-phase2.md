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
COUNT與頁查詢分開；只抓該頁，不先抓整批再slice。保留Dataset.maxRows、timeout及明確capped提示；COUNT BIGINT字串不經不安全Number。
搜尋值、頁數、offset/limit均綁定；欄位只從保存設定和當前NONE政策取得，支援安全Unicode別名。內部Oracle順位欄位不交付。

每頁只對**實際頁raw rows**執行既有患者HMAC／PAGE disclosure，然後套Dataset遮蔽/OMIT，再投影本層可見欄位。
QUERY_EXECUTE start/final Audit沿用原finalizeDeliveryAudit；患者metadata的UPDLOCK及其他open/revalidate讀取均綁定相同owner transaction，不另開連線自我阻塞。最終交易重新驗身份、ACL、政策、版本、設定及row context；Audit不記參數、搜尋文字、患者鍵或原SQL。
Patient／一般Audit、SQL、CAS、DB或最終驗權失敗不得交付；設定Writer未知commit不盲目重試。既有Audit Number receipt不安全時拒絕，不String(Number)修復。

限制：只支援可安全包裝的單一SELECT。CTE、既存ORDER BY/OFFSET/FETCH、注釋、多敘述、未知dialect及不支援型別拒絕，不猜測改寫。
COUNT與頁之間的業務資料可變；不宣稱來源資料repeatable snapshot、外部DDL fence或SQL_LOCK_VERIFIED。排序鍵應為穩定識別鍵，並由實機驗收確認索引和唯一性；重複鍵／並行資料異動的穩定跨頁語意尚待實測。

## PIN、清除及舊功能

WORKSTATION_PIN_RUNTIME 預設false及927不變。新階層API拒絕pinSession，不新增PIN allowlist、不用Device/Cookie代替JWT、不新增操作員JWT。
QueryRuntime/階層採原WorkstationIdentity取消與generation fence；登入/登出clear、PIN廣播、離線、hidden/pagehide、到期清結果/條件/堆疊，舊結果、錯誤、匯出blob不得交給新身分。
工作站跨分頁clear只可清資料；在舊JWT Query頁收到PIN身分廣播會登出，重新登入不恢復子層。React StrictMode不重複建立/稽核主層context。
原Dashboard公共播放、Dataset遮蔽、Query/Excel授權及PIN路由未改；原QueryRuntime資料交付仍走舊服務。新增apiDownload取消參數為選填，舊呼叫介面相容。

## 必要SQL：929審查草稿，未安裝

Inventory基準Runner已至927；923/924/925為既有專用草稿，928由CHART佔用。新增僅
`database/review/929_query_hierarchy.sql.txt`，不在Runner目錄、不寫SchemaMigration、不授權、不改舊資料。
新增一表QueryHierarchyConfiguration：RootQueryId PK、GraphJson、BindingJson、UpdatedByUserId、UpdatedAtUtc、AuditLogId、ROWVERSION；JSON/大小/正ID CHECK及兩個NO ACTION FK。
沒有線上AuditLog FK，避免破壞Archive；帳號或Root Query被配置參照時不可直接刪除，沿用封存或由現任管理員重存／另行審查清除，不cascade稽核。
Runtime做可見性、欄位型別／PK／FK trust／CHECK／default／額外trigger檢查；不把Mock稱為實際Catalog EXACT_MATCH。

實際安裝前：管理員/DBA先核對當時inventory及明確測試Instance/DB，驗證備份與回復，審閱草稿，在自有交易執行並唯讀核對Catalog；失敗完整rollback。
本PR**不提供自動安裝器、不執行DDL**。Runtime需原UQP讀取/稽核權限，加新表SELECT/INSERT/UPDATE與必要VIEW DEFINITION；DDL權限僅安裝者，不要求sa/db_owner/VIEW SERVER STATE。
SQL Server與Oracle來源帳號維持既有最小唯讀權限，不接正式HIS驗收。

## 本次驗證／CI邊界及實機條件

以合成資料驗證Graph、保存binding、真SQL頁面編譯、原QueryDelivery遮蔽/披露、API JWT/ACL、Config CAS/Audit/rollback/commit unknown Mock、三層導航、三種事件與容器、搜尋排序、到期、離線、晚回應、多分頁清除、原Date/PIN回歸。
本機結果：Server針對性140/140、Client安全單元18/18、Browser23/23通過；其中階層10、既有Date6、PIN7。另重驗390px右側面板與卡片1/1。Server/Client typecheck及build通過；0失敗、0跳過。Browser使用合成HTTP及本機Chromium，沒有實際資料庫。Client單元使用test-isolation=none並確認18個具名案例，沒有把本機受限子程序僅回報的4個檔案套件當成實際單元驗證。
專屬branch只跑針對性CI；source guard鎖定846483f已成功基準，禁止修改927、PIN/Policy/Compiler核心及lockfiles。
其他分支原CI不變；本分支不重跑不相關SQL/Windows全量或封裝，不把原workflow的有意SKIPPED稱為新實測PASS。

實機 NOT_RUN：929實際DDL/Catalog、受限帳號交易、SQL2019及Oracle來源分頁/COUNT/排序唯一性/索引、雙連線CAS/撤權/1205/1222/rollback/斷線commit unknown、真HMAC/AuditArchive交易及IIS多程序故障。
只在獨立合成環境經核准執行；禁止現有共用正式DB或C:\UQP。需驗證頁曝光與子層遮蔽符合實際資料擁有者設定，不能以姓名/病歷號判定安全。

結論：可審查、可用Fixture驗收的第二階段功能候選；不是整體實機驗收完成，也不是部署許可。
PIN多層／患者低保證存取、隱藏鍵映射、不相容SQL、正式資料庫安裝保持BLOCKED；沒有再拆新增開發Gate。
