# D1-S：ExcelJS／minimatch 相依修補

基準 PR #83 `53a546251de1982eec7a922ac5278001afc9e2eb`。僅修改 Server package／lockfile、專項回歸測試與本紀錄；不開始 D2，不修改 926、狀態契約、Cookie／Token、IIS、BAT、IP resolver、SQL／匯出／遮蔽的產品程式。未操作現有 C:\UQP、正式 SQL Server，未執行本機或正式 Migration。原有 CI 工作與 audit 門檻完整保留。

## 弱點來源與完整樹分析

分析 `npm ls --all --json`、lockfile、`npm audit --json` 與實際 node_modules 呼叫程式。公告 [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) 的 audit 範圍是 minimatch <11.0.1；原本共有八個 Moderate audit 項目，來自同一公告的相依傳遞，不是八個獨立 CVE；High／Critical 為零。四條來源：

| 原有完整來源 | 修補後 |
| --- | --- |
| exceljs 4.4.0 → archiver 5.3.2 → archiver-utils 2.1.0 → glob 7.2.3 → minimatch 3.1.5 | 母套件版本不變；glob 14.0.3 → minimatch 11.0.3 |
| exceljs 4.4.0 → archiver 5.3.2 → zip-stream 4.1.1 → archiver-utils 3.0.4 → glob 7.2.3 → minimatch 3.1.5 | 母套件版本不變；glob 14.0.3 → minimatch 11.0.3，與上一條 dedupe |
| exceljs 4.4.0 → archiver 5.3.2 → readdir-glob 1.1.3 → minimatch 5.1.9 | readdir-glob 保持 1.1.3，minimatch 11.0.3 |
| exceljs 4.4.0 → unzipper 0.10.14 → fstream 1.0.12 → rimraf 2.7.1 → glob 7.2.3 → minimatch 3.1.5 | unzipper 0.12.5 的上游 fs-extra 11.3.1 取代整條 fstream／rimraf 鏈；不再安裝該舊鏈 |

八個原 audit 項目為 exceljs、archiver、archiver-utils、zip-stream、readdir-glob、rimraf、glob、minimatch。更新後完整 runtime 樹只剩 glob 14.0.3／minimatch 11.0.3；沒有殘留 glob 7、minimatch 3／5、fstream 或 rimraf。lockfile package entries 421 → 333，移除舊鏈帶入的套件；未更新 SQL driver、Zod、MSAL 或 Client lockfile。

2026-10-31 於 Node 24.15.0／npm 12.2.1 實際乾淨 npm ci 後，完整及 omit=dev audit 均由 **8 Moderate → 0**，High／Critical 維持0；92項專項／delivery路由及全量Server **2,053** 項通過，Typecheck／Build 通過。Windows 與整體 CI 的最終結果以 PR 上對應 Commit 的完整 workflow 為準。

## 為何這組 overrides 可用

沿用 Node 24.15.0／npm 12.2.1，保留 ExcelJS 4.4.0、Archiver 5.3.2、zip-stream 4.1.1、既有 uuid／MSAL override 及僅 odbc@2.6.0 的 install-script 許可。新增覆蓋均限定已驗證的確切父版本：

```json
"exceljs@4.4.0": {"uuid":"11.1.1", "unzipper":"0.12.5"},
"archiver-utils@2.1.0 || 3.0.4": {"glob":"14.0.3"},
"readdir-glob@1.1.3": {"minimatch":"11.0.3"}
```

- **不直接替 glob 7 換 minimatch 11**：glob 7 讀取 `Minimatch.set` 裡的 RegExp／`_glob` 並使用 String.match；11 改用 Matcher，無法直接相容。已在獨立 probe 檢查，不採該錯誤方案。
- archiver-utils 2.1.0／3.0.4 的 file.expand 都只呼叫 `glob.sync(pattern, options)`，14.0.3 CommonJS entry 保留此 API；file.expandMapping 本身不變。實測 Unicode／空格／括號路徑、brace／globstar、filter、排除、cwd、dot、mapping 的結果集合。沒有將 glob 14 當成 glob 7 所有第三方 API 的通用替代品；舊版 callback glob 的 rimraf 呼叫端已由新版 unzipper 移除，不讓它誤用新 namespace export。
- readdir-glob 1.1.3 僅使用 `new Minimatch(pattern, options)`／`.match(path)`，不讀 RegExp 內部、不呼叫已移除的 makeRe。11.0.3 保留這些實際使用的 API；以原 EventEmitter walker 驗證 arrays／ignore／skip／nocase／dot／matchBase 與 stat／relative／absolute 資料。
- ExcelJS streaming reader 使用 `unzipper.Parse({forceStream:true})`，0.12.5 保留；實際 writer／reader、ZIP Open.buffer／entry.buffer、Unicode entries 及無效 ZIP 拒絕均回歸，不靠 mock 代表相容。
- Archiver 8 已切換 ESM、readdir-glob 3 仍宣告受 audit 影響的 minimatch 10；整批升級母套件不會是較小的安全修補。未降級 ExcelJS、執行 audit fix --force、使用自製 matcher shim、偽造套件版本或隱藏 audit。

兩個 archiver-utils 版本用**同一個精確 OR selector**，避免 npm 對同名多版本 override 的解析遺漏；乾淨 npm ci 後的實際相依解析與專項測試會驗兩條路徑，不能只看 package.json 寫了 override。

## 測試與風險界線

`minimatchCompatibility.test.ts` 的六個相容案例先在修補前樹通過，再於修補後使用相同案例回歸。另有兩個安全測試：所有實際 matcher／glob 路徑的版本／呼叫 API，以及以實際 patched matcher 在 128MB／10秒限制的獨立子行程處理 globparts amplification pattern（optimizationLevel=2）。不在舊 matcher 上執行可能耗盡資源的輸入。

測試包含：真實 Archiver glob／directory 壓縮及 ZIP 讀回、120列 streaming XLSX／日期／數值、**實際 Dataset masking → createQueryExcel → XLSX XML／讀回**，驗中文表頭／檔名、日期、數值格式、OMIT 欄位與原患者識別值不落入工作簿。既有 query delivery 匯出路由的 RBAC、遮蔽、患者與 delivery Audit、失敗拒絕、CSV／XLSX、D1 狀態回歸也完整保留。

驗證命令（server 目錄、乾淨安裝）：

```text
npm ci
npm ls --all
npm audit --omit=dev --audit-level=low
npm audit --audit-level=low
npm test
npm run typecheck
npm run build
```

CI 未修改：Linux／Windows Node 24 Server 跑相同專項與全量測試、兩種 audit、Typecheck／Build；原有 Client／Browser／BAT／唯讀 SQL smoke 及 D1 隔離 SQL 安全測試依原設定執行。既有 D1 容器測試不等於在使用者環境部署 Migration。完整 CI 結論及 Commit 以 PR 最新紀錄為準，不能只以部分工作成功宣告完成。

剩餘界線：audit 0 代表查詢時資料庫沒有已知項目，並非保證未來無公告。跨 major 覆蓋只證明目前 UQP 呼叫面與 Node 24 Linux／Windows 回歸；若未來加入檔案 glob 功能、換母套件／Node 或移除 override，須重新驗證。未宣稱已更新使用者 Windows 現機或正式資料庫；本階段不提供現場覆蓋包，也不開始 D2。
