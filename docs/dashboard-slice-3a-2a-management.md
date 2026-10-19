# Dashboard Slice 3A-2A：管理契約

基準 fc5328b；只實作後端管理，不啟用 Query-only 播放。917、916 均未執行，本次無 Migration 變更、共用資料庫連線或部署。

## 隔離與前置條件

`DASHBOARD_QUERY_SOURCE_MANAGEMENT` 預設 false。啟用前需在隔離 SQL Server 2019 驗證並經批准安裝 917；API 檢查新欄位、計算狀態及 enabled/trusted FK/check，缺少時回 503 `QUERY_SOURCE_SCHEMA_REQUIRED`，沒有舊整批儲存 fallback。

旗標為 true 時，該程序的所有舊來源、版面與主設定寫入及額外 Dataset 預覽均拒絕；應先用舊 API 停用要管理的 Dashboard，再切換旗標。首次成功更改將主來源 `QuerySourceMaxRows` 設為 1000（既有值保留），作為持久化管理隔離標記。即使關閉旗標，帶標記或已綁 Query 的看板仍禁止上述舊操作與重新啟用，不自動降級。此階段新 API 只寫入已停用的看板；虛擬 PRIMARY 為唯讀投影，不能修改主 Query 或啟用看板。

所有節點必須部署同一版本、使用一致旗標，切換前停止舊版程序的配置寫入；舊 binary 不會識別此隔離標記，不能與新 API 並行。不得為使用新管理而在尚未完成後續播放安全檢查前重新啟用看板。播放器／Query runtime／前端程式均未修改；對舊額外 preview 的拒絕只是防止繞過新管理隔離。

## 契約

既有 JWT、TokenVersion 驗證後，另要求 `DESIGN_QUERY`，主 Query 及所有已綁定來源必須通過既有 role/user Query ACL 的 canView **與** canExecute，沒有管理者 ACL bypass。

- `GET /api/dashboards/:id/query-sources/v1`：回 version、虛擬 PRIMARY、來源中繼資料、pending 狀態、overCapacity、`playbackEnabled:false`。不回 SQL、Dataset 資訊或保存的參數值；pending 不代表已授權。
- `PATCH /api/dashboards/:id/query-sources/v1`：body 僅接受 `expectedVersion`、`upserts`、`removals`。省略的來源保留，不代表刪除。
- upsert：`id`（新增 null、現有必須原 Id）、`sourceKey`、`queryDefinitionId`、`parameters`、`refreshSeconds`（5–3600）、`pageSize`（1–100）、`pageSeconds`（5–3600）、`maxRows`（1–10000）、`isEnabled`。不接受 DatasetId、SQL 或未知欄位。
- removal：原 `id` 與精確 `sourceKey`。禁止 PRIMARY、重複／大小寫碰撞、重新命名或刪除任何 profile 的 FIELD/TABLE 正在引用的來源。

總數最多 8（含 PRIMARY、停用及 pending）；過量舊設定可以讀，資料不被自動刪除，管理者須明確移除未引用來源以達到上限。pending 轉換須明確選 Query 且其現行 DatasetId 與歷史 DatasetId 一致，否則拒絕，不猜測候選。已綁來源後續明確換 Query 可使用不同 Dataset，但保留歷史 DatasetId；新來源的 DatasetId 只由已授權 Query 推導。

## 交易、安全與版本

SERIALIZABLE transaction 內按 Dashboard → sources → profiles/widgets 鎖定；舊來源、版面與主設定寫入也先使用相同 Dashboard 鎖及隔離檢查。版本是主設定、來源設定與引用的 SHA-256 指紋；客戶端需用最新 GET version，過期回 409。相同 SourceKey 僅更新變更欄位並增加 binding revision，保留 Id／DatasetId／Key；無變更不寫入。只 INSERT 真正新來源、只 DELETE 明確且未引用的 Id。

發布、啟用、封存、ACL、資料來源與必要參數都在同一交易內驗證，使用既有參數解析與 coercion；不建立查詢或呼叫執行 adapter。參數分類只回固定代碼，不回參數名／值或原始錯誤。任一驗證或稽核失敗整筆回滾；成功稽核沿用 `AuditLog`，只存 dashboardId、SourceKey、QueryId 與操作類型，不存 Bind、SQL 或參數值。回應保留 Request ID，no-store；未知儲存錯誤回通用 503，不反射 driver 訊息。

主要錯誤：404 `QUERY_SOURCE_MANAGEMENT_DISABLED`；503 Schema／儲存不可用；403 Query ACL；400 必要參數／輸入／容量；409 版本衝突、引用保護、Query 無效、Dataset 轉換不符、legacy key 問題或看板仍啟用。

## 驗證與後續

Mock 測試包含實際 service、HTTP 邊界及 repository 的 Mock SQL driver／交易／ACL／稽核依賴；不是 SQL Server 編譯或真實鎖競爭驗收。需在隔離 SQL Server 驗證 917 的 metadata、交易鎖順序與並發、死鎖／rollback、異常 JSON、時間戳及不同 collation。

後續才處理 PRIMARY 編輯、保存參數的安全讀取介面、來源個別錯誤與權限狀態、Query-only 執行及快照版本、播放器與編輯器整合、轉換後正式啟用／回退流程。目前不提供解除隔離標記的 API，不可用 SQL 手動清標記來繞過安全檢查。

## 修改檔案

- 新增 `dashboardQuerySources.{schema,service,repository,routes,test}.ts`、`dashboardSourceWriteGuard.ts`（`server/src/modules/dashboard/`）及本文件。
- `server/src/config/env.ts`：預設關閉能力旗標。
- Dashboard 既有 `dashboard.routes.ts`、`dashboard.repository.ts`、`dashboardDataSource.repository.ts`、`dashboardLayout.repository.ts`：掛載契約及舊寫入／預覽隔離。
- Query Definition `queryDefinition.repository.ts`、Dataset `dataset.repository.ts`／`parameter.repository.ts`、Audit `audit.repository.ts`：既有讀取／稽核支援可選 transaction，預設路徑維持原行為。

驗證：新增 23 項加受影響回歸 69 項，共 92 通過、0 失敗；後端 TypeScript 型別檢查與 build 通過。不重跑無關前端或工作站測試。
