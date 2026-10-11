# Dataset 敏感資料規則：SQL Server 本機整合驗證

> PR #64 驗證用；尚未在正式或測試 SQL Server 執行。請先備份平台資料庫，使用隔離的測試資料庫與非真實患者資料。

## 部署順序

1. 確認既有平台 schema `uqp.Dataset`、`uqp.AuditLog` 與權限已部署，並確認執行帳號有 DDL 權限。
2. 在**測試平台資料庫**執行 `database/migrations/910_dataset_sensitive_columns.sql`；再次執行 910，驗證冪等性。
3. 執行唯讀 `database/migrations/911_verify_dataset_sensitivity.sql`；應顯示 `VerificationStatus = PASS`。
4. 重啟測試版 API；確認管理者具有 `DESIGN_QUERY` 權限；確認其他角色不能修改 Dataset 敏感欄位。
5. 確認新增兩張資料表的 Dataset 外鍵具有 ON DELETE CASCADE；同時確認 AuditLog 外鍵**不**使用 CASCADE。若 Dataset 有稽核紀錄，現行永久刪除可能遭 FK 阻擋；應優先使用封存，絕不可為了刪除 Dataset 而清除稽核紀錄。
6. 以沒有患者真實資料的 Dataset 執行以下測試；測試完確認稽核事件存在。

## 測試矩陣

| 情境 | 操作 | 預期結果 |
| --- | --- | --- |
| 初次建立 | GET 規則取得 version 0；PUT 帶 expectedVersion 0 | HTTP 200、version 1；稽核一筆 |
| 一般更新 | GET 取得 version 1；PUT 帶 expectedVersion 1 | HTTP 200、version 2；修改前後記錄完整 |
| 雙人衝突 | A、B 同時 GET 相同版本；A 先 PUT；B 再以舊版本 PUT | A 成功；B HTTP 409；B 的規則不覆蓋 A |
| 同時首次建立 | 新 Dataset 兩個工作階段同時以 version 0 PUT | 最多一筆成功；另一筆應衝突或需重試；無重複版本列 |
| 啟用中 Dashboard 清空規則 | Dataset 有啟用中的 Dashboard 時 PUT columns=[] | HTTP 409 SENSITIVITY_ACTIVE_DASHBOARD；原有規則與版本不變 |
| 更新 Dashboard 重新啟用 | 曾設定敏感規則但已清空時，對既有 Dashboard PUT isActive=true | HTTP 409 DASHBOARD_SENSITIVITY_REVIEW_REQUIRED；不得藉由更新繞過檢查 |
| 啟用與清空併發 | A 啟用 Dashboard，同時 B 清空同 Dataset 的規則 | 不得產生已啟用且敏感規則清空的狀態；此項需在 SQL Server 併發整合測試確認，啟用檢查與寫入已在同一 SERIALIZABLE 交易，仍需 SQL Server 實測鎖定及死結行為 |
| 清空後重新啟用 | 曾有敏感規則的 Dataset 清空規則後，嘗試啟用 Dashboard | HTTP 409 DASHBOARD_SENSITIVITY_REVIEW_REQUIRED；重新設定規則後才允許啟用 |
| 停用後調整規則 | 停用所有相關 Dashboard，再調整 Dataset 規則 | 可依版本檢查正常儲存，完成 SQL 與規則設定後才重新啟用 Dashboard |
| 直接修改受保護 SQL | Dataset 有敏感欄位規則時直接 PUT 修改 sqlText 或 dataSourceId | HTTP 409 DATASET_SENSITIVITY_REVIEW_REQUIRED；舊 SQL 與規則保持不變 |
| 一般設定修改 | 只修改 Dataset 名稱或說明，不變更 SQL 與資料來源 | 可正常儲存 |
| SQL 欄位重新命名 | 已設定 PAT_ID 敏感規則後，預覽 SQL 將 PAT_ID 改名為 PATIENT_ID | HTTP 409 DATASET_SENSITIVITY_COLUMNS_STALE；原欄位中繼資料不被覆蓋，規則保留 |
| SQL 欄位大小寫改變 | PAT_ID 改為 pat_id 後重新同步 | 規則仍可對應，不因大小寫差異拒絕同步 |
| 欄位不存在 | PUT 使用 DatasetColumn 中不存在的 columnName | HTTP 400 SENSITIVITY_COLUMN_NOT_FOUND；規則、版本、稽核不變 |
| 尚未同步欄位 | DatasetColumn 為空時 PUT 非空規則 | HTTP 400；先執行查詢預覽同步欄位 |
| 不合法遮蔽 | sensitivityType=NATIONAL_ID、deviceMaskMode=NONE | HTTP 400；規則及版本不變 |
| 重複欄位 | 同一請求重複 columnName | HTTP 400；規則及版本不變 |
| 稽核內容過大 | 送出總異動內容超過 20,000 字元的合法規則 | HTTP 400 SENSITIVITY_AUDIT_TOO_LARGE；規則、版本、稽核均不變 |
| 稽核寫入失敗 | **僅測試環境**：以受限 DB 權限阻擋 AuditLog INSERT，再 PUT | 整筆交易失敗；規則、版本均不變 |
| 遮蔽傳送 | Dashboard 核准欄位，Dataset 設 FULL 或 OMIT | 播放 API 僅回傳允許且經遮蔽的資料 |
| 未核准欄位 | Dataset 設 FULL，但 Dashboard 未核准 | 播放 API 不傳送該欄位 |
| 規則衝突 | Dashboard 設 NAME、Dataset 設 MRN | 播放 API 採 FULL |
| 永久刪除稽核保護 | Dataset 有 AuditLog 記錄時嘗試永久刪除 | delete-impact 回傳 auditCount 大於 0；API 拒絕刪除，建議封存；稽核紀錄保留 |
| 永久刪除併發 | 測試 Dataset 無引用，另一工作階段同時建立關聯或稽核紀錄 | 刪除與關聯建立不能同時成功；資料庫外鍵與交易必須維持一致 |
| 裝置憑證撤銷與網路重連 | 管理者撤銷 Device Token，同時播放裝置重新連線 | API 回傳 401 後清除舊 Token、患者資料、快照及版面；必須重新驗證才能播放 |
| 版面 API 憑證失效 | 播放資料已載入，但版面 API 回傳 401 | 清除患者資料及 Token，顯示裝置重新啟用畫面 |
| 伺服器無法連線但瀏覽器仍顯示在線 | 保持網路連線但停止 API 服務或阻擋 API 連線 | 播放 API 失敗時清除患者資料與舊快照；依退避機制重試，不沿用舊資料 |
| 斷線前請求延遲返回 | 裝置請求播放分頁時斷線，讓先前請求延遲返回 | 已失效的請求不得重新顯示患者資料 |
| 網路中斷與恢復 | Dashboard 裝置播放患者清單時切斷網路再恢復 | 中斷時清除畫面資料與快照；恢復後重新取得第 1 頁，不顯示中斷前患者資料 |
| 伺服器重新啟動 | 裝置持有 snapshotId 時重啟 Node.js 伺服器 | 原記憶體快照不存在，回傳 409 並自動重新取得新快照 |
| 第一頁快照過期自動恢復 | 裝置停在第 1 頁時變更 Dataset 敏感規則，再觸發快照過期 | 清除舊快照與資料，自動重新請求第 1 頁，不停在錯誤畫面 |
| 遮蔽規則變更後舊快照 | 先取得 snapshotId，再修改 Dataset 敏感規則版本，使用舊 snapshotId 請求下一頁 | HTTP 409 DASHBOARD_SNAPSHOT_EXPIRED；不得回傳舊快照頁面，裝置重新取得快照 |
| 播放與規則更新併發 | A 持續請求 Dashboard 分頁，同時 B 修改 Dataset 遮蔽規則 | 每次回應的資料列與欄位中繼資料須使用同一份規則；不可傳送未核准欄位；檢查遮蔽前後差異及稽核 |
| 規則更新後播放 | 播放中修改 Dataset 規則，再取得下一頁 | 依目前伺服器實作重新套用最新規則；檢查回傳值及欄位中繼資料 |

## 稽核與版本查核（測試 Dataset ID 請自行替換）

```sql
DECLARE @DatasetId BIGINT = 123; -- 改為測試用 Dataset ID
SELECT DatasetId, VersionNumber
FROM uqp.DatasetSensitivePolicyVersion WHERE DatasetId=@DatasetId;
SELECT ColumnName, SensitivityType, DeviceMaskMode, UpdatedAtUtc
FROM uqp.DatasetSensitiveColumn WHERE DatasetId=@DatasetId ORDER BY ColumnName;
SELECT TOP (20) Id, EventType, DatasetId, UserId, Status, ParametersJson, CompletedAtUtc
FROM uqp.AuditLog
WHERE DatasetId=@DatasetId AND EventType='DATASET_SENSITIVITY_UPDATED'
ORDER BY Id DESC;
```

## 重要限制

- GitHub CI 通過不代表已測試真實 SQL Server 的交易鎖定、死結、資料庫權限及 Migration。
- 不要在正式環境以故意破壞 AuditLog 結構的方式測試失敗回復。
- 請記錄 SQL Server 版本、資料庫相容性層級、API commit SHA、執行時間與各項結果。
- 若遇到 SQL deadlock (1205)，需確認交易回復後再重新載入版本；不可無條件覆寫舊版本。
