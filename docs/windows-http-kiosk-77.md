# Issue #77 — Windows HTTP 固定播放：安全阻斷及落地條件

基準：PR #76 `8d40fadaf4811a37ccbf9641689ece82d8728b72`。本 PR **沒有完成 HTTP 自動恢復播放**，狀態為 **BLOCKED**。沒有要求本階段先建置網站 HTTPS，也沒有新增 Agent、服務、金鑰、資料庫結構或 Migration。既有 HTTPS 安全 Cookie 流程保留。

## 實際問題與本次程式修正

- 現有 `dashboardToken.ts` 只把 Token 留於頁面記憶體；重新整理、關閉及重新開機即消失，這是既有安全界線。`DashboardDisplayPage.tsx` 的持久授權僅用 HTTPS 的 Secure／HttpOnly Cookie。Windows BAT 只是以固定設定檔及已保存多螢幕位置啟動 Edge／Chrome，沒有裝置保管庫或安全通道。
- PR #76 的 HTTP 手動模式以 `X-Dashboard-Device-Token` 傳送裸憑證，頁面 API 回傳患者資料。即使只用內網、Token 不落磁碟或患者欄位已遮蔽，也沒有傳輸機密性／伺服器認證。DPAPI 不會改變這一點。
- 本 PR 將 **HTTP Device 播放整體拒絕**，包含手動輸入，不能以它替代 Issue #77 的安全 Agent。播放頁只顯示 BLOCKED，不提供 Token 欄位、交接或資料請求；API client 在 fetch 前拒絕。原有 HTTP 播放因此會停止，這是刻意的安全行為變更。
- Server 的共用 Device 路徑在所有 layout／preview／page／補充來源／enrollment／restore／forget 前回覆 `426 DASHBOARD_PROTECTED_TRANSPORT_REQUIRED`、`Cache-Control: no-store`，不查詢裝置、不執行 Dataset、不核發 Cookie、不反射 Token。這不可能收回舊客戶端已經送到網路上的明文，因此必須停止舊 HTTP 播放端；也不能保護被中間人置換的 HTTP JS。
- 沿用既有實際 TLS／精確受信任 TLS 終止代理規則，沒有 `agent=1`、DPAPI、localhost、IP 白名單、Origin 或自報加密標頭例外。受信任代理必須移除外來 forwarded headers、自行設定 HTTPS，且限制 API 入口；錯誤代理配置仍屬部署風險。
- 播放網址、BAT 格式、固定 browser profile、多螢幕／座標／大小／全螢幕參數不變。HTTP BAT 改標示「開啟阻斷狀態頁」，不再宣稱可安全手動播放。管理頁既有 30／7 天提醒、安全續期及一次性 Token 複製未改寫；HTTP 視窗交接明確拒絕。HTTPS 的到期、撤銷、IP、Query-only／委派修訂、公共政策、遮蔽及患者 Audit 原路徑繼續驗證。

此限制只覆蓋 Device 播放；**不是全站 HTTP 管理／登入安全修補**。管理者登入或核發 Token 也不可經未保護網路交付。HTTP 網站及既有 API 不能被宣稱具備 HTTPS 等級安全。

## DPAPI 評估：已測與未完成

`tools/test-uqp-kiosk-dpapi.ps1` 僅為 Windows PowerShell 5.1 的離線可行性回歸：隨機合成 bytes 使用 `ProtectedData`／`CurrentUser`，只寫密文、非秘密 context 與 digest；另一個 PowerShell 程序可解密；錯誤 origin/device context 與竄改密文必須失敗。測試不接受任何實際 Token，不安裝服務，不讀寫 C:\UQP，不代表已交付保管庫。

- CurrentUser 可在同一 Windows 帳號／設定檔恢復，但同帳號其他程式可呼叫 DPAPI。可選 entropy 不是權限機制；測試 context binding 不能證明本機呼叫者或裝置受信任。
- LocalMachine 讓同機其他帳號也有解密可能，不能單靠它宣稱裝置隔離；本 PR 沒有採用。
- 程序重啟測試不是登出、冷開機、換帳號／網域設定檔或原生 DPAPI master key 復原驗收。未測不同 Windows 帳號、ACL、簽章及安裝身分。

## 可行但尚未交付的 HTTP-first 架構

HTTP 外層可以承載受認證的內層加密通道，但 **HTTP 載入的網頁不能取得內層金鑰或接收解密後患者資料**。候選方向是簽章的 Windows 原生受管理播放端，從受信任安裝來源提供固定 UI，以 DPAPI CurrentUser 配合專用低權限互動式帳號與嚴格檔案 ACL 保管裝置註冊；透過既有公開連接埠上的隧道使用成熟 TLS 1.3 實作及事先可信佈署的伺服器 pin／裝置信任材料。網站仍可維持 HTTP；本 PR 沒有實作此隧道或要求建置網站 HTTPS。

原生端應在程序內顯示可信 UI；可評估 WebView2 的封裝靜態資源／程序綁定訊息，避免開放 localhost HTTP 代理。若必須繼續使用獨立 Edge／Chrome，須另外證明指定視窗／本機 IPC 身分綁定、Host／Origin／DNS rebinding 防護、跨來源與同使用者未授權程式隔離；不能讓任意 HTTP 頁面讀取本機代理的已解密結果。既有 BAT 的 Edge／Chrome 選項不能被冒稱已適用原生端。

必須先完成以下交付及獨立安全審查，才能啟用 HTTP-first 恢復功能：

| 阻斷項目 | 必需證據 |
| --- | --- |
| 簽章與可信首次註冊 | 受信任發行者憑證、簽章安裝／更新／回復、離線可信 pin 佈署；不得 TOFU 信任 HTTP 傳回的公鑰，也不得用 HTTP 傳裸 Token 註冊 |
| 經驗證加密通道 | 標準成熟協定、雙向身分／裝置／origin 綁定、fresh challenge、重播／降級／憑證替換拒絕、認證後資料與控制訊息一律受保護；不能自行拼湊 AES 換取安全宣稱 |
| Windows 播放端與本機隔離 | 專用帳號、ACL／reparse-point 防護、只允許指定程序／視窗、安全 UI、可回復簽章升級；無公開新增 port／任意 loopback proxy |
| Server 可撤銷授權整合 | 沿用既有裝置雜湊／修訂及逐次資料交付檢查，不新造授權捷徑；裝置與註冊分別到期，續期不得自動延長註冊／重新核發 |
| 失敗關閉 | 到期、撤銷、IP／委派／Query-only／政策變更、Audit 寫入失敗、斷線／解密錯誤立即清除已顯示資料，重啟不復活舊快照 |
| 實機與審查 | 對抗測試、獨立協定審查、Windows 冷開機／多螢幕及指定瀏覽器、受限測試資料庫的逐次 Audit 證據 |

目前沒有可信發行者／裝置信任材料、已實作通道或獨立審查證據。不能把未簽章 PowerShell 腳本加上 DPAPI 當作已完成 Agent，也不能新增切換旗標開放裸 HTTP。未準備資料庫 SQL，因本次不需要結構變更；未執行 Migration。

## 分離 Windows 驗收及回復

1. 依 PR #76 的 `windows-dependency-repair-75.md`，在**另一路徑**乾淨 checkout 本 Draft Commit，使用 Node 24.15.0／npm 12.2.1、兩端 `npm ci`。保留 LF 原始位元組。不要複製舊 node_modules、金鑰或正式設定到 CI 測試。
2. 執行 Server／Client tests、typecheck、build；PowerShell 5.1 執行 `tools/test-uqp-kiosk-launcher.ps1` 與 `tools/test-uqp-kiosk-dpapi.ps1`。後者只使用 Windows TEMP 下隨機命名的合成密文檔並清理。
3. Client 安裝測試 Chromium，執行 `npx playwright test dashboard-http-expiry.spec.ts dashboard-kiosk.spec.ts dashboard-playback.spec.ts`。本機需 OpenSSL 以產生合成 API 的短期測試憑證；忽略該憑證只限測試 Context。Windows CI 另外用已安裝 Edge／Chrome 檢查 HTTP 真實 browser process/profile 重啟後仍阻斷。
4. 下載 HTTP BAT，在隔離 Windows 環境驗證保存的位置／螢幕選項及 BLOCKED 頁；F5、關閉重開、登出／重新開機後仍不得要求或自動傳送 Token。這是**安全拒絕驗收，不是自動恢復成功**。目前不適合患者資料 HTTP 部署。
5. 既有 HTTPS 測試另驗證首次註冊、同設定檔真實瀏覽器重啟、撤銷／到期／政策／Audit 拒絕清除、到期提醒與續期。沒有執行正式資料庫或使用者實機驗收。
6. 回復僅限隔離驗收目錄切回已驗證的完整應用程式快照；不改資料庫／金鑰。若回復 PR #76，**不可恢復未保護 HTTP 患者播放**，必須保持該播放端停用。此 PR 不安裝或解除任何服務／排程，也不操作正式目錄。

PASS 只表示已完成的阻斷、DPAPI 可行性及既有功能回歸；Issue #77 的無人值守 HTTP 播放與 Windows 冷開機恢復仍為 BLOCKED。網站 HTTPS 延後不改變這個結論。
