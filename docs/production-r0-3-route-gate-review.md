# R0-3 第二輪：API Route 層與 915 Schema 阻擋追查

狀態：PARTIAL_STATIC_REVIEW，2026-10-15。僅讀取 PR #64 GitHub 原始碼，不代表 SQL Server 或端到端驗收通過。

| 類別 | 檔案 | 已觀察到的守門機制 | 未完成 |
|---|---|---|---|
| 916 工作站 | `server/src/modules/admin/workstationManagement.routes.ts`、`workstationManagement.repository.ts` | router MANAGE_USERS、錯誤 WORKSTATION_SCHEMA_REQUIRED 對應 HTTP 503；repository 有 readinessSql 與不就緒拋錯 | 驗證所有 list/create/retire/audience/綁定及讀取分支是否在任何新版欄位 SQL 前檢查 |
| 917 Query 來源 | `server/src/modules/dashboard/dashboardQuerySources.routes.ts`、`dashboardQuerySources.service.ts` | router DESIGN_QUERY、輸入驗證；service 存在 `tx.schemaReady()` 未通過時回傳 QUERY_SOURCE_SCHEMA_REQUIRED 503 | 追查每個 read/configuration/patch/primary/layout/disclosure 路徑的 flag/readiness，尤其讀取端 |
| 918 Query 播放 | `server/src/modules/dashboard/dashboardQueryMode.routes.ts`、`dashboardQueryMode.repository.ts` | DESIGN_QUERY、JWT claims/TokenVersion 形式檢查、Repository schema readiness SQL | 檢查服務 read/change/preflight/issue/revoke 及舊 Legacy 裝置播放路徑；不能僅以 Repository 存在 readiness 就宣稱完整阻擋 |
| 919 患者稽核 | `server/src/modules/dataset/patientAuditConfig.routes.ts`、`patientAuditContract.repository.ts` | DESIGN_QUERY、明確識別欄位確認、PatientAuditError/SecurityContractError 處理 | 確認 get/put 在 915 下先 fail-closed，不觸及缺少的 ConfigurationVersion/Metadata |
| 919 Dashboard 核准 | `server/src/modules/dashboard/dashboardApproval.routes.ts`、`dashboardApproval.repository.ts` | DESIGN_QUERY、token claims、輸入驗證 | 檢查 Service/Repo 對 ApprovalRowVersion 缺失的就緒與錯誤處理；保護舊版 Dashboard |

注意：以上僅證實原始碼存在檢查或路由處理。**尚未確認所有分支都被阻擋**。正式資料庫提供的 ledger 僅到915；不得在其上啟動 PR #64 後端或執行 db:migrate/status。三個 DASHBOARD_QUERY_SOURCE_* flags 不擅自啟動。

下一步：針對上述各方法建立「前置 Gate → 讀寫 SQL → 例外回傳」逐方法矩陣，新增缺 Schema 的 Mock/路由測試，再於核准的獨立測試 DB 驗證。正式系統程式版本尚未核對，因此資料庫向前相容性仍未通過。
