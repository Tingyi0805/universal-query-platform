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
| 不合法遮蔽 | sensitivityType=NATIONAL_ID、deviceMaskMode=NONE | HTTP 400；規則及版本不變 |
| 重複欄位 | 同一請求重複 columnName | HTTP 400；規則及版本不變 |
| 稽核寫入失敗 | **僅測試環境**：以受限 DB 權限阻擋 AuditLog INSERT，再 PUT | 整筆交易失敗；規則、版本均不變 |
| 遮蔽傳送 | Dashboard 核准欄位，Dataset 設 FULL 或 OMIT | 播放 API 僅回傳允許且經遮蔽的資料 |
| 未核准欄位 | Dataset 設 FULL，但 Dashboard 未核准 | 播放 API 不傳送該欄位 |
| 規則衝突 | Dashboard 設 NAME、Dataset 設 MRN | 播放 API 採 FULL |
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
