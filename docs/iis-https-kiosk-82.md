# IIS HTTPS／純網頁 Device Token 整合驗收（Issue #82）

基準 PR #81 `707655ea6e69536e7c85456bf70b5ef33649a4b2`。正式 public origin 使用 `https://uqp.tjci.org.tw`，**沒有結尾斜線或中文句號**。本 PR 不連線／更改該站台、既有 C:\UQP 或正式資料庫；不安裝 Agent、不改 schema、不執行 Migration。文件與模板供管理員審查及隔離驗收後操作，不是已部署紀錄。

## 設定差異與信任邊界

外部瀏覽器 → 受信任憑證的 IIS HTTPS → **同機** `127.0.0.1:3200` HTTP Node。患者資料／Token 的外部路徑必須全程 TLS；同機 loopback 例外不能擴大成跨主機的裸 HTTP。遠端反向代理另需受驗證 TLS，不適用本模板。

| 項目 | 本次契約 |
| --- | --- |
| Node 監聽 | 新增 `LISTEN_HOST`；IIS 部署明確設 `127.0.0.1`，Port 3200。為相容既有開發環境，程式未設定時仍為 0.0.0.0，因此不可漏掉這項設定。只開站台必要的 443；3200 不對外、不可 Port Forward。 |
| 代理信任 | `TRUST_PROXY_ENABLED=true`，`TRUST_PROXY_ADDRESSES=127.0.0.1`；只有實際 TCP peer 精確在名單才可信，不接受 CIDR／主機名／全信任。若真的使用 ::1，僅額外加入 ::1，並調整監聽／Rewrite 一致。勿把播放裝置或整個內網列入代理名單。 |
| Host | IIS 先拒絕非 UQP Host，再覆寫 `X-Forwarded-Host=uqp.tjci.org.tw`。Cookie 邊界只接受可信 peer 的單值 forwarded Host，且必須精確等於設定的 public origin Host；未提供時仍驗證 Host。未授權 peer 的 forwarded Host 不生效。ARR 是否把後端 Host 改成 127.0.0.1 不影響此明確契約。 |
| TLS | IIS 只在 `{HTTPS}=ON` 的 API 規則覆寫 `X-Forwarded-Proto=https`。HTTP、混合／重複 Proto、偽造來源不會建立 Cookie 授權；不從任意 forwarded header 推定 HTTPS。 |
| 來源 IP | IIS 以 `{REMOTE_ADDR}` 覆寫 X-Forwarded-For。若 ARR 又附加真實來源，後端從右向左跨越明確受信任的代理，在第一個不可信 hop 停止；不相信客戶端塞在最左側的值。 |
| 正規化 | 支援 IPv4、IPv4:port、IPv4-mapped IPv6（大小寫、十六進位）、裸 IPv6、[IPv6]、[IPv6]:port。IPv6 壓縮／大小寫統一，mapped IP 統一成 IPv4，IP ACL 與患者 Audit 共用。裸 IPv6 永遠當完整地址，**不猜最後一段是 port**；不接受 scope zone、DNS、畸形／重複 header、空 hop 或過長鏈。IPv4 CIDR 及 IPv6 單一 IP 保留，不新增 IPv6 CIDR。 |
| 失敗處理 | 可信代理缺少／提供無效 For／Proto，API 回 400 `PROXY_METADATA_INVALID`，不退回 loopback 身分、不交付資料。未知外部 peer 的 forwarded headers 全忽略，仍以真實 socket 身分及直接 TLS 判斷。 |

IIS 主機本身屬信任邊界：不得讓不受信任使用者／服務登入該主機並偽裝 loopback 代理。若 IIS 前還有其他代理／CDN，不能直接套用這份單層模板；應逐一確認實際可信 hop 與加密路徑。不要將無法確認的來源列入 allowlist。

## DNS、憑證、SSL／SNI 與 IIS 前置檢查

1. 先備份 UQP **站台專屬**設定、Rewrite 規則、binding、原 physical path 與應用版本；記錄既有代理全域設定供比較。這裡不提供會寫入正式設定的自動腳本，也不做全域 iisreset。
2. DNS A 指向該 IIS 伺服器；只有 IPv6 listener、路由及 Firewall 都就緒才提供 AAAA，避免某些裝置走壞掉的 IPv6 路徑。所有播放裝置須能解析同一 Host，不使用不同 IP URL 登錄。
3. IIS HTTPS binding 的 Host name 為 `uqp.tjci.org.tw`、Port 443、啟用 SNI，選擇私鑰可用、有效且 SAN 包含該 DNS 名的 Server Authentication 憑證；瀏覽器須信任完整 CA chain，禁止略過錯誤或使用測試自簽憑證。確認 SNI/binding 不搶走同機其他站台。規劃憑證續期及到期監測，續憑證不用更換 Cookie key。
4. 確認 Static Content、URL Rewrite 2.x、ARR 3.x 已安裝，既有 ARR proxy 已啟用。**不要為 UQP 修改共用 ARR preserveHostHeader、全域 Host／cache／proxy 規則或其他站台。** 本方案透過 UQP 站台覆寫固定 forwarded Host；不需要全域 preserveHostHeader=true。若 ARR proxy 尚未啟用而此 IIS 共用其他業務，由 IIS 管理員另行評估或使用隔離 IIS instance；不要直接執行全域變更指令。
5. 以 IIS 管理員在 UQP site 的 URL Rewrite → View Server Variables，允許下列三個變數；確認權限寫入 **UQP site location**，不廣泛解除整個 server 的 section locking：`HTTP_X_FORWARDED_PROTO`、`HTTP_X_FORWARDED_HOST`、`HTTP_X_FORWARDED_FOR`。分散規則無權寫入時會 500.50，不能靠改成信任任意 header 解決。
6. 關閉／排除 UQP API 的 IIS／ARR／CDN 回應快取；保留 Node `Cache-Control: no-store`，不要快取臨床回應。關閉此站台 Cookie、Set-Cookie、Authorization、Device Token header、request body／form 的 Failed Request Tracing、ARR diagnostics、APM／封包擷取；只保留必要 metadata，避免核發及 enrollment 憑證落入日誌。Audit 不收 Token／Cookie。

## web.config 與站台實體目錄

模板為 [tools/iis/web.config.example](../tools/iis/web.config.example)。先檢視差異，再複製成**新驗收目錄的 client/dist/web.config**，不是整個 repo 根目錄。IIS physical root 只指向該 dist；不得把 server、.env、node_modules、Git、SQL 或文件放進可公開讀取的目錄。App Pool 採獨立身分，只授予 static root Read；Node 執行身分及 .env／keys 另外保護，IIS static 身分不需要讀取。

規則順序是拒絕其他 Host → 拒絕 HTTP → `/api` 固定代理至 loopback → 已知 SPA 路徑 fallback。它不使用請求裡的 Host 當代理目的地，也不接受任意 proxy URL；原始 query 保留，Token 從來不在 URL。HTTP 一律 403，不將帶憑證的 POST 重導到 HTTPS。模板清除的是該 UQP site 的 distributed rules，不是全域規則；先確認沒有更早執行的 inherited/global rule 搶先處理請求。

保留 `httpErrors existingResponse=PassThrough`，避免 IIS 改寫 API 的 401／403 JSON。不要用 outbound rule 改寫 Set-Cookie 的 Secure／HttpOnly／SameSite／Path／Domain。CSP 僅允許同來源腳本／連線，HSTS 一年且不含 includeSubDomains；請先確認所有目標裝置信任憑證及既有品牌資源符合 CSP。回復時保持 HTTPS，HSTS 不因換回舊程式就消失。

若 ARR 附加 client port，IPv4:port 或 [IPv6]:port 會被安全解析。不得讓代理產生無法區分的「裸 IPv6 加 port」；先檢查實際 ARR 輸出並修正其站台／隔離 instance 的格式，不能在後端猜 IP。診斷僅暫時使用 `CLIENT_IP_DIAGNOSTICS=true`，新日誌只記正規化 IP／信任結果，不記原始 header；驗收後關閉。

## .env 最小差異

於新驗收目錄保留既有已驗證設定，只調整以下項目；不要覆寫正式 .env、JWT_SECRET、DATASOURCE_ENCRYPTION_KEY 或資料庫連線。**Node 的 working directory 必須是對應 server 目錄**，避免 dotenv 載入錯檔。

```dotenv
NODE_ENV=production
LISTEN_HOST=127.0.0.1
PORT=3200
CLIENT_ORIGIN=https://uqp.tjci.org.tw
DASHBOARD_PUBLIC_CLIENT_ORIGIN=https://uqp.tjci.org.tw
TRUST_PROXY_ENABLED=true
TRUST_PROXY_ADDRESSES=127.0.0.1
CLIENT_IP_DIAGNOSTICS=false
```

保留已驗收的 Query source management／execution、Query device playback、Dataset 公共政策／遮蔽旗標；本文件不繞過未完成的來源、權限、欄位政策及患者 Audit 預檢。`DASHBOARD_KIOSK_COOKIE_KEY` 必須是**獨立、隨機、固定**的 32-byte AES key（64 hex 字元），不留空、不共用 JWT／資料來源 key、不寫入 Git／BAT／日誌。首次配置由管理員用 OS CSPRNG 產生並安全保存；更新程式、Node restart 與備援 API instance 必須沿用同一個 key／origin。刻意輪替 key 才會使所有舊登錄失效；勿每次啟動自動重產。

IIS 只服務 static files／代理 API，不會自動啟動 Node。完成 build 與環境設定後，依既有平台執行管理方式從新 server 目錄執行 `npm start`（`node dist/server.js`）；不要改成從 IIS static root 執行或另裝播放 Agent。若看到 502.3，先確認對應的 loopback port／Node process；400 PROXY_METADATA_INVALID 查 For／Proto 及 peer；401 KIOSK_AUTHORIZATION_REQUIRED 查 pinned Host／origin／Cookie key／目前裝置權限，不能藉停用驗證解決。

## 持久授權與到期契約

沿用現有 AES-256-GCM 隨機 IV、origin／purpose 綁定的 `__Host-uqp-enrollment-*`／`__Host-uqp-session-*` Cookie，Secure／HttpOnly／SameSite=Strict／Path=/、無 Domain。原 Token 不寫入 localStorage、sessionStorage、IndexedDB、URL、BAT、播放中的 DOM、日誌或 Audit；輸入欄只在首次授權時存在，成功後清除。Cookie 仍是 bearer grant，禁止複製／匯出瀏覽器 profile 或 storage state。HttpOnly 不保護已遭同來源腳本或 OS 帳號入侵的裝置。

登錄期限為首次授權時間起 **365 天與裝置到期日的較早者**；session 最多 5 分鐘，亦不能超過登錄／裝置期限。還原 session、F5、瀏覽器重開及裝置續期都不延長原登錄期限。30／7 天管理提醒、安全續期及播放端 7 天提醒沿用。原登錄期限結束須重新明確輸入有效 Token，不會自動重新核發。

還原與每個 layout／page 仍驗 Device Token hash、到期／撤銷／停用、IP、委派者／工作站／權限版本、Query-only 模式、Query ACL、Dataset 公共政策與遮蔽；患者資料只在既有執行及 delivery Audit 成功後交付。撤銷後**下一次資料要求即拒絕**；已顯示資料由失敗回應或獨立約 15 秒檢查清除，並非伺服器瞬時推播。到期 deadline、offline、pagehide 亦會清除資料；bfcache 還原重新驗證。

## 一次整合驗收／更新程序

1. 確認 Draft 最新 Commit 的五個 CI 工作 Success。下載該 Commit 至**全新隔離資料夾**（例如 D:\UQP82-Acceptance），Node 24.15.0／npm 12.2.1；server／client 各執行 `npm ci`、`npm run typecheck`、`npm run build`，不用 audit fix --force。無 Migration。沿用測試資料庫與合成 Dataset，不連正式患者資料；必要 schema 依既有已驗收環境提供，不在本 PR 自動建立。
2. 建立獨立驗收 IIS site／binding、Node port 及可信 HTTPS **測試 Host**（例如 uqp82-test.tjci.org.tw，須有對應 DNS/SAN）。一致修改模板 Host regex、固定 X-Forwarded-Host、Rewrite Node port、兩個 origin .env；使用獨立 Cookie key。不要與既有站台搶 binding／port，也不更改 C:\UQP。Cookie 不按 TCP port 隔離，因此不以同 Host 換 port 當成完整隔離；使用獨立測試 Host 及專用測試瀏覽器 profile。
3. 確認 Node 只監聽 loopback，外部不能直連 Node port；從目標裝置以新 HTTPS Host 讀取頁面及 `/api/status`，沒有 certificate warning／mixed content。以合成資料確認實際 public IPv4／IPv6 在 IP ACL、患者 Audit 一致；測試偽造 XFF 前綴、Proto、Host、未授權 proxy peer 與錯 IP，不得取得患者資料。
4. 保存測試裝置及 Edge／Chrome、螢幕、絕對座標、視窗大小／全螢幕。確認自動顯示網址、複製、隔離開啟、下載 BAT；網址為 HTTPS 且無 Token。按指定瀏覽器啟動 BAT，**在該 BAT 專用 profile 裡首次貼 Token，保留持久授權勾選**。在管理者一般瀏覽器完成授權，不會自動授權 BAT 的獨立 profile。
5. 驗 F5 → 關閉所有該 profile 的瀏覽器 process → 重執行相同 BAT，確認無須 Token。確認 Cookie flags／到期（不要匯出值）、document.cookie 不可讀，URL／儲存空間／BAT／日誌／Audit 無原 Token。重下載 BAT 不改 profile，但變更 origin／Device ID／瀏覽器／Windows 使用者會換 profile；由 HTTP 換 HTTPS 也須首次重新授權。
6. 同一管理的 Windows 使用者互動登入後，以既有 Startup／Task Scheduler 啟動此 BAT；不放入 Token、不用 SYSTEM／登入前背景工作、不用 InPrivate／incognito／Edge --kiosk，也不讓瀏覽器 exit policy 清 Cookie。驗證真正冷開機登入後恢復、負座標、多螢幕排序、DPI 及全螢幕。螢幕編號仍依 Windows DeviceName 排序，不保證等於系統顯示設定號碼。
7. 播放中逐一驗撤銷、到期、停用、重新核發、IP 變更、Query／委派者權限撤銷、公共政策變更、Audit 寫入失敗與斷線：後續交付拒絕、畫面清空，重新啟動也不能恢復舊授權。測試 30／7 天提醒與安全續期；確認續期沒有延長原 Cookie 登錄上限。清除此瀏覽器授權後，再開 BAT 應要求 Token。
8. 隔離驗收完成並核准切換後，維護時段只更新 UQP 站台到已驗證的新 static root／對應 API；先保存舊版本／站台 binding、專屬規則及受保護的環境設定，再停止舊 API、切換、啟動、檢查 HTTPS／IP／Audit。保留相同 origin／key 可保留既有有效登錄；不用 Migration、不原地覆蓋現有 C:\UQP。回復時恢復原 UQP site/API 版本及設定，保持 HTTPS、原 keys；不還原／變更資料庫、不撤除其他站台的設定。不要自動用新 key 或放寬 IP／代理信任來「修復」失敗。

## 自動化證據與待現機驗收

Server 涵蓋正規化、可信鏈／偽造／重複／畸形 header、HTTP middleware／IP ACL／Audit 一致、Host pin、Cookie 加密／到期／365 天／續期不延長、撤銷／Query-only／公共政策等。Browser 使用真實 TLS frontend → loopback HTTP backend（**合成 ARR／資料庫，非 IIS 引擎**），驗 IPv4:port／IPv6／mapped、F5、真實 Chromium process/profile 重開、無 Token 明文、權限失效後不交付。原 Browser 與 Windows PowerShell BAT 8 組矩陣完整保留；Windows CI 另解析此 XML 模板。

PR #81 的 clean build 設定保留：dist 先清理、不部署編譯 test／fixture；typecheck／test 仍涵蓋它們，必要 SQL／部署腳本／稽核與遮蔽來源未刪除。CI 的 `tools/measure-browser-build.mjs` 印出追蹤與 Build bytes；歷史 PR #81 的 size JSON 是當時快照，不誤標成本 PR 的大小。IIS template 是部署後額外放入 static root 的單一小檔，未複製多份生成產物。

**待本機驗收**：現場 IIS/ARR 版本、站台 server-variable delegation／實際標頭、憑證/DNS/SNI、Windows 冷開機／互動登入排程、Edge／Chrome 實體多螢幕／DPI、真實測試資料庫與 Audit。CI process restart 不等於 Windows 冷開機，也不等於正式資料庫驗收。本 PR CI 全綠後適合一次下載至隔離資料夾進行上述整合驗收；未宣稱正式站台已更新或可跳過現機驗收。

IIS 參考：[Microsoft URL Rewrite 設定](https://learn.microsoft.com/en-us/iis/extensions/url-rewrite-module/url-rewrite-module-configuration-reference)、[允許覆寫 server variables](https://learn.microsoft.com/en-us/iis/extensions/url-rewrite-module/url-rewrite-module-20-configuration-reference)、[Microsoft IIS forwarded Host／Proto 說明](https://techcommunity.microsoft.com/blog/iis-support-blog/how-to-properly-configure-iis-reverse-proxy-for-asp-net-core-applications-secure/4388483)。本程式使用 Node／Express 的明確信任及 origin 驗證，並未套用 ASP.NET middleware。
