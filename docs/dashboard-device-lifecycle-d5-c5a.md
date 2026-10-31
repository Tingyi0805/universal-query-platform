# Migration 926 隔離升級與回復驗收（D5-C-5A）

基準：`230eccd8ced4fa7c391f28f4161e6dad871e4fa9`；測試程式 Commit：`d5f5794e5c7135250ec425da46ad5a0542c5de3e`。
PR #83 維持 Draft，不合併 main。只新增／擴充隔離驗收、兩個安全 guard unit case 與 CI SQL 版本矩陣；未改 D1～D4-D Runtime、任何 Migration、Token／Cookie／Enrollment／Audit 契約或正式環境。

## 結果與驗收範圍

**926 隔離升級、失敗交易回復及備份復原：PASS。** SQL Server 2019、2022 各22個D5-C-5A案例通過，共44次；既有D1／D3／D4-C1／D4-D SQL acceptance亦在兩版通過。
這不授權正式部署；**舊版Server直接回復程式且保留新Schema的路徑不相容，該降版方式BLOCKED**，必須採用下述已驗證的受限回復方案。
[完整CI #1251](https://github.com/Tingyi0805/universal-query-platform/actions/runs/41217453861) **Success**，7個必要工作全部通過，包含完整Browser。CI對應測試程式Commit `d5f5794`；之後只補入本報告的結果紀錄，不重跑相同測試。

## 測試環境與隔離證據

重用 `.github/workflows/ci.yml` 的 `device-lifecycle-d1-sql`，加入2019／2022矩陣，沒有建立另一套測試框架。
[CI #1251](https://github.com/Tingyi0805/universal-query-platform/actions/runs/41217453861) 執行測試程式Commit；兩個SQL工作均已成功。

| 項目 | SQL Server 2019 | SQL Server 2022 |
|---|---|---|
| 新建容器／MachineName | uqp-d1-838879664aeb | uqp-d1-ccb6dee57476 |
| Docker Container ID | ca198cf5f47a613c7540514dddf159a6d65f464f37ab624aa8436a05a4aa20c6 | dbc00c94efebeb2888f635980cae66c9732fd9c425133050ce09503a38a47951 |
| Image | mcr.microsoft.com/mssql/server:2019-latest | mcr.microsoft.com/mssql/server:2022-latest |
| 已核對engine major | 15 | 16 |
| 基準測試DB | UQP_D1_UPGRADE_926726dd24a2 | UQP_D1_UPGRADE_e82af3e8187f |
| D5-C-5A案例 | 22／22 | 22／22 |

隔離約束在第一次測試DDL前驗證：

- GitHub-hosted runner 新建 `docker run --rm` instance，隨機12位hex名稱／hostname、新生成密碼，label `uqp.d1.disposable=true`；`docker inspect` 記錄ID／hostname／image／label，未輸出密碼或完整環境。
- 沒有掛載正式DB檔案或使用正式連線；固定 `127.0.0.1:14336`，不接受任意hostname／port／database。連線後核對 `SERVERPROPERTY('MachineName')` 與新容器名稱、`DB_NAME()='master'`，再建立隨機DB。
- `UQP_D1_SCOPE=DISPOSABLE_ONLY`；不允許任何 `PLATFORM_DB_*` 或 `DOTENV_CONFIG_PATH` 進入驗收入口。新增guard測試證明未綁定endpoint／machine／正式DB名稱／應用DB設定會在SQL前拒絕。
- D5-C-5A helper不import config、dotenv或migrate CLI；DB名稱僅接受 `UQP_D1_UPGRADE_[a-f0-9]{12}`。後續D3沿用原有注入隔離pool的Runtime writer測試。
- 所有使用者／Dashboard／Device／TokenHash／Audit均為合成資料；未讀正式 .env、密碼、Cookie、Token或患者資料；未連正式VPN／SQL Server、未操作正式UniversalQueryPlatform或C:\UQP。
- helper只清理自己建立的隨機DB；既有workflow的always步驟銷毀該新建容器，包含測試備份。沒有對正式物件執行DDL、DML或DROP。

這些映像驗證SQL2019／2022引擎家族，不代表已驗證與正式SQL2019 Express `15.0.2180.2`相同Edition／patch／資料量環境；正式Express資源與實際資料仍需部署前另行驗收。

## 前置Schema與固定來源

| Source | SHA-256（與原machine inventory相符，未變更） |
|---|---|
| 025_dashboard_display_device.sql | e9382df5566a26e38e27ab7afc985d85d7ea74b6192a3d8170d584c24dca125c |
| 900_dashboard_device_archive.sql | b3dcf810d6981e225c1631f2d8b63d69ec1b70399441cce56786d326d66c8b07 |
| 918_dashboard_query_playback_mode.sql | cc7ad656ff726448a89e5e168f6dac5d5e3bf83e41b8684366e3b6b61855b813 |
| 926_dashboard_device_lifecycle.sql | f2d17b2a24963860e646a620f9548b22ff6a1a296e077071e8fb50237c8cfd43 |

D5-C-5A升級fixture使用**真實025／900／918檔案**，不是僅手抄Device表；先建立最小AppUser、Dashboard（含917的QuerySourceMaxRows）、DashboardDataSource（含QueryDefinitionId）、AuditLog與SchemaMigration測試基礎。
這些基礎是合成fixture，不冒充完整正式Schema或已執行001～921。
926 prerequisites固定為 `[25,900,918]`，不需要923／924／925；helper記錄執行的Migration來源集合，必須且只能是025、900、918、926。
完整D1～D4-D回歸另外沿用原有900／006／016等**刻意且既有的測試fixture來源**；這不是意外啟動全量Migration runner，也不將那些fixture當成此次926升級的額外前置。
本輪未執行db:migrate、status、adopt或其他installer。

## Schema升級與資料保留

fixture包括版本化有效裝置、已撤銷、已封存、停用舊資料及未帶grant的合法舊裝置，分屬兩個Dashboard；預先有一筆合成Audit。
以runner同樣的**外層交易 → 原始926 batch → Ledger INSERT → commit**驗證原子性，不呼叫無範圍限制的scanner。926自有內層交易的commit不等於外層Ledger交易已提交。

| 驗證項目 | 結果 |
|---|---|
| SuspendedAtUtc | DATETIME2(0) NULL、非Computed、無DEFAULT；所有既有列初值NULL |
| ReenrollmentRequired | BIT NULL、非Computed、無DEFAULT；所有既有列初值NULL |
| CHECK | LifecycleTerminal／LifecycleSuspended／LifecycleEnrollment三項定義、enabled／trusted／NFR由既有attestation檢查 |
| Trigger | TR_DashboardDevice_Lifecycle：啟用AFTER UPDATE、母表／事件／非NFR／固定definition hash通過 |
| 裝置資料 | 除兩個新增NULL欄位外，升級前後完整原列相同，ID／DashboardId／TokenHash／到期／授權版本／RevokedAtUtc／ArchivedAtUtc不變 |
| Dashboard／既有Audit | 完整快照相同，沒有額外Audit、無來源事件或Dashboard更新 |
| Token／Cookie | Migration沒有重建TokenHash或Cookie；原Hash保留；後續D1～D4-D及CI的授權／Cookie／播放合成回歸另行驗證 |
| 終止狀態 | 既有撤銷／封存狀態不復活；重啟用被CHECK拒絕，清除永久終止時間被Trigger拒絕 |

沒有聲稱在本輪執行正式HTTPS／IIS／BAT或舊版實機Client驗收。

## 正常與異常案例

以下每項均在2019、2022各通過一次；負面案例的PASS表示**預期拒絕且驗證未改變資料／安裝狀態**，不是允許不合法操作。

| # | D5-C-5A案例 | 結果／重點 |
|---|---|---|
| 1 | verified-preupgrade-backup | COPY_ONLY＋CHECKSUM備份；RESTORE VERIFYONLY成功 |
| 2 | 025-900-918-to-926-owned-ledger-and-preserved-data | 原始檔升級、attestation、Ledger與完整資料保留 |
| 3 | repeat-exact-926-and-recorded-run-are-idempotent | 原926重跑及已記錄的驗收流程皆不改狀態／重複Ledger |
| 4 | invalid-suspension | 547／51926拒絕；完整資料／Catalog／Ledger不變 |
| 5 | revoked-reactivation | 拒絕已撤銷裝置重新啟用 |
| 6 | archived-reactivation | 拒絕已封存裝置重新啟用 |
| 7 | invalid-reenrollment | 拒絕inactive裝置不合法marker組合 |
| 8 | irreversible-revoked-trigger | 拒絕清除RevokedAtUtc；不是僅CHECK測試 |
| 9 | irreversible-archived-trigger | 拒絕清除ArchivedAtUtc |
| 10 | old-server-output-without-into-is-not-a-safe-code-only-downgrade | 真實舊續期SQL在新Trigger下錯誤334，確認不相容且資料不變 |
| 11 | retain-new-schema-and-compatible-writer | 現行續期SQL成功，保留Hash／ID／永久終止欄位／既有Audit及新Schema |
| 12 | restore-verified-backup-to-separate-db-and-old-writer | 還原至另一隨機DB；完整快照等於升級前、926未出現、舊SQL可用；原升級DB仍保有926 |
| 13 | missing-prerequisite-025 | 缺Device表時拒絕，無部分安裝 |
| 14 | missing-prerequisite-900 | 缺ArchivedAtUtc時拒絕 |
| 15 | missing-prerequisite-918 | 缺授權版本欄位時拒絕 |
| 16 | missing-single-grant-prerequisite | 單一grant欄位缺失仍拒絕 |
| 17 | preexisting-partial-marker-is-refused-not-repaired | 既有部分安裝不被擅自修補，也不新增其他部分狀態 |
| 18 | invalid-legacy-row-rolls-back-added-schema | 舊資料已撤銷卻啟用，WITH CHECK失敗後回復新增Schema與Ledger，不修造原資料 |
| 19 | late-ddl-failure-rolls-back-columns-checks-and-ledger | 測試專用DB DDL Trigger在第三個CHECK建立時THROW；已新增欄位／前兩項CHECK亦回復 |
| 20 | ledger-insert-failure-rolls-back-successful-inner-ddl | Ledger測試CHECK拒絕926列；已成功的內層DDL也隨外層交易回復 |
| 21 | recorded-ledger-missing-schema-blocked-by-acceptance-preflight | 驗收preflight拒絕既有不一致，保留原狀不auto-repair |
| 22 | manual-schema-missing-ledger-blocked-without-auto-adoption | 手動Schema存在但未記Ledger，preflight停止，不auto-adopt |

`unchangedFailure` 比對Device、Dashboard、Audit、Ledger、物件／欄位快照並檢查 `@@TRANCOUNT=0`。既有部分安裝／Ledger不一致的測試保留**原有診斷狀態**，不是聲稱把既有錯誤自動修好；所有測試DB最後銷毀。原有D1的wrong-shape故障fixture會刻意移除測試物件，僅作隔離負面案例setup，沒有用作成功提交後的回復方案。
D3真實 `writeCredential` 另新增「正確Hash但QueryModeGrantVersion不符」及「DelegatorTokenVersion不符」兩個Enrollment拒絕，之後同交易的正確版本Enrollment成功；沒有重做版本契約或僅測UI。

## Ledger狀態與runner限制

正常fixture的前置Ledger列由測試建立：025／900／918；成功升級後新增且只有一筆926；重跑不重複。失敗交易沒有留下新926列或新欄位／Constraint／Trigger，既有資料完全不變。
這些是隔離Ledger，不回寫或推論正式Ledger。

**重要：`ledgerGate` 是本輪驗收procedure的前置檢查，不是既有migrate.ts新增的Runtime保護。**
既有runner對「已記錄926但Schema不存在」會在`applied.has(file)`略過，因此不能以runner正常退出當Schema驗證。
正式部署前必須獨立核對Ledger＋完整926 attestation，任一不一致／部分安裝立即BLOCKED；不執行自動修補或採認。本輪沒有修改runner／Migration。
「Schema完整但未記錄」同樣不是可盲目重跑的授權，必須另案查核安裝來源與採認程序。

## 回復驗收與降版風險

### A. 尚未提交的失敗

已測原926內層DDL與外層Ledger原子性：舊資料不合法、晚期DDL注入及Ledger INSERT失敗均回復，原錯誤保留，沒有自動重送。
測試中的故障Trigger／CHECK僅建於隨機隔離DB，不修改926文字、SHA或正式Schema。

### B. 已成功提交後的程式回復

舊版參考：`707655ea6e69536e7c85456bf70b5ef33649a4b2` 的 renewDashboardDisplayDevice SQL，fixture已離線確認除空白外相同。
該SQL使用 `UPDATE … OUTPUT INSERTED.*` 而沒有INTO；新UPDATE Trigger使SQL Server回覆334。
因此**不能核准任意舊Server／Client套件直接退回**；沒有以「新增欄位可NULL」推定所有舊程式相容。
未取得正式舊版binary／Client部署manifest，也未啟動完整舊Server。上述不相容證據已足以排除直接退版，而不是完整舊程式驗收PASS。

可採用的受限方案：

1. **保留新版Schema與資料，維持或回復到經驗收的926相容程式。** 本次真實現行writer在新Schema成功，保留終止狀態／Hash／Audit。需要回復程式時，候選版本必須另證明OUTPUT INTO及生命週期／Enrollment安全契約，不得直接回到707655e。
2. **已驗證備份的完整DB復原。** 本次以升級前COPY_ONLY／CHECKSUM備份、VERIFYONLY及實際RESTORE至另一隨機DB，完整比較資料／Ledger／Schema，再執行舊SQL成功。沒有DROP原升級DB的926欄位、Constraint、Trigger或資料來假裝rollback。

備份復原演練只證明**此合成checkpoint可還原**。若升級後已產生撤銷、封存、新Token、Enrollment或Audit，直接回復舊備份可能遺失新事件並復活舊授權；本測試不核准那種cutover。
正式回復必須先停止寫入、保留升級後DB與Audit，證明無checkpoint後變更，或另有經驗證的對帳／重放／重新授權方案；不能證明時該備份退版方式BLOCKED，應保留新Schema及相容程式。
SQL2019 Express上的備份權限、儲存空間、加密／憑證、實際應用版本及可還原性需由正式部署流程另行驗收，本次不操作正式環境。

## 驗證紀錄與正式部署前風險

- 本機：專項160／160，Server Typecheck／Build通過；舊SQL fixture與707655e來源一致（僅空白差異）。
- 隔離CI：SQL2019 **22／22**、SQL2022 **22／22**；兩版D1／D3／D4-C1／D4-D SQL回歸通過，兩個instance銷毀成功。
- 完整CI：**Success，7個必要工作成功**。Linux／Windows Server各2,189／2,189，Client 69／69，Browser 263／263；雙方Typecheck／Build、離線Migration Inventory／Schema清冊驗證、Windows launcher與SQL adapter smoke通過。PR66專用的923／924／release工作依原條件跳過，不當成已執行。
- 沒有執行本機SQL、正式Migration、db status／installer；沒有修改025／900／918／926 byte或Runtime。

仍需正式部署前處理：真實前置Schema／舊資料合法性與鎖定成本、Ledger／Schema獨立一致性檢查、正式2019 Express實際patch／資源、相容程式與Client套件manifest、維護／停寫窗口、可還原備份，以及checkpoint後撤銷／Audit不可遺失的回復方案。
本報告不是正式部署或直接降版的核准；PR保持Draft，不合併。
