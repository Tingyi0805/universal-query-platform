# R0-4／B0 實際 CSV 盤點複核紀錄（2026-10-16）

> **READ-ONLY / NOT PRODUCTION APPROVAL**。依使用者於對話提供的 SSMS 匯出 CSV（sql1–sql5）進行本地離線複核；無 SQL Server 連線、無 DDL/DML。GitHub 不含患者資料與完整內部匯出內容。

## 本次重新複核的量測結果

| 匯出 | 內容 | 實際資料列 |
| --- | --- | ---: |
| sql1.csv | uqp 欄位清單（無標題列） | 363 |
| sql2.csv | uqp 約束清單（無標題列） | 299 |
| sql3.csv | 索引與索引欄位（無標題列） | 150 |
| sql4.csv | CHECK 狀態（無標題列） | 61 |
| sql5.csv | FK 參照欄位與狀態（無標題列） | 46 |

- 五份檔案均以第一列為資料，不得把第一列視作欄名。
- sql4.csv：61/61 CHECK 的 IsDisabled=0、IsNotTrusted=0。
- sql5.csv：46/46 FK 的 IsDisabled=0、IsNotTrusted=0；每筆的 ColumnOrder=1，未見複合欄位 FK。
- 既有表存在：Dashboard、DashboardDataSource、DashboardDisplayDevice、SharedWorkstation、DatasetPatientAuditConfig。
- 917 SQL 中明列的前置欄位：Dashboard.QueryDefinitionId、DashboardDataSource.DatasetId／SourceKey／PageSize／PageSeconds，在正式盤點均存在。
- 918 SQL 中應新增的 Dashboard.QueryMode／QueryModeVersion，以及 DashboardDisplayDevice.QueryModeGrantVersion／DelegatorTokenVersion，在現有盤點均不存在；符合未安裝 918 的預期。
- 919 新增欄位：DatasetPatientAuditConfig.ConfigurationVersion、Dashboard.ApprovalRowVersion、DashboardDataSource.ApprovalRowVersion，在盤點均不存在。
- 不據此推定表定義、預設值、FK 動作、所有 CK 與 migration 完全相符，也不據此核准正式升級。

## 狀態與剩餘阻擋

1. **盤點核對：PASS（限上述明列 CSV 指標）**。
2. **915 實際 Schema 與全部既有 Migration SQL 語義／型別／約束／索引逐項相符：NOT FULLY VERIFIED**。
3. **916、919 的所有 DDL 前置物件與名稱衝突：NEEDS FULL SCRIPT REVIEW**。
4. **正式部署中的應用程式 SHA 與舊／新 API 相容性：UNVERIFIED**。
5. **916–919 安裝／回滾／鎖定時間／資料完整性：NOT RUN；必須在獨立 SQL Server 實例測試**。
6. **PR #64 合併、正式 Migration、正式 ZIP 覆蓋：NOT AUTHORIZED**。

## 放行原則

可繼續進行離線審查與 Mock CI；不可把本文件當成正式 Migration 執行許可。方案 B 的 UQP_TEST 共用實例不能替代獨立實例的破壞性／高風險測試。正式資料庫仍以已回報的 915 ledger 為基準。
