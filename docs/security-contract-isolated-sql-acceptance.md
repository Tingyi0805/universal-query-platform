# UQP 階段 4B-1：SQL Server 2019 隔離驗收準備

盤點基準：`beee734f3b23ec72f3d3a9374df91f3214b348d8`。本文件是後續驗收程序，**不是本階段的資料庫執行授權或通過證明**。4B-1 不啟動資料庫、不連線、不執行 Migration；只執行離線工具、靜態與 Mock 測試。沒有修改業務邏輯。

## 結論與執行阻擋

儲存庫有 **46** 份 Migration：001～026、900～919，並沒有 027～899。由檔案建立物件與 ALTER/FK/seed 使用關係追溯，919 所需前置物件都有來源，未發現必須從共享資料庫複製 Schema/資料的相依。**可提出全新隔離建置路徑，但尚未真實驗證任何 DDL 可執行性。** 不用手寫精簡假 Schema 冒充正式前置版本。

目前阻擋正式驗收的因素：隔離 SQL Server 2019 實例、管理者核准的連線與建立/備份權限、兩個獨立交易連線、受控失敗注入方式及合成帳號尚未配置/驗證；任何程序均不得使用既有共享連線。Loopback/資料庫名稱只能輔助檢查，不能證明隔離（可能是轉送）。容器/VM 身份、沒有共享掛載、路由與憑證分離須人工查核。若真實前置 DDL、權限或原子性測試失敗，停止並提出獨立修正，不在本階段修改應用或 Migration。

### Migration Runner 陷阱（已從原始碼確認）

`server/src/scripts/migrate.ts`：`/^\d+_.*\.sql$/i` 選檔，以 `localeCompare` 排序；只依 `uqp.SchemaMigration.FileName` 跳過已記錄檔案，**沒有 915 截止、916～918 排除或 Query-only 旗標判斷**。一般 `db:migrate` 預設 apply，未記錄的 916、917、918、919 都會嘗試執行，依序失敗即停止。即使三旗標關閉也一樣。

- `status` 在解析命令/列狀態前，已取得 pool 並執行建立 `uqp` Schema/`SchemaMigration` 的 batch；不能當成唯讀探測。
- `adopt` 會寫 Migration 記錄，只有 900 有專用完整性查詢，不能用來採認 916～919。
- 每檔由 Runner 開始外層交易，按單獨 `GO` 分批，最後與 FileName 記錄一起提交。917～919 自己亦有交易，SQL Server 是交易計數而非獨立子交易；919 CATCH 的 ROLLBACK 可能回滾整個外層交易。必須測單獨919及等效Runner外層情境。
- 917、918 刻意拒絕已安裝/部分安裝；不能把「重跑所有檔案」當作冪等測試。001 等早期檔案亦非冪等；900 的索引建立也不能無條件重跑。
- `server.ts` / Runner / `db:migrate:status` / bootstrap 不作為本階段或後續初始連線探針。未來 bootstrap 必須先審查會否觸發額外寫入。

## 001～919 相依盤點

以下為直接安裝相依，不是所有歷史序列邊。共同前提為選定資料庫及 `uqp` Schema（001 建立）。表中的編號對應 `database/migrations` 唯一同號檔案；精確檔名、SHA-256 與機器可讀相依清單在 `database/acceptance/migration-inventory.json`。這是人工依原始碼盤點、離線測試檢查順序與雜湊，**不是 SQL 語義解析器**。

| Migration | 直接前置 | 建立/改動或使用的物件 |
|---|---|---|
| 001 | 無 | AppUser、Role、Permission、UserRole、RolePermission，種入權限/角色；沒有自動建立可登入管理者 |
| 002 | 無 | DataSource、來源類型/連線 CHECK |
| 003 | 002 | Dataset→DataSource FK、DatasetParameter |
| 004 | 003 | Parameter UI/lookup 欄位，lookup→Dataset FK |
| 005 | 001、003 | QueryDefinition、RoleQueryAccess、UserQueryAccess |
| 006 | 001、003、005 | AuditLog 與使用者/Query/Dataset FK |
| 007 | 003、005 | DatasetColumn、ReportColumn |
| 008 | 001 | SystemSetting 與管理設定權限/角色關聯種子 |
| 009 | 002 | DataSource 類型 CHECK 擴充 |
| 010 | 009 | ODBC 欄位與類型 CHECK（保留009類型） |
| 011 | 005 | QueryCategory、CategoryId FK，轉換既有分類文字 |
| 012 | 001、005 | Query archive、封存者 FK |
| 013 | 001、003 | Dataset archive、封存者 FK |
| 014 | 001、003、005 | DatasetVersion、QueryDefinitionVersion |
| 015 | 008、014 | 版本保留欄位/索引/設定種子 |
| 016 | 006、008 | AuditLog 分類/保留、AuditLogArchive、設定種子 |
| 017 | 001、005 | UserQueryFavorite |
| 018 | 006 | AuditLog 使用者/Query/Event/Status/時間索引 |
| 019 | 001 | AppUser.TokenVersion |
| 020 | 001、005 | Dashboard、Query及建立/更新者 FK |
| 021 | 020 | 版面/分頁/時鐘/倒數欄位及 CHECK |
| 022 | 021 | DisplayProfile、Widget，從舊Dashboard設定建立初始版面 |
| 023 | 004 | DatasetParameter 動態日期設定 |
| 024 | 022 | Profile/Widget 視覺設定與 widget 類型 CHECK |
| 025 | 001、020 | DashboardDisplayDevice |
| 026 | 025 | 裝置 IP 限制欄位 |
| 900 | 025 | 裝置封存、Dashboard封存政策/歷史/索引 |
| 901 | 025 | DashboardDevicePlaybackSettings |
| 902 | 無 | SharedWorkstation/User/Session、UserQuickPin、DashboardAuthenticationPolicy；AppUser/Dashboard IDs在本檔無外部FK，runtime仍需身份/看板 |
| 903 | 無 | QuickPinPolicy 及預設種子（只需共同Schema） |
| 904 | 902 | SharedWorkstationCredential |
| 905 | 902 | Workstation.PlatformCode |
| 906 | 無 | PatientListDisclosure、Subject；主表外部參考為可空ID欄位，Subject FK指向本檔主表 |
| 907 | 003 | DatasetPatientAuditConfig→Dataset，預設停用、識別欄位非空CHECK |
| 908 | 906 | Subject.KeyVersion，PK改為DisclosureId/KeyVersion/PatientKeyHash；會拆建PK |
| 909 | 025、906 | Disclosure.DashboardDeviceId、FK與索引 |
| 910 | 003、006 | DatasetSensitiveColumn、DatasetSensitivePolicyVersion；檢查AuditLog存在 |
| 911 | 910 | **驗證查詢**，亦檢查AuditLog與無孤兒/非負版本/級聯；Runner仍會當Migration執行並記錄 |
| 912 | 910 | CUSTOM欄位/JSON CHECK，重建模式CHECK並驗信 |
| 913 | 003、020 | DashboardDataSource→Dashboard/Dataset FK、SourceKey UNIQUE |
| 914 | 913 | 額外來源PageSize/PageSeconds、DEFAULT及CHECK |
| 915 | 912、914 | 早期912/914的約束調和與WITH CHECK CHECK；不重寫政策 |
| 916 | 001、006、025、902、904、906、915 | Workstation管理/受眾/成員/Device連結；915是檔案宣告的升級順序，其他為實際物件前置 |
| 917 | 005、020、914 | Query來源綁定/版本/上限/計算狀態；不推定Query、不移轉授權 |
| 918 | 025、917 | Dashboard.QueryMode/Version、裝置授權版本；新值LEGACY，沒有轉換/啟用 |
| 919 | 003、006、007、907、910、913 | Config BIGINT版本、父/來源ROWVERSION、metadata表與約束；檢查DatasetColumn/AuditLog等存在 |

919 DDL 直接前置不含908/909/912/914/915，但**完整患者揭露及Legacy驗收**需要這些版本，不能只滿足存在性檢查。`writeAuditEvent` 使用016分類欄位，登入需019 TokenVersion，版面/來源操作需要021～026、914；因此建議保守完整前置序列，而非只跑最小FK閉包。

兩個隔離建置 profile：

1. `legacy`：001～026 → 900～915 → 919（43份）。先完成到915，建立合成資料並備份 `PRE919`，再驗919；證明無916～918仍能安全拒絕/執行Legacy路徑。
2. `coexistence`：001～026 → 900～918 → 919（46份）。單獨新資料庫；916→917→918按序一次，三旗標維持false，QueryMode保持LEGACY；檢查舊資料未被映射/轉換。

序列中的缺號是預期的。JSON計畫不是批次SQL，不得複製成對共享資料庫的Migration清單。前置各檔必須以獨立外層交易、保留GO批次及成功紀錄提交；錯誤立即停止，不補假紀錄。選legacy時不用全目錄Runner（會誤裝916～918）；未來需隔離專用白名單執行器或由DBA逐檔核對執行，目前沒有此寫入工具。

## 驗收環境與權限

- 專用一次性 SQL Server **2019（major15）** Developer/適用測試授權，固定CU及映像digest，compatibility_level **150**。建議x64 Linux容器/VM、至少4GB RAM、足夠資料/交易記錄/備份磁碟；不得掛載共享SQL資料或真實備份。
- 主機僅127.0.0.1高位port（計畫限制14330～65535），獨立network/volume；禁止指向共享環境的轉送、linked server、外部來源、排程、郵件或背景清除工作。DBA記錄實例/容器ID、port、volume、TLS憑證及run ID，人工驗證SQL連線端點實際身份；名稱白名單不能取代此步驟。
- 資料庫為 `UQP_ACCEPT_<12位小寫hex run ID>`，每profile/破壞性案例使用不同實例或restore副本，名稱不使用master/model/msdb/tempdb。讀寫分離/RCSI設定要記錄；本驗收仍明確用SERIALIZABLE及列/範圍鎖，不靠預設隔離推測。
- 建庫/還原操作者：只在一次性實例上有CREATE DATABASE、BACKUP/RESTORE與檔案系統權限。不要為測試給共享帳號sysadmin；若只能用隔離sa建置，應立即換成以下獨立使用者，且sa不供應用使用。
- Migration使用者：該DB `VIEW DEFINITION`、CREATE SCHEMA/TABLE、`ALTER` on schema::uqp、`REFERENCES`及uqp DML（種子/調和/紀錄表）；變更擁有者由DBA審查，無需伺服器sysadmin、無其他DB權限。
- API測試使用者：`VIEW DEFINITION`（安全Schema完整可見）、uqp所用表SELECT/INSERT/UPDATE/DELETE，無ALTER/CONTROL/建庫權限；可從schema級DML開始再依實際request縮減成表級，不能把這份建議當已證明的最小GRANT集合。失敗注入帳號明確DENY INSERT on uqp.AuditLog；不要用擁有者/db_owner測DENY。
- catalog探針：CONNECT及VIEW DEFINITION，只讀sys catalog，不需資料表SELECT。鎖診斷若需DMV，用DBA獨立唯讀觀察者的VIEW SERVER STATE（2019），不加給API帳號。
- 合成資料來源：同一隔離環境的獨立唯讀source帳號，僅合成查詢所需權限；不能使用來源Credential指向共享SQL/Oracle。固定VALUES/常數SELECT不需任何患者資料。

### 連線與秘密

本次沒有建立/修改 `.env`。未來新程序僅從隔離專用secret provider/短效程序環境取得值，不繼承現有平台DB設定。變數名稱（不含值）：`PLATFORM_DB_SERVER/PORT/DATABASE/USER/PASSWORD/ENCRYPT/TRUST_SERVER_CERTIFICATE`、`JWT_SECRET`、`DATASOURCE_ENCRYPTION_KEY`、`PATIENT_AUDIT_ACTIVE_KEY_VERSION`、`PATIENT_AUDIT_HMAC_KEYRING_JSON`。JWT/加密/HMAC均臨時隨機產生；HMAC每版至少32 bytes，保留測試舊版只供歷史比對。不得輸出keyring/token、SQL或Bind至報告。

TLS開啟並驗憑證；自簽憑證須加入隔離CA信任，不把正式安全設定改成trust-all。三個 `DASHBOARD_QUERY_SOURCE_MANAGEMENT`、`DASHBOARD_QUERY_SOURCE_EXECUTION`、`DASHBOARD_QUERY_DEVICE_PLAYBACK` 在未來程序亦明確保持false；旗標組合只由現有Mock測試覆蓋，本階段不啟用任何組合。

## 本階段可執行的離線工具

從server目錄（只讀repo，JSON輸出可重導到/tmp）：

```sh
node --import tsx src/scripts/securityAcceptancePlan.ts --profile legacy
node --import tsx src/scripts/securityAcceptancePlan.ts --profile coexistence
node --import tsx src/scripts/securityAcceptancePlan.ts --profile legacy --host 127.0.0.1 --port 15433 --database UQP_ACCEPT_012345abcdef
node --import tsx --test src/scripts/securityAcceptancePlan.test.ts
```

工具不import dotenv/config、DB driver或應用啟動模組，無連線、SQL執行或寫入模式；`--execute`、密碼參數、不完整/重複參數均拒絕。預設無target且`executable:false`；提供target仍只產生計畫。比對46檔雜湊/相依，未知/缺失/改變先拒絕，不能默默採用新的Migration。目標樣例只是離線描述，沒有預設資料庫連線。

`database/acceptance/catalog-probe.sql` 是**未執行**唯讀模板；新session預設THROW，需DBA先核對隔離身份，另以session context綁定精確database與整數isolation acknowledgement才可在後續階段送出。檢查DB名稱、SQL15、compat150、VIEW DEFINITION；沒有GO分隔，錯誤終止同batch。只輸出catalog、不讀應用資料、不建立任何物件。此模板不自動設定通行context；不得為方便刪除guard。全Schema未信任/停用約束會拒絕，完整919定義還要比對runtime `catalogEvidence` 的11項證據，不能只看到最後沒有錯誤就PASS。

## 未來現場執行順序（本階段不執行）

1. 驗收負責人核准獨立實例/資料庫清單、網路與秘密隔離、回復點、故障注入及清除範圍。任一項未確認即STOP。
2. 離線輸出兩個profile計畫，核對檔案雜湊與本次Commit。DBA新建空DB，確認SQL15/compat150、無外部連線/患者資料/應用排程。記錄schema/catalog baseline。
3. 依profile建立前置Schema，逐檔GO/交易/記錄成功；保留原始檔，不自行改寫DDL。建立合成使用者/角色/權限與來源、Dataset/Column/政策、已發布Query、停用Dashboard及SYNTH_EXTRA來源、固定文字widget。身份ID取INSERT OUTPUT，不假設1/101。fixture中的101僅單元測試ID，不能當live ID。
4. 合成SQL與aliases使用 `database/acceptance/synthetic-fixture.json`；設定管理者A/B、DESIGN但無主Query view/execute者、唯讀者、撤銷token者。穩定識別碼只選PatientId，PatientName標NAME；HiddenValue最低OMIT。種入既有disabled config、歷史稽核與舊合法Parameters JSON做保留測試，另準備尚未設定config的Dataset。**既有DatasetColumn不建立metadata**。
5. 備份 `PRE919`（COPY_ONLY完整備份、CHECKSUM；檔名標run ID/profile），另記各測試表逐欄排序快照/筆數/主鍵/JSON/時間，只有合成值。不要用CHECKSUM_AGG作唯一資料相等證據。DBA做RESTORE VERIFYONLY並實際還原到同隔離實例的新DB驗證可用性；還原副本沿用UQP_ACCEPT命名與guard。
6. 依下方M矩陣驗919，每個負向/破壞案例從PRE919新副本開始。不能靠包住919的外層ROLLBACK作為所有案例清除保證：其CATCH可回滾整個交易。單獨執行模式需stop-on-error；等效Runner模式要額外驗外層commit與SchemaMigration紀錄原子性。
7. 在通過919的獨立副本執行D/L/S矩陣。實際API必須由只載入隔離設定的新程序執行，不使用現有運行中的server；登入按現有JWT/TokenVersion流程，請求頭只留記憶體不記錄。
8. 每案收集代碼、HTTP狀態、版本字串、rowversion十六進位、合成ID、精確資料差異、audit增量、耗時/鎖結果及PASS/FAIL。錯誤詳細訊息/原始SQL/Bind/token/key不作交付附件。任何資料洩漏、回滾不完整或過期快照重用都直接FAIL/STOP。
9. 確認測試結束所有交易/程序/連線關閉；匯出無機密證據後，用核准還原點復原或刪除**具體run ID**的專用DB/容器/volume及備份，撤銷短效帳號/密鑰。不得使用DB萬用字元、共用volume prune或任何共享資料刪除命令。本repo不提供DROP/RESTORE執行腳本。

## M：Migration 919 真實DDL矩陣

| ID | 安排與操作 | 必須斷言 |
|---|---|---|
| M01 首次 | PRE919副本單獨執行原始919 | Config.ConfigurationVersion BIGINT NOT NULL，既有列=1，DEFAULT1、CHECK>=1可信且啟用；Dashboard與來源各恰一ROWVERSION NOT NULL(8bytes)；metadata恰3欄、初始空，無Column回填 |
| M02 重跑 | 保存M01後資料/rowversion/catalog，再執行919一次 | 成功，原config/metadata/父/來源/來源ID與rowversion均不被無意改寫，欄位/PK/FK/CHECK不重複；不是重跑917/918 |
| M03 既有保留 | PRE919已有disabled config、Column、敏感CUSTOM/OMIT、Dashboard參數/版面/額外來源及歷史Audit/Disclosure | 除新增version=1與rowversion外逐欄一致；沒有自動啟用、授權、映射患者鍵或改寫分類；歷史筆數與值不變 |
| M04 前置缺少 | 每個副本移除一個必要Schema物件/欄位（先處理FK只限該副本），執行919 | 51919安全拒絕，無部分新版本/rowversion/metadata；原狀保持。應用回SECURITY_SCHEMA_REQUIRED而非假成功 |
| M05 晚期失敗回滾 | PRE919先建立同名metadata view（不影響其他前置），919在版本/rowversion ADD之後CREATE TABLE名稱衝突；或預建同長度錯型metadata table | 919失敗，前面已ADD欄位完全回滾；故障物件保持原狀，無成功記錄，XACT_STATE/@@TRANCOUNT歸零、連線可再用；錯誤碼可能是SQL原生名稱衝突，不能強要求51919 |
| M06 定義衝突 | 各副本預建錯型/nullable/computed/alias型ConfigurationVersion、另名rowversion、DEFAULT2、CHECK>=0、metadata錯PK/FK指向/Json CHECK1=1/額外欄位 | 不默認接受；失敗且無部分修復提交。schema evidence亦拒絕。等價但不在canonical接受集合的定義應轉人工審查，不擴寬檢查 |
| M07 信任 | 正常副本讀sys.check_constraints/foreign_keys；在其他副本建立NOCHECK/disabled/NOT FOR REPLICATION約束、另造不合法資料 | 正常FK/CHECK enabled/trusted/nfr0，metadata FK DatasetId→Dataset.Id DELETE CASCADE/UPDATE NO ACTION、單欄PK；無效資料/錯定義拒絕。919有WITH CHECK CHECK可能修復其owned既有check的trust，成功時必須重新可信且資料有效，不要求所有untrusted情境都拒絕 |
| M08 邊界 | 獨立交易試version0、負數、BIGINT溢位、invalid JSON、孤兒metadata；有效version1/有效JSON | 負向約束拒絕、無殘留；JSON CHECK只是ISJSON，合法JSON但錯alias結構須由API拒絕，不能宣稱DB CHECK已保證結構。CASCADE只刪合成Dataset的metadata，不刪Audit |
| M09 Runner外層 | 新副本用與Runner一致的外層tx、逐GO、最後插FileName；成功/晚期故障各一次 | 成功DDL與記錄一起提交；失敗無成功記錄/部分DDL，外層rollback已被內層執行時仍安全終止。不得在原始Runner目錄直接apply來達成legacy profile |

注意919沒有把ROWVERSION當數字遞增契約；只比較不透明bytes/摘要。失敗交易可消耗DB rowversion計數，**不斷言全域計數連續**；只斷言被回滾列的已提交值/資料沒有改變。

## D：Dataset metadata、版本與稽核

| ID | 現場安排/操作 | 成功標準與既有Mock對應 |
|---|---|---|
| D01 來源證明 | 先GET未設定；用已儲存SQL/同DataSourceId成功preview，與DB鎖下定義比較；再GET | version0（首次config），CONFIRMED aliases；SHA256(UTF8 JSON.stringify([DataSourceId,SqlText]))等於DefinitionHash；只存hash/alias，不存SQL/Bind/患者值/金鑰。對應patientAuditPreview/config tests |
| D02 拒絕證明 | 未儲存SQL（含只差一空白）、不同來源、失敗preview、預覽執行期間另一session改定義、只有DatasetColumn、alias大小寫重複 | 不可建立有效metadata；舊證明失效，不靠Column猜鍵；確認實際provider欄位大小寫。需要兩session barrier使競爭可重現，不能只依sleep |
| D03 版本 | 明確確認PatientId，PUT使用GET原始expectedVersion；第一次0→1，再GET後1→2 | 管理Audit同交易各增加一次；stale版本409 PATIENT_AUDIT_VERSION_CONFLICT、沒有更新/audit；版本字串不經JS Number；>2^53與BIGINT MAX邊界，MAX回SECURITY_VERSION_EXHAUSTED |
| D04 並行 | A/B都GET同版本v，使用同body並發PUT；另用SQL session A持有Dataset UPDLOCK/HOLDLOCK確認B等待，釋放後再送相同expectedVersion | 只有一個v→v+1成功，另一個409；沒有丟失更新、重複版本或額外成功audit。兩session需不同實體連線，timeout記FAIL/待查，不算409通過 |
| D05 強制稽核失敗 | 副本API DB帳號DENY INSERT AuditLog（非owner），其他DML照常；PUT後restore授權 | 非2xx；config/version/metadata與管理Audit增量都保持原狀，GET仍舊版本；沒有吞錯當成功；不刪歷史稽核。另可由DBA在專用副本設拒寫trigger，須另核准DDL，不在本repo提供 |
| D06 無效設定 | 嘗試disabled、缺確認、姓名鍵、缺alias、歧義、缺/錯HMAC keyring、缺919/部分919 | 安全拒絕、非空患者response沒有rows；Schema503 SECURITY_SCHEMA_REQUIRED，金鑰503 PATIENT_AUDIT_KEY_UNAVAILABLE（設定路徑）；實際執行另查alias與HMAC，不依UI或metadata單獨放行 |
| D07 證明變更 | 修改SQL/來源後改回A；改aliases/重建preview；config已有版本 | 版本/證明指紋有變，舊快照不能復活；記錄metadata變更可能令config版本提升，不能硬寫固定下一版。單次失敗稽核亦不能留下半個metadata更新 |
| D08 HMAC/揭露 | 合成ID含空白/全形等NFKC案例；同ID不同scope、兩個ephemeral key版本；空/缺欄/錯型/超長 | 相同正規化ID/scope/key digest一致，scope或key不同digest不同；Subject只有32bytes hash+KeyVersion，沒有原始識別碼；同次重複ID去重；缺key/持久化失敗不傳非空資料。對應patientIdentityHmac/keyring/disclosure tests |

D04的可控鎖時序：A開始SERIALIZABLE，以實際DatasetId持有 `SELECT Id FROM uqp.Dataset WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id`；啟動兩個帶同v的API PUT，觀察阻塞（由獨立observer）；A提交後兩個PUT依序取得鎖，檢查一成功一409。所有session有可控timeout及finally rollback/close。這是預定程序，未提供可對任意連線執行的SQL寫入harness。

## L/S：Legacy核准、快照與權限

| ID | 現場安排/操作 | 必須斷言 |
|---|---|---|
| L01 權限/停用 | JWT管理者、無DESIGN者、有DESIGN但無主Query canView/canExecute者、active Dashboard依序GET/PATCH | JWT/TokenVersion與Query權限重新檢查；只有停用Legacy可PATCH；不自動切換active，無SQL/Bind/患者/Token回傳。不存在/部分919安全拒絕 |
| L02 增量/移除 | GET真實digest，PRIMARY新增INHERIT/FULL/OMIT；extra各自新增，再更新及確認remove PatientId（另MRN舊模式案例） | 只動指定來源與欄位；deviceColumnTypes、其他來源ID/參數/固定文字/分頁/秒數不變；未核准與Dataset OMIT無輸出；不存在SourceKey/重複/歧義拒絕 |
| L03 最低政策 | CUSTOM→INHERIT/CUSTOM/FULL/OMIT，嘗試NAME/MRN/PHONE部分互換；Dataset OMIT試FULL/NONE；額外來源借PRIMARY核准 | 只接受後端允許的可比較模式；Dataset政策不能被降級或借用，後端實際輸出亦確認，不只看PATCH成功 |
| L04 競爭/回滾 | 兩管理者同digest同時PATCH；持有父/來源集合鎖；額外來源集合競爭；另DENY AuditLog INSERT | 只有符合版本者成功，stale409；無部分JSON/audit、rowversion回到已提交狀態；鎖順序Dataset IDs升冪→Dashboard→來源範圍；deadlock1205/timeout1222須回安全409或拒絕，不能默默重試覆寫；未觀察到死鎖不等於證明沒有 |
| L05 舊寫入/換綁 | 基本PUT省略三核准欄、明確改寫、Query換綁；來源換Dataset/刪除重用SourceKey；空核准新建 | 省略保留鎖下最新核准；明確改寫409 DASHBOARD_APPROVAL_WRITE_REQUIRED；有核准換綁409 DASHBOARD_APPROVAL_BINDING_CHANGED；移除後才可重新明確綁定；不整批刪建來源/遺失其他JSON |
| S01 rowversion | 分別更改父核准、extra核准與來源列，在每步GET digest | 父或來源可信rowversion任一變化都使摘要失效，舊expectedVersion不能使用；不要求每次只變一個counter或固定增量 |
| S02 A→B→A | 先以A建立可用快照，停用後改核准B，再改回A，明確再啟用/預覽；primary與extra各測；Dataset config/metadata同樣往返 | 即使JSON回到A，rowversion/可信epoch不同；第一次A快照不得被用於新回應。比較cache key/evidence與實際執行/稽核次數；單看畫面數值相同不能證明失效 |
| S03 撤銷/競爭 | 刷新前撤銷Query canExecute/canView、DESIGN、AppUser.IsActive或增加TokenVersion；在SQL執行/稽核期間以另一session撤銷；裝置grant/expiry/revoke | 回傳前重查，不可因已快取/已開始SQL而繼續揭露；全域token/裝置失效清除全部，單來源政策失敗清該來源；無未遮蔽fallback。ACL鎖等待/失敗亦安全拒絕 |
| S04 UI回歸 | 管理/唯讀各測config conflict reload、active限制、錯誤中文/code/source、0筆結果、固定文字及健康來源 | 無管理權不見入口亦不可API存取；失敗rows清空、版面/文字/秒數保存，0筆與安全阻擋不同；無SQL/患者/Bind/秘密漏出 |
| S05 隔離範圍 | coexistence Schema、三旗標false，Legacy操作；檢查來源/QueryMode/舊裝置 | 919沒有轉換Query-only、改旗標或放鬆arbitration。Query-only旗標組合只跑Mock；一般查詢/Excel現有Mock與合成回歸維持原行為，不能用其路徑繞過Dashboard稽核 |

## 自動與人工驗收分工

| 類別 | 本次準備/可自動執行 | 尚未執行或仍需人工 |
|---|---|---|
| 離線 | 46檔雜湊/相依閉包、legacy/coexistence篩選、參數拒絕/無執行模式、唯讀probe guard、合成metadata/HMAC測試 | 雜湊只證明檔案未變，不證明DDL正確；相依為人工審查結果 |
| 既有Mock | patientAuditConfig/Preview、securityContract catalog、dashboardApproval/repository、PageSnapshot、preview/device/querySourceExecution、HMAC/disclosure tests；Client與Playwright使用合成資料 | 模擬交易/rowversion不證明SQL鎖與commit原子性 |
| 真實DB可自動化（下階段） | M01～M09、D01～D08、L01～L05、S01～S03可用隔離專用白名單runner/API harness與barrier自動斷言；本次僅有fixture/程序/唯讀probe，**沒有live executor** | 須先取得隔離環境授權，再實作/審查連線身份比對、預設dry-run、雙確認寫入、白名單/nonce/超時/rollback、故障注入及證據清理；目前全部標NOT RUN |
| 人工 | 對照本文逐案簽核 | 隔離實例/路由/secret/最低權限、備份可還原與清除、業務識別碼穩定唯一性、實際provider alias、裝置/撤權/中文UX S04及無資料洩漏；不能由自動猜測取代 |

驗收紀錄至少含：case ID、profile、repo SHA及Migration hashes、SQL/CU/compat/collation/RCSI、run ID、前置/操作、期望/實際、前後版本與資料差異、audit增量、兩session事件順序、PASS/FAIL/NOT RUN、操作者及證據路徑（排除機密）。未跑、timeout或缺少證據一律不能算PASS。
