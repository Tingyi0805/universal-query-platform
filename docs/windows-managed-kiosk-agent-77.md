# Issue #77 — Windows Managed Kiosk Agent

基於 PR #76 `8d40fadaf4811a37ccbf9641689ece82d8728b72`；沒有以 PR #78 為功能基準。此版有可執行的 .NET 10 WinForms／WebView2 Agent、原生安全首次授權、DPAPI 註冊及 Node Server 通道，並非只有 HTTP 拒絕。沒有資料庫結構變更、SQL 或 Migration，沒有修改正式目錄／資料庫。

## 實際播放路徑

Agent 從簽章單一 EXE 內嵌的原有 Client build 顯示 Dashboard；不是載入 HTTP 網頁。WebView2 的固定虛擬來源 `https://uqp-kiosk.invalid` 只由原生程序回應，沒有網站 HTTPS 建置需求、localhost listener、網頁可呼叫的 IPC、Host Object 或 WebMessage bridge。外部導航、子框架、彈窗、下載、權限、外部資源、Service Worker 與 DevTools 被拒絕。這不是供其他 Edge／Chrome 視窗使用的本機 HTTP 代理。

使用 .NET `SocketsHttpHandler`／`SslStream` 與 Node `https` 的 **TLS 1.3 優先／TLS 1.2 限 ECDHE＋AES-GCM、雙向憑證認證**，包在標準 HTTP CONNECT 中。只有不含憑證的 CONNECT 與 200 回應是明文；登入密碼、JWT、Device Token、API 路徑與患者回應全在 TLS 內。未自行設計加密、簽章或金鑰交換。沒有舊 TLS／弱 cipher fallback、redirect、TOFU 或 HTTP Token fallback。

Server 在現有 HTTP API listener 接收固定 `CONNECT uqp-kiosk.internal:443`，把 socket 交給未 listen 的 TLS server；不額外開公開連接埠、不允許任意 CONNECT 目標。CA 驗證、精確 client certificate SHA-256 allowlist、Dashboard／Device／公開 origin／註冊期限皆須相符。Agent 驗證預先可信佈署的 server leaf SHA-256、SAN 名稱、serverAuth EKU 與憑證期限；不靠 HTTP 下載公鑰建立信任。TLS session ticket 關閉、不啟用 0-RTT。每個 HTTP 請求另有隨機 ID、30 秒時間視窗及程序內 65 秒 nonce 重放拒絕；不是跨叢集業務冪等機制。每次請求均重新讀取 allowlist，回應交付前再驗證。

## 一次首次授權及恢復

1. IT 先透過可信離線／既有安全管理通道佈署 PKI 與公開設定，不能從 HTTP 網頁下載後直接信任 pin 或安裝程式。
2. 在指定的**專用標準 Windows 使用者**工作階段開啟 Agent。SYSTEM／管理員帳號不支援；UQP 管理者帳號與 Windows 播放帳號是兩回事。
3. 原生對話框選擇該裝置 PFX、輸入 PFX 密碼及 UQP 管理者帳密，明確確認重新核發。管理者密碼、JWT、原 Token 不會進入 WebView、網址或磁碟明文。
4. 原生端透過 mTLS 呼叫原有 `/auth/login`、Query-mode 版本讀取及 `devices/:id/credential`。沿用既有權限、版本衝突、原子核發與 Audit，不自動啟用 Dashboard、不延長或恢復過期／撤銷裝置。再次授權會讓先前 Token 失效。
5. 成功後以原有 Device Token 驗證 layout／政策，讀取已保存播放位置，再存 DPAPI。首次註冊也必須通過 server 憑證與 client binding，沒有明文 HTTP 手動 Token 註冊路徑。
6. F5、關閉 Agent 視窗後重新執行、相同使用者互動式登入啟動，都會讀取同一 DPAPI record，重新驗證 Server／裝置，不再次要求 Token。這是程式行為；實體冷開機仍須驗收。

DPAPI 使用 CurrentUser；額外 entropy 與 record 綁定 Windows SID／MachineGuid、server pin、endpoint、公開 URL、Dashboard／Device 及配置摘要。Vault 在 `%LOCALAPPDATA%\UQP\ManagedKiosk\<config-digest>`，只有該 SID／SYSTEM DACL，拒絕 reparse point、採原子密文寫入。PFX 以 EphemeralKeySet 載入，PFX 與其密碼、Token 皆只在 DPAPI record；不加入 browser certificate store。首次使用的原始 PFX 檔由 IT 安全交付並依組織程序回收；Agent 不假裝能保證 SSD 安全抹除。

**DPAPI 不隔離同一使用者的惡意程式／系統管理員。** 生產必須是專用低權限帳號，透過 WDAC／AppLocker／端點管理限制可執行程式、瀏覽器擴充、debug／dump、登入與資料匯出；不允許一般工作站任意軟體。沒有宣稱抵抗該帳號／OS 已遭入侵。

本機註冊期限為首次授權時 device expiry、client certificate、server allowlist expiry、365 天的最早者。Dashboard 原有 30／7 天管理提醒、安全續期及 7 天播放提醒保留；延長 Device expiry **不會**延長本機註冊／憑證。到期須管理者明確重新授權，沒有自動核發或隱藏延長。

## 每次患者資料交付

mTLS 邊界先以既有 `checkDashboardDisplayDevice`、Query-only mode／grant／委派版本、`queryExecution.inspect` 驗證；既有 page handlers 再做原本 ACL、敏感遮蔽、Dataset 公共政策、即時版本與患者 Audit。JSON 回應有大小上限且在寫出任何回應 bytes 前再次檢查裝置／政策／allowlist。Audit 失敗不得交付。

原生端不把 Token 送進 renderer，只攔截該視窗自己的固定 Device API；原有 Cookie-session UI 使用非秘密的本機 lease 回覆，沒有把 HttpOnly Cookie 改成 JS Token。其他 API／管理者登入 API 不開放給 WebView。Server 原本 HTTPS Cookie Kiosk 完整保留。

原生 watchdog 每 5 秒驗證，單次 8 秒 deadline；任何觀察到的拒絕／斷線／解密或 API 失敗會隱藏 clinical view、取消後續世代及清除頁面，既有 Client 期限／頁面離開清除仍生效。失效發現不是即時 server push；正常上線時最多約 13 秒觀察窗。重新整理只重驗原授權，不會核發新 Token。API／WebView 回應 no-store，Token 不進 localStorage／sessionStorage／DOM／BAT／URL／日誌或 Audit。Windows crash dump／帳號入侵仍屬前述 OS 管理界線。

## Server 分離設定

- 在隔離的 PR #76 相容安裝設定 `MANAGED_KIOSK_CONFIG=<絕對路徑>`，格式見 `windows-agent/channel.example.json`。此檔只放公開 bindings 與 key 檔路徑，**不放 Token**。伺服器 key 檔限服務帳號／管理員讀取，CA private key 保持離線。
- Server cert SAN 必須有 `uqp-kiosk.internal`、serverAuth EKU；每個裝置是獨立 clientAuth 憑證。範例 A/B fingerprint 是不可用 placeholder，必須換成經可信來源確認的 DER SHA-256。TLS 1.2 僅允許 ECDHE＋AES-GCM，亦支援 TLS 1.3；不可開啟跳過 pin、舊 TLS 或不驗證 client certificate 的選項。
- `publicOrigin` 是既有 Dashboard 公開 URL 的 canonical origin；client binding 的 Dashboard／Device ID 必須一致。移除該憑證 binding 可即時拒絕後續請求及待交付回應；CA／Server key rotation 要受控重啟及可信 pin／註冊更新。
- Agent 直接使用既有 API port。若原反向代理不支援 CONNECT，或不能保留真正 TCP 來源 IP，須先配置受控 passthrough／既有 API 入口；**不得相信 Agent 自報 X-Forwarded-For，也不能用代理 IP 放寬原裝置 IP 限制**。不新增公開 port 作替代。
- 網路攻擊仍可阻斷 HTTP 外層連線；TLS 保護機密性／完整性，不保證可用性。Server 有 64 通道及 10,000 個 65 秒 nonce 的程序上限；大規模 fleet／負載平衡與流量限制需獨立容量驗收。

## Build、安裝與 BAT／多螢幕

SDK 固定 `windows-agent/global.json`；WebView2 NuGet 與 NuGet lockfile 固定。需 .NET 10 支援且仍受維護（含必要 ESU）的 Windows x64、受管理且已更新的 Microsoft Evergreen WebView2 Runtime。NuGet audit 不等於對實際 Edge Runtime 的 CVE 驗收。

```
npm ci --prefix client
npm run build --prefix client
dotnet restore windows-agent/Uqp.Kiosk.Agent.Tests --locked-mode
dotnet build windows-agent/Uqp.Kiosk.Agent.Tests -c Release --no-restore
dotnet publish windows-agent/Uqp.Kiosk.Agent -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o windows-agent/artifacts/candidate
```

CI 的 `windows-managed-agent-UNSIGNED-acceptance-only` artifact 是**未簽章隔離驗收候選**，不得直接做正式裝置安裝。實際發行必須由組織可信 Authenticode publisher 簽章 single-file EXE（內含 Client assets／依賴），IT 透過獨立可信通道確認 publisher SHA-256，並簽章／安全交付 installer／公開配置。沒有提供 `SkipSignatureCheck`。

正式安裝命令（由 IT 在目標機器執行，本次 Agent 沒有替使用者執行）：

```powershell
.\windows-agent\tools\Install-Agent.ps1 -Executable <已可信簽章的單一EXE> -Configuration <agent.json> -WindowsUser <專用標準帳號> -ExpectedPublisherSha256 <可信發行者SHA256>
```

Installer 只寫新 `%ProgramFiles%\UQPManagedKiosk\<hash>`，限制 ACL、驗證複製後簽章，建立該使用者 `Interactive`／`Limited` AtLogOn task。沒有 Windows 密碼、SYSTEM 啟動、網站 HTTPS 先決條件或 Token 命令列。Windows 自動登入／桌面鎖定／Assigned Access 由組織另行管理；未登入互動式工作階段不會有可見播放。

既有公開播放 URL 保留，HTTP 瀏覽器視窗本身不收 Token。新下載的既有 Dashboard BAT 會依 Windows SID／公開 URL 查詢管理員保護的 HKLM mapping，再驗證簽章 publisher 並啟動 Agent，帶入原有螢幕／負座標／大小／全螢幕設定；沒有 Agent 時 HTTP 不回退裸 Token。HTTPS 沒有 Agent 時仍可使用原 Edge／Chrome launcher。Agent 本身是 WebView2，**不是外部 Chrome／Edge 視窗共用授權**。

互動式登入 task 使用註冊時保存的位置；管理者之後改位置，可重新下載 BAT 取得新位置，或受控更新啟動設定。螢幕編號沿用依 DeviceName 排序的 1-based index，不是穩定 EDID。混合 DPI、負座標、實體多螢幕／全螢幕仍須現機驗收。

## 驗收、回復與 BLOCKED

- 自動化：Node 真實 CONNECT／TLS1.2／TLS1.3／mTLS；錯誤／缺少 client cert、弱 RSA CBC cipher、wrong pin／origin／device／路徑、過期 timestamp／重放、授權撤銷與待交付回應拒絕；.NET 對 Node 真實登入／核發／page／pin／撤銷與雙向 TCP relay 明文掃描。
- Windows：真實 DPAPI／DACL／錯誤 machine／origin／竄改；真實 WebView2 F5、相同使用者的兩次程序／profile 啟動、外站導航拒絕、撤銷清除；檢查 DOM／URL／storage 沒有 Token。這些使用合成 API／憑證，不代表實際 DB／冷開機。
- **BLOCKED（不可宣稱已驗收）**：組織可信簽章與發行、真實 PKI／專用帳號／WDAC／代理原始 IP 設定、正式/指定測試 SQL 實機、Windows 登入 task 與實體冷開機／多螢幕。網站 HTTPS 可以延後；上述安全條件不能以裸 HTTP 替代。
- 現機程序：在新隔離目錄及合成／去識別測試資料庫完成首次 native 登入 → F5 → 關閉所有 Agent 程序後 BAT 重開 → 登出登入 → Windows 冷開機登入；每步檢查逐頁 masking／Audit，再測 revoke、expiry、Token reissue、IP／mode／policy／Audit 失敗與網路中斷。明確記錄 physical reboot，而不是用程序重啟冒稱。
- 回復：先停止該 `UQP.ManagedKiosk.<hash>` task／Agent，再由 IT 移除該 SID／URL 的 HKLM mapping 與該版本目錄或切回已驗證簽章版本；若 pin／配置改變須明確重新授權。清除 DPAPI 是本機解除註冊，不取代 Server revoke。保持網站 HTTP 患者播放拒絕，不回復成裸 Token。沒有 DB 回復或 Migration。
