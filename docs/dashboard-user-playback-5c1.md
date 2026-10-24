# 5C-1：一般使用者 Query-only 播放

## 範圍與 API

基準 `6b28f7414e1441ec7c9b964730f85e27624cbd59`，使用既有 Draft PR #66 分支。

新增 `/api/dashboards/:id/playback/v1`：

| 方法／路徑 | 用途與授權 |
| --- | --- |
| `GET /` | 可信持久模式探測；QUERY_ONLY 時回傳安全 Dashboard metadata、保存版型、安全指紋、JWT 到期時間。僅明確 LEGACY 回應允許舊介面；Schema、權限或其他錯誤不得 fallback |
| `POST /:sourceKey/page` | JWT 一般使用者逐頁播放；嚴格 page／snapshotId body，無權指定 context、參數、Device ID 或 Dataset |

新路由在既有 authenticateJwt 後，要求 VIEW_QUERY、EXECUTE_QUERY；執行核心再次檢查帳號、TokenVersion、JWT exp、實際啟用來源的 Query canView/canExecute、Query 發布／啟用、Dataset／DataSource、參數、敏感分類及明確 Dashboard 欄位核准。來源必須完成轉換；pending（即使停用）、超量或無效 Widget 引用拒絕。

僅 IsActive=true、持久模式 QUERY_ONLY、有效 mode revision、PRIMARY 已轉換者可播放。所有啟用來源納入完整指紋／授權；額外來源 page 還必須被保存版型引用。未核准欄位繼續 OMIT，核准不能降低 Dataset 最低政策；CUSTOM 使用既有 Dataset 規則。

User 同時受既有 DASHBOARD_QUERY_SOURCE_EXECUTION 與 DASHBOARD_QUERY_DEVICE_PLAYBACK 控制，沒有新增或啟用旗標。Designer 仍要求 DESIGN_QUERY＋EXECUTE_QUERY 並限定停用設計預覽；Device 仍使用既有 Token、委派者、工作站、IP、grant／TokenVersion 驗證。沒有新增另一套 SQL 執行器、快照快取或患者稽核實作。

## 安全隔離與重驗

沿用 createQuerySourceExecution、dashboardQueryExecutor、dashboardPageSnapshot、919 evidence reader、maskDeviceRows 及逐頁患者曝光稽核。

- context 由受保護路由固定為 user；designer／device 的既有呼叫相容保留。禁止 device context 與 deviceId 不一致。
- Snapshot 增加 executionContext，保留負數 JWT owner／正數 Device owner；modeVersion 分別為 QUERY_ONLY_USER_V1、QUERY_ONLY_PREVIEW_V1、QUERY_ONLY_DEVICE_V1。指紋包括 context、JWT session hash／TokenVersion／exp、mode revision、919 ApprovalRowVersion、來源／Query／ACL／政策、版型與全部啟用來源安全指紋。
- PRIMARY、來源、不同使用者、不同 JWT 與三種 context 不得混用快照。任何全域或 sibling ACL／政策變更都會拒絕舊資料。
- 沿用 SQL 完成後、曝光稽核前及後的完整重驗。HTTP 層也在 metadata／版型／回傳前檢查相同完整指紋，避免不同版本混合。
- 每頁稽核使用實際 userId，不偽裝為裝置；稽核失敗或非空頁缺少稽核證據不回傳資料。只回傳遮蔽後列與可見 report columns。
- snapshotExpiresAt 由實際快照 createdAt＋TTL 計算；authorizationExpiresAt 來自已驗證 JWT exp，不以畫面自行推測授權。

發現既有 getQueryAccessRevision 只雜湊 ACL 內容，ACL A→B→A 可回到同一雜湊。因此在 replaceQueryAccess 的原交易內，更新 PRIMARY 或額外 Query 綁定受影響 Dashboard 的 UpdatedAtUtc，以推進 919 真正 RowVersion；ACL、證據更新同 commit／rollback，不更動 ACL union 規則或另開無交易寫入。前 919 的一般 Query ACL 保持相容；Query-only user 執行仍強制要求 919。此保護涵蓋應用程式 ACL writer，不代表可允許繞過應用程式的直接 SQL 安全設定修改。

## Portal 與 Display

Portal 改為同頁導覽，不 window.open、不複製 uqp.auth 到新視窗、不新增 JWT 儲存／交付。全站登入仍沿用原 AuthContext 的 sessionStorage 契約，本次不改寫認證儲存架構；播放流程只使用既有記憶體 accessToken，沒有新增 localStorage/sessionStorage 寫入或 URL 憑證。

Available 清單移除參數／核准 JSON；一般播放 metadata 只提供白名單欄位與空 parameters，不將 Query 參數交給 PARAMETER Widget。報表標籤只保留實際可見欄位。

Display 一開始先等待可信模式；QUERY_ONLY 的 PRIMARY／額外來源一律使用新 page API，版型從受完整 user 授權的 metadata 讀取，不呼叫 DESIGN_QUERY 設定 API、Legacy preview 或 Device API。僅新播放初次明確 LEGACY 可沿用原入口；播放中的模式變動會清除及停止，不能降級。

- JWT、ACL、核准、政策、Schema、稽核或任一來源失敗時，清空 PRIMARY、所有額外來源、snapshot ID／列、版型與舊欄位暫存，撤銷未完成請求的畫面寫入資格並停止，要求重新開啟。無最後一筆資料保留或錯誤 fallback。
- metadata 每 5 秒重驗（不執行臨床 SQL），逾時 5 秒亦停止。這是輪詢，不宣稱撤權時零延遲；正常偵測約下一輪，網路停滯最多還需等待該次逾時。
- JWT 期限與快照期限以伺服器證據排程；到期時先清除舊列，替代查詢等待期間也不能留下舊資料。離線、進入背景／pagehide 同樣清除，避免瀏覽器凍結計時器後留下患者畫面。
- 舊快照仍由既有伺服器 process-local TTL／容量機制管理，前端清除持有引用；過期或失效指紋不能再次通過驗證，沒有持久化患者快照。

## 修改檔案

| 檔案 | 目的 |
| --- | --- |
| server/src/modules/dashboard/dashboardQuerySourceExecution.ts | 共用核心 user context、JWT exp、完整來源／核准驗證、指紋隔離及期限證據 |
| server/src/modules/dashboard/dashboardQuerySourceExecution.repository.ts | 沿用鎖定來源 reader；來源完整性與可信模式 Schema 檢查 |
| server/src/modules/dashboard/dashboardPageSnapshot.ts | 記錄 executionContext，拒絕跨情境重用 |
| server/src/modules/dashboard/dashboardUserPlayback.routes.ts | 獨立 JWT metadata／page 路由及安全 DTO |
| server/src/modules/dashboard/dashboard.routes.ts | 掛載、雙旗標 gate、Portal 清單移除參數 |
| server/src/modules/queryDefinition/queryAccess.repository.ts | ACL 原交易內推進受影響 Dashboard 919 證據，防止 ACL ABA |
| server/src/modules/dashboard/dashboardQuerySourceExecution.test.ts | 新增 user 授權、隔離、失效、稽核與來源 reader／ACL 證據回歸 |
| client/src/pages/DashboardPortalPage.tsx | 同頁播放，移除 popup 登入憑證複製 |
| client/src/pages/DashboardDisplayPage.tsx | 可信模式、新 API、來源清除、重驗及期限控制 |
| client/e2e/dashboard-user-playback.spec.ts | 一般使用者 Chromium Mock 安全案例 |
| docs/dashboard-user-playback-5c1.md | API、安全界線、剩餘工作與驗收 |

## 5C-2／5C-3 待辦與實機風險

- 大量並行、8 來源重驗成本、既有 SQL executor 背壓、單節點快照容量與多節點部署／重新整理行為，仍需負載與部署驗證；沒有新增共享或持久化患者快取。
- 播放失敗目前保守清除並停止；安全的重新連線／重試體驗、完整播放器操作與跨瀏覽器／實體螢幕驗收留待後續。回到前景需重新開啟播放。
- Legacy 播放入口與 API 尚存，後續退役另處理；沒有處理 5B-3B 裝置換綁、恢復或封存。
- 隔離 SQL Server：917–919 Schema／metadata 權限、ACL 與 RowVersion 更新的同交易 rollback、來源／核准／Dataset 政策並行更新、鎖順序／deadlock、逐頁患者曝光稽核失敗與版本切換實測。
- Windows Server／瀏覽器：時鐘同步、JWT／快照期限、背景節流／OS 休眠、斷線、窗口生命週期、固定文字／表格／FIELD 與多螢幕；輪詢偵測窗口及實際部署延遲須驗收。

未新增／執行 Migration、未連正式 SQL Server／Oracle、未修改環境設定／功能旗標、未刪除 Legacy API 或歷史資料、未啟用正式播放。Mock／Chromium／CI 通過不能當作醫院環境或患者資料稽核已驗收。

## 自動化驗證

- 先執行相關安全案例：dashboardQuerySourceExecution.test.ts 共 127 項通過（新增 40），一般使用者 Chromium E2E 18 項通過。
- 最終 Server build／typecheck 通過；完整 Server test 600 項通過（基準 560 + 40）。
- 最終 Client build／typecheck、npm test 通過；另逐檔直接執行確認 37 個單元案例通過。Node 24 的 npm test 輸出為 9 個檔案結果，未將檔案數當作案例數。
- 最終完整 Chromium E2E 109 項通過（基準 91 + 18），包含既有管理、遮蔽、Device Token、PIN／工作站回歸。
- 新案例覆蓋無 DESIGN_QUERY 的 user、草稿／未轉換／Schema／ACL／JWT／核准拒絕、SQL／稽核期間變更、PRIMARY／額外來源核准 ABA、ACL ABA、不同 owner／JWT／source／context 快照隔離、逐頁遮蔽／稽核失敗、TTL／JWT 到期、任一來源失敗全清、離線／背景、模式雙向變更不降級及無 Legacy／Device fallback。
- 新流程未輸出 JWT、Token、雜湊或患者原始列；資料及驅動均為 Mock／合成資料。Logger 原有 Authorization／Device Token／tokenHash 遮蔽仍保留。
- 未用自動化結果宣稱實際 SQL Server 交易、鎖、Windows 或患者曝光稽核已驗收；GitHub CI 狀態以提交後工作流程為準。
