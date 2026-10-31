# UQP 正式升級機制 — Phase R0（僅規劃與靜態檢查）

> 2026-10-31：目前來源／Ledger 差異請併讀 [D5-C-3 Migration Inventory](database-migration-inventory.md) 與 [Schema 使用清冊](database-schema-inventory.md)；下文保留 R0 歷史計畫，不授權執行 Migration。

**狀態：PREPARATION_ONLY，禁止資料庫寫入。** 正式 UQP 在 Windows Server；Windows 11 測試新版但原先共用同一正式 SQL Server 資料庫。方案 B 規劃建立同一 SQL Server 實例的獨立 `UQP_TEST` 資料庫，但目前尚未建立、尚未核准，因此不能進行實際 CRUD、DDL、Migration 或回滾驗收。

## 第一關：固定版本與盤點

1. 記錄正式 Windows Server **現行正在執行**的 UQP 程式版本／檔案雜湊、服務啟動方式、Node 版本、正式連接埠、部署路徑及備份方式。不能由 GitHub main 或 PR 推定正式版本。
2. DBA 使用獨立、真正唯讀的管理查詢盤點 SQL Server Edition/版本、DB 相容性與 `uqp.SchemaMigration` 紀錄。若 Migration ledger 不存在或歷史有人工變更，標示 BLOCKED，絕不自動建立表或 adopt。
3. 讀取 GitHub 的 Migration 固定庫存／SHA-256，並逐項對照正式資料庫已安裝狀態。**不能只靠檔名**：未知檔案、雜湊變更、人工變更與 schema drift 均須人工審查。
4. 核對現行正式查詢、Dataset、Dashboard、使用者權限、PIN、裝置 Token、稽核及 HMAC 所需的資料表／約束及後端 API；寫出升級前後相容性矩陣。

## 第二關：安全升級方案（仍不得執行）

- 產出 per-version Migration allowlist、精確 SHA-256、前置條件、需要的 DB 權限、執行順序、每檔預期物件與失敗停止條件。
- **不可執行現有 `db:migrate`、`db:migrate:status` 或 `db:migrate:adopt`**：現有 Runner 的 status 路徑亦可能寫入 SchemaMigration；apply 會自動選 916–919。
- 先在獨立實例（方案 C）演練具 DDL 的高風險 Migration、919 回滾及並發故障；方案 B 的共享實例 `UQP_TEST` 僅供經批准的非破壞性完整業務 CRUD 驗收，不能取代隔離實例驗收。
- 建立測試用獨立服務與帳號，使用合成資料；絕不把正式患者、正式憑證、正式資料庫備份搬進較弱保護的環境。
- 三個 `DASHBOARD_QUERY_SOURCE_*` 旗標預設關閉，任何開啟必須另外核准。

## 第三關：正式 ZIP 發布及回復

發行套件須至少包含：
- `UQP-Release.zip`（精確 Commit SHA，Windows Server 可部署內容；不含 .env、密碼、token、患者資料）。
- `Release-Notes.md`（功能與 DB / API 相容性）。
- `Migration-Manifest.json`（清單/hash/profile/明確阻擋）；清單不是執行 SQL 的授權。
- `Upgrade-Plan.md`（停機／通知、部署路徑、精確檢查點、是否需要資料轉換）。
- `Backup-Restore.md`（正式備份、可還原性驗證、RPO/RTO、資料庫與程式版本回復的相依性）。
- `Acceptance-Checklist.md`（升級前後 API、登入、角色、Dataset、查詢、Excel、Dashboard、遮蔽、裝置、稽核抽查，敏感資料不輸出）。

正式部署應採停用服務、保存舊版目錄、部署新目錄／切換版本、啟動、健康檢查；不得直接覆蓋執行中的正式程式。資料庫已執行變更時，不能只替換舊 ZIP 假裝回復。需 DBA 核准並在隔離環境排練回復。

## 明確的未完成與阻擋事項

| 項目 | 狀態 |
| --- | --- |
| R0 文件與離線盤點 | 本文件已編寫；未確認現場資訊 |
| 正式程式版本與實際 Migration ledger | NOT_VERIFIED |
| SQL Server `UQP_TEST` 建立／測試帳號 | NOT_STARTED，需 DBA 與使用者另行核准 |
| SQL Server 2019 獨立實例高風險驗收 | NOT_RUN |
| 安全 Migration 執行器與升級/回復演練 | NOT_IMPLEMENTED / NOT_RUN |
| Windows Server 正式發布與部署 | NOT_APPROVED / NOT_RUN |

**本階段交付僅限文件與程式靜態審查，不觸碰現有 SQL Server 或正式程式。**
