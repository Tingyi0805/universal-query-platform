# 5B-3A：Dashboard 裝置基本管理安全契約

## 完成範圍

基準 `ca38776f8bf21d2a01dec946363eaef9aaa06ece`，沿用既有分支及 Draft PR #66。

新增 metadata-only 建立、裝置基本設定及播放位置的版本化 API 與最小管理 UI。全部掛在既有 JWT 驗證後，要求 DESIGN_QUERY，交易內重新確認帳號有效、JWT TokenVersion、DESIGN_QUERY／EXECUTE_QUERY、所有綁定 Query 的發布／啟用／ACL／參數，以及既有裝置委派者與工作站有效性。

本階段不授權播放、不啟用旗標、不改患者資料遮蔽或曝光稽核。管理 API 只依既有 `DASHBOARD_QUERY_SOURCE_MANAGEMENT`，因此播放旗標關閉不阻止 metadata 管理；憑證核發仍依既有獨立播放安全契約。

## API 與資料契約

前綴 `/api/dashboards/:id/device-management/v1`。回應皆 `Cache-Control: no-store`。

| 方法／路徑 | 輸入與結果 |
| --- | --- |
| `GET /` | 回傳 dashboardId、獨立聚合 version、canCreate、裝置 metadata 與 nullable placement；不回傳 Token、TokenHash 或內部憑證指紋 |
| `POST /` | `{expectedVersion,confirmed:true,metadata}`；只允許停用且已完成 Query 綁定的 Dashboard；回傳 deviceId、credentialIssued:false 與新快照 |
| `PUT /:deviceId/metadata` | `{expectedVersion,confirmed:true,metadata}`；回傳 deviceCredentialsInvalidated:true 與新快照 |
| `PUT /:deviceId/placement` | `{expectedVersion,confirmed:true,placement}`；回傳 deviceCredentialsInvalidated:false 與新快照 |

metadata 完整替換欄位為 deviceName、enforceIpRestriction、allowedIp、allowedCidr、expiresAtUtc；不接受部分省略、額外權限欄位或任意 JSON。

- 名稱 trim 後 1–200 字元。IP 必須是有效 IPv4／IPv6；CIDR 限既有執行器支援的 IPv4/0–32，拒絕空 prefix。啟用限制時至少指定一項；關閉限制時兩項必須為 null。
- 到期時間為未來 UTC ISO 字串或 null（明確設定無到期日）。只可編輯目前仍有效的裝置；過期裝置不得藉此延長／復活。設定未來到期或改為 null 也必須撤銷原憑證，並另行明確授權。
- 建立時 CreatedByUserId 固定為交易內已驗證的操作人員，不能指定他人；SharedWorkstationId 明確為 null，不推測綁定。
- 既有裝置的 CreatedByUserId、SharedWorkstationId、IsActive、RevokedAtUtc、ArchivedAtUtc 均不可由 metadata／placement 契約修改。
- placement 完整欄位為 browser(chrome/edge)、screenNumber(1–16)、fullscreen、windowX/Y(-32768–32768)、windowWidth(200–7680)、windowHeight(200–4320)。不接受資料來源、遮蔽或授權欄位。
- 身分與播放位置分開寫入；沒有保存播放位置的裝置回傳 null，僅在管理員明確進入編輯並確認保存時建立設定，不自動初始化覆寫。

## 版本、鎖與交易

不新增 Migration。916 提供工作站關聯及狀態；917 提供 Query 綁定；918 提供 QueryMode／QueryModeVersion 及裝置 grant/delegator 版本；919 提供 Dashboard 與來源 ApprovalRowVersion。裝置與播放設定本身沒有 RowVersion，本次使用既有 Dashboard 作聚合並行控制。

新的 expectedVersion 是 SHA-256 聚合版本，**不同於** query-mode／query-sources 原有 version，不可混用。內容包含：

1. 既有 sourceVersion（Dashboard、來源、版型）。
2. 可信 919 Dashboard／來源 RowVersion 證據（沿用既有 evidence reader）。
3. Dashboard 下依 ID 排序的裝置身份、安全狀態、不可逆內部憑證指紋及播放設定。

LastUsedAtUtc 不屬設定，不納入版本，避免正常播放心跳使管理持續衝突。內部憑證指紋不進入 DTO／稽核；憑證核發、撤銷或模式切換改變持久化安全欄位後，舊裝置管理版本即失效。

沿用 createQuerySourceStore 的 SERIALIZABLE 交易；readState 先持有 Dashboard／來源／版型的 UPDLOCK,HOLDLOCK，裝置及播放設定也取得範圍鎖。驗證 expectedVersion、身份／ACL、SQL 寫入、Dashboard 更新以推進真正 RowVersion、強制 writeAuditEvent、重新讀取結果，最後才 commit。不能因 UpdatedAtUtc 精度相同或設定 A→B→A 而重用舊版本。

稽核失敗／無有效稽核 ID、SQL 失敗、重新讀取失敗或 commit 失敗均走 rollback，不回傳成功。deadlock、lock timeout、SQL 目標失效衝突轉為安全版本衝突；其他未知錯誤只回傳安全分類，不輸出 driver 訊息。

919 exact Schema 使用既有 requireSecuritySchema，另檢查 918、916 必要欄位、裝置 FK、播放設定 PK/FK/check；證據缺失一律拒絕。沒有 Legacy、原始 Dataset 或無版本 writer fallback。

## 未授權初始狀態與憑證失效

DashboardDisplayDevice.TokenHash 有 NOT NULL／UNIQUE 約束。建立時由 SQL CRYPT_GEN_RANDOM + SHA2_256 產生不可用的隨機佔位值，不建立或交付可使用的 Token；兩個 grant 版本皆 null。IsActive=1 僅代表裝置 metadata 可參與既有 preflight／明確核發流程，**不代表獲得播放權限**。這避免用 IsActive=0 建立後，現有 issue 又無法授權的死結。

名稱、IP 或到期完整設定保存時，SQL 重新產生佔位雜湊、清除 QueryModeGrantVersion／DelegatorTokenVersion／LastUsedAtUtc；保留原委派者與工作站。原 Token 無法再匹配，後續須使用既有版本化 Query-only credential API 明確授權。即使放寬 IP／延長日期，也不會延長原憑證權限。

播放位置不改 Token／grant／委派者／敏感政策；只推進管理聚合版本並強制稽核。Dashboard RowVersion 也會使依賴它的執行快照保守失效，沒有降低 5A-3A 保護。

管理模式開啟時，原 `/:id/devices` 下無版本 POST/PUT/PATCH/DELETE 一律回應 DASHBOARD_DEVICE_VERSIONED_API_REQUIRED；保留 Legacy API 與純讀入口。管理旗標關閉時，僅後端明確 LEGACY 模式可繼續原流程；非 Legacy 仍拒絕。沒有恢復舊核發／續期流程。

## 前端操作

新版管理頁內新增「裝置建立與基本設定」。載入本契約快照才能啟用按鈕；建立／metadata／placement 保存均明確確認，攜帶自己的最新版本。來源／模式／裝置操作事件會撤銷寫入依據；API 拒絕保留草稿並鎖定保存，須明確確認重新載入，無自動覆寫或重試。

成功寫入會通知既有管理區重新載入並清除記憶體內憑證，重新編輯也必須明確重載。未取得新 API／Schema／權限時維持停用；不改接 Legacy API。

## 修改檔案

| 檔案 | 用途 |
| --- | --- |
| server/src/modules/dashboard/dashboardDeviceManagement.schema.ts | 嚴格 metadata、位置、版本驗證 |
| server/src/modules/dashboard/dashboardDeviceManagement.service.ts | 身份／Query／delegator、聚合版本、不可恢復狀態與操作協調 |
| server/src/modules/dashboard/dashboardDeviceManagement.repository.ts | 既有 Schema 探測、鎖定、SQL 寫入、失效與同交易強制稽核 |
| server/src/modules/dashboard/dashboardDeviceManagement.routes.ts | JWT 後的權限／版本化契約、Legacy 無版本寫入守衛 |
| server/src/modules/dashboard/dashboard.routes.ts | 掛載新 API 與守衛 |
| server/src/modules/dashboard/dashboardDeviceManagement.test.ts | 使用實際 Repository／Service／JWT middleware 的 SQL Mock 安全回歸 |
| client/src/components/DashboardDeviceMetadataManager.tsx | 最小版本化 metadata／位置編輯，衝突保留草稿 |
| client/src/components/DashboardQueryPlaybackManager.tsx | 統一管理入口接線 |
| client/e2e/dashboard-device-management.spec.ts | 新版 UI 的 Mock Chromium 回歸 |
| docs/dashboard-device-management-5b3a.md | 契約、安全邊界、驗收與後續工作 |

## 5B-3B 待完成項目

- 工作站新綁／換綁、委派者變更、已撤銷／停用／過期裝置恢復、封存／封存政策仍不提供寫入；必須另定版本、權限、強制稽核與失效契約。本階段不重新設計 PIN。
- Query-only 播放旗標關閉時的獨立模式停用／撤銷契約仍未實作；UI 不宣稱資料庫模式已停用。播放旗標本身持續阻擋播放；Legacy 單向安全停用仍沿用 5A-3B。
- 一般使用者 Query-only 播放仍屬 5C，未改造 Legacy 播放入口。

## 真實環境驗收

本次僅 Mock／合成資料、Linux Chromium 與 CI，不連線正式 SQL Server／Oracle，沒有建立／執行 Migration、修改 .env、旗標或使用患者資料。

隔離 SQL Server 需確認：916–919 與既有 025/026/900/901 約束實際相容；RowVersion 型別與單調推進；SERIALIZABLE 範圍鎖、兩位管理員競爭、與核發／撤銷／工作站管理的鎖順序與 deadlock；稽核拒絕與 SQL/commit 故障時回復；TokenHash UNIQUE 及 null grant 契約；ExpiresAtUtc 的 DATETIME2(0) 精度與時鐘邊界；播放設定 FK、跨 Dashboard 拒絕；IP 改變後舊憑證及分頁快照拒絕；逐頁患者曝光稽核。

Windows Server／實體瀏覽器需驗證多螢幕與負座標、指定螢幕、全螢幕、重新授權／重新整理、IP／到期及既有 PIN／工作站認證。自動化通過不代表真實醫院環境已驗收。

## 自動化驗證結果

- Server build、typecheck 通過；560 項測試通過（基準 514 + 本次新增 46）。
- Client build、typecheck、npm test 通過。Node 24 的 npm test 輸出為 9 個檔案結果，另逐檔直接執行確認 37 個案例通過；未把檔案數當作案例數。
- 新增裝置管理 Chromium E2E 9 項通過；完整回歸 91 項通過（基準 82 + 9）。
- 回歸覆蓋 metadata-only、不交付憑證、RBAC/JWT/TokenVersion/ACL、Schema／RowVersion 證據、競爭版本、A→B→A、SQL／版本推進／強制稽核／commit 故障 rollback、失效裝置不恢復、原委派者／工作站不可修改、位置與遮蔽安全邊界，以及 UI 保存、重新載入、403/409/503 草稿保護、旗標拒絕及無 Legacy fallback。
- SQL 層使用注入 Mock、交易隔離模型與 SQL 結構檢查，不能據此宣稱實際 SQL Server 已驗證鎖、rollback 或憑證失效。GitHub CI 狀態以最終提交後的工作流程為準。
