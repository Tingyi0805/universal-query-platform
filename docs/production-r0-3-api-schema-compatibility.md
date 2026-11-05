# R0-3：GitHub 新版 API 對 Migration 916–919 的靜態相容性檢查

> 狀態：PARTIAL_STATIC_REVIEW。基準PR #64 HEAD `30a11a2eed40a01cb87df8886aa3bbaa14f9a281`；正式 SQL Server Migration ledger 42 筆（001–026、900–915）；GitHub 46 筆。**未連接正式 SQL Server，未操作測試 DB，不是整體 API 相容性通過證明。**

| Migration | 程式位置 | 已確定使用的新版結構 | 下一步 |
|---|---|---|---|
| 916 | `server/src/modules/admin/workstationManagement.repository.ts` | SharedWorkstation.PurposeCode、SortOrder、RetiredAtUtc；WorkstationAudience/Member、SharedWorkstationAudience；DashboardDisplayDevice.SharedWorkstationId | 檢查所有路由是否先執行 readiness gate；415結構下不得讓缺欄位 SQL 穿透到資料庫 |
| 917 | `server/src/modules/dashboard/dashboardQuerySources.repository.ts` | Dashboard.QuerySourceMaxRows；DashboardDataSource.QueryDefinitionId、QueryBindingRevision、MaxRows及 computed QueryBindingState | 核實預設關閉旗標時管理/執行路由拒絕；舊版來源資料不應被推定轉換成Query |
| 918 | `server/src/modules/dashboard/dashboardQueryMode.repository.ts` | Dashboard.QueryMode、QueryModeVersion；DashboardDisplayDevice.QueryModeGrantVersion、DelegatorTokenVersion | 檢查Schema readiness與feature flags、legacy path、Token重發、跨裝置授權失效 |
| 919 | `server/src/modules/dataset/patientAuditContract.repository.ts`、`server/src/modules/dashboard/dashboardApproval.repository.ts` | DatasetPatientAuditConfig.ConfigurationVersion；DatasetPatientAuditMetadata；Dashboard/DashboardDataSource.ApprovalRowVersion | 追查 routes/service fail-closed、稽核寫入安全，以及未安裝919時是否會影響舊Dataset/Dashboard路徑 |

## 確認的事實與禁止推論

- 以上是**讀取後端 Repository 原始碼**核對 SQL 引用，證明新版有實際的 schema 依賴；尚未查完所有 routes、service、舊版程式與客戶端，因此**不能宣稱全功能相容或不相容清單已完成**。
- 916–919 在正式 ledger 尚無套用記錄；先前 CSV 顯示新欄位/新表尚不存在。因此直接部署新版後端可能觸發不存在物件錯誤；即使某些路徑有 readiness 檢查，仍需要逐路由驗證與隔離測試。
- SQL Runner `db:migrate:status` 不唯讀；不得執行於正式 DB。三個 `DASHBOARD_QUERY_SOURCE_*` 旗標持續 false；不能以啟用旗標解決缺資料庫欄位。
- 正式仍在運作的 Node 版號尚未採證；不能由 Repo SHA 推定舊程式資料庫向前相容。若未來希望「先升級資料庫，再覆蓋程式」，需專門測舊版後端在919結構的 DML/查詢行為。

## 下階段阻擋條件

1. 展開實際 route/service 層呼叫圖（含 flag 和 readiness/deny 分支），建立 915/919 API compatibility matrix。
2. 以獨立隔離 SQL 實例證實高風險 migration/rollback；方案B的共用實例UQP_TEST只用於經核准業務CRUD驗收。
3. 保存現有正式軟體、設定、DB備份及回復演練；經版本核對、審查、批准後才執行任何正式 SQL/ZIP 更新。

**此文件不包含操作正式資料庫的指令或授權。**
