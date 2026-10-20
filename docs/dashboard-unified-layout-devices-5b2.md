# 5B-2 版型與裝置管理整合

## 完成範圍與阻斷

本階段可安全完成的部分為：新版唯一版型寫入、版本配對與衝突草稿保護、管理導覽、既有版型／裝置設定唯讀顯示、版本化 preflight／模式切換／憑證操作，以及原始 Token 不進入 DOM 的交付流程。

**5B-2 為部分完成**：缺少安全 API 的裝置新建、名稱／IP／到期／播放位置修改、工作站換綁與裝置封存寫入已停止整合。沒有重新使用舊寫入作為 fallback，也沒有自行擴充後端安全契約。一般使用者 Query-only 播放仍留待 5C。

未修改 Server、Migration、環境設定或播放旗標；未呼叫正式 SQL Server／Oracle，未移除 Legacy 播放 API、Dashboard 實體刪除守衛或任何歷史資料。

## 修改檔案

| 檔案 | 目的 |
| --- | --- |
| `client/src/pages/DashboardLayoutDesignerPage.tsx` | 移除 Legacy layout PUT 與執行 fallback；版本前後配對；保留多尺寸、固定文字、FIELD、TABLE、樣式與引用；衝突鎖定、明確重載；pending／停用／未知來源提示 |
| `client/src/pages/DashboardDesignerPage.tsx` | 統一管理導覽與裝置入口；移除舊固定播放／Token 核發與顯示 UI；管理清單預覽改走既有安全 Query page API |
| `client/src/components/DashboardQueryPlaybackManager.tsx` | 聚合 Legacy 安全停用、模式、預檢、核准紀錄、裝置與唯讀播放位置；憑證只存記憶體；旗標拒絕為預期安全狀態；失敗撤銷前端寫入依據 |
| `client/src/components/DashboardDataSettingsEditor.tsx` | 修復核准重新載入的政策就緒競態：舊讀取失效，同版本亦重驗政策，本輪政策完成前禁止重新確認 |
| `client/src/dashboard/managementStatus.ts` | 嚴格解析模式與預檢證據；裝置到期／撤銷／封存區分；唯讀位置資料驗證；安全錯誤說明 |
| `client/src/dashboard/managementStatus.test.ts` | 模式、預檢、來源／裝置證據、到期／撤銷／封存、旗標與位置資料拒絕測試 |
| `client/e2e/dashboard-layout-management.spec.ts` | 版型完整 round-trip、競態、版本衝突與來源限制的新增 Chromium 測試 |
| `client/e2e/dashboard-query-mode.spec.ts` | 保留既有版本化授權與可信視窗交付；新增旗標、到期、封存、pending、核准、政策／權限拒絕、刷新與唯讀設定測試 |
| `client/e2e/dashboard-masking.spec.ts` | 管理預覽改驗證新版受保護 page API；Legacy 播放安全案例仍保留 |
| `docs/dashboard-unified-layout-devices-5b2.md` | API 對應、缺口、驗證及實機驗收說明 |

## 操作順序與可信證據

建立停用草稿 → PRIMARY／額外來源 → 明確敏感欄位核准 → 設計版型／預覽 → preflight → 啟用 → 明確裝置授權。

導覽順序本身不代表任何步驟完成。介面分別顯示後端的 Dashboard mode／editable、PRIMARY 轉換標記、pending Query 綁定、逐來源明確核准紀錄、預檢結果與裝置已儲存設定。

已保存核准紀錄不等同完整授權；預檢通過只代表當時結果，不代表已核發憑證或患者資料已可傳送。模式、設定或安全 API 拒絕後，前端清除既有 readiness／憑證，不自動重試寫入。核發與逐頁資料執行仍依原有後端 JWT／TokenVersion／RBAC／Query ACL、委派者、工作站、IP、遮蔽與曝光稽核守衛。

## 版型操作與 API

路徑前綴為 `/api/dashboards`。

| 操作 | API | 行為 |
| --- | --- | --- |
| 讀取既有版型 | `GET /:id/layout` | 純讀；沒有建立預設版型或載入後自動寫入 |
| 讀取來源、版型版本 | `GET /:id/query-sources/v1/configuration` | 在 layout GET 前後各讀一次；版本不同時保留讀取內容，禁止儲存，避免舊版型配新版本 |
| 儲存所有版型 | `PUT /:id/query-sources/v1/layout` | 唯一 writer，使用配對的 expectedVersion；保留各 profile、Widget、SourceKey、座標／尺寸／樣式／排序／config |
| 管理設計預覽 | `POST /:id/query-sources/v1/PRIMARY/page` 及 `/:sourceKey/page` | 沿用既有 JWT 安全執行與逐頁稽核；失敗不回落 Legacy SQL／Dataset |
| 獨立設計預覽 | 既有 designer display 的 `queryPreview=1` | 只接線既有設計預覽；未改一般使用者播放邏輯 |

pending 來源不可新選為 Widget 資料來源；停用、pending 或未知 SourceKey 的既有引用保留並提示，禁止不安全儲存。後端現有版本化 layout API 也會拒絕 pending、無效來源引用、權限或政策失敗。

核准區重新讀取後，也必須等待本輪 Dataset 政策完成；不得短暫沿用上一輪 ready 狀態。

版本衝突後保留草稿，鎖定儲存，必須明確確認重新載入；不以新版本自動重送舊草稿。其他管理區變更同樣使版型寫入依據失效，不覆蓋未儲存設計。

## 裝置與授權操作 API

| 操作 | API | 管理行為 |
| --- | --- | --- |
| Legacy 單向安全停用 | `GET/POST /:id/legacy-disable/v1` | 沿用 5A-3B 最新專用版本、確認、強制稽核與憑證失效交易；獨立於播放旗標 |
| Query-only 模式／預檢 | `GET /:id/query-mode/v1`、`GET /:id/query-mode/v1/preflight` | 驗證可信版本、modeVersion 與完整檢查證據；只顯示後端結果 |
| Query-only 啟用／停用 | `POST /:id/query-mode/v1` | expectedVersion、明確確認；啟用須來源／核准證據及同版本預檢；由後端再次驗證與撤銷原憑證 |
| 核發／重新核發 | `POST /:id/query-mode/v1/devices/:deviceId/credential` | 只針對既有、啟用、未封存且到期證據可確認的裝置；expectedVersion；後端重驗委派者、工作站與 ACL |
| 撤銷 | `DELETE /:id/query-mode/v1/devices/:deviceId/credential` | 版本與明確確認；不依賴當前 Query ACL 已有效才可撤銷；刷新不復活原憑證 |
| 裝置已儲存設定 | `GET /:id/devices` | 顯示識別、委派者 ID、IP、到期與撤銷／封存紀錄；不由 metadata 推定有效播放授權 |
| 播放視窗位置（唯讀） | `GET /:id/devices/:deviceId/playback-settings` | 保留讀取瀏覽器、多螢幕、全螢幕與位置／尺寸；無安全 writer 時不提供假儲存 |
| 明確核准紀錄（唯讀） | `GET /:id/column-approvals` | 讀取完整來源核准；與 configuration 前後版本比對；不修改 Dataset 政策或自動核准 |

原始 Device Token 只存在本頁記憶體 ref，不進入 DOM、URL、console、localStorage 或 sessionStorage；沒有顯示／複製按鈕。沿用可信同源視窗的一次性交付，不新增播放器。重新整理、管理區重載、模式／來源變更、失敗或退出本頁會清除憑證。到期 UI 僅可保守拒絕；實際時效與授權一律由後端判定。

## 明確停止的功能與最小補強

| 功能 | 已確認缺口 | 目前處置／最小後續工作 |
| --- | --- | --- |
| 新建裝置 | 舊 `POST /:id/devices` 同時核發 Legacy Token，沒有新版 metadata-only 建立契約 | 移除舊固定播放建立入口；先設計版本化建立／委派契約，不拿舊 Token 作替代 |
| 名稱、IP、到期與位置修改 | 舊 settings PATCH、renew PATCH、playback-settings PUT 沒有 expectedVersion；使用更新後另行 tryWriteAuditEvent | 僅顯示既有值；先補版本衝突、強制稽核與交易一致性契約，再接寫入 UI |
| 已撤銷／停用／過期裝置恢復 | 既有安全 issue 只接受有效裝置；沒有明確的安全恢復／續期／重新綁定 API | 不透過刷新或舊 renew/reissue API 恢復；須先補新授權流程並保留原身份及歷史 |
| 工作站綁定詳情／換綁 | list DTO 沒有 SharedWorkstationId／可信綁定狀態；沒有版本化綁定 writer | UI 明示「尚未提供」，不推定未綁定或已通過；後端預檢仍驗證工作站。先補受權限保護的讀取與版本化換綁契約，不改 PIN 認證 |
| 裝置封存／政策修改 | 舊 archive POST／archive-policy PUT 沒有 expectedVersion；封存與 Dashboard 退役沒有統一安全管理契約 | 保留歷史狀態唯讀並說明差異，不硬刪；另設計版本化、不可誤恢復的封存契約 |
| 播放旗標關閉時，資料庫中的 Query-only 模式停用 | 現有 query-mode read/change/revoke 均受播放旗標 gate；旗標關閉不等於 Dashboard IsActive 已改為 false | 顯示預期安全拒絕，不冒稱停用交易完成；不回退 Legacy、也不開旗標。若要此時改管理狀態，須另定獨立安全停用契約 |

補強前須先決定裝置獨立版本或 919 聚合版本的使用方式、稽核與撤銷一致性；本階段未新增 API、未決定或執行 Migration，不以無版本舊 API 降低保護。

## 尚存 Legacy UI 與 5C

新版管理頁已移除舊裝置核發／固定播放與整體版型 writer。`DashboardDisplayPage` 仍保留 Legacy designer/device 播放與既有 Query-only 設計預覽／裝置資料路徑；`DashboardPortalPage` 的一般使用者導覽亦未改造。這些留待 5C 的一般使用者 Query-only 播放與後續退役，不宣稱已完成。

5C 仍需定義／實作一般使用者 JWT／VIEW_QUERY／EXECUTE_QUERY 的 Query-only 播放導覽與授權；多來源 Widget、快照／分頁、離線與權限撤銷時清除資料、逐頁曝光稽核及功能旗標驗收。不能以管理端 preflight 或裝置核發成功替代一般使用者授權。

## 實際驗收需求

- Windows Server／實體瀏覽器：現有多尺寸、多螢幕、固定文字／FIELD／TABLE／樣式、取消／重載／跨管理員衝突、同源視窗交付、重新整理／重啟等待授權、IP／期限／撤銷及 PIN／工作站既有登入流程。
- 隔離 SQL Server：917–919 Schema、版型指紋／RowVersion／鎖、並行更新、交易 rollback、強制操作稽核失敗、憑證旋轉／撤銷原子性、FK／Widget 引用與患者逐頁曝光稽核。
- Mock、Linux Chromium、CI 成功只屬自動化證據；不代表真實醫院、Windows Server、SQL Server／Oracle 或患者資料稽核已驗收。

## 自動化驗證結果

- Server build、typecheck 成功；514 項測試通過。
- Client build、typecheck 成功；37 項單元測試通過。
- 完整 Chromium E2E：82 項通過，保留既有 5B-1、Legacy 播放防護與 PIN／工作站回歸。
- 相較指定基準，新增 6 項單元測試與 14 項 E2E。核准重新載入衝突案例另連續 4 輪、共 8 次檢查通過；補上阻擋 Dataset 政策回應的測試，確認本輪政策完成前不能重新核准。
- 首輪最終回歸曾發現核准政策就緒競態；已修正並完整重跑通過，不將該次失敗省略為「從未失敗」。
- 測試僅使用 Mock／合成資料及 Linux Chromium；CI／本機成功不能替代上列真實環境驗收。
