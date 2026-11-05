# Slice 3B-1：來源管理與視覺化編排

基準 `6b6e604200cac81934933bc0e384018b357b1fda`；沿用 React 編輯器、Query ACL、JWT/TokenVersion、917/918 與既有播放契約。能力旗標預設值不變，未連接共用 SQL Server、建立／修改／執行 Migration、部署或合併。

## 介面與操作

既有 Dashboard 頁整合 Query-only 來源面板，PRIMARY 為虛擬來源，最多七個額外來源。候選取自既有 `/queries` 已發布、可查看清單並篩選 canExecute；因此候選讀取仍須既有 VIEW_QUERY，預覽須 EXECUTE_QUERY。寫入再由後端驗證當前發布、有效性、ACL 與必要參數，不相信候選快取。參數採 JSON 物件，更新秒數、換頁秒數、頁大小、資料量上限及啟用狀態各自保存。

一次只儲存明確編輯來源或明確確認移除的 Id/SourceKey；不批次替換，省略来源保留。既有 key 不可改名；pending 狀態不自動映射 Query。需明確選取 Query，後端仍要求初次轉換與歷史 Dataset 相容。無法安全讀取參數時顯示提示，使用者須明確填寫完整替換設定，未儲存前原資料不變。版本衝突保留目前草稿，不自動取新 version 重送。所有錯誤僅顯示安全分類，不反射 SQL／Bind／driver 訊息。

Query-only 啟用時禁止編輯，面板提供確認後呼叫既有模式停用 API 的安全停用操作，會使相關憑證失效。Legacy 啟用看板沿用原安全停用流程，之後才能轉換。首次轉換後舊主設定／來源／版面寫入保護不解除；PRIMARY 使用新契約，版面使用新版本契約。一般名稱／標題等舊主設定表單仍受既有保護，不提供繞過入口。此批不新增啟用或裝置憑證簽發 UI，不自動啟用播放。

## 最小後端補充

全部置於既有能力旗標、JWT/TokenVersion、DESIGN_QUERY、no-store、Request ID 與安全錯誤邊界：

- `GET /dashboards/:id/query-sources/v1/configuration`：可編輯狀態、持久模式、version 與個別來源錯誤。獨立驗證各 Query；只有已通過 ACL 的參數才可讀。參數本身驗證失敗可回設定供修正；未授權、無效 Query 及 pending 不回其保存參數。PRIMARY 不回伺服器遮蔽／快照保留項。SQL 交易內查詢依序執行。
- `PATCH /dashboards/:id/query-sources/v1/primary`：expectedVersion、QueryId、參數、刷新／分頁與 maxRows。拒絕啟用／QUERY_ONLY、過期版本、未知欄位及伺服器保留參數。只更新 PRIMARY 欄位，保留原 deviceColumnMasks/deviceColumnTypes/snapshotKind/snapshotSeconds、所有額外來源歷史與關聯。
- `PUT /dashboards/:id/query-sources/v1/layout`：expectedVersion 與原 profiles/widgets 格式。交易內驗證停用、容量、Query ACL／必要參數、無 pending、元件引用、邊界及單一預設版型。共用原版面寫入 helper，不更動來源列；沿用原版面 profile/widget 重新建立行為及儲存格式，不承諾其數字 Id 不變，SourceKey 綁定保留。來源 Id/歷史 DatasetId 保持不變。

新契約使用同一 SERIALIZABLE transaction/Dashboard 鎖，Schema 917 未安裝即安全拒絕。PRIMARY、版面保存與 mandatory audit 同交易回滾；稽核只記錄看板／Query／SourceKey／操作，不記參數或固定文字。opaque version 新增完整版面指紋，涵蓋空 profile、固定文字、座標、尺寸、格式、排序及樣式，避免僅引用未改或時間戳毫秒相同時漏掉衝突。既有管理／模式 API 都使用相同 state/version。

## 畫布與呈現

沿用既有拖曳、X/Y/大小、TEXT/FIELD/TABLE、橫式1920×1080、直式1080×1920與自訂解析度。補元件排序輸入與編輯畫布排序；固定科別／醫師／手術室／标题用 TEXT，可混排動態欄位。保留原 refresh/pageSeconds 及 config，不重新設計樣式。

修正尺寸觀察器在非同步畫布出現後重新綁定，FIT 依實際可視區縮放，CUSTOM 保留既有加減縮放。Query-only 使用畫布預覽；既有獨立視窗預覽尚未接入新契約，對新模式停用該按鈕，不退回 Dataset。PRIMARY 或額外預覽失败仍載入保存版面與固定文字；新契約 Schema/讀取失敗不轉為舊版寫入。僅能力明確關閉才沿用 legacy 版面契約，後端原有持久隔離保護仍生效。

FIELD displayFormat 與 TABLE columnFormats 支援原文字、數字千分位、日期及 UTC 日期時間，原設定預設文字相容。編輯器與播放器共用格式函式；只格式化伺服器已授權且已遮蔽的值，遮蔽文字不重建。元件遮蔽只能增加保護；真正患者資料遮蔽、欄位授權與揭露稽核仍由後端執行。播放器只增加已遮蔽值的格式呈現與額外顯示遮蔽，未更動認證、播放路由、錯誤隔離或 Token 儲存。

## 檔案與驗證

前端：DashboardDataSourcesEditor、DashboardLayoutDesignerPage、DashboardDisplayPage；新增 dashboard/querySourceManagement、displayFormat 及其單元測試、e2e/dashboard-management.spec.ts。
後端：dashboardQuerySources service/repository/routes/test、dashboardLayout.repository、dashboard.routes；抽出共用 dashboardLayout.schema。沒有 Migration 變更。

受影響後端 Mock／HTTP／單元共 118 項通過（source management 29、mode／execution／widget／masking／device page 89）；前端單元 16 項；Chromium 編輯器2項、既有播放安全10項，共12項通過，無未修復失敗。前後端 TypeScript 與 build 通過；Vite 保留既有大於500 kB chunk警告。測試僅合成資料／Mock driver，未驗收真實 SQL Server／裝置。

待本機：隔離 SQL Server 2019 的917/918 Schema、LEFT JOIN 指紋／交易鎖／版面保存回滾、並行配置／撤權、真實 Query 參數與遮蔽／揭露稽核；Windows/Android/iOS 實機畫布與播放格式。不得因 Mock 通過宣稱正式啟用。

3B-2：完整手動模式啟用與安全憑證簽發 UI／導引、無人值守重啟與憑證交付（不得回到 localStorage 長期 Token）、撤銷／輪替／到期與工作站失效後的恢復策略、多節點安全狀態與實機驗收；不得把當前管理標記或 IsActive 當成安全啟用證據。
