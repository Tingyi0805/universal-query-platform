# Dataset／Dashboard 雙層遮蔽

基準 ec84190c8732c1f144d3f9c655b1c26e03f2e9b7。只處理 Dashboard；一般查詢及 Excel 匯出留待未來階段。未連接資料庫、修改 .env、執行 Migration 或部署；讀取確認三個 Query-only 旗標均 false。

## 根因與契約

前端和 Dashboard 儲存驗證未接受沿用模式；額外來源及部分 Query-only 路徑曾將 Dataset 規則直接當成 Dashboard 核准。因此只補 CUSTOM 選單不足以符合雙層要求。

- Dataset 是第一層最低政策；Dashboard 是第二層明確欄位核准與額外保護。
- `deviceColumnMasks`／`deviceColumnTypes` 保留 PRIMARY 原結構。
- 額外來源使用 Dashboard ParametersJson 內的 `deviceSourceColumnMasks: { SourceKey: { ColumnName: Mode } }`，不新增 Schema。PRIMARY 核准不授予額外來源，同名欄位也不跨來源共用核准。
- 新 Dashboard 模式 `INHERIT` 表示沿用目前 Dataset 規則。CUSTOM 的 prefix、suffix、symbol 只保存在 Dataset，不複製到 Dashboard。
- Dataset CUSTOM 可沿用、FULL、OMIT。其他舊模式不能降低最低政策；不同部分遮蔽保守升為 FULL。
- 歷史 Dashboard `CUSTOM` 保留為沿用 Dataset CUSTOM 的相容別名；Dataset 已改成其他模式或規則不存在時，這個舊別名不再核准傳送。
- Dataset OMIT 一律不傳送；未被 Dashboard 核准、沒有目前唯一 Dataset 規則、欄位已改名／移除或名稱有歧義，一律不傳送。已知非敏感欄位需明確 Dataset `OTHER/NONE`，再由 Dashboard 核准。

所有 Dashboard 輸出共用 `resolveDashboardDisclosureMasks`，再由後端 maskDeviceRows 使用原 Dataset CUSTOM。Legacy PRIMARY／額外來源預覽、清單／版面預覽、Legacy 裝置分頁、Query-only JWT／裝置 PRIMARY／額外來源一致執行。舊完整裝置預覽維持 410。INHERIT 不會直接傳给值遮蔽器作為模糊的部分遮蔽；沒有已解析 Dataset 政策就不傳送。

## 儲存、安全與相容性

- 舊 JSON 不自動刪除、改名或批次轉換。既有較強 Dashboard 保護若要改為沿用，需管理者在前端明確確認，Dataset 最低政策仍由後端強制執行。
- Legacy 使用既有受保護儲存。已轉換 Query-only 看板使用新增 `PATCH /dashboards/:id/query-sources/v1/disclosure`，只儲存明確選取來源的核准；受既有管理旗標、JWT／TokenVersion、DESIGN_QUERY、Query ACL、Schema、停用狀態及 expectedVersion 保護。
- 新契約沿用既有鎖定交易與 primary writer，保留所有其他参数／核准、来源 Id、Query 綁定、歷史 DatasetId、元件；不使用 DELETE／INSERT。稽核必須同交易成功，否則回滾。未轉換来源、啟用看板、模式 QUERY_ONLY、版本衝突拒絕寫入；不解除 Legacy writer guard。
- 新 JSON 鍵由 Dashboard 參數過濾器排除，不當作 Query Bind、不暴露為預覽私有參數。Query／Excel 執行器未修改。
- 快照指紋包含實際來源核准、Query 綁定、Dataset 政策／版本及原認證／ACL／模式版本；政策或核准改變使舊快照失效。重新執行時再套用目前政策；INHERIT 依目前 Dataset 規則，消失或改名的欄位不沿用舊授權。
- 來源別 JSON 缺少核准時，舊額外來源配置仍保存，但不再僅憑 Dataset 規則傳送資料。未定義 Dataset 政策的歷史欄位也保留設定，但留白／不傳送；需管理者審查，不自動猜測非敏感。
- 伺服器患者揭露稽核、工作站、裝置委派者 ACL／撤銷、JWT／TokenVersion 均保留。前端僅以固定合成文字示範 CUSTOM，不決定實際保護。

## 驗證

使用 Mock／合成資料，未使用真實患者。

- 後端 6 個相關測試檔，共 157 個測試通過（含最後新增歧義欄位測試）：合併矩陣、實際 HTTP 預覽／裝置回應、PRIMARY／額外來源、INHERIT／FULL／OMIT、權限撤銷、政策改名、快照失效、版本衝突與稽核回滾。
- 前端單元 26 個通過。
- Chromium Dashboard 27 個通過：遮蔽 8、管理 3、播放 14、模式 2。包含 CUSTOM 核准、儲存後重新進入、舊 JSON 保留、版本化 Query-only 核准／衝突與無 Legacy writer fallback。
- Client／Server typecheck、build 通過；Client 保留既有 bundle 大小提示。最終失敗 0。CI 以交付 commit 核對，最終回報連結。

## 尚待驗證

隔離 SQL Server／Oracle：實際 JSON 持久化、Unicode／欄位大小寫、政策更新与 Query 綁定競爭、稽核失敗回滾、跨實例快照與撤銷。真機：Windows／Android／iOS、休眠、橫直向、重新整理後重新授權。尚未實際驗收，不開啟旗標。非敏感欄位分類的管理操作及一般查詢／Excel 雙層政策另行規劃，不於此批擴大。

## 修改檔案
- `client/e2e/dashboard-masking.spec.ts`
- `client/src/components/DashboardDataSettingsEditor.tsx`
- `client/src/dashboard/dataSettings.test.ts`
- `client/src/dashboard/dataSettings.ts`
- `client/src/pages/DashboardDesignerPage.tsx`
- `docs/dashboard-dual-masking-policy.md`
- `server/src/modules/dashboard/dashboard.routes.ts`
- `server/src/modules/dashboard/dashboardDeviceMasking.test.ts`
- `server/src/modules/dashboard/dashboardDeviceMasking.ts`
- `server/src/modules/dashboard/dashboardDevicePage.routes.test.ts`
- `server/src/modules/dashboard/dashboardDevicePage.routes.ts`
- `server/src/modules/dashboard/dashboardPreview.routes.test.ts`
- `server/src/modules/dashboard/dashboardPreview.routes.ts`
- `server/src/modules/dashboard/dashboardQueryMode.service.ts`
- `server/src/modules/dashboard/dashboardQuerySourceExecution.repository.ts`
- `server/src/modules/dashboard/dashboardQuerySourceExecution.test.ts`
- `server/src/modules/dashboard/dashboardQuerySourceExecution.ts`
- `server/src/modules/dashboard/dashboardQuerySources.routes.ts`
- `server/src/modules/dashboard/dashboardQuerySources.service.ts`
- `server/src/modules/dashboard/dashboardQuerySources.test.ts`
