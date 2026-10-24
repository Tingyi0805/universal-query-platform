# 5B-1 統一 Dashboard 基本管理介面

本階段只整合管理介面；沒有新增 SQL Migration、啟用播放旗標、刪除後端 Legacy API 或修改一般使用者播放入口。既有顯示設定從 configuration 讀取，既有版型不在初始化時寫入。

## 欄位與唯一寫入入口

以下 API 均以 `/api/dashboards` 為前綴。

| 管理項目 | API | 保護／保留原則 |
| --- | --- | --- |
| 建立停用草稿、不可變代碼、初始 Query | `POST /` | 沿用既有建立契約，明確選擇 `/api/queries` 中可執行的 Query；固定 `isActive:false`，不傳核准、參數或 maxRows；建立不等於完成 PRIMARY 轉換 |
| 名稱、說明、顯示模式、標題、時鐘、頁碼、倒數 | `PATCH /:id/query-sources/v1/presentation` | 完整七欄位、expectedVersion；只用後端 configuration 初始化，不用清單的舊值覆蓋 |
| PRIMARY Query、查詢參數、refreshSeconds、pageSeconds、pageSize、maxRows | `PATCH /:id/query-sources/v1/primary` | 唯一後續來源編輯入口；首次轉換確認；後端保留核准及舊快照 reserved keys |
| 額外來源 Query／參數／上述時間及筆數、isEnabled | `PATCH /:id/query-sources/v1` | 明確增量 upserts/removals；保留來源身份與其他來源；引用、Query ACL 及歷史 Dataset 相容性仍由後端檢查 |
| 敏感欄位核准與額外遮蔽 | `PATCH /:id/query-sources/v1/disclosure` | 來源隔離、expectedVersion、Dataset 最低政策；保留 CUSTOM／OMIT，移除需確認；`GET /:id/column-approvals` 僅讀取完整既有核准，不回退舊寫入 |
| Legacy 安全停用 | `GET/POST /:id/legacy-disable/v1` | 操作時先取最新專用版本、確認、僅停用；同交易撤銷憑證及強制稽核 |
| pending 舊核准撤銷 | `GET/POST /:id/query-sources/v1/:sourceKey/pending-approvals` | 最新專用版本、Source ID、明確確認；不猜 Query、不刪來源 |
| Query-only 啟用／停用與裝置授權 | 既有 `/query-mode/v1` 及 `/devices/:deviceId/credential` | 留在既有播放授權區；移除來源區的重複停用按鈕，保留 preflight、JWT、ACL、工作站、憑證撤銷守衛 |
| 版型 | 既有 `PUT /:id/query-sources/v1/layout` | 版面編輯器維持原版本化寫入，不由基本設定建立或覆蓋 |
| 舊 snapshotKind／snapshotSeconds | 本階段無編輯 API | 保留既有值，明示不可編輯；移除只改本地狀態的試算／套用按鈕。Query-only 快照效期仍依既有執行契約，未新增另一套設定 |

管理介面不提供 Dashboard 實體刪除、舊整體 PUT、舊來源 PUT 或舊核准 PATCH。裝置管理中既有撤銷／封存操作與 Dashboard 硬刪除不同，仍保留。

## Legacy 轉換順序

1. 選取 Dashboard；若 Legacy 啟用中，點安全停用，取得專用最新版本後確認。失敗不假報成功，也不改其他設定。
2. 重新載入基本／來源設定。停用後僅可修改新版 API 支援欄位。
3. PRIMARY 尚未轉換時，編輯 PRIMARY，確認 Query、完整參數、時間／分頁及 maxRows，確認首次轉換。後端拒絕不安全綁定或權限不足。
4. pending 額外來源有舊核准時，點「撤銷來源舊核准」。確認專用版本及 Source ID 後撤銷；保留 Source ID、SourceKey、歷史 Dataset、版型引用與歷史稽核。
5. 重新選取該來源，由管理員明確選 Query，再確認轉換。候選清單不預選 Query。後端驗證已發布、啟用、ACL、歷史 Dataset 相容性及引用限制。
6. 轉換成功顯示「敏感欄位需要重新核准」。在核准區重新讀取版本與 Dataset 政策，逐來源明確核准。轉換不自動啟用或核發憑證。
7. 撤銷與換綁是獨立交易。換綁失敗會維持已撤銷狀態；管理員可修正 Query／參數後重新確認，不恢復舊授權。

版本衝突或 API 拒絕會保留草稿並鎖定該寫入。重新載入不自動重送；來源須重新選取確認，基本設定重新載入前提示替換未保存內容。跨分區變更會使基本設定版本失效，避免隱性合併舊草稿。缺少可信版本、Schema、政策或管理能力時禁止寫入，不回落 Legacy。

## 後續 5B-2 與實際驗收

- 一般使用者播放、Legacy 播放入口退役、裝置操作整體導覽與部署開關不在本階段；不可把管理介面整合視為已可全面播放。
- 舊快照用途／秒數若仍有管理需求，先定義與 Query-only 快照效期的單一契約；本階段沒有新增欄位或偽造儲存。
- Windows Server／瀏覽器：用停用的合成測試看板驗證重載、確認取消、跨管理員衝突、既有版型不變、Device Token／PIN、權限撤銷及旗標關閉時的拒絕行為。
- 隔離 SQL Server：驗證 917–919 Schema、真實 RowVersion、交易與 rollback、強制稽核失敗、憑證失效一致性、鎖及 FK／Widget 引用。不得以 Mock、CI 或本機 build 取代此驗收。

## 修改檔案與本機驗證

| 檔案 | 用途 |
| --- | --- |
| `client/src/pages/DashboardDesignerPage.tsx` | 移除舊整體儲存、重複資料設定與硬刪除；組合新版分區；成功變更後背景刷新清單，不重置其他區草稿 |
| `client/src/components/DashboardBasicSettingsEditor.tsx` | 停用草稿建立、可信設定讀取、唯一一般顯示寫入、版本衝突鎖定 |
| `client/src/components/DashboardLegacyDisable.tsx` | 最新專用版本、明確確認、單向停用及拒絕後重新載入 |
| `client/src/components/DashboardDataSourcesEditor.tsx` | PRIMARY／額外來源唯一編輯、pending 核准撤銷／明確轉換、重驗草稿版本、重新核准提示 |
| `client/src/components/DashboardDataSettingsEditor.tsx` | 核准寫入統一 disclosure；完整既有核准只讀；CUSTOM／OMIT／分類及來源隔離保留 |
| `client/src/dashboard/querySourceManagement.ts` | 顯示設定型別、管理版本及來源身份的 fail-closed 讀取檢查 |
| `client/src/dashboard/querySourceManagement.test.ts` | 新增可信版本／來源身份拒絕測試 |
| `client/e2e/dashboard-basic-management.spec.ts` | 新增 12 項基本管理、持久化、轉換與失敗流程瀏覽器測試 |
| `client/e2e/dashboard-management.spec.ts` | 更新確認與衝突後重新載入流程；保留版型及 JWT Query 預覽測試 |
| `client/e2e/dashboard-masking.spec.ts` | 將原管理寫入測試移至新版 API，保留最低遮蔽、CUSTOM／OMIT、分類、撤銷與敏感資料不外洩驗證 |
| `docs/dashboard-unified-management-5b1.md` | 欄位 API、轉換順序、限制及實機驗收說明 |

本機驗證：Server build、typecheck、514 項測試通過；Client build、typecheck、31 項單元測試及完整 68 項 E2E 通過。相較基準新增 1 項單元測試與 12 項 E2E，沒有移除既有測試案例。E2E 使用 Linux Chromium、合成資料及 Mock HTTP；不是 Windows Server 或真實 SQL Server／Oracle 驗收。Client build 的既有 bundle 大小提示不影響成功結果。
