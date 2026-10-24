# 階段 5A-3B：Legacy 停用、pending 核准撤銷與硬刪除保護

本階段只提供後端安全基礎與 Mock／合成資料驗證；未接管理 UI、執行 Migration、啟用旗標或連線正式 SQL Server／Oracle。沿用既有 917–919。不能把本文件或 CI 結果當成真實資料庫／裝置驗收。

## 1. Legacy 安全停用

- `GET /api/dashboards/:id/legacy-disable/v1`：回傳 DashboardId、LEGACY、IsActive 與 opaque version。
- `POST` 同一路徑：嚴格接受 `{expectedVersion, confirmed:true}`。不接受 IsActive、activate、Query、參數、來源、版型或核准欄位。

此操作不受管理／播放能力旗標限制，但要求有效 JWT、TokenVersion、DESIGN_QUERY，以及實際可用的 917／918／919 Schema。交易內再次驗證帳號與權限；臨床 Query 的 canExecute 或 EXECUTE_QUERY 被撤銷，不應阻止具設計管理權的使用者停止曝光。

只允許 `LEGACY + IsActive=true → IsActive=false`。只更新 IsActive 與技術版本／更新時間；保留 Query、所有參數／核准、來源、版型與模式。Query-only 必須繼續使用既有 query-mode 停用契約；重複停用、過期版本或其他模式回 409，沒有啟用操作。

SERIALIZABLE 內鎖定父 Dashboard，讀取父／全來源 RowVersion，之後更新裝置。讀取停用版本不解析 Query 參數或版型 JSON，避免設定損壞阻止安全停機。所有裝置 TokenHash 都旋轉並清除模式授權；不回傳新 Token，不刪裝置，也不改動其到期、設定或原始委派者。裝置身分與有效狀態保留，供後續既有流程明確重新授權。

停用、憑證失效、`DASHBOARD_LEGACY_DISABLED` 強制操作稽核同一交易。任一失敗則 rollback；不回傳停用成功。稽核只記錄操作者、DashboardId 與憑證已失效標記。

## 2. pending 額外來源明確撤銷核准，再轉換

舊問題：有核准的 pending 來源不能換綁 Query；管理旗標啟用後 Legacy 核准 API 被隔離，而新版 disclosure 又拒絕 pending。不得用關閉守衛、手改 JSON 或猜 Dataset→Query 映射解決。

流程：

1. 先以 Legacy 安全停用或既有 Query-only 停用 API 停止播放。
2. 管理能力已啟用時，讀取 `GET /api/dashboards/:id/query-sources/v1/:sourceKey/pending-approvals`。
3. 管理員確認指定 sourceId／精確 SourceKey 的舊核准要撤銷，再 `POST` 同一路徑，嚴格 body 為 `{sourceId, expectedVersion, confirmed:true}`。
4. 重新 GET 既有 `/query-sources/v1/configuration` 取得當前設定版本。管理員明確選擇 Query，沿用既有增量 PATCH；不自動重送過期版本、不自動選 Query。
5. 初次 pending 轉換仍要求 Query 有效、已發布、未封存，操作者有 canView／canExecute，必要參數正確，且現行 Query Dataset 等於歷史 DatasetId。保持 Source Id／Key／歷史 DatasetId／元件引用。
6. 轉換後重新使用既有 disclosure 契約核准欄位。沒有核准的欄位仍由伺服器 OMIT；轉換不啟用 Dashboard、不發憑證、不代表可直接播放。仍須完成 PRIMARY、版型、政策／患者證明、預檢、模式啟用及憑證核發。

撤銷只允許停用的 LEGACY／QUERY_ONLY_DISABLED、仍未綁 Query 的額外來源，禁止 PRIMARY、已綁定來源、錯誤 Id、大小寫錯誤或歧義身份。要求 JWT／TokenVersion／DESIGN_QUERY，並在交易內驗證主 Query ACL 與參數。不能利用本 API 寫 QueryId、參數、版型、Dataset 或批次來源。

版本結合既有完整設定指紋及父／全來源 919 RowVersion。核准 A→B→A、來源獨立更新或集合變動仍使舊版本失效。只撤銷指定來源的核准（包含歷史大小寫等價 key）；保留 PRIMARY、deviceColumnTypes、其他來源與一般參數。變更與 `DASHBOARD_PENDING_APPROVALS_REVOKED` 同交易，稽核不記錄核准內容、SQL、Bind 或患者值。

撤銷與轉換是兩次明確操作：轉換失敗時，已成功撤銷的核准保持撤銷，來源保持 pending，不自動恢復舊授權。若撤銷交易本身失敗，則原設定完整保留。

來源正在被 FIELD／TABLE 引用時，允許上述同歷史 Dataset 的初次轉換；不刪除／重建來源。仍禁止刪除被引用來源；本階段也阻止已綁 Query 的被引用來源直接改成另一個 Query。後續換綁須先明確處理版型引用與核准。

## 3. DELETE Dashboard 安全保護與 FK

`DELETE /api/dashboards/:id` 路徑保留，經 JWT／DESIGN_QUERY 後固定回 `409 DASHBOARD_HARD_DELETE_DISABLED`。Repository 也拒絕直接呼叫，不取得資料庫連線或執行 DELETE。為避免把 Legacy 或旗標關閉當成硬刪除後門，此保護適用所有模式，不依賴旗標或 FK 剛好擋下刪除。沒有成功刪除或假的 DASHBOARD_DELETED 稽核紀錄。

Migration 靜態相依：

| 關聯 | ON DELETE 行為 | Migration |
| --- | --- | --- |
| DashboardDisplayProfile → Dashboard | CASCADE | 022 |
| DashboardWidget → DashboardDisplayProfile | CASCADE | 022 |
| DashboardDataSource → Dashboard | CASCADE | 913 |
| DashboardDisplayDevice → Dashboard | CASCADE | 025 |
| DashboardDeviceArchivePolicy → Dashboard | CASCADE | 900 |
| DashboardDevicePlaybackSettings → DashboardDisplayDevice | NO ACTION | 901 |
| PatientListDisclosure.DashboardDeviceId → DashboardDisplayDevice | NO ACTION | 909 |
| Dashboard → QueryDefinition／AppUser | NO ACTION | 020 |
| DashboardDataSource → 歷史 Dataset／QueryDefinition | NO ACTION | 913／917 |

ArchiveHistory 在 900 未建立 Dashboard／Device FK，不能因此把歷史記錄當成可清理孤兒。現有 FK 可能造成級聯刪除，也可能阻擋整筆刪除；實際安裝狀態仍待 SQL Server catalog 核對。本階段不刪 Dashboard、裝置、版型、患者曝光或 AuditLog。

## 4. 後續 5B／5D 與回復

- 5B 接上停用／撤銷的版本讀取、確認、衝突提示及重新核准導引；只給每項設定一個寫入入口，移除或停用 UI 的硬刪除按鈕。不恢復舊整體 writer。
- 一般登入使用者的 Query-only 播放契約仍需後續整合，不能以本批安全 API 當作已完成播放驗收。
- 5D 在所有既存來源已明確轉換、外部呼叫端與舊 binary 排空後，再退役 Legacy 寫入。若需要獨立持久退役狀態，另外設計加法式契約，不能用 DELETE 或清歷史資料取代。
- 回復時維持安全停用與既有 Schema；已旋轉的 Token 不恢復，已撤銷核准不自動恢復。若要再次播放，必須走明確模式／核准／重新核發流程。

需隔離 SQL Server 驗證：919 ROWVERSION 回傳型別與 A→B→A；917／918／919 可信約束與 FK；SERIALIZABLE 父／來源範圍／裝置鎖與其他 writer 的競爭；crypto SQL、rowcount、稽核失敗／交易 rollback；撤權競爭及新版本讀取延遲。另需 Windows／瀏覽器驗證舊憑證停止播放、重新授權與 UI 導引。Mock／CI 不取代這些驗收。
