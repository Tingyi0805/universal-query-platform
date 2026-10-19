# Dashboard 遮蔽與設定整合

基準 cffb71bb1a029281ad6116929a2552a354c505a5。僅修改輸出邊界、前端設定／預覽與 Mock 測試；沒有 Schema、Migration、.env、共用資料庫、部署或模式啟用異動。讀取確認三個 Query-only 旗標均 false。

## 根因與修正

- Legacy PRIMARY 預覽直接回傳 Dataset 原始結果且標記 masked:false；額外來源雖遮蔽，未要求非空結果具患者稽核，也未在 SQL／稽核後重查政策／授權。現在兩條預覽共用可注入 Mock 的 router，執行前、SQL 後、稽核後確認目前 JWT TokenVersion、EXECUTE_QUERY、Query canView/canExecute／發布狀態及 Dashboard／來源／Dataset 政策指紋。DESIGN_QUERY 不替代 Query ACL；Legacy 額外來源另需 DESIGN_QUERY。
- Legacy PRIMARY 先採 Dashboard 明確 allowlist，再強制 Dataset 最低遮蔽；額外來源只回 Dataset 唯一、明確核准且遮蔽的欄位。不回 OMIT、未核准欄位或私有 parameters。不使用原始結果快取／fallback；非空結果須先完成患者揭露稽核，原始識別只在後端供既有稽核使用。
- 裝置及 Query-only 既有遮蔽增加一致的政策結構、版本、唯一欄位、模式／分類及 CUSTOM 驗證。政策讀取失敗／衝突拒絕；版本 0 且空規則不能猜測為非敏感，回 POLICY_REQUIRED。版本 >0 的已審查空政策仍須明確 Dashboard 核准才可由 Legacy PRIMARY 傳送。
- Query-only PRIMARY 原先忽略已保存的 Dashboard 額外遮蔽；現在 binding 讀取原 masks/types，僅加強 Dataset 核准欄位或 OMIT，不新增欄位、不影響額外來源。這些政策納入快照指紋；模式、委派者 ACL／TokenVersion、裝置撤銷保護不變。
- 清單背景失敗及 Legacy designer PRIMARY 失敗曾保留舊結果。現在失敗清除來源值，不用舊資料備援；整體 JWT 失效停止預覽，來源個別失敗保留其他安全來源。版面拒絕遲到回應並保留保存版面／固定文字。
- 版面「部分來源失敗」改列 PRIMARY／SourceKey 與安全錯誤碼，不反射 driver 訊息、SQL、Bind、Token、患者值。
- 內部遮蔽鍵曾混入預設參數 JSON，範例按鈕可整批取代規則。現在分開顯示參數表單、Dataset 最低政策、Dashboard 核准／加強規則及播放設定。欄位取自 metadata／原規則，不須原始患者值。不同部分遮蔽不可推定等價，只能維持或改 FULL／OMIT。進階參數 JSON 保留陣列、物件及未知合法參數；遮蔽 JSON 唯讀保留，不自動刪除或重新命名。

## 資料輸出盤點（Mock／合成資料）

| API／用途 | 保護及驗證 |
| --- | --- |
| Legacy `/:id/preview`：清單、版面、JWT 視窗 | Dataset 最低遮蔽、Dashboard allowlist、Query ACL／TokenVersion 再查、政策指紋、mandatory audit；實際 HTTP response 無原始合成姓名／病歷號 |
| Legacy `/:id/data-sources/:key/preview` | Dataset 核准且遮蔽欄位；拒絕政策／稽核／授權失敗；個別來源不污染 PRIMARY |
| Legacy `/device/:id/preview` | 維持 410，不回完整結果、沒有 fallback |
| Legacy `/device/:id/page` | 原裝置授權、Dataset 最低遮蔽、Dashboard allowlist、分頁稽核及政策／快照／裝置再驗證 |
| Legacy `/device/:id/data-sources/:key/page` | Dataset allowlist、元件引用、獨立分頁／快照、遮蔽及 mandatory audit |
| Query-only `/:id/query-sources/v1/:key/page`（含 PRIMARY） | 原 JWT／ACL／Schema／模式／來源版本檢查，Dataset allowlist、政策驗證、錯誤隔離、稽核；PRIMARY 可加強遮蔽 |
| Query-only 裝置上述兩條 `/device` page API | 持久模式、憑證與實際委派者 ACL／TokenVersion；同一安全執行器；不使用歷史 DatasetId |

預覽均 no-store。Legacy 綁定保護同時阻止預覽繞回 Query-only。管理設定 API 的資料結構保留。

## 相容性／待隔離或真機驗證

- 原 Dashboard、來源、元件、JSON 與資料库不改；未知／未審查政策保留但可能拒絕預覽／播放，需管理者審查。不得為放行清空敏感規則。
- PRIMARY 預覽不再回私有 parameters，依賴該回應的舊 PARAMETER 元件可能留白，原配置保留；不以未遮蔽 Bind 補回。請確認是否改用固定資訊或另行設計安全契約。
- 未核准 PRIMARY 欄位可能留白；須依 metadata 明確核准並維持 Dataset 最低保護。Dataset CUSTOM 使用後端原規則；未知／舊 Dashboard 不支援的 JSON 不強制轉換，保守阻擋。
- 隔離 SQL Server／Oracle：政策／稽核配置与持久化、競爭版本、SQL／稽核期間撤權與改政策、跨實例快照／憑證及 Adapter 型別。禁止用共用資料庫進行寫入驗證。
- 真機 Windows／Android／iOS：尺寸、橫直向、休眠、重新整理、到期／撤銷後停止播放。尚未實際驗收。

## 本機驗證

後端相關 4 檔共 94 個單元／Mock／HTTP 測試；前端 25 個單元；Chromium Dashboard 25 個（新增遮蔽 6、管理 3、播放 14、模式 2），均通過，最終失敗 0。Client／Server typecheck、build 通過；保留既有 bundle >500kB 提示。CI 以交付 commit 的 run 核對並於最終回報提供，不以基準 commit 的成功替代。

## 修改檔案
- `client/e2e/dashboard-masking.spec.ts`
- `client/src/components/DashboardDataSettingsEditor.tsx`
- `client/src/dashboard/dataSettings.test.ts`
- `client/src/dashboard/dataSettings.ts`
- `client/src/pages/DashboardDesignerPage.tsx`
- `client/src/pages/DashboardDisplayPage.tsx`
- `client/src/pages/DashboardLayoutDesignerPage.tsx`
- `docs/dashboard-masking-settings.md`
- `server/src/modules/dashboard/dashboard.routes.ts`
- `server/src/modules/dashboard/dashboardDeviceMasking.ts`
- `server/src/modules/dashboard/dashboardDevicePage.routes.test.ts`
- `server/src/modules/dashboard/dashboardDevicePage.routes.ts`
- `server/src/modules/dashboard/dashboardPreview.routes.test.ts`
- `server/src/modules/dashboard/dashboardPreview.routes.ts`
- `server/src/modules/dashboard/dashboardQuerySourceExecution.repository.ts`
- `server/src/modules/dashboard/dashboardQuerySourceExecution.test.ts`
- `server/src/modules/dashboard/dashboardQuerySourceExecution.ts`
