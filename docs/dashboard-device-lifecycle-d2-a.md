# Dashboard Device D2-A — 暫停／恢復後端

基準 HEAD：`178ed79577a80ba34e32e4f25456ebe3bf950724`，沿用 [D1 契約](dashboard-device-lifecycle-d1.md) 與 Migration 926，未修改 Migration、Cookie、BAT、IIS 或 IP resolver。沒有 UI、Token 核發或 enrollment 新流程。

## API

既有 JWT 驗證、管理 feature flag、DESIGN_QUERY 與 live TokenVersion 均必須通過；恢復另要求 EXECUTE_QUERY，暫停與安全快照沿用永久撤銷的 DESIGN_QUERY 止血權限：

- `GET /api/dashboards/:id/device-management/v1/lifecycle`：提供安全管理快照及完整版本，不驗證 Query ACL，因此委派者失去 Query 權限後仍能取得暫停所需版本。只回傳裝置設定，沒有 Query 資料、Token、hash 或 fingerprint。
- `POST /api/dashboards/:id/device-management/v1/:deviceId/suspend`
- `POST /api/dashboards/:id/device-management/v1/:deviceId/restore`

POST 嚴格接受 `{ expectedVersion: string, confirmed: true }`，禁止額外欄位。回應 `Cache-Control: no-store`、`credentialIssued:false`、`deviceCredentialsInvalidated:true`。管理快照新增 nullable `suspendedAtUtc`／`reenrollmentRequired`，並納入版本；不把標記當作播放授權證據。

## 交易與安全

沿用 SERIALIZABLE 交易與 Dashboard／Device 的 UPDLOCK、HOLDLOCK；版本涵蓋設定、approval evidence、全部裝置欄位（含私有 credential fingerprint 與生命週期標記），排除 LastUsedAtUtc。新操作在同一交易內先執行唯讀 `requireDeviceLifecycleSchema`，缺少／損壞 926 回覆 503，沒有 migration 或自動修復行為。既有一般管理讀取保留 absent／NULL 欄位相容。

暫停只接受未到期、未撤銷／封存的 active 且非 suspended 裝置；使用 DB DATETIME2(0) UTC、停用、CSPRNG tombstone hash、清除兩個 grant、pending=true。不要求操作者或委派者的 Query ACL，也不要求委派者帳號／工作站仍有效，以保留止血能力；操作者的管理 RBAC 與 session 檢查仍不可省略。

恢復重驗操作者及原委派者的全部來源 Query ACL、Query／Dataset 可用性、參數與委派者權限、工作站；SQL 再檢查 suspended、未到期、未撤銷／封存，只改回 active、清暫停、再旋轉 tombstone，維持 pending=true 及空 grant。Device／Dashboard／原到期日不變。DB 回傳事件時間後，以 D1 transition validator 驗證前後狀態，任何不一致回滾。相同動作重送採衝突／不可編輯拒絕，不新增第二筆 Audit。

同交易 touch Dashboard 並要求 `DASHBOARD_DEVICE_SUSPENDED`／`DASHBOARD_DEVICE_RESTORED_PENDING` Audit 回傳有效 ID；Audit 失敗、無有效 ID、後續讀取／commit 失敗均回滾。既有 Query-mode 永久撤銷 writer 可撤銷 suspended／pending 列並清除兩個標記；無 926 時保留舊 SQL，不引用不存在欄位。恢復與撤銷共用鎖定順序，撤銷先提交會使舊完整版本失效；恢復先提交也不阻止後續永久撤銷。

播放繼續使用 D1 fail-closed guard；暫停與恢復 pending 都不交付資料。即使 Cookie 未清除或尚持有 matching hash 的測試證據，persistent enrollment、short session、layout、page 與舊 Token enrollment 都被拒絕。沒有修改 Cookie 實作。

## 驗證與界線

本機受影響測試 209/209 PASS，Server Typecheck／Build PASS。

受影響測試涵蓋 API 確認／版本／no-store、兩次 hash 輪替、重複與並行操作、雙方 ACL／session／工作站、terminal／expired、Audit 與 commit 失敗回滾、撤銷／恢復兩種交易順序、舊欄位 absent／NULL 與未安裝 926 的永久撤銷 SQL、舊 Cookie 的零資料交付。此階段使用合成交易／HTTP 測試，不宣稱已在 SQL Server 執行新 API SQL 或部署到正式環境。未操作正式 SQL 或 C:\UQP。

## D2-B 必須接續

1. pending 裝置的本輪新 Token 核發：完整 Query-only／公共政策／RBAC 重驗，核發仍保持 pending=true；盤點 metadata、模式切換等所有失效 writer，確保不會清掉 pending 或繞過生命週期。
2. 受限且不交付患者資料的 enrollment proof：驗證本輪新 Token、live Device／IP／ACL／Query-only／公共政策；原子完成 pending=false，交易提交後才建立既有 Cookie。舊 Token／Cookie 永遠不能完成新一輪 enrollment。
3. 隔離 SQL Server 驗收實際暫停／恢復／撤銷 writer 與 926 trigger、競爭與 rollback；正式 926 的備份、唯讀盤點、核准與部署仍須另行安排。本提交沒有執行這些部署步驟。
