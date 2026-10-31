# D4-C1 — 唯讀裝置清單

基準 `bc9e2324e6284318819462eda2dc2213c4380700`。新增 `GET /api/dashboards/:id/device-management/v1/list`，不更動原 `/v1`、`/lifecycle` 完整快照或生命週期寫入契約。

## Query / 回應

- `search`：trim 後最多 200 字，拒絕控制字元；裝置名稱 literal substring（沿用 DB collation），或 canonical 正整數安全 ID 的精確匹配。LIKE 的 `% _ [ ] \` 全部 escape；值以 mssql parameters 綁定，沒有動態 SQL 或使用者 ORDER BY。
- `status`：預設 ALL，接受 ACTIVE、SUSPENDED、PENDING_REENROLLMENT、REVOKED、ARCHIVED、EXPIRED、UNVERIFIED。SQL 先拒絕不符合 D1 的組合，再依 archived → revoked → expired → suspended → pending → unverified 判定。此安全管理 API 不取得 live Token／ACL 播放證據，因此 **ACTIVE 查詢目前回傳空結果**，不把 IsActive、grant pair 或 reenrollment=false 猜成 ACTIVE。
- `page`：canonical 正整數字串，預設 1、最多六位；`pageSize` 僅 10／20／50／100，預設 20；offset 不得超過 1,000,000。重複參數、物件、未知參數、非法數值回覆 400。超出結果末頁回傳空 items 與真實 total。
- 第二頁起必須傳第一頁的 `snapshot`，並保持 search／status／pageSize 不變；第一頁可不傳 snapshot 以明確重新取得清單。
- 回應：`items, total, page, pageSize, asOfUtc, validUntilUtc, sort:"ID_ASC", snapshot, consistency:"CONTENT_CHECKED_UNTIL_EXPIRY", writeVersionIncluded:false`。items 只含 Device／Dashboard ID、名稱、委派者／工作站 ID、啟用與生命週期標記／時間、IP 限制設定、status。無 Token、TokenHash、credential fingerprint、grant、Cookie、患者資料、完整 expectedVersion。

## SQL 與一致性界線

沿用現有 SERIALIZABLE store、schema／926 唯讀 attestation、live JWT TokenVersion、DESIGN_QUERY 安全讀取，不要求 EXECUTE_QUERY／Query ACL；不新增寫入權限。保留 Dashboard → Device 鎖定順序。SQL Server 將同 Dashboard 列暫存於 SQL temp table，完成參數化搜尋、狀態篩選、COUNT_BIG、固定唯一 Id ASC 及 OFFSET/FETCH；只有 metadata 與一頁安全 rows 離開 SQL，不在 Node 取全量分頁。

每次在同一交易對 **未經篩選的全部裝置清單相關欄位**，依 Id 排序，以 SQL FOR JSON（含 NULL）與 SHA-256 計算內容指紋。涵蓋所有回傳欄位及影響 D1 合法性的 TokenHash／grant；私有指紋只送到 service，再以 process-random key 的 HMAC 綁定 Dashboard、使用者／TokenVersion、查詢條件、pageSize、固定 as-of 與期限。公開 snapshot 只有 as-of、期限及簽章，沒有 DB 指紋或 TokenHash。

未到期且簽章相符的續頁，必須觀察到同樣完整內容；新增、刪除、名稱／IP／期限／委派／工作站／credential／生命週期等相關內容差異均使舊 snapshot 回覆 **409 DASHBOARD_DEVICE_LIST_CHANGED**。不僅比較 COUNT、MAX(Id)、Dashboard timestamp 或本頁內容。簽章最長五分鐘，並在所有非終止裝置下一個到期時間提前失效，因此即使沒有任何寫入，時間跨越狀態邊界也要求重載。角色／session 每頁重新驗證。process 重啟或跨 instance key 不同時 fail-closed 要求重載；不需永久 key 或 schema 調整。

這是「固定時點分類＋目前完整內容相符」驗證，**不是保留歷史版本的資料庫 snapshot 或不可逆修訂 ledger**。中途變動又完整還原成完全相同內容（ABA）不會被當成歷史事件偵測；但接受的頁仍對應相同排序及相同完整清單內容，不宣稱偵測所有歷史操作。LastUsedAtUtc 播放活動與未回傳的 placement／Audit 歷史不影響本清單內容，不作為跨頁失效依據。若需要偵測每次歷史修改／ABA，必須另設持久 revision／change tracking，不能以現有 timestamp 假冒，本階段沒有新增該機制。

COUNT／內容指紋需在 SQL 掃描全部相關列並持有序列化讀鎖；不是低成本 revision 或長時間快照，資料量大時可能增加寫入等待。沿用 DB timeout／錯誤處理，不回退至 Node 全量分頁。沒有新增索引或 Migration。

snapshot 不是寫入版本，不能送作 expectedVersion；所有寫入仍須取得既有完整管理快照版本、明確確認及後端重驗，衝突不自動重送。本階段不做 D4-C2 UI 或 D4-D。

## 驗證

新增單元／真實 JWT HTTP 測試：strict query、所有大小、安全 offset、literal SQL binding、snapshot 綁定／篡改／過期／time-only 邊界、DESIGN_QUERY without EXECUTE、角色／撤銷 session／旗標／schema、敏感欄位投影、no-store 及原完整快照契約回歸。

擴充既有 guarded disposable SQL harness，執行實際清單 SQL：中文／特殊字元／注入字串／精確 ID、D1 狀態逐列比對（完整 grant 仍 UNVERIFIED）、COUNT／每頁大小／邊界／空結果／穩定排序、跨頁新增／更新／撤銷／刪除、只因時間到期失效、不同連線並行新增／修改／撤銷的序列化鎖與續頁衝突。只在既有隨機資料庫與 machine identity guard 之後執行，沿用 CI 容器與清理，無正式連線。

本機沒有 SQL Server image；實際 SQL 由完整 CI 的 disposable SQL job 驗證。本機 Server 全量 2,182 案例、專項 201 案例、Typecheck／Build 通過；schema／旗標 HTTP 補測亦通過。完整 Windows／Client／Browser／SQL 結果以本提交 CI 為準。未修改 Migration 926、Token／Cookie／Enrollment／播放授權或生命週期 writer，未操作正式 C:\UQP 或 SQL Server。
