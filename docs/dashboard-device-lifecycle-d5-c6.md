# D5-C-6 — Migration 926 Ledger 採認與相容交付

**D5-C-7A 交付目標更新：Node v24.22.1／ABI 137／win32／x64，精確比對四項，不降版、不放寬。下方 CI #1252 與 5582671 artifact 是 Node v24.15.0 的歷史證據，不適用於目前正式 Node。新交付來源、CI 與下載以新 artifact manifest 為準。**

PR #83 保持 Draft、不合併 main。本階段不連線正式 SQL Server、不讀取正式 `.env`，不操作 `C:\UQP`。**正式覆蓋結論：BLOCKED，尚待人工核准及交付驗收；CI 成功及 ZIP 雜湊通過不等於部署授權。**

## 已有事實與版本

以下採信使用者已提供的正式證據，不要求重做基本存在性查詢：925 主要 Schema 已存在；926 SQL 已於 2026-11-01 12:52 成功執行，兩欄位、三個 enabled/trusted CHECK、enabled UPDATE Trigger 已確認；926 Schema PRESENT、Ledger NOT_RECORDED。上述時間僅作歷史事實，**不回填為採認時間**。

開始本次工作時 PR #83 HEAD 為 `570df70c3f5df4dcbbee57b76b251c849b390e0f`。PR #66 最新 HEAD 為 `a4e9cf64b258802ab992ec004a0aad9c5fbd2133`；GitHub compare 及本地 ancestry 均確認最新 #66 是 #83 的祖先，ahead 49 / behind 0。`c218c512` ahead 97 的舊比較不作本次交付依據。沒有切換分支、重設或合併。

每個交付 artifact 使用自己的完整 `sourceCommit` 及 `sourceTree`，不以本文件的起始 HEAD 代替交付版本。CI 包裝前及上傳前重新取得兩個 PR 最新 HEAD；#83 移動、非 Draft，或 #66 不是祖先時停止產包。下載後至實際部署前若任一 HEAD 更新，需重新審查差異／取得對應新產物，禁止將不同版本 Server/Client 混用。

## 採認邊界

新增獨立 CLI：`server/dist/scripts/reconcileDeviceLifecycle926.js`。它不 import app config、dotenv 或 migrate runner，不執行歷史 SQL，也不提供 Schema 修復／重跑功能。未掛入 Server 啟動流程或一般 migration 命令。

926 SQL 的 SHA-256 固定為：

`f2d17b2a24963860e646a620f9548b22ff6a1a296e077071e8fb50237c8cfd43`

採認必須先通過：

| 項目 | 拒絕條件／保護 |
|---|---|
| 套件／核准 | manifest SHA、sourceCommit、完整檔案 SHA、926 SHA 不符；未核准或過期；CLI 不在核准 package 內 |
| 正式身份 | ServerName、MachineName、DB、ORIGINAL_LOGIN、DB user 與核准書逐一相等；正式 profile 限 UniversalQueryPlatform、SQL 2019 Express、compatibility 150、ONLINE/read-write |
| 權限 | DB VIEW DEFINITION、Device SELECT、Ledger SELECT/INSERT、sp_getapplock EXECUTE 缺一拒絕；不新增／授予角色或權限 |
| 前置 | 025/900/918 精確檔名各一筆；前置欄位、900 archive tables、918 mode/grant CHECK 定義及 trusted/enabled 核對；Ledger 欄位及唯一鍵有效 |
| 完整 926 | 兩欄位 native type、精度、NULL、非 computed/default/identity/sparse/generated；三 CHECK 定義、enabled/trusted/NFR；唯一 UPDATE event、enabled AFTER Trigger 與既有精確 SHA guard |
| Trigger 雜湊 | 使用既有 Runtime attestation；正規化 definition SHA `0f3259251e812fdc2e3acc303e0c469cf2aaf4590035099336da72b0dae4abfb` |
| 資料 | 實際掃描 terminal/suspended/enrollment/grant 合法組合，只回傳聚合，不輸出 TokenHash 或裝置資料 |
| 未審查副作用 | Device 上其他 Trigger 或 Ledger 上任何 Trigger 均拒絕；不猜測其行為 |
| 交易／併發 | SERIALIZABLE、與926相同的 transaction-owned exclusive applock；Ledger UPDLOCK/HOLDLOCK；Device TABLOCK/HOLDLOCK；鎖定後重新 attest |

範圍是「完整 926 及其必要前置契約」，不是聲稱已驗證整個 UQP Catalog 或外部系統。額外合法業務欄位不被刪除，也不因採認而重建 Token/Cookie、授權、Audit 或 Dashboard。

唯一資料寫入為缺少時 `INSERT uqp.SchemaMigration(FileName,AppliedAtUtc)`，固定 926 檔名及**當下** UTC 時間。相符且已有紀錄回傳 `ALREADY_RECORDED`，不改時間；缺 Ledger 的 preflight 回傳 `READY_LEDGER_ONLY`，不寫入。所有 guard 在重複採認時仍執行。錯誤 rollback，commit／rollback 結果不明回傳 `926_COMMIT_OR_ROLLBACK_UNKNOWN_NO_RETRY`，禁止偷偷重送。

不寫入業務 Audit，避免創造無業務來源的事件；獨立 JSON receipt 記錄核准 reference、source/manifest hash、採認時間及結果，由操作者連同維護紀錄保存。備份／停寫 reference 僅是核准綁定，**工具不能證明備份可還原或所有外部寫入者已停止**，需人工驗收。

### 人工核准與執行方式（本次未執行）

1. 從該次成功 GitHub CI 取得 Windows staging ZIP 與 `.zip.sha256`，用可信 CI 下載來源核對外層 SHA。解壓至正式目錄外，不以 Windows 檔案總管直接覆蓋 `C:\UQP`。
2. 使用 Repository／可信交付來源的 `verify-uqp-pr83-926.ps1 -PackageRoot <staging>` 核對完整檔案、manifest、CI 證據、Node/ABI/Windows x64。此工具只讀取交付套件及 Node 版本，不讀 `.env`、不連 SQL、不操作服務，不會核准部署。
3. 核准者建立放在 package **外**的 JSON，`format=UQP_926_LEDGER_APPROVAL_V1`、`approved=true`、`scope=PRODUCTION`、`applicationSourceSha`、`packageManifestSha256`、`migrationSha256`，及精確 `serverName/machineName/databaseName/loginName/databaseUser/engineMajor`；`approvedAtUtc/expiresAtUtc` 使用 UTC ISO，核准窗最多24小時；`approvalReference/maintenanceReference/existingBackupReference` 必填。這不是自動授權模板，需審查簽核並保護檔案。
4. 維護人員確認停寫及現有已驗證備份，再於自己管理的 session 設定專用 `UQP_926_ADOPT_HOST`、`UQP_926_ADOPT_PORT`、`UQP_926_ADOPT_PASSWORD`；帳號與 DB 取自核准書，禁止使用一般 app `.env` 或將密碼寫入參數／紀錄。CLI 預設 STRICT_TLS（encrypt=true、trustServerCertificate=false）；嚴格模式憑證不可信時停止，不自動降級。D6-2另提供明確核准的ENCRYPT_TRUST_CERT，操作方式見下節，不需因此修改正式憑證。此 CLI 使用既有 SQL login；若正式環境僅允許 Windows 整合驗證且無可用的既有核准身份，也維持 BLOCKED，不新增帳號、不開啟 SQL authentication。
5. 以核准套件的 Node 執行 `node <staging>/payload/server/dist/scripts/reconcileDeviceLifecycle926.js preflight <staging> <approval.json>`。這是受控採認的完整交易驗證，會取鎖；不是要求再次手動執行已完成的基本存在性查詢。
6. 僅在人工核准後執行相同命令的 `adopt` 模式，最後加 `CONFIRM_LEDGER_ONLY_926`。保存 receipt；`ADOPTED` 或精確驗證後 `ALREADY_RECORDED` 才能繼續。異常／結果不明由維護人員查核交易結果，不重跑926、不無條件INSERT、不停用Trigger、不修造歷史資料。

## 隔離驗收

重用 D1/D5-C-5A disposable SQL harness，CI SQL Server 2019/2022 各自隨機 hostname、隨機密碼、獨立 localhost:14336 port binding，Docker label 與 MachineName 驗證，隨機 `UQP_D1_UPGRADE_[12hex]` 資料庫及合成資料；全部銷毀。無正式連線資訊。926 仍只在這些隔離 fixture 執行。

新增13項 SQL 案例／每版本：缺Ledger preflight不寫入、精確採認與重複冪等、額外欄位default不符、disabled Trigger、錯 CHECK 定義、錯 Trigger SHA、enabled但untrusted CHECK、缺前置Ledger、未審查Ledger Trigger、身份不符、Ledger INSERT故障的完整rollback、兩連線併發僅採認一次、權限不足。比較 Device 全欄位、Dashboard、Audit、Ledger 狀態；正常採認只多一筆Ledger、失敗不變，並確認無殘留交易。保留既有22項C5A及D1/D3/D4-C1/D4-D SQL驗收。

另有3項單元測試：核准資料/時效/身份約束、disposable與production範圍隔離、固定926來源及無migration/config執行入口。交付包在Windows PowerShell5.1測試正常、ZIP往返、竄改、多餘檔案、路徑穿越拒絕及修復後驗證。

實際結果見下方「本次執行證據」。交付套件內 manifest.ci 綁定該次完整核心測試結果；正式部署核准仍獨立於 CI。

## UPDATE 路徑覆核

| Repository | 與926相容方式 |
|---|---|
| dashboardDevice.repository | metadata、reissue、renew沿用570df70c三個 OUTPUT INTO @ChangedDevice 後回讀；manual/auto archive亦使用OUTPUT INTO；revoke無裸OUTPUT；create的INSERT OUTPUT不受UPDATE-only Trigger影響 |
| dashboardDeviceManagement.repository | credential/enrollment、suspend/restore使用OUTPUT INTO；metadata無OUTPUT；完整expectedVersion保持原狀 |
| dashboardQueryMode.repository | 模式切換、撤銷無裸OUTPUT，沿用既有pending invalidation及exact schema guard |
| dashboardTransition.repository | credential invalidation無OUTPUT，沿用既有交易及Audit |
| admin/workstationManagement.repository | 停用／綁定裝置無OUTPUT，沿用既有pending清理、管理交易與Audit |

本階段沒有發現需要再改的Runtime UPDATE。未改RBAC、Token/Cookie/Enrollment、生命週期、安全寫入或Audit契約。只把既有相容程式與新驗收、工具封裝交付。

## 交付與停寫／回復計畫

`pr83-926-release` 僅在 Server、Client（含Browser）、SQL2019/2022、Windows Node24 dependencies、kiosk launcher、dependency SQL smoke 全部成功後執行。在 Windows x64/Node24.22.1/ABI137/npm12.2.1 重新以鎖檔安裝／建置，Server保留原生production依賴，Client交付同一commit的dist及src；同包包含Server dist/src、兩邊package lock、Runtime需要的SQL資源、此報告與唯讀 verifier。SQL資源只是檔案，**解壓不執行Migration或Installer**。

`manifest.json` 包含source/tree、最新PR66、ahead/behind、Node ABI、平台、CI URL及必要jobs結果、926 SHA、每檔SHA256/bytes；`SHA256SUMS.txt` 另涵蓋manifest；外層ZIP另有SHA。ZIP採用保留dotfiles的archiver，不沿用只針對925的舊更新腳本。套件固定標示 `BLOCKED_PENDING_MANUAL_ACCEPTANCE`，無自動覆蓋或安裝入口；檔案雜湊是完整性證據，不是數位簽章，下載來源與核准書仍須可信。

**人工維護順序：**

1. 確認交付source/hash及最新#66/#83未漂移、現行服務啟動命令、IIS/server/client對應路徑、Node/ABI與ODBC/Oracle等機器依賴。若現行以tsx/dev模式啟動，不能直接套用production-only node_modules，須先核准切換為既有 `npm start`/dist 啟動配置；本次不改正式IIS或服務設定。
2. 查閱**既有**已驗證備份/復原紀錄，確認涵蓋926後Schema及目前業務資料/Audit、RPO/RTO、責任人及可復原時間；本任務不執行正式備份。缺合格備份reference即BLOCKED。
3. 核准維護窗，停止Web寫入、背景Job、外部整合與會寫入裝置狀態的服務，確認無進行中寫入。先保留整個現行程式目錄及ACL/啟動設定的回復副本；所有 `.env`、業務上傳／匯出／附件、憑證和稽核均保留，不讀其內容或用交付檔取代。
4. 只在staging展開／驗證，取得核准及採認receipt。對明確受管理程式目錄（server/dist、server/src、server/node_modules、client/dist/src及相應package/config）建立檔案替換清單；先保留所有既有非程式資料再替換。不要盲目ZIP合併造成殘留舊JS，也不要刪除未知業務目錄。SQL資源不執行；不使用925-only舊installer作926核准依據。
5. 安裝同一manifest Server/Client後，以受控合成測試身份驗收登入、Dashboard清單/播放、metadata/renew、暫停/恢復待授權、Token一次顯示、Enrollment、撤銷/封存、RBAC、409與Audit；**不使用正式Token/Cookie或患者資料作測試材料**。保存執行身份、manifest/source SHA與結果，再逐步恢復服務。
6. 失敗先保持停寫。回復程式僅能選經926相容驗證的版本；正式舊版裸OUTPUT程式不可直接回退。保留926及已採認Ledger，不DROP欄位/Constraint/Trigger、不倒回撤銷／封存/Audit。需要DB還原時只按獨立核准且已驗證的備份方案執行，先評估備份後新增Audit與不可逆安全狀態，禁止靜默丟失。

### 尚待人工驗收／正式覆蓋門檻

- 正式維護核准、停寫證據、既有可還原備份reference及身份/TLS/Node/原生依賴相符。
- 指定CI交付ZIP的可信下載、雜湊核對、受管理檔案替換清單及全部既有業務檔案保留方案。
- 核准書與該manifest綁定的完整採認preflight/receipt，以及實際部署後功能驗收及回復責任人。

上述不是要求重新執行已完成的926存在性檢查。**目前只能下載CI產物至隔離staging檢視；不可認定已核准直接下載覆蓋 `C:\UQP`。**


## 本次執行證據

**Repository／隔離驗收：PASS；正式覆蓋：BLOCKED（等待上述人工核准）。**

- Runtime／交付 source：`55826718c9c1f7d0d292338ec7f159364e792697`。
- [完整 CI #1252](https://github.com/Tingyi0805/universal-query-platform/actions/runs/41278310026)：completed / success；8個適用jobs全部成功，PR66專用jobs按既有條件略過。
- Server 2,192／2,192（Linux及Windows各通過）；Client 69／69；Browser 263／263。兩邊Typecheck/Build、依賴稽核、Migration/Schema inventory validation、SQL adapter smoke及Windows kiosk launcher全部通過。
- SQL2019：`uqp-d1-33881cb490da`，新增採認13／13、原C5A 22／22。SQL2022：`uqp-d1-3045b36e2284`，新增採認13／13、原C5A 22／22。D1/D3/D4-C1/D4-D SQL回歸均成功，兩個disposable容器已移除。
- Windows PowerShell5.1交付驗證：正常、ZIP往返、防竄改、多餘檔案、路徑穿越及修復後驗證全部成功；14,298個檔案。manifest SHA256：`69e62768835ed7530af28aad792f75dd9e47384f15fae3e0f5163f052d117e9a`。
- [Staging artifact](https://github.com/Tingyi0805/universal-query-platform/actions/runs/41278310026/artifacts/13072855491)：`uqp-pr83-926-windows-staging-55826718c9c1f7d0d292338ec7f159364e792697`，內含`release926.zip`及其SHA256檔；保留至2026-11-08。GitHub外層artifact digest為`88d9e1b4e6487094c031c534d34d3e6d41c2433d9e972bb27d5aca09d5f73cd2`，**不可混作內層release926.zip雜湊**。
- 上傳前及完成後確認PR83仍Draft、未合併；PR66最新HEAD仍為`a4e9cf64b258802ab992ec004a0aad9c5fbd2133`。本次未改Runtime或任何Migration；926 SHA保持上述固定值。

本節是在CI完成後以純文件commit補記；交付manifest/source仍固定為上述已測Runtime commit，沒有重新標記ZIP來源。已審查這個後續差異僅為本報告，server/client/database/tools/workflow與已測commit完全相同，無既有修正遺失。純文件補記只執行文件連結／清冊一致性與diff檢查，不重跑完整CI。人工核准書必須綁定**交付manifest的source與hash**，不得把後續文件HEAD冒充ZIP建置版本。


## D5-C-7A — Node v24.22.1 交付相容性

- 只調整目前適用PR83的七個CI Node pin、Windows打包精確版本/ABI guard、交付測試及說明；PR66-only歷史Node22流程不改。server/client既有engines範圍`>=24.15.0 <25`已包含24.22.1，鎖檔與套件版本不變，不修改Runtime業務功能。
- Manifest仍從實際Windows建置執行環境記錄Node/ABI/platform/arch，打包前必須精確等於`v24.22.1`/`137`/`win32`/`x64`。Verifier仍逐項完整比對，僅提前拒絕不符環境以避免無效的全包雜湊掃描；成功回傳前仍須通過原有全部SHA及檔案檢查。
- Windows regression job、prune後production dependencies及ZIP解壓後，均執行`tools/test-pr83-node-runtime.mjs`：載入真實ODBC Node-API addon、Oracle win32-x64原生addon與mssql模組；不讀.env、不連DB、不呼叫initOracleClient。Oracle Instant Client及特定ODBC driver的正式連線/設定不由此smoke保證，仍遵循既有人工部署驗收。
- PowerShell5.1增加四個精確錯誤案例：Node24.15.0、錯ABI、錯platform、錯arch均須回報各自的`926_NODE_RUNTIME_MISMATCH`。原有ZIP往返、防竄改及路徑安全測試保留。新的Server/Client/Browser回歸、Typecheck/Build及CI門檻維持不變。
- 新包重建Manifest、每檔SHA256及ZIP SHA256，不修改舊包Manifest來假裝相容，不重用舊Windows原生依賴作新版本建置證據。CI成功只代表此相容性驗收通過，正式覆蓋仍需D6既有人工核准；925/926已安裝，不重新執行Migration或改SchemaMigration。


## D6-2 — 明確核准的加密連線模式

預設`STRICT_TLS`維持`encrypt=true, trustServerCertificate=false`；省略模式欄位的既有核准JSON仍採嚴格模式。新增`ENCRYPT_TRUST_CERT`固定`encrypt=true, trustServerCertificate=true`，不提供無加密模式，也不在連線失敗後降級或重試。此模式略過憑證鏈與憑證主機名驗證，需明確接受此差異；原有SQL目標身份核對繼續執行，但不等同TLS的伺服器憑證身份驗證。

若選擇ENCRYPT_TRUST_CERT，操作者須在自己的session明確設定`UQP_926_ADOPT_TLS_MODE=ENCRYPT_TRUST_CERT`，並在完整核准JSON加入：

```json
{
  "connectionMode": "ENCRYPT_TRUST_CERT",
  "tlsTrustApprovalReference": "D6-2-approved-internal-certificate-exception"
}
```

這只是新增欄位示意，其餘既有核准、身份、交付source/manifest SHA、有效期間、維護及既有備份reference均須保留。環境選擇與核准模式不一致、缺核准編號或任意其他模式都拒絕；不讀取或改動現有`.env`。

核心另核對實際pool的encrypt/trust設定與核准模式一致，才可進入原有交易。preflight、ADOPTED及ALREADY_RECORDED收據均增加`connectionMode`、`encrypt`、`trustServerCertificate`及`tlsTrustApprovalReference`，無法以核准欄位掩蓋不符的連線設定。其餘Schema、CHECK/Trigger SHA、資料合法性、Ledger-only、身份、前置、交易、鎖與併發保護不變。

僅新增四項TLS單元案例與兩項隔離連線案例：嚴格模式拒絕disposable SQL的未受信任憑證且不寫Ledger；核准trust模式連線成功，查核該session的`encrypt_option=TRUE`及收據模式。沿用原有採認隔離案例。Windows仍由Node v24.22.1/ABI137流程重建Manifest、SHA256及ZIP；現有CI gate保留。本次不在本機重跑未修改的Client/Browser測試，不操作正式環境。

正式操作前僅需使用新套件雜湊綁定核准書、明確核准選定模式，依既有停寫流程執行採認並保存收據，再完成部署核准；沿用已確認的Schema、Node、備份及Staging證據，不要求重新手動驗收那些項目。本任務未執行正式採認或覆蓋。
