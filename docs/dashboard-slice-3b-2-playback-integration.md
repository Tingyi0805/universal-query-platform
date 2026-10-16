# Slice 3B-2：手動啟用、播放與安全恢復

基準 `57188f1f9fa46c765cb1cab8bfa47c6025587c84`。保留既有 Query-only 執行與 JWT/TokenVersion/RBAC/Query ACL/工作站/遮蔽/患者揭露稽核；所有能力旗標預設不變，PIN 快速登入仍未啟用。未連接共用 SQL Server、修改／執行 001–918 Migration、部署或合併。

## 管理與啟用

Dashboard 管理頁新增 Query-only 播放授權面板，與來源編輯器同步狀態變動，來源修改使舊預檢失效。使用既有模式 GET/POST 與 credential POST，expectedVersion 必填；400/403/409/503 顯示安全分類，不自動刷新版本重送。停用／模式切換清除本頁憑證並由後端旋轉所有相關雜湊、清模式授權；管理者需重新核發。

新增唯讀 `GET /api/dashboards/:id/query-mode/v1/preflight`，與既有模式 API 共用能力旗標、JWT/TokenVersion、DESIGN_QUERY、917/918 Schema 檢查、SERIALIZABLE transaction、Dashboard→來源→版面→裝置鎖順序。回報停用狀態、含 PRIMARY 的來源數（最多8）、待轉換／key 有效性、啟用來源引用、装置綁定，以及每個來源的操作者 Query ACL／必要參數／敏感政策／稽核設定、每個有效装置的原始委派者帳號／工作站／IP／到期與所有 Query ACL。查詢依序執行，不執行臨床 Query、不寫模式或憑證；不回 SQL、參數值、Token 或 keyring。驗證失敗局部列出固定代碼；未知儲存錯誤安全回503。預檢只代表當下，啟用時既有後端交易仍重新驗證，並新增拒絕引用已停用來源的檢查。

管理者流程：先完成停用看板的來源與版面轉換→預檢→確認啟用（舊憑證失效）→為個別有效裝置明確核發→可信交付／本機一次性交接→後端驗證後播放。Legacy 啟用看板仍按既有 rollout 流程，在開啟管理旗標前停用，沒有解除舊寫入保護。

新增 `DELETE /api/dashboards/:id/query-mode/v1/devices/:deviceId/credential`，body `{expectedVersion}`。要求現行管理者 JWT/TokenVersion/DESIGN_QUERY、完整 Schema、非 LEGACY 模式與版本；交易內停用指定裝置、記錄撤銷時間、旋轉雜湊、清授權並強制安全稽核。稽核失败整筆回滾，不能宣稱已撤銷。即使該委派者已撤權／工作站停用，管理者仍可撤銷，不用失效的 Query ACL 阻止安全操作。撤銷裝置不能直接重新核發；須依既有管理流程建立／授權有效裝置。

成功核發才在頁面記憶體保存，預設以密碼欄位隱藏，可明確顯示、清除或開啟同源播放視窗。回應必須符合所請求的 deviceId/dashboardId，防止錯誤交接；離開／更換登入身分、模式變更、重新核發及撤銷清除本頁舊憑證與待交接監聽。不記錄、不寫 localStorage/sessionStorage、URL、啟動腳本。播放路徑与記憶體索引使用 **DashboardId**：例如為 Dashboard1 的 Device7 核發，播放 `/display/dashboards/1`，不是 `/display/dashboards/7`；DeviceId 只用於管理／快照擁有者識別。

## 播放與恢復

裝置 PRIMARY 與額外來源沿用既有安全 page API、独立刷新／分頁／快照與遮蔽。Query ACL 403、參數400、執行503保留局部錯誤；整體身分／模式授權401停止所有來源並清除憑證。Query-only 委派者失去全域 EXECUTE_QUERY 同樣視為整體失效：已簽發模式裝置的 repository 驗證與執行核心均拒絕；Legacy 的原有權限規則不變。JWT 預覽區分全域權限撤銷與個別 Query ACL 拒絕，全域失效清除整體並拒絕遲到回應。

新增独立授權檢查：裝置頁每15秒及回到可見狀態時呼叫既有 layout GET，5秒截止，不執行臨床 SQL，也不重設健康來源的刷新／分頁。工作站停用、撤銷、委派者 TokenVersion／角色改變、到期、模式變更或授權檢查不可用時停止所有患者列，清本頁 Token，顯示等待授權。不是即時推播；正常前景輪詢約15秒加請求時間（上限5秒），背景／休眠計時器受瀏覽器限制，需真機驗證。

重整／關閉／重啟後記憶體丟失，等待管理者登入、核發及可信交付，再由播放頁驗證；不把 IP、WorkstationId、遺留明文 Token 當成新的授權證明。舊 localStorage/sessionStorage 播放憑證會清除，**不再自動讀取啟用**；Legacy Dashboard 設定與 API 保留，但舊自動啟動方式需改為手動驗證／可信一次性交接。正常頁面中的網路恢復仍須以現有記憶體憑證通過後端檢查，不能復活已撤銷或遺失的憑證。

沒有現成的可信重啟身分／受控重新授權代理，因此本批**不實作無人值守自動重新授權**；沒有新增基礎設施、Migration 或 PIN bypass。若未來需要自動恢复，須另行批准装置身分、受保護代理、撤銷、到期與跨實例协议，不能使用永久瀏覽器 Token。

全螢幕保留標準 API，補 WebKit API／事件与不支援的提示；需使用者手勢時提供按鈕，不支援時提示瀏覽器全螢幕／加入主畫面。修正狀態提示遮擋按鈕的層級。沿用橫直向、解析度縮放、固定文字、自由排列、FIT、格式及追加遮蔽。

## 獨立預覽

恢復 Query-only 版型預覽按鈕，沿用既有同源登入會話／版型 session handoff。`queryPreview=1` 只是選擇安全 API 的非敏感路由標記，不是授權；沒有交付或保存裝置憑證。PRIMARY/額外來源均使用已發布 Query 的 JWT v1 page API、真正的伺服器快照分頁、独立更新与错误；PRIMARY 只补相容显示中繼資料，不能回退 Dataset／舊 preview API。每次请求仍检查当前 JWT/TokenVersion/DESIGN_QUERY/EXECUTE_QUERY/Query ACL/参数/遮蔽/稽核，啟用的看板仍不能用停用設計預覽契約執行。能力或 Schema 不完整安全拒絕。

## 修改與測試

前端：DashboardQueryPlaybackManager（新增）、DashboardDesignerPage、DashboardDataSourcesEditor、DashboardDisplayPage/CSS、DashboardLayoutDesignerPage、querySourceManagement/helper test、dashboardToken/helper test；新增 fullscreen/helper test、dashboard-query-mode Chromium；更新 dashboard-management/playback Chromium。
後端：dashboardQueryMode service/routes/repository/test、dashboardDevice.repository、dashboardQuerySourceExecution/core test。本文件；沒有 Migration 或依賴套件變更。

後端122項 Mock/HTTP/單元、前端20項單元、Chromium19項通過，無未修復失败。涵蓋預檢、啟停／版本、核發／撤銷／稽核回滾、委派者／模式／TokenVersion、遮蔽、分來源錯誤、長間隔授權檢查、一次性交接、刷新／新視窗等待、預覽与3B-1編輯器。Chromium使用1920×1080/800×1280/1024×768代表尺寸與真實Chromium全螢幕操作，WebKit API單元使用Mock；不代表Windows/Android/iOS真機或Safari驗收。前後端型別檢查、build通過；保留既有Vite大於500kB chunk警告。

後端受影響命令：在server執行 `node --import tsx --test src/modules/dashboard/dashboardQueryMode.test.ts src/modules/dashboard/dashboardQuerySources.test.ts src/modules/dashboard/dashboardQuerySourceExecution.test.ts src/modules/dashboard/dashboardWidgetSource.test.ts src/modules/dashboard/dashboardDeviceMasking.test.ts src/modules/dashboard/dashboardDevicePage.routes.test.ts`。
前端：在client執行 `node --import tsx --test src/dashboard/*.test.ts src/security/dashboardToken.test.ts`；`CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/dashboard-management.spec.ts e2e/dashboard-query-mode.spec.ts e2e/dashboard-playback.spec.ts`。兩側各 `npm run typecheck`、`npm run build`。測試皆Mock/合成資料，不連接共用DB。

## 未完成、真機與下載前總檢查

- 無人值守自動授權未實作，理由如上；提供等待授權与完整手動流程。
- 隔離SQL Server2019：917/918與既有916相容性、trusted constraints、owner/Query ACL、crypto/update rowsAffected、交易鎖／并行／稽核回滾、Schema缺失安全拒絕。腳本本次不執行，正式流程須另批准，不能重跑001–915。
- 真機Windows/Android/iOS/Safari：手勢／全螢幕／橫直向／自訂解析度、睡眠／喚醒／背景節流／断線、刷新／重啟等待、IP/CIDR/工作站／到期／TokenVersion／模式撤銷與控制面不可用。模式切換／重新核發後旧憑證及快照应拒絕，個別Query403仍局部处理。
- 真实Query与患者揭露：只在批准的隔離環境以合成資料核對必要参数、后端遮蔽、强制稽核与失败不回列；此前患者基本查詢500實際根因仍需安全Request ID／錯誤分類本機確認，不把Mock通过当作生产驗收。
- 下載前确认分支与本批Commit、工作樹／锁檔／变更清單，按上述Mock/typecheck/build验证；001–918無變更，無SQL修正或部署步驟。保持旗標false，先由DBA與資訊室完成隔離与真機验证、HTTPS/代理/裝置限制/稽核金鑰設定及批准上線順序，才能正式開啟。
- PIN快速登入跨實例安全防護仍未完成，维持未啟用；不要用它替代缺少的重啟授權。
