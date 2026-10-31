# Dashboard Device D4-A — 生命週期管理 UI

基準 HEAD：`2543b953cb8bf79cad9f03bcc56b543f681966ec`。沿用 D1～D3 API、既有裝置管理區、API Client、CSS、確認視窗及設定變更事件；不新增管理頁或後端生命週期實作。

## 管理操作

既有管理區平行讀取一般 metadata 與 `GET /api/dashboards/:id/device-management/v1/lifecycle`，分別保留各自完整版本。一般 Query ACL 讀取被拒絕時，安全快照仍可讓具有 DESIGN_QUERY 的人員暫停、永久撤銷或封存；恢復與核發另要求 EXECUTE_QUERY。UI 權限僅控制操作入口，live session、Query ACL、委派者、工作站、政策、schema 與轉移仍由後端驗證。

暫停、恢復、核發新 Token、永久撤銷、單台封存使用既有 `POST .../:deviceId/{suspend,restore,credential,revoke,archive}`，body 僅 `{ expectedVersion, confirmed:true }`。全部有明確確認；暫停告知舊授權失效，永久撤銷警告原 Token 不可恢復。移除舊 Query-mode DELETE 撤銷按鈕，統一經完整裝置版本撤銷。舊核發流程保留於未進入生命週期管理的裝置，既有後端 unmanaged guard 不變。

寫入成功、失敗、跨區變更或頁面離開均使管理版本失效。使用者須明確重新載入、再次確認；不自動重送、覆寫或把新版本套到舊操作。恢復回應必須仍是 active、無暫停時間且 pending=true，否則拒絕接受。核發回應驗證 Dashboard、Device、版本、pending 與 Token 格式。

## 狀態與一次性 Token

顯示已封存、已撤銷、已到期、已暫停、待重新授權、啟用設定與無法驗證。依 terminal → expiry → suspended → pending 的優先序呈現。管理 API 沒有 live Token／ACL 播放證據，因此啟用設定明確標成「啟用設定／無法驗證播放授權」，不宣稱 ACTIVE 或正常播放；不能以 grant pair 或 IsActive 推測播放授權。

新 Token 僅留在對話框記憶體 ref 與當前可見欄位，不進入 storage、URL、歷史、Audit 或播放交接快取。提供複製與失敗時手動複製說明。關閉、Escape、重新載入、導航、pagehide、到期或設定變更會清除 ref 並同步清空 DOM；晚到的 HTTP／複製結果不能重新顯示 Token。回應遺失也不嘗試讀回或重送核發。

恢復和核發始終顯示待重新授權，說明須使用原 BAT 專用瀏覽器、HTTPS 裝置播放網址及新 Token。播放頁增加明確勾選「使用恢復後的新 Token 重新授權」，選取後只呼叫 D2-B 已存在的 `POST /api/dashboards/device/:id/kiosk/enrollment-proof`，傳送 `{deviceId,token}` 及原 X-UQP-Kiosk header；失敗不自動改走舊 Enrollment 或直接帶 Token 讀取資料。成功後沿用既有 Cookie session 播放流程。未勾選者保留原 Enrollment；HTTP 不提供 proof 選項。未修改 Cookie 格式、後端 Cookie writer、BAT 或 IIS。

## 驗證與界線

Client 單元測試涵蓋狀態優先序、無 live 證據時不猜 ACTIVE、DESIGN_QUERY／EXECUTE_QUERY 入口與確認警告。Browser 專項涵蓋五種版本化操作、取消確認、恢復 pending、Token 複製／關閉／離頁／晚到回應、360px 對話框、schema／錯誤回應、401／403／409／503 不重送，以及 full Query ACL 讀取失敗仍保留止血操作。HTTPS proof Browser 測試驗證明確選擇、成功後才能讀資料、拒絕時不回退、HTTP 不提供 proof；既有 Query-mode 與 metadata／位置／到期提醒／續期回歸保留。

本機 Node 24.19.0、npm 11.9.0，使用既有 lockfile npm ci；執行 Client test（63 個案例，另逐檔直接執行確認）、Typecheck、Build 及受影響 Browser 專項（裝置管理、Query-mode、Enrollment 三檔共 67 案例）。完整平台／Windows／SQL／Browser 結果以本提交的 CI 為準；Browser 合成契約測試不宣稱 Windows 實機 BAT 或正式資料庫驗收。

未修改 Migration 926、後端生命週期、Cookie、BAT、IIS、IP resolver 或正式 C:\UQP／SQL Server。PR #83 保持 Draft、不合併。D4-B 日期時間選擇器、D4-C 搜尋／分頁、D4-D 批次封存均未開始；D4-B 接續現有 UTC ISO 到期欄位的輸入體驗，沿用現有版本與確認契約。
