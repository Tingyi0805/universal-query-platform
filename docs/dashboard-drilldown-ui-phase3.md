# Dashboard JWT Drill-down：第三階段互動 UI

基準 `41c2ffc18c3141b1ea9cb32a127eb5cd967a8a8f`。沿用[第二階段契約](dashboard-drilldown-jwt-phase2.md)；僅修改 Client 與本文件，沒有 Server、SQL、Migration、CI 或環境設定變更。

## 管理員設定

四頁籤的「版面設計」選取 PRIMARY TABLE 後提供下鑽設定；根 Query 取已保存 Dashboard PRIMARY。從 `/queries` 既有可執行清單選下一層，透過既有 `/queries/:id` 授權 metadata 取得欄位及參數；不執行 Query 來猜欄位。參數名稱與型別固定取後端 metadata，父欄位使用選單，不提供 SQL、自由 Query ID 或患者值輸入。

可依父節點逐層加入 ROW／COLUMN、PAGE／PANEL／MODAL 及完整參數對應；每層可選不同已授權 Query。Graph 存在同一個 profile.config.interactiveDrilldown；所選 TABLE 用非機密 `config.drilldownRoot=true` 作入口，其餘元件取消此標記。每個 profile 只容許一個 PRIMARY TABLE 入口，與現有 profile 層 Graph 契約一致；額外來源 TABLE 不宣稱支援互動 root。

設定加入同一份版型草稿，保留既有 ConfigJson namespaces。沿用完整 `expectedVersion` 的版本化 layout PUT；不另建儲存 API、不自動保存／重試。尚未完成的新增設定阻止儲存，循環、失效引用、深度、缺 mapping 等先作保守結構檢查；前端檢查不代表安全核准，是否已發布、ACL、實際未遮蔽欄位及參數型別仍由第二階段後端保存與交付驗證。metadata 未提供欄位時不猜測；不可把可見的遮蔽欄位當成可綁定鍵。衝突保留草稿、使版本失效並要求明確重載。

目前設計器提供逐層新增與確認後清除整個 Graph；複雜圖形視覺化、單條邊重構、共用 server-only 隱藏患者鍵不在本次介面範圍。

## 個人使用者互動

只有個人 Dashboard display route、個人登入且具有 VIEW_QUERY／EXECUTE_QUERY、已保存的 PRIMARY TABLE 入口才顯示「開啟互動表格」。Device route、Query-only 設計預覽及 previewKey 均不提供入口。UI 隱藏不是權限控制；全部資料仍由既有 JWT-only API 驗證。後端 Runtime 維持預設關閉，UI 不會變更伺服器開關。

播放頁資料沒有可信 rowRef，因此點入口重新 POST Context，取得完成授權／遮蔽／Audit 的根層表格；絕不以播放 row index、欄位值或瀏覽器拼出的患者識別值替代 rowRef。ROW 支援點列、鍵盤 Enter／Space 及明確整列操作按鈕；COLUMN 只在後端 action 指定的欄位提供明細按鈕。多個 ROW action 由具名按鈕選擇，不偷偷選第一個。

導航只 POST `{edge,rowRef}`；Back 只 POST `{}`，返回主層逐次呼叫 Back 並重新稽核，不重放舊患者結果。只保留目前一層資料，階層導覽只保留非患者的層級／呈現方式。PAGE 為同 SPA 全畫面，PANEL 為側邊，MODAL 為置中；均用原生 dialog 管理焦點與背景隔離，Escape／關閉清 Context，返回入口焦點。沒有匯出、HTML 執行或患者 URL。

## 清除與晚回應

- 登出、登入嘗試／身份切換、JWT 失效先發出同步互動清除事件；Host 清除畫面、rowRefs、階層及 Context，使用原 JWT 發出 best-effort DELETE，再由原 AuthProvider 改變登入狀態。互動畫面提供「登出並清除互動」。
- JWT exp、後端 Context expiresAtUtc 到期、頁面 hidden、pagehide、元件卸載、Dashboard／profile／身份變更均清除；不自動恢復資料或重建 Context。
- 每次 Navigate／Back 先移除舊結果，只有本代、仍掛載且頁面可見的合法回應才能顯示。API 失敗包含 Audit／必要患者揭露稽核失敗、撤權、過期及版本變更，一律清資料，安全通用錯誤不回顯 driver 訊息。
- 對晚到的 Create 回應，保留讀取其 opaque Context ID 的能力並另發 DELETE；不因 abort 而丟掉新 Context ID 後再恢復畫面。已清除的 Navigate 回應亦不能復活資料。相同 Context 重複 DELETE 的失敗不重試。
- 患者結果、mapping 值、rowRef、Context 不寫入 URL、localStorage、sessionStorage、跨視窗訊息或下載。原系統 JWT session 格式維持不變；opaque ref 僅在記憶體使用。
- DELETE 是 best effort；網路中斷、硬關瀏覽器、程序被終止時不能保證送達，後端固定120秒TTL及清理仍是必要防線。沒有新增伺服器 logout／TokenVersion 撤銷端點，不能宣稱 UI logout 等同全域 JWT 撤銷。PIN／工作站 session 不在此階段。

## 修改檔案

- 新增 `DashboardDrilldownEditor.tsx`、`DashboardDrilldownHost.tsx`、`DashboardDrilldown.css`。
- 新增 Client `dashboard/drilldown.ts`（DTO／保守驗證）與四個 unit；新增兩份 Browser spec。
- `DashboardLayoutDesignerPage.tsx`：TABLE 設定入口、完整草稿保存前檢查；原四頁籤架構不變。
- `DashboardDisplayPage.tsx`：僅個人 JWT PRIMARY TABLE 的 opt-in 互動入口。
- `AuthContext.tsx`：同步清除事件；原登入／登出與 storage 契約不變。
- `api/client.ts`：可選的請求身份生命週期判斷，只控制舊身份錯誤是否觸發全域登出通知；HTTP 失敗仍一律 throw。其他呼叫預設行為不變，沒有放寬授權或資料交付。Host 已銷毀身份的晚到401不能登出新使用者。

## 驗收與阻斷

本機 Client unit 79／79（新增4項）、Client Typecheck／Build通過；Server既有Drill-down與QueryDelivery安全專項114／114。Browser主回歸210／210（含當時新增23項）通過，涵蓋四頁籤、LIVE PREVIEW、版型、裝置生命週期、Token／BAT、播放、遮蔽及互動。最後補上舊身份晚到401專項，新增UI案例共24項，並重跑受影響的登入／互動／播放專項74項：73項首跑通過，1項因fixture缺少登入頁public-branding回應而逾時，補齊後與JWT撤銷、真實登出、晚到Context清除共4／4重驗通過。未因fixture問題修改功能程式，不將重疊案例加總當成不同測試。

本機 Node v24.19.0、Chromium；沒有重建Windows Node24.22.1交付包。Browser使用合成資料、mock API，並非真資料來源／正式 SQL 的端到端驗收。

CI：**BLOCKED**，延續第二階段。CI workflow 與跳過規則完全不變；推送 Draft 分支後取消本次自動工作流程，避免未核准的 SQL／Staging 封裝，不把取消當成 PASS。不製作或核准正式更新包。

第四階段仍需：

1. 核准可執行的 CI／隔離驗收與封裝範圍，取得完整成功結果；本次不新增例外。
2. 真後端／合成資料端到端驗證 Graph 保存、rowRef、逐層授權、遮蔽與 Audit 交易，及登入／hidden／硬關閉場景；不能以 Browser mock 取代。
3. 審查正式單 Node 程序／單副本拓撲及啟用條件、TTL、容量與 best-effort DELETE／logout 界線。多節點仍不得啟用，sticky routing 不等於共享 Context；維持預設關閉。
4. Windows／Android／iOS／iPadOS 實機觸控與輔助工具驗收；本機 Chromium 測試不等於全平台正式簽核。
5. OR_001 可信患者 ID 與受控 metadata 仍 **BLOCKED_BY_DATA_OWNER**，不得以姓名或床號代替。PIN、真正圖表、正式部署均另案。

本階段完成後停止，不操作正式 C:\UQP、不連正式 SQL、不執行 Migration 926、不合併 PR #83。
