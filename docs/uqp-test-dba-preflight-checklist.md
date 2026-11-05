# UQP_TEST — DBA 建置前核對表（R0-4 / B0）

> **未核准、未執行。** 此表供資訊室與 DBA 共同審查；不含建立資料庫或授權 SQL。正式 Windows Server 與正式資料庫不得變更。

## 1. 確認現況（唯讀）

- [ ] DBA 確認所選 SQL Server 實例／資料庫（實際名稱僅保留在內部紀錄，不放入 GitHub）。
- [ ] 由 DBA 審核並視需要執行 `database/acceptance/production-schema-readonly-inventory.sql`；比對表、欄位、索引、約束與 915 預期結構。
- [ ] 由 DBA 審核 `database/acceptance/production-migration-ledger-readonly.sql`；確認 001–026、900–915，任何不一致立即停止。
- [ ] 確認正式應用程式實際部署 Build/Commit，不以 GitHub PR 版本代替。
- [ ] 確認 CPU、RAM、tempdb、磁碟可用量、備份政策與測試時段；規劃正式負載異常停止條件。

## 2. 防止測試連到正式系統

- [ ] 由 DBA 另建專用 SQL Login / User，**僅**指向 `UQP_TEST`；不得使用正式連線字串、正式帳號或共享高權限角色。
- [ ] 以 DBA 可稽核方式確認測試帳號不能連線、讀取或修改正式 DB；不得有跨資料庫 ownership chaining / linked-server 迂迴權限。
- [ ] Windows 11 測試程式獨立資料夾、服務埠與設定；啟動前驗證實際 Server/Instance/Database 身分。
- [ ] 對 Oracle/HIS、外部資料來源、通知、排程、裝置 Token、審計收集逐項封鎖或改 Mock；不能只切換平台 DB。
- [ ] 僅使用合成資料與合成帳號。禁止將含患者資料的正式備份直接還原到測試 DB。

## 3. 放行與停止條件

- [ ] DBA 核准方案 B 的共享實例資源界限、建立程序和還原責任人。
- [ ] 資料庫測試帳號、應用程式帳號、敏感金鑰分離；三項 Dashboard 新功能旗標預設停用。
- [ ] 先確認停止測試與撤銷帳號／連線的方法，以及如何確認正式 DB 無預期外變更。
- [ ] **不在共享實例執行**高風險 Migration 916–919 交易回滾、併發與 DDL 壓力驗收；此類情境需獨立 SQL Server 實例。
- [ ] R0-4 / B0 全數簽核前，禁止 `db:migrate`、`db:migrate:status`、`adopt`、正式 ZIP 覆蓋或 PR 合併。

## 4. 審核紀錄（由現場人員填寫）

- 審核日期：
- DBA／資訊室審核人：
- 正式 Schema 差異：無／有（附內部報告編號）／未確認
- 測試用帳號與資料來源隔離：已核准／待確認
- 共用實例資源風險：可接受／需另建實例／未確認
- **最終決定：尚未授權 B1 建置／另行核准 B1 建置**

**文件目的：** 只作事前門檻，不構成 SQL 執行授權，也不代表任何正式環境驗收通過。
