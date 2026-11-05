# Slice 3A-2C：Query-only 裝置安全閉環

基準 e57566b。本次提供後端模式／啟停／簽發／播放 API；能力旗標預設關閉，918 只建立、未執行。沒有連接共用 SQL Server、部署或變更視覺編輯器、版面外觀、001–917。

## 持久模式與相容性

918 為 Dashboard 加 `QueryMode`（LEGACY／QUERY_ONLY／QUERY_ONLY_DISABLED）、單調遞增 `QueryModeVersion`，為裝置加 nullable `QueryModeGrantVersion`／`DelegatorTokenVersion`。既有列為 LEGACY/0，裝置新欄位 NULL；不轉換 DatasetId／Query、啟用看板、改 Token、授權或清資料。單交易 additive DDL，錯誤整筆 rollback；既有／部分欄位拒絕覆寫，沿用 runner 外層交易與紀錄。

`IsActive` 與管理標記不能代表 Query-only 已啟用；播放同時要求持久 QUERY_ONLY、正模式版本、啟用狀態、已簽發模式授權及 `DASHBOARD_QUERY_DEVICE_PLAYBACK=true`。關閉全域旗標不降級 LEGACY。模式 API 也檢查 917／918 新欄位與 enabled/trusted constraints，Schema 不齊安全拒絕。

## 明確流程與 API

所有管理 API 經既有 JWT／TokenVersion 與 DESIGN_QUERY。先於停用狀態完成來源與版面轉換；PRIMARY 沿用 Dashboard.QueryDefinitionId／參數／播放設定，不複製主來源列。

1. `GET /api/dashboards/:id/query-mode/v1`：模式、模式版本、opaque 管理 version。
2. `POST` 同路徑，body `{expectedVersion, activate:true}`：SERIALIZABLE、Dashboard → sources → profiles/widgets → devices 鎖順序，拒絕過期 version。含 PRIMARY 最多 8 個，來源 key 唯一、無 pending、必要參數正確、元件引用有效；驗證每個已發布／有效 Query 的操作者 ACL，並獨立驗證每個有效裝置**原始 CreatedByUserId 委派者**的帳號、DESIGN_QUERY／EXECUTE_QUERY、Query canView/canExecute、到期、IP 設定及工作站狀態。資料來源、敏感政策與揭露稽核設定／keyring 也須可用。
3. 啟用交易寫 QUERY_ONLY、模式版本 +1、IsActive=true，保留所有來源 Id／歷史 DatasetId／SourceKey／版面；旋轉所有相關 TokenHash並清空舊模式授權，強制安全稽核。舊 Token 不再有效。
4. `POST /api/dashboards/:id/query-mode/v1/devices/:deviceId/credential`，body `{expectedVersion}`：再驗證操作者與該裝置原始委派者的所有 Query ACL／必要參數／工作站／到期，交易內簽發新 43 字元 Token（只保存 SHA-256）、捕捉現行模式與委派者 TokenVersion，強制稽核後才返回憑證。UI 沿用既有手動啟動／同源記憶體 handoff，不加持久前端儲存。
5. 停用 `POST query-mode/v1`，body `{expectedVersion, activate:false}`：QUERY_ONLY_DISABLED、模式版本 +1、IsActive=false、旋轉 Token 並清授權、強制稽核。停用不用失效 Query 的 execute ACL阻止安全管理者停機；仍需有效 JWT／DESIGN_QUERY。模式與憑證更新／稽核任一失敗同交易回滾。

舊重新簽發 Token API 以同一 Dashboard 鎖拒絕非 LEGACY，不能繞過新簽發與稽核。停用後不自動轉回 LEGACY，不清管理隔離標記；模式 GET／credential API 是後端管理契約，本次沒有開發管理 UI。

## 裝置執行與隔離

既有 `/device/:id/page`、`/device/:id/data-sources/:sourceKey/page` 依持久模式路由：只有明確 LEGACY 才走舊執行；Query-only PRIMARY 與額外來源共用同一已發布 Query 核心，Dataset 只由 Query 推導。PRIMARY 仍返回既有 dashboard／reportColumns 外型；reportColumns 僅保留後端允許輸出的欄位。額外來源須被 FIELD/TABLE 引用，沒轉換或來源停用均不得執行。

每次分頁／SQL／揭露前後重查原裝置 Token、IP、到期、撤銷／退役、工作站、委派者 TokenVersion 與 Query ACL；權限不從目前 API 操作者或其他設計者繼承。保留第二批工作站撤銷機制。PRIMARY 與額外來源相同後端敏感政策、頁面限制、遮蔽、強制患者揭露稽核；不相信前端遮蔽設定。

快照區分 user／device owner，含 Dashboard、SourceId／Key、QueryId、BindingRevision、ACL revision、委派者與模式版本及 Token 雜湊 fingerprint。啟停後舊快照不能使用，新 Token 也不能重用先前 Token 的快照；只依 TTL 留在有界 process-local cache，不把患者列寫入模式表。來源 400／403／503 只清自身；裝置／工作站撤銷、模式授權或整體認證失效為 401，沿用播放器全體清除。

## 上線、回滾與待驗證

先在隔離 SQL Server 2019 驗證 917/918、crypto SQL、recordsets、交易鎖競爭／deadlock、role/ACL撤權競爭、IP／工作站與稽核 keyring；經批准維護流程才可執行 Migration，本次不執行。所有節點須同版本与一致旗標，舊 binary 停止配置寫入與播放，避免不理解新模式。正式裝置與瀏覽器驗收完成前保持旗標 false，不能宣稱正式啟用。

回退先用新 API 停用、使憑證失效，保留模式／來源／版面／歷史資料；不得回退到可忽略新模式的舊程序並重新啟用。沒有破壞性 down migration 或自動 Dataset fallback。PRIMARY 設定編輯仍是既有管理規劃後續項目；本批完成其安全執行，未解除 3A-2A 對舊主設定寫入的保護。

修改檔案：918；新增 `dashboardQueryMode.{service,repository,routes,test}.ts`、`dashboardQueryDevice.routes.ts`；修改 Dashboard route、Device credential/DTO/check、Query source execution／loader／routes／測試、source repository 交易擴充與持久模式版本、env 能力旗標及 auth repository 可選同交易讀取。沒有修改工作站或 PIN 模組；前端只修正 PRIMARY 的 403 局部錯誤判斷並補 Chromium 回歸，沒有更動編輯器、縮放或外觀。

驗證：受影響後端 136 項（含工作站／PIN）、Chromium 安全播放回歸 10 項通過，0 失敗；前後端 TypeScript 與 build 通過。測試使用 Mock／合成資料，沒有真實 SQL Server／裝置驗收。
