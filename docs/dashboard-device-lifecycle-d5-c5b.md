# Migration 926 正式部署前唯讀檢查（D5-C-5B）

基準：`8b27dac43d9b362dc0d5d266686bb7d41bd96f98`。日期：2026-11-01（Asia/Taipei）。PR #83維持Draft，不合併。
**本階段只完成SQL腳本／報告準備；正式部署判定仍為BLOCKED，等待使用者在SSMS取得結果及人工證據。**
沒有連線EINOV-VPN／正式SQL Server，沒有讀取正式.env／密碼，沒有操作C:\UQP；沒有執行Migration、installer、db:migrate:status、備份、驗證備份或還原。Runtime與所有Migration原樣保留。

## 交付物與執行順序

1. [主唯讀檢查SQL](../database/acceptance/production-device-lifecycle-926-preflight-readonly.sql)。在SSMS連至 **EINOV-VPN**，由UI選擇既有 **UniversalQueryPlatform**。先只選取`00_ENVIRONMENT`執行，核對連線與metadata；不要透過SQL切換DB或使用sqlcmd模式。
2. 環境正確後，依序執行主檔其餘組。先核對`01`～`07`的可見性、表與欄位；Ledger／資料組需要既有Ledger／PRE欄位已存在。缺物件、無權限或任何SQL錯誤均記BLOCKED並停止，不做初始化或修補。DMV／msdb另需既有診斷權限，不為此改正式權限。
3. 若兩個926 marker都不存在，**不執行**下一檔；升級時新增NULL使Suspended／Enrollment兩個CHECK對舊資料為真，仍須主檔檢查Terminal與918 grant pair。
4. 只有`03`證明兩個926 marker型別／NULL／非Computed／無Default均正確時，才手動執行[已安裝926狀態資料SQL](../database/acceptance/production-device-lifecycle-926-installed-data-readonly.sql)。缺一欄／錯型別屬部分安裝，BLOCKED。若926已完整安裝且有Ledger，這是核對，不是重跑安裝授權。
5. 提供完整結果組與錯誤訊息、原始擷取時間及執行主體；分享前由管理者檢視內部命名。勿附.env、密碼、Token、Cookie、TokenHash資料列或患者資料。

**為何分兩檔：** SELECT-only腳本不能用動態SQL避開尚不存在的926欄位，也不應將尚未安裝時的編譯錯誤冒充資料違規。主檔不直接引用新marker資料欄位，只查Catalog；第二檔僅在型別存在已證實後執行。
兩檔只有SELECT／CTE與SSMS的GO分隔，無SELECT INTO、EXEC、宣告／控制流程、DML／DDL／交易／設定或備份／還原指令。權限名稱字串中的INSERT／ALTER／EXECUTE只是查詢名稱，不會執行操作。
SELECT仍可能掃描大量裝置並取得讀鎖；應由DBA安排允許的查詢時段。多組結果不是跨組不可變快照，不使用NOLOCK／READPAST掩蓋資料；部署前在核准的停寫／一致性窗口重新核對，任何並行變更均需重新評估。

## 每組結果的PASS／BLOCKED條件

所有PASS都是該項證據通過，不是單一結果就批准部署。`14_NON_SQL_GATES`是固定待審查標記，人工核對後應在審查紀錄附證據與結論，不修改SQL把BLOCKED字串改成PASS。若某項沒有資料／NULL／無權限／定義不可見，不能當成零問題；整體需所有SQL及非SQL gate閉合。

| 組別 | PASS條件 | BLOCKED／處理界線 |
|---|---|---|
| 00_ENVIRONMENT | SSMS連線確為EINOV-VPN、DB為UniversalQueryPlatform、engine major15／Express engine edition4、ONLINE／可寫；compat150符合C5-A隔離profile | 錯DB／instance／engine／唯讀／offline。ServerName與VPN alias不同需既有alias對照證明，不自行忽略；SQL本身不能證明客戶端連線alias。非150代表未按本次profile驗證，不代表926必然不相容；先另行審查／隔離重現，不修改正式compatibility |
| 01_PERMISSIONS | 證據主體具DB VIEW DEFINITION、Ledger／Device SELECT，相關DMV可讀；列出部署所需Device ALTER、Ledger INSERT及sp_getapplock EXECUTE能力 | NULL／無法看完整metadata不能推論不存在。唯讀查詢者可以不是部署者；其缺DDL能力不應自動授權，須另提供核准部署主體相同能力證據 |
| 02_TABLES | 既有Ledger、Device、Dashboard、AppUser、ArchivePolicy／History均為uqp實體表 | 缺表或type不符。無metadata可見性時先BLOCKED_VISIBILITY，不能稱確定未安裝 |
| 02_LEDGER_COLUMNS | FileName內建NVARCHAR(255) NN、AppliedAtUtc內建DATETIME2(0) NN、非Computed | 與runner建立Ledger的基準不同／欄位不可見先審查，不代表精度差異本身必然阻止926；不修改Ledger或呼叫status初始化。檔名比對統一轉nvarchar(max)，避免varchar／nvarchar字節差異冒充缺紀錄 |
| 03_COLUMNS | 所有PRE欄位符合輸出的最小型別／長度／scale／NULL／Identity契約；兩marker若存在必須精確DATETIME2(0) NULL／BIT NULL、無Default／Computed | 舊欄位缺失、alias type／錯型別／非NULL或Computed／意外Default。Datetime2的max_length僅輸出，按既有attestation檢查type／scale；不以推測儲存長度誤判。TokenHash只查欄位metadata，意外Default內容遮蔽並BLOCKED |
| 04_PREREQUISITE_CHECKS | 918的Dashboard QueryMode與Device grant pair CHECK存在、啟用、Trusted、非NFR；definition另與固定918來源人工比對 | 缺失／停用／不Trusted／不可見；僅名稱／flags相符不等於完整語意已比對 |
| 05_926_CHECKS | 已安裝時3項均啟用、Trusted、非NFR，definition通過既有926／Runtime相同的正規化比較 | 未安裝時3項均ABSENT可與clean-pre pair合併判定，不單獨當錯誤；部分存在／錯定義／停用／不Trusted則BLOCKED |
| 06_926_TRIGGER | 已安裝時母表正確、啟用AFTER UPDATE、唯一UPDATE事件、非NFR、definition SHA符合固定attestation | Trigger**沒有Trusted屬性**，不可虛構Trusted PASS。缺失僅可配合clean-pre判定；錯母表／事件／hash／hidden definition一律BLOCKED |
| 07_NAME_COLLISIONS | 4個保留物件名全不存在，或都屬正確Device表／物件類型且05／06通過 | 相同名稱掛在其他表／錯類型，不自動移除或修補 |
| 07_OTHER_DEVICE_TRIGGERS | 完整可見性下沒有未審查的額外Device Trigger；若有，需先完成既有程式／Audit影響審查 | 任何回傳列均先BLOCKED_UNREVIEWED_ADDITIONAL_TRIGGER；停用的額外Trigger亦需審查，不自行刪除 |
| 07_DATABASE_DDL_TRIGGERS | 無可影響安裝的未審查DB DDL Trigger，或已有相符審查證據 | 回傳列先BLOCKED，因其可能拒絕ALTER／CREATE_TRIGGER或產生副作用；只輸出hash／狀態，不執行、停用或輸出可能含機密的完整module文字 |
| 08_LEDGER | 025／900／918各精確檔名恰1列；926為0或1列並配合09；保留AppliedAtUtc | 缺前置、重複列、同版本其他檔名／尾空白等變體先BLOCKED；不得自動補登 |
| 08_PREREQUISITE_PAIRS | 前置各有1列，對應最小Schema存在，並且02～04全通過 | 有Ledger卻無最小Schema、Schema有卻未記錄、前置缺失均BLOCKED。這不是025／900／918整份歷史來源逐byte證明 |
| 09_LEDGER_SCHEMA_PAIR | 下方矩陣的clean-pre或完整already-installed狀態，仍需其餘gate | Ledger／實際Schema任何不一致、部分安裝、名稱衝突不可自動修補／採認 |
| 10_LEGACY_DATA | TerminalViolations=0且GrantPairViolations=0；PRE型別與可見性先通過 | 任何違規BLOCKED，926 WITH CHECK將可能失敗；不修改舊資料。ActiveExpired及inactive已封存但無撤銷時間只是資訊，不能誤判為926 CHECK違規 |
| 11_DATABASE_FILES／EXPRESS_DATA_CAP | 所有用量可見；依下方已核准需求預算，內部餘量／可增長空間足夠 | 超10GB ROWS限制、NULL用量／非標準檔案或預算未核准均BLOCKED；query不憑任意MB門檻自動判容量足夠 |
| 12_VOLUMES_LOG_TEMPDB | 既有診斷權限可取得數值，data／log／tempdb及實體volume餘量符合核准預算 | DMV權限錯誤／NULL不是0；同volume的available_bytes不能重複相加。log_reuse_wait／增長設定／維護鎖定成本未審查亦不能判部署PASS |
| 13_EXISTING_BACKUP_HISTORY／RESTORE_HISTORY | 與本次回復計畫相符的**既有**備份與既有驗證／還原紀錄已人工閉合 | history／checksum flag本身不證明可還原；沒有可見history不代表歷史從未備份，但現有證據未閉合仍BLOCKED。不執行新BACKUP／RESTORE／VERIFYONLY |
| 14_NON_SQL_GATES | 每項均由既有artifact／DBA紀錄／核准計畫提供可信證據 | SQL固定回傳待人工審查，不以Ledger或SQL版本冒充程式版本／備份已驗證／容量核准 |
| 15_INSTALLED_926_DATA（第二檔） | 兩marker精確型別先確認；Terminal／Suspended／Enrollment Violations均0 | 任何違規／SQL錯誤／不可見BLOCKED。只驗當前CHECK狀態，不能證明過去每次Trigger轉移或Enrollment的授權證據 |

### 926 Ledger／Schema組合

| 當次926 Ledger | Catalog狀態 | 結論 |
|---|---|---|
| 0列 | 兩marker及4個保留名稱全部不存在 | PASS_PAIR_CLEAN_PRE926；僅表示可繼續前置審查，沒有執行升級授權 |
| 1列 | 兩marker精確＋3 CHECK完整＋Trigger完整 | PASS_PAIR_ALREADY_926；**不重跑Migration**，另核對已安裝狀態資料與程式相容性 |
| 0列 | 完整926已存在 | BLOCKED_SCHEMA_PRESENT_LEDGER_ABSENT；不auto-adopt、不重跑 |
| 1列 | 缺失／部分／錯定義／停用／不Trusted | BLOCKED_RECORDED_BUT_SCHEMA_INCOMPLETE；不能信任runner會自行補救 |
| 任意 | 重複Ledger／名稱衝突／部分marker或其他部分狀態 | BLOCKED，保留原狀等待審查 |

主檔先列025／900／918的精確紀錄與最小Schema相依，不能僅因926 pair clean就忽略前置Ledger不一致。
既有runner可能略過「已有Ledger、卻缺Schema」，這也是本次獨立唯讀核對的必要性；不透過db:migrate:status取得證據。

## 資料檢查的精確語意

主檔只讀必要的IsActive、撤銷／封存時間、到期與grant欄位，回傳彙總數；沒有SELECT *序列化整列，也不回傳TokenHash、裝置名、IP、Credential或Audit ParametersJson。
若926 marker尚未存在，新增NULL會使Suspended與Enrollment CHECK為真；Terminal仍需檢查舊資料。若marker已存在，主檔不猜測其值，改由第二檔使用**固定926原始三個CASE**統計違規，保留NULL／CASE語意。
不把合法舊inactive／expired或已封存但沒有RevokedAtUtc的舊列視為需要「修造」的資料；也不因列數為0判為UNUSED。
Trigger的歷史不可逆／Hash輪替規則無法僅由當前列證明。926 CHECK語意與Trigger雜湊仍以原Migration與Runtime attestation為準，本次沒有改契約。

## Express容量與部署權限的人工核准

SQL2019 Express的關聯ROW資料庫上限為10GB（10240MB）；不把log或tempdb加進這個DB data上限。腳本同時回傳data已配置量、檔內已使用／空間、距10GB配置上限、file max_size／autogrowth、volume可用bytes、log用量與tempdb餘量。
達到配置上限不一定沒有檔內餘量；未達10GB也不代表volume／log／tempdb夠用。max_size=-1仍受Express與磁碟限制，growth=0不會自動增長；百分比增長也不能當固定MB保證。

DBA需用**既有容量資料及D5-C-5A／相符資料量的演練紀錄**記錄核准需求：

| 預算 | 必要紀錄 |
|---|---|
| 額外data／metadata需求D MB | 檔內可用＋實際允許增長量需覆蓋D；增長同時受file max、Express剩餘上限及volume限制 |
| 額外交易log需求L MB | 可用log＋可用增長容量足夠，recovery／log_reuse_wait與既有log保留策略已審查 |
| tempdb／工作需求T MB | 已用／未配置extent與其volume空間，包含同期其他workload及維護時間餘量 |
| 實體volume安全餘量 | data／log／tempdb若共用volume，增長及其他負載合併計算，不能重複使用同一份free bytes |
| 停寫／鎖定窗口 | 三個WITH CHECK可能掃描舊資料並要求Schema鎖；小型合成fixture不保證正式掃描時間或空間需求 |

未有核准D／L／T與安全餘量預算，空間結果保持BLOCKED_CAPACITY_BUDGET；本報告不憑單一free百分比批准升級。
部署主體需對既有Device表具ALTER（含建立DML Trigger）、既有Ledger具INSERT，並可執行sp_getapplock及讀取必要Catalog／Ledger；query login若只是唯讀收證者，需另用既有核准部署身份的證據核對，不要求替正式應用程式授予dbo或變更權限。

## 現行正式程式與待部署程式

SQL Server版本、Migration Ledger、套件`0.1.0`字串都不能證明C:\UQP的Server／Client實際build。
使用者需提供**既有**部署manifest／版本紀錄／非敏感檔案hash：目前Server與Client的commit／build識別、準備部署的release manifest、測試對應commit，以及同一版本配對與回復候選。
本代理不讀C:\UQP或.env，不要求提供密碼、Cookie key或Token值。

[D5-C-5A](dashboard-device-lifecycle-d5-c5a.md) 已在SQL2019／2022及CI #1251驗收：測試程式commit `d5f5794`，報告commit／本階段基準 `8b27dac`，當時Runtime沒有改變。
舊參考 `707655ea6e69536e7c85456bf70b5ef33649a4b2` 的UPDATE OUTPUT無INTO會在926 UPDATE Trigger下錯誤334；不能直接假定舊Server或任意舊Client／Server組合相容。
PASS必須證明準備部署／回復的程式具有已驗收的926相容writer及生命週期安全契約，Client／Server套件配對正確；若正式目前程式尚未被證明相容，**不能先裝926再讓未知舊程式繼續寫入**。
需要經核准的停寫、配對切換與回復計畫；此任務不提供部署命令。

## 沿用既有備份與驗證紀錄

`13`僅SELECT msdb已有歷史。回報backup_set_id／UUID、來源DB／server／machine／database GUID、時間／LSN／checksum／is_damaged及對應restore history，以便與**既有**檔案／驗證紀錄比對。
msdb備份／還原時間沿用SQL Server紀錄原值，不冒稱UTC；CapturedAtUtc則明確為查詢UTC時間。需要DBA說明既有紀錄時區。

- 有backupset、checksum=1或未損壞旗標，均不等於已執行VERIFYONLY或實際還原。
- VERIFYONLY不會形成一份可單靠restorehistory完整證明的驗收紀錄；有restorehistory亦需核對是否同一backup artifact、驗證結果與DB身份。
- 既有history可能被清除或由外部系統留存，空結果不能證明從未備份；仍需現有外部紀錄／備份識別閉合。
- 沿用記錄需包括：artifact／backup ID、時間與檔案識別、既有checksum／VERIFYONLY或還原測試結果、驗證時間／人員、保留／可存取性、核准RPO／RTO。不在本階段重跑任何備份／驗證／還原。
- C5-A的隔離合成備份不是正式DB的既有可回復證明。若checkpoint後有撤銷／Enrollment／Audit變更，還原舊備份可能復活舊授權；無保留／對帳／重新授權計畫時回復方式BLOCKED。

## 檔案安全與檢查範圍

本輪只新增兩份SELECT-only SQL與本報告，並更新既有Schema清冊的來源SHA索引，以免新增驗收檔破壞離線source-set驗證；不改清冊物件分類／49份Migration pin或Runtime。
已執行離線T-SQL parser（sqlglot 28.0.0）確認所有可執行AST均為SELECT、無INTO；另查禁DDL／DML／EXEC／設定／備份還原命令、確認三個CASE與固定CHECK／Trigger簽章來自未改的926／Runtime。
這是**靜態語法／唯讀性檢查**，不是SQL Server 2019實機執行或正式查詢PASS。沒有啟動完整CI或重新執行C5-A。
任何結果尚未取得前，正式部署均待審查；產出後停止，等待使用者提供SSMS結果與既有非SQL證據。

### ExpectedSha256字串補正

修正基準 `474916bcb520304a0806f72f3492bd34c06f995a`。06_926_TRIGGER的ExpectedSha256原先缺少字串引號，已改為 `N'0f3259251e812fdc2e3acc303e0c469cf2aaf4590035099336da72b0dae4abfb'`；原SHA、正規化與兩處0x二進位比較均未變。
先前parser將未加引號的N0f…當合法識別字，單靠語法樹可解析不能證明欄位綁定正確。本次補充預期常數的literal節點／值與未限定欄位作用域檢查，並以舊版本重現誤判；兩份SQL仍共26個SELECT AST，無其他靜態語法問題或寫入指令。
只做離線靜態檢查與清冊hash／連結一致性檢查；未在SQL Server實例執行，不能把靜態檢查當正式編譯／查詢結果。沒有修改Runtime、Migration或正式環境，也未重跑完整CI。
