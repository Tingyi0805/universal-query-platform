# D4-D：裝置操作歷史（唯讀）

基準 `23c9dfe95e7c997e63b78a1011a63d89eb29d9ff`。只新增既有裝置頁的歷史明細與範圍受限的 Audit 查詢，不新增永久歷史表、Migration 或生命週期 writer。

## 第一階段盤點結論

- `dashboardDeviceManagement.repository.ts::deviceAudit` 將 `DASHBOARD_DEVICE_${action}` 經既有 `writeAuditEvent` 寫入 **AuditLog**。根層 ParametersJson 為 `{dashboardId,deviceId,credentialIssued,deviceCredentialsInvalidated,...}`；續期另含 extendDays／前後期限，ENROLLED 另含 authorizationMethod。不以 QueryDefinitionId、DatasetId 或 EventType 推測裝置範圍。
- CREATED、METADATA_UPDATED、PLACEMENT_UPDATED、RENEWED 在管理 service 明確呼叫；SUSPENDED、RESTORED_PENDING、REVOKED、ARCHIVED 由 lifecycle action 映射；TOKEN_ISSUED_PENDING、ENROLLED 由 enrollment service 呼叫。十種事件都有寫入路徑。Legacy dashboard.routes 的 CREATED／REVOKED 也使用相同根層 dashboardId／deviceId。
- `006_audit_log.sql` 定義 LIVE 的 ParametersJson NVARCHAR(MAX)、UserId、Status、ErrorCode、CreatedAtUtc；`016_audit_retention.sql` 定義 ARCHIVE 相同 JSON／事件／結果／時間，另保存 Username／DisplayName。`archiveOldAuditLogs` 逐字複製 `a.ParametersJson`，不改鍵名／層級。因此兩來源可採完全相同的雙 ID 安全條件。
- 實際正式環境資料及部署 Schema 未查詢。本盤點依原始 SQL DDL、實際 writer／archive SQL 與既有交易契約；正式 SQL 禁止操作。本次 CI 隔離驗收會套用原 006／016 DDL 並執行原封存 SQL 驗證相容性。
- retention 預設線上 365 天、封存 1,825 天，importantPermanent=true；設定讀取沿用現有合法最小天數與政策。DASHBOARD_* 經 writer 分為 CONFIG／important。搬移略過 STARTED，同交易複製後刪除 LIVE；清理僅依既有政策，不由歷史 UI 觸發。
- VIEW_AUDIT 已存在。全域 Audit API 只要求 VIEW_AUDIT，裝置管理入口要求 DESIGN_QUERY；新端點要求兩者，並在交易內重驗 live TokenVersion／角色。不要求 EXECUTE_QUERY，亦不新增管理／封存／刪除權限。

## API

`GET /api/dashboards/:id/device-management/v1/:deviceId/history`

Query：source=LIVE（預設）或 ARCHIVE；eventType 可省略，否則只能是上述十種 **完整 DASHBOARD_DEVICE_* 名稱**；startDate／endDate 為 YYYY-MM-DD；username 為帳號 literal substring，最多 100 字且不允許控制字元；page 預設 1、正整數最多六位；pageSize 僅 10／20／50／100、預設 20；offset 上限 1,000,000。拒絕未知／重複／物件參數及不合法值（400）。日期支援 1000～9998，起日不得晚於迄日。

日期以 IANA Asia/Taipei 的完整曆日解讀：`[起日第一個實際時刻, 迄日下一曆日第一個實際時刻)`，在 Server 轉 UTC DateTime2 比較。不是瀏覽器本地日界；歷史夏令時間的 23／25 小時日界亦按時區處理。回應操作時間為 UTC ISO，UI 固定台北時區顯示 YYYY-MM-DD HH。

回應 `{dashboardId,deviceId,source,items,total,page,pageSize}`；items 僅含 `id`（BIGINT 保留為字串）、createdAtUtc、eventType、username、displayName、status、errorCode。Status SUCCESS／FAILED／STARTED 顯示成功／失敗／未完成。errorCode 僅允許明確列出的公開代碼，其餘 NULL；不輸出 ParametersJson、IP、UA、Query／Dataset、Token、Hash、Cookie 或 Credential。

SQL 先確認 Device 屬於指定 Dashboard（包含已封存／撤銷列，無還原行為），不屬於則 404。LIVE／ARCHIVE 共用 ISJSON 防護與 OPENJSON 根層 predicate；要求 dashboardId／deviceId 各恰好一個、鍵名大小寫與長度完全相符、JSON number 型別且 canonical ID 精確匹配。缺鍵、字串 ID、重複鍵、嵌套／畸形 JSON、錯 Dashboard／Device 均不當成可歸屬紀錄，不回退全域 Audit 查詢。來源表選擇只允許兩個固定表名，其他值均參數化。

SQL 在既有 SERIALIZABLE 管理交易中執行條件篩選、COUNT_BIG 及 OFFSET/FETCH，固定 `CreatedAtUtc DESC, Id DESC`。不在 Node 下載全量分頁。COUNT／當頁在同次交易一致；不宣稱不同頁之間是保留歷史快照，並行新增／封存／清理可能改變 total 或頁面邊界。LIVE 與 ARCHIVE 分別查詢，不做合併或假造完整跨來源 ledger。

兩個 Audit 表與 JSON 查詢能力（DB compatibility >=130）必須存在，否則安全拒絕；不自動修 Schema。JSON 範圍沒有新增 computed column／索引，大量 Audit 資料時仍需評估查詢與鎖定成本，沒有偷偷新增 Migration。

## UI 與已知資料界線

重用 D4-C ARCHIVED 篩選，從當頁裝置的「更多操作 → 查看操作歷史」開啟明細；只有具稽核檢視權限者提供入口。沿用 Audit 篩選／狀態樣式、原生日期欄位與觸控操作區；窄螢幕以逐列標籤呈現，無需橫向捲動。

支援資料區、事件、日期、帳號、每頁筆數與分頁；篩選後回第一頁。AbortController／request sequence 在切換來源、裝置、Dashboard、關閉、卸載及離頁時拒絕舊回應。Loading／Empty／Error／Retry／權限不足與 scope 不符均不展示舊紀錄或原始錯誤內容。所有歷史動作唯讀，沒有復原封存裝置、修改撤銷、刪除歷史等入口。

管理寫入與 Audit 為同一交易，**失敗回滾不保證有 FAILED Audit**；Legacy tryWrite 也可能缺少紀錄。新 UI 只呈現現有、可歸屬且仍留存的 Audit，不宣稱每次嘗試均被記錄，不補寫失敗事件。ENROLLED 的 UserId 是既有委派者授權主體，非瀏覽器實際操作者身分證明。LIVE 使用目前 AppUser 名稱；ARCHIVE 使用封存時的名稱快照，不宣稱是事件發生時的不可變名稱。

## 測試

新增單元／HTTP 驗證 strict query、雙權限、兩來源一致守衛、live session、台北日期／閏日／歷史 DST、SQL parameter binding、BIGINT ID、安全錯誤碼、無機密欄位與原寫入不變。Client 驗證 scope／來源／分頁與公開 DTO；Browser 涵蓋 ARCHIVED 入口、來源／事件／日期／帳號／所有筆數選項、分頁、無權限、空資料、錯誤重試、晚到回應、關閉及 390px 觸控版面。

必要 SQL 擴充沿用現有 guarded disposable harness：套用原 Audit DDL，使用實際 Audit writer、實際歷史 SQL 及原 archive SQL，驗證十種事件、雙 ID 隔離、重複／畸形／嵌套／錯型別 JSON、中文與 literal username／注入字串、UTC 日期邊界、COUNT／排序／分頁、錯誤遮蔽及 LIVE 搬移 ARCHIVE 後條件保持一致。不連正式 SQL，不修改 Migration 926、Token／Cookie／Enrollment／IIS／BAT，不開始 D5。
