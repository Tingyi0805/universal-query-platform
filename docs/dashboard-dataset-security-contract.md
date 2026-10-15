## 恢復階段 3：Legacy Dashboard 欄位核准（目前實作）

基準 7986cd17f1a305321a727a708a344a76b4ccc36f。新增 GET/PATCH /api/dashboards/:id/column-approvals；不需開啟 Query-only 旗標，仍保留既有 management writer arbitration：management 開啟時拒絕 Legacy 寫入；已轉換/Query-only/Query-only-disabled 即使旗標關閉也不能回到 Legacy API。

- JWT/TokenVersion、DESIGN_QUERY、目前已發布主 Query 的 canView/canExecute，在同一 SERIALIZABLE 交易重新驗證。GET 回版本摘要、來源身份及三種核准/分類設定；不回 SQL、Bind、患者資料或其他 Parameters。PATCH 要求停用 Dashboard，不會自動切換啟用狀態。
- 無鎖前置讀取只用來發現 Dataset 集合，不構成授權。鎖順序為 Dataset IDs 升冪 → Dashboard UPDLOCK/HOLDLOCK → DashboardDataSource 全來源範圍鎖 → 鎖下重新比對綁定。新核准、舊基本設定與舊來源管理共用此順序；綁定漂移直接衝突，不追加順序外 Dataset 鎖。後續 ACL/政策/稽核鎖不等待（LOCK_TIMEOUT 0），競爭安全回滾；1205/1222 回 409，不自動重試或覆寫。結束前恢復 LOCK_TIMEOUT -1。實際 SQL Server 鎖與連線重設仍須隔離驗證。
- expectedVersion 是父列與全部來源 ID/SourceKey/DatasetId/rowversion 的 SHA-256 摘要；來源獨立更新、集合變動及來源替換均令舊版本失效。只 UPDATE 父 Dashboard.ParametersJson，與 writeAuditEvent(..., sameTransaction) 同成敗；管理稽核僅記錄操作者、Dashboard、SourceKey。
- PATCH 僅改指定來源的 upsert/remove。移除大小寫等價舊核准時全部刪除，重複/歧義輸入拒絕；保留 deviceColumnTypes、其他來源核准、一般參數與固定文字。分類不是傳送授權，無核准即不傳送。基本設定驗證允許保留沒有對應核准的分類。
- 只有 Dataset 最低政策允許的模式可寫入：CUSTOM 為 INHERIT/CUSTOM/FULL/OMIT；OMIT 只能 INHERIT/OMIT；其他部分遮蔽不可任意互換。實際輸出仍使用原共用雙層遮蔽，不新增原始資料 fallback。
- 建立時禁止附帶核准/分類，需先空核准建立並停用，再走新 API。基本設定 PUT 不能變更三種核准/分類 JSON（409 DASHBOARD_APPROVAL_WRITE_REQUIRED）。有核准時主 Query 更換、額外來源換綁/刪除/SourceKey 重用及 Query 轉換流程均拒絕（409 DASHBOARD_APPROVAL_BINDING_CHANGED）；必須先明確移除原核准。舊來源 PUT 保持完整清單語意，但既存來源採 UPDATE 保留 ID，不整批刪除重建。
- Legacy PRIMARY/額外來源與管理預覽的既有狀態指紋加入同交易讀取的父/全來源 rowversion 摘要；傳送前重新檢查權限、政策與版本。核准 A→B→A 仍有不同 rowversion，不能復用原快照。Query-only 既有指紋與患者證明防護保留。
- 階段 4 尚須接新核准 UI：以 GET 版本進行增量 PATCH、顯示停用/衝突/換綁錯誤、保留未儲存編輯與分類、先移除舊核准再換綁，不能繼續以基本設定 PUT 寫核准。
- 本階段沒有執行任何 Migration 或連接共用資料庫，沒有修改 .env、啟用旗標、修改一般查詢/Excel、部署或合併 PR。Mock/合成資料/瀏覽器測試不能取代隔離 SQL Server 2019 的 DDL、實際並行鎖、ACL 撤銷、稽核失敗、rowversion/來源集合變動與回滾驗證；部署前仍須停用/排空舊寫入者。

以下階段 2/1 與原附件正文為歷史交付說明；階段 3 完成範圍以上方為準。

## 恢復階段 2：Dataset 患者揭露稽核（目前實作）

基準 a4caca51aa29c07d0292db930c381bb5c3b263b1；本次依保存文件重新實作，沒有還原原 Commit。

- GET/PUT patient-audit-config 保留 JWT/TokenVersion 與 DESIGN_QUERY；嚴格 PUT 要求字串 expectedVersion、isEnabled=true、identifierConfirmed=true 與精確 alias。GET 回 config/version/status/metadataStatus/columns，不回 SQL 或定義 hash。
- 每次新契約交易先讀 sys catalog，檢查 907/919 欄位、版本 DEFAULT/CHECK、rowversion、metadata 型別與主鍵/外鍵/可信約束。缺少或衝突以 SECURITY_SCHEMA_REQUIRED 拒絕；不執行 DDL，不依 feature flag 推定已安裝。
- SERIALIZABLE、Dataset UPDLOCK/HOLDLOCK、設定/metadata 範圍鎖；版本以 SQL VARCHAR(20) 讀寫並轉換 BIGINT，設定寫入與 writeAuditEvent(..., sameTransaction) 同成敗，禁止停用及溢位。沒有吞掉管理稽核錯誤的成功路徑。
- 只有 /datasets/preview/run 實際成功結果可建立證明；一般 DatasetColumn 同步不會建立或覆寫證明。執行失敗不建立新證明；成功但未儲存/來源不符/alias 歧義會移除證明。建立時在交易鎖下逐值比較已儲存 SQL/DataSourceId，僅保存 SHA-256 與 alias。無 DatasetId 的預覽不建立任何 Dataset 證明。
- Dataset 定義改變及版本還原，在原交易內清除既有證明；變回舊 SQL 也必須重新成功預覽。metadata 內容改變時同步推進已存在設定的 ConfigurationVersion，並強制管理稽核，避免證明 A→缺少→A 復活舊快照。這不代表 metadata 能證明業務唯一性，穩定識別碼仍須由管理者與資料負責人確認。
- Dashboard 的 PRIMARY、額外來源、管理預覽及 Query-only 使用專用政策包裝器和稽核函式。患者設定版本、定義/metadata/分類/金鑰可用狀態納入既有指紋，執行與稽核後重新確認；非空資料必須通過可信 alias、設定啟用、可用金鑰與實際列識別欄位/HMAC 驗證。原雙層遮蔽不變。
- 一般查詢、Dataset execute 與 Excel/CSV 仍使用原 auditPatientListIfConfigured；沒有切換新 Dashboard 契約。舊敏感政策寫入與 SQL 變更保護維持。
- 此階段尚未實作 Legacy column-approvals API、核准 rowversion 快照整合或管理 UI。患者設定/metadata 的快照失效已接入；完整核准設定 A→B→A 防護屬階段 3，不宣稱完成。
- 本機僅使用 Mock/合成資料；尚未驗證真實 SQL Server DDL、鎖競爭或裝置。未執行 Migration、連接共用資料庫、修改 .env 或啟用旗標。未安裝 919 或未建立可信患者設定時，Dashboard 預期 fail-closed；部署仍須先安排隔離驗證及停用/排空舊寫入者。

以下保留階段 1 註記及原始完整交付目標，不能將原文件測試數量當成本次測試成果。

> 恢復階段 1 狀態：以下原始文件描述的是遺失 Commit 的完整交付目標，並非目前已實作功能或本次測試成果。原始附件正文保留於下方。階段 1 尚未接入患者設定寫入、核准 API 或新播放驗證。現有揭露稽核維持不變。
>
> 本次依附件重新實作，不宣稱還原 3490674。Schema 輔助程式不會自動探測或宣稱資料庫已安裝 919；階段 2 必須在交易內取得目前 catalog 證據。沒有完整證據一律回 SECURITY_SCHEMA_REQUIRED。
>
> 919 相對原附件的修正：拒絕同名非資料表物件；拒絕 metadata 額外欄位、受檢欄位的 computed／alias 型別；驗證版本 DEFAULT=1、版本 CHECK>=1、ISJSON CHECK 的標準定義及啟用／可信／複寫屬性；驗證 metadata 單欄 DatasetId 主鍵及啟用索引；驗證外鍵精確 DatasetId→Dataset.Id、單欄、CASCADE DELETE／NO ACTION UPDATE 與可信度。等價但非標準的約束表達式保守拒絕，須人工檢視；不默默接受。保留原單交易及回滾策略，沒有執行 SQL。
>
> 相依性：907 提供患者設定；910 提供敏感欄位與政策版本；913 提供 DashboardDataSource。912、914、915 是現有 CUSTOM／來源分頁功能前置；911 為驗證腳本。919 無直接 916–918 欄位相依，仍須保留既有 Query-only 保護。所有 DDL 結論均為靜態分析，尚待隔離 SQL Server 2019 驗證。

# Dashboard / Dataset 安全契約（919）

範圍：後端版本控制、Legacy 核准增量寫入、交易內強制管理稽核、患者 metadata 來源證明與快照失效。未整合管理 UI；Query-only 三旗標保持關閉。一般查詢／Excel 仍使用原有揭露稽核契約。

## Migration 919（僅建立，未執行）

- 保留 907 的資料、欄位與外鍵；新增 `ConfigurationVersion BIGINT NOT NULL DEFAULT 1`，既有列起始為 1。未建立設定的 API 版本為字串 `"0"`，首次建立版本 1，後續每次成功儲存 +1；失敗不遞增，BIGINT 耗盡拒絕寫入。版本字串避免 JavaScript 整數精度損失。
- Dashboard 與 DashboardDataSource **各新增** `ApprovalRowVersion ROWVERSION`。全來源版本摘要包含父列版本、各來源 ID／SourceKey／版本；父列與來源範圍鎖下比較。來源獨立更新、整批舊來源替換、來源集合異動均會使版本過期；不同來源的核准共用父列 ParametersJson，故保守拒絕任何過期的全來源版本，不合併未確認的競爭更新。SQL Server 自動更新 rowversion，舊寫入者無法忘記遞增。
- 新增 `DatasetPatientAuditMetadata`：Dataset 外鍵、已執行定義 SHA-256、結果欄位 alias JSON，沒有 SQL、Bind、患者值或金鑰。不為舊 DatasetColumn 清單補做可信證明。
- 明確檢查 907 與 Dataset、DatasetColumn、DatasetSensitiveColumn、DatasetSensitivePolicyVersion、Dashboard、DashboardDataSource、AuditLog。完整前置安裝需先完成 DatasetSensitivePolicyVersion 等既有政策 Schema；919 不依賴 916–918。全新安裝须依既有 Migration 順序建好前置表後執行 919。
- 全腳本單一交易、XACT_ABORT、失敗回滾；重複執行不重建既有物件，檢查版本型別、其他 timestamp 欄位衝突、metadata 欄位及受信任約束。此處只經靜態／Mock 檢查，尚未在 SQL Server 執行。

## Dataset 患者稽核 API

保留 `GET/PUT /api/datasets/:id/patient-audit-config`，JWT／TokenVersion 與 DESIGN_QUERY gate 不變。

GET 回傳 `{config, version, status, metadataStatus, columns}`；config 包含 isEnabled、patientKeyColumn、version。狀態包含 NOT_CONFIGURED、DISABLED、KEY_UNAVAILABLE、METADATA_UNCONFIRMED、METADATA_AMBIGUOUS、PATIENT_KEY_INVALID、CONFIRMED。只回傳可確認的欄位名稱，不回傳定義 hash 的來源 SQL、秘密或金鑰。Schema 919 不完整回 503 `SECURITY_SCHEMA_REQUIRED`。

PUT 嚴格輸入 `{expectedVersion: "0", isEnabled: true, patientKeyColumn: "PATIENT_ID", identifierConfirmed: true}`。

- expectedVersion 必填；不符回 409 PATIENT_AUDIT_VERSION_CONFLICT。禁止透過本管理契約停用稽核。
- SERIALIZABLE 交易先鎖 Dataset，讀取設定與 metadata，再寫入設定、呼叫 **writeAuditEvent(..., sameTransaction)**，全部成功才 commit；管理稽核失敗則 rollback。新路徑不使用 tryWriteAuditEvent。
- `/datasets/preview/run` 的成功結果，只有實際執行的 SQL 與 dataSourceId **逐值等於交易鎖下的已儲存定義**，才建立證明。這個比較僅证明 metadata 來源，不能用來豁免敏感 SQL 審查。未儲存預覽會使證明失效。沒有來源證明的其他欄位同步不覆蓋獨立證明。
- SQL／資料來源改變後 hash 不符；未確認 metadata、消失／改名 alias、大小寫歧義、已分類為 NAME 的識別欄位均拒絕寫入。患者識別欄位需是 SQL 結果的**精確 alias**，不可自動推定。
- identifierConfirmed 是管理者對穩定識別碼的明確確認；metadata **無法證明業務唯一性**。須由隔離驗證與資料負責人確認，不可將名稱視為穩定識別碼。執行時仍檢查實際結果 alias、有效識別值及 HMAC，不能只依賴 metadata。
- Dashboard 揭露採新安全驗證：停用、未確認、金鑰不可用、Schema 缺少均拒絕。一般查詢及匯出未切换此新契約。患者設定版本及 metadata 證明加入 Dataset 政策快照指紋，PRIMARY／額外／Query-only 快照均重新驗證。

## Legacy Dashboard 核准 API

新增 `GET/PATCH /api/dashboards/:id/column-approvals`，不需要 Query-only 旗標。僅限未轉換 Legacy Dashboard；沿用原有寫入者 arbitration，保留 Query-only 模式及轉換保護。寫入要求 Dashboard 停用，不能直接解除啟用中保護。

GET 回傳版本摘要、來源識別及三種既有 JSON 核准／分類設定。PATCH 嚴格輸入：

```json
{"expectedVersion":"64位十六進位摘要","sourceKey":"PRIMARY","upsert":{"NAME":"INHERIT"},"remove":["OTHER_COLUMN"]}
```

- JWT／TokenVersion、DESIGN_QUERY、目前已發布主 Query 的 canView／canExecute ACL 必須有效。額外來源沿用明確 Legacy Dataset 綁定，不猜測 QueryId；檢查 Dataset 與最低政策。所有讀取／核准變更在父列及來源鎖下进行。
- PRIMARY 與額外來源分開增量改動，僅 UPDATE Dashboard ParametersJson；不刪除／重建來源，不碰患者紀錄、Dataset 政策、元件或其他合法 JSON。
- 只允許最低政策容許的模式。CUSTOM 可 INHERIT／CUSTOM／FULL／OMIT；Dataset OMIT 不可覆蓋。實際輸出仍由共用後端雙層合併執行，不依賴管理前端。
- remove 只移除該來源指定的核准欄位；分類資訊仍由遮蔽邏輯使用，因此保留 deviceColumnTypes。分類本身不授權傳送；舊基本設定驗證允許保留未核准欄位的分類。
- 變更與強制管理稽核同一交易；失敗沒有部分儲存。稽核只記錄操作者／Dashboard／SourceKey，不記錄資料值。父列 rowversion 加入 Legacy 快照指紋，A→B→A 亦不可復用旧快照。
- 舊基本設定 PUT 若改動三種核准／分類 JSON，回 409 DASHBOARD_APPROVAL_WRITE_REQUIRED；建立含核准的 Dashboard 亦拒絕，需先建立空核准，再使用新 API。基本設定更換主 Query、額外來源換綁／重用 SourceKey 若仍有核准，回 409 DASHBOARD_APPROVAL_BINDING_CHANGED，避免核准被帶到不同綁定。舊資料保持不變。
- 管理 UI 尚未整合，所以舊 UI 不能繼續以基本設定儲存核准變更；下一階段须接此契約，不可恢復 best-effort 寫入。

## 上線、回復及隔離驗證

本次不執行 Migration、不連接共用 SQL Server／Oracle、不修改 .env、不啟用旗標、不部署。

建議順序：離線備份與 Schema 比對 → 隔離 SQL Server 2019 執行首次／重複／失敗 Migration → 驗證 DDL 原子性與保留資料 → 驗證真實 SERIALIZABLE 競爭、ACL 撤銷、稽核錯誤注入與快照失效 → 管理 UI 接契約 → 停用播放／排空舊寫入者 → 經批准的部署及 Migration → 以已儲存 SQL 確認 metadata、金鑰與患者穩定識別碼 → 安全恢復播放。

缺少 919 或可信證明时新 Dashboard 揭露會 fail-closed，預期可能暫時停止播放，不能用未遮蔽結果或停用稽核恢復。metadata 證明外鍵採用與既有 Dataset 子設定相容的 ON DELETE CASCADE；它不是患者稽核歷史。移除 Dashboard 核准不觸碰 metadata 或患者紀錄。

回復先停止播放與設定寫入，保留加法式 Schema 及所有版本／稽核資料。Migration 失敗由同交易回滾；已成功安裝不提供破壞性 down migration。不得回復至允许舊無版本核准寫入的服務後繼續接收設定修改；若需應用版本回復，維持管理寫入／播放停用或另做安全修復，不能恢復已失效快照。

本機 Mock／合成資料不等於真實資料庫或裝置驗收。GitHub API 憑證本次回 401，不能聲稱本次 CI 已通過。

## 本機驗證及修改檔案

229 項相關測試通過、0 失敗（本次新增 42 項：39 項契約／SQL Mock／Migration 靜態測試，3 項播放快照回歸）。Server typecheck 與 build 通過。未修改前端；本階段不執行管理 UI／裝置真機驗收。

- `database/migrations/919_dashboard_dataset_security_contract.sql`
- `docs/dashboard-dataset-security-contract.md`
- `server/src/middleware/errorHandler.ts`
- `server/src/modules/audit/patientDisclosure.service.ts`
- `server/src/modules/dashboard/dashboard.repository.ts`
- `server/src/modules/dashboard/dashboard.routes.ts`
- `server/src/modules/dashboard/dashboardApproval.repository.ts`
- `server/src/modules/dashboard/dashboardApproval.routes.ts`
- `server/src/modules/dashboard/dashboardApproval.service.ts`
- `server/src/modules/dashboard/dashboardDataSource.repository.ts`
- `server/src/modules/dashboard/dashboardDevicePage.routes.test.ts`
- `server/src/modules/dashboard/dashboardQuerySourceExecution.test.ts`
- `server/src/modules/dataset/column.repository.ts`
- `server/src/modules/dataset/dataset.routes.ts`
- `server/src/modules/dataset/datasetSensitiveColumn.repository.ts`
- `server/src/modules/dataset/patientAuditConfig.repository.ts`
- `server/src/modules/dataset/patientAuditConfig.routes.ts`
- `server/src/modules/dataset/patientAuditConfig.service.ts`
- `server/src/modules/securityContract/securityContract.repository.test.ts`
- `server/src/modules/securityContract/securityContract.test.ts`
- `server/src/modules/securityContract/securityContract.ts`
- `server/src/modules/securityContract/securityContractMigration.test.ts`
