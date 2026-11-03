# D6-3 第二輪：Issue #85、#86

基準 `a9140110544e4607b557291aba80ac7e0c2a79c7`，PR #83 維持 Draft。兩張 Issue 全文及留言（皆無）已讀。採信使用者已部署 a914011、首次核發／BAT Enrollment／播放、8/8 預檢及 20 秒換頁 PASS；不重做正式 925／926、Ledger、備份或 Node 驗證，不連正式 DB、不操作 C:\UQP／.env。

## #86：持久證據與管理流程

- **原因已確認**：D1 `deviceLifecycleState` 的 ACTIVE 必須有既有播放安全檢查提供的 live Token proof；D4-C1 SQL 清單沒有 Cookie、來源 IP、工作站及 live session/ACL 證據，因此非終止／暫停／過期／pending 的裝置仍為 UNVERIFIED。清單沒有程式錯把 ACTIVE 改成 UNVERIFIED 的分支，不能僅從 BAT 有畫面推定 ACTIVE。
- **DONE**：管理完整快照額外投影 `enrollmentState`：NULL marker＋NULL grants 為 NOT_ISSUED；true＋grants尚未核發為 PENDING_CREDENTIAL，核發後為 PENDING_ENROLLMENT；false＋正整數 grant pair 為 ENROLLED；其他為 UNKNOWN。終止、到期、暫停優先呈現，不由 marker 復活。ENROLLED 只表示926持久 marker，**不是 Cookie 仍存在、grant 仍有效或當前可播放的證明**。
- **DONE**：新增 `GET /api/dashboards/:id/device-management/v1/:deviceId/authorization-evidence`，no-store、沿用 live JWT／TokenVersion、DESIGN_QUERY、Dashboard/device scope 及 lifecycle/schema attestation；與安全管理讀取相同，不要求 EXECUTE_QUERY，不增加寫入權限或執行患者 Query。只回傳當前查詢時間、持久 Enrollment、儲存 grant 與 Dashboard mode version 的相符性、既有終止/期限標記及固定 `playbackAuthority=NOT_VERIFIED`。明列未驗證的 Cookie、來源 IP、工作站、委派者 session/ACL、逐頁遮蔽／患者稽核，不回傳 Token、Hash、Credential、Cookie 或 Audit JSON。此回應不可替代完整 expectedVersion 或播放授權。
- **DONE**：在原管理區整合六步引導；建立／保存後選定裝置並顯示已保存設定、播放位置、Query-only 啟用及 Enrollment 進度；連到原預檢／啟用與唯一版本化核發／網址／BAT 入口。每一步仍由原 API 獨立確認與 CAS，409明確重載，不自動重核、重送或啟用。
- **DONE**：尚未核發及版本化生命週期裝置不再顯示重複舊核發按鈕。只有完整快照證明 NULL marker＋既有正整數 grant pair 的 Legacy 裝置才顯示明確標示的相容區，未載入／證據不足即隱藏；既有 ACK、一次性交接保留。`VERSIONED_API_REQUIRED` 改為前往版本化入口／重載的提示，禁止建議因錯誤而重核 Token。
- **DONE**：搜尋標示「輸入純數字 ID」；不修改搜尋 API。管理操作表於1280px以下改卡片排列、保留欄位標籤、間距及觸控操作，避免不必要水平捲動。播放位置／Audit入口保留。
- **待人工驗收**：正式 Dashboard #3／實際裝置的 readonly evidence 結果與原 BAT Cookie/IP/工作站狀態。本輪只確認 Repository 契約與合成測試，不宣稱已讀取該正式資料列或已通過 Windows／Android／iOS 實機驗收。ENROLLED 管理顯示不會把 ACTIVE 空篩選補值。

## #85：刷新與後端交付時間

- **DONE**：LIVE PREVIEW 保留成功結果至新請求完成，20秒換頁時計保持獨立；裝置／使用者播放在新頁請求中保留仍有效的已交付頁與其頁碼，不以暫時空陣列顯示假零筆。真正零筆顯示「目前無符合條件資料」，未交付顯示更新中；失敗清除受影響內容，沿用原授權撤銷／遮蔽／Audit失敗全域或來源隔離規則，絕不回退舊未遮蔽 API。
- **DONE**：管理LIVE PREVIEW及提供snapshot期限的播放端在到期前1秒預取；PRIMARY及額外來源仍有獨立硬到期清除，慢請求不得延長舊資料有效期限。來源時鐘不再被 PRIMARY 刷新重設，20秒換頁及頁次縮減邊界保留。裝置 Cookie lease／IP／安全輪詢原契約不變；Legacy device回應也附原snapshot期限。接收時已過期的回應拒絕顯示，管理預覽掛起刷新／逾期晚到回應另有專項測試，不能以不斷取消請求來延後硬期限。
- **DONE**：成功交付 API 在原最後安全檢查、遮蔽與 Audit 完成後回傳 `deliveredAtUtc`（UTC ISO）；包含共用 Query-only service 及 Legacy device/preview delivery。失敗不回傳成功時間。不以 snapshot 建立時間或瀏覽器時鐘冒充交付時間。
- **DONE**：管理 LIVE PREVIEW 與播放端共用「PRIMARY 最後成功更新」；明確只表示 PRIMARY，而非保證所有額外來源都已更新。固定 Asia/Taipei，缺證據／舊 Server 回應顯示 placeholder。預設右下／時分秒；版型設計可設定四角及日期＋時分秒，沿用原 profile ConfigJson 和版本化 layout 保存，不新增 DB Migration。未設定的舊版型採預設，其他 config 原樣保留。
- **DONE**：播放畫布預留時間條空間；360px觸控、四角、不同行為及美西瀏覽器時區測試，時間不遮擋患者畫布。原播放警告、清除持久授權按鈕與安全停止仍保留。
- **待人工驗收**：實際螢幕／多螢幕的版型位置與文字大小；可一次下載完整新包至 staging 驗收，不需要為每一項重新下載。

## 測試與交付

本機 Server 專項374/374、補充清單/交付專項172/172（含重疊回歸），Client75/75，原相關Browser128/128，加上新流程／四角／刷新／Legacy ACK／硬到期專項通過。Server／Client Typecheck及Build通過。完整 CI、測試總數、Windows Node v24.22.1／ABI137／win32-x64、來源 Commit、Manifest 與逐檔 SHA256 以本次 CI artifact 為準，不沿用前包證據。

正式覆蓋需既有維護核准、停寫與已驗證備份／回復計畫；Server/Client/原生依賴同一manifest，保留.env、業務檔案／資料及Audit，不執行Migration／Installer／Ledger採認。PR不合併。Issue #84 OR_001患者揭露稽核仍 **BLOCKED_BY_DATA_OWNER**（欠可信患者ID及受控metadata初始化），不得以姓名／床號代替或關閉稽核來解除；本輪不是該功能上線核准。
