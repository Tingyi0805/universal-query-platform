# SQL Schema 安全清理報告（D5-C-3／D5-C-4-C）

D5-C-3歷史基準 `ae1b367`；日期 2026-10-31。Repository 層盤點保留；本輪923正式結構PASS與其他待證據項目見下方D5-C-4-C更新。
沒有刪除 SQL／文件／資料庫物件；沒有修改既有 Migration、Schema、seed、權限、Token、Cookie、Enrollment、Audit 或 lifecycle 流程。

## D5-C-4-C 正式核對更新

本輪基準 `9f8dfb244c5b5b831df021e955bad27cd6f30b8b`；[完整正式核對／Drift報告](database-schema-production-drift-d5-c4.md)。以下D5-C-3來源計數保持原口徑，不當作正式安裝物件數。

- **923結構PASS**：依本輪提供的Ledger、87欄位、Constraint、Index與Sequence證據；四表0筆不等於未使用，原始部署檔仍UNKNOWN。
- **924未安裝**：正式ScopeBinding NOT_FOUND、Ledger無紀錄；已有Scope與923欄位初始化Runtime用途，Permission亦有消費者。不是啟動必備；是否現在部署待需求／旗標／權限／Provider及installer相容性審查，絕不自動安裝或授權。
- **925部分相符**：三表存在，Template.CreatedBy／UpdatedBy正式允許NULL與DDL相符，**不是Drift**；其他完整Catalog未提供，不能回報完整EXACT_MATCH。三表有實際程式讀寫及歷史用途，管理旗標關閉不等於播放／政策路徑不用。
- **922 UNKNOWN**：尚無獨立正式Ledger證據；不沿用先前無紀錄假設，不因923存在推定922已裝或不需要。
- **926 UNKNOWN（當前正式安裝）**：來源Migration與Runtime gate明確；本輪未提供當前Ledger／欄位／Constraint／Trigger。先前尚未安裝是歷史陳述。
- **已確認Drift：無；仍待比對：有。可安全清理候選0、UNUSED_CONFIRMED 0、實際移除0；不提出Cleanup Migration或DROP。** 外部報表／排程／第三方／DB module尚無否定依賴證據，保留UNKNOWN。

## 盤點結果

- 應用 Schema：1（uqp）；表 54、欄位 536、Constraint 宣告 407、明確 Index 43、Trigger 1、Sequence 1。
- 以上合計 1,043 個來源宣告物件：ACTIVE 865、LEGACY_REQUIRED 32、MIGRATION_ONLY 0、UNUSED_CONFIRMED 0、UNKNOWN 146。
- **腳本另計**：58 份 tracked SQL，其中 49 份歷史 Migration 為 MIGRATION_ONLY。不要將物件與腳本數字相加當成正式 Schema 數量。
- 此數字不是正式 DB object count；隱含 PK/UQ 索引不重算，系統 Schema、測試臨時／外部 Schema 不計入。
- 欄位 ACTIVE 包含宣告完整性／預設值／索引依賴，不宣稱都有已觀測 workload；UNKNOWN 必須保留。分類逐項見 [清冊](database-schema-inventory.md)。

## 重複、舊版與待確認項目

| 項目 | 實際證據／判定 | 處理 |
|---|---|---|
| SharedWorkstationSession 索引前綴 | IX_SharedWorkstationSession_Workstation (WorkstationId,RevokedAtUtc,ExpiresAtUtc) 與 UX_SharedWorkstationSession_OneActive (WorkstationId)；後者 UNIQUE＋filter，不是等價結構 | 保留；需要 workload 才可評估非 unique index |
| DatasetSecurityDecision 索引前綴 | IX_SecurityDecision_Snapshot (SnapshotId,Id) 與 UX_SecurityDecision_CollectionSnapshot (SnapshotId)；後者 UNIQUE＋Kind/Action filter | 保留，不合併唯一性與分頁用途 |
| PK／UQ 的實體索引 | SQL Server 自動建立；不等於重複 CREATE INDEX | 分開計數，保留完整性約束 |
| 912／914 與 915 CHECK | 915 reconciliation 補建／重新 trusted CHECK；不是可刪歷史 SQL | 保留；同名現行定義不重複算物件 |
| 908 Subject PK | 加入 KeyVersion 後替換 PK；與 HMAC 歷史查詢相依 | 保留 Migration 與現行複合鍵，不把舊定義當現行第二個 PK |
| DataSource CHECK enum／DashboardWidget Type | 後續 Migration 擴張／替換；舊 predicate 是升級來源 | 不更動歷史來源，以最後宣告列現行結構 |
| Dashboard.QueryDefinitionId 與多來源 QueryDefinitionId | 父層與每來源位置不同；舊資料／目前 repository 仍有父層引用 | 父欄位列 LEGACY_REQUIRED，非同表重複欄位 |
| DashboardDataSource.DatasetId 與 QueryDefinitionId | 917 保留待轉換資料，QueryBindingState computed 與 CAS 依賴 | 不刪舊 DatasetId；需獨立遷移與轉換證據 |
| AuditLog／AuditLogArchive 的名稱／JSON／ID 欄位 | LIVE 名稱 join，Archive 保留封存時快照；D4-D 雙 ID 歸屬仍使用 JSON | 歷史保留用途明確；不能只留 UI 顯示欄位 |
| DashboardAuthenticationPolicy | 未證明 Runtime 消費，902 歷史建立；外部／舊版不明 | UNKNOWN，保留 |
| DatasetSecurityConfirmation | 923 exact Catalog 四表契約仍要求；目前未證明直接業務 DML | LEGACY_REQUIRED，保留 |
| 923 draft | installer render 出相同 byte，Catalog／tests／CI 使用 | 名稱含 draft 不等於廢棄 |
| 924 draft | feature-gated Scope 管理讀寫；正式缺表事實待獨立釐清 | ACTIVE（來源功能），不重跑、不修改 |
| 925 installer 與 release 多路徑 | 安裝與 Runtime validator 共用 DDL；部署包相容複製 | 保留，沒有兩套獨立 Schema |
| Permission／Role seed | 001 基礎角色、008 設定權限、916／924 新能力；以既有鍵／NOT EXISTS 防重，權限定義與授予不同 | 不移除 seed、不自動授予能力、不把多階段初始化當可刪重複 |
| 923/924/925 文件 | 分別保存離線契約、Windows 安裝、UAT／rollout；本次新增 canonical inventory 作索引 | 無足夠理由刪除既有證據文件 |
| 外部來源／ODBC／Oracle／Stored SQL | dataset.service 動態執行 SqlText，來源端表／View／SP 及報表／排程不在 repo | UNKNOWN，不推導未使用 |

未找到可證明等價且可移除的重複欄位／索引；這不是對正式 workload 的效能驗收。
無實際 index usage／Query Store／資料量，不能建議 DROP。FK、hint、filtered uniqueness、typed binding、retention 與 audit 必須優先保留。

## SQL 檔案逐項處置

全部保留。以下分類指檔案用途，不重算資料庫物件。

| SQL 檔案 | 使用狀態 | 依賴／保留依據 |
|---|---|---|
| [database/acceptance/catalog-probe.sql](../database/acceptance/catalog-probe.sql) | ACTIVE | 唯讀 acceptance／人工稽核工具；操作指南仍保留其用途，未執行 |
| [database/acceptance/production-migration-ledger-readonly.sql](../database/acceptance/production-migration-ledger-readonly.sql) | ACTIVE | 唯讀 acceptance／人工稽核工具；操作指南仍保留其用途，未執行 |
| [database/acceptance/production-schema-readonly-inventory.sql](../database/acceptance/production-schema-readonly-inventory.sql) | ACTIVE | 唯讀 acceptance／人工稽核工具；操作指南仍保留其用途，未執行 |
| [database/drafts/924_dataset_security_scope_binding.sql](../database/drafts/924_dataset_security_scope_binding.sql) | ACTIVE | installDataset924＋Scope 管理 exact Catalog |
| [database/migrations/001_platform_identity.sql](../database/migrations/001_platform_identity.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/002_datasource.sql](../database/migrations/002_datasource.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/004_parameter_designer.sql](../database/migrations/004_parameter_designer.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/006_audit_log.sql](../database/migrations/006_audit_log.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/007_report_designer.sql](../database/migrations/007_report_designer.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/008_system_settings.sql](../database/migrations/008_system_settings.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/009_mysql_postgresql_datasource.sql](../database/migrations/009_mysql_postgresql_datasource.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/010_odbc_datasource.sql](../database/migrations/010_odbc_datasource.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/011_query_category.sql](../database/migrations/011_query_category.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/012_query_archive.sql](../database/migrations/012_query_archive.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/013_dataset_archive.sql](../database/migrations/013_dataset_archive.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/014_version_history.sql](../database/migrations/014_version_history.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/015_version_retention.sql](../database/migrations/015_version_retention.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/016_audit_retention.sql](../database/migrations/016_audit_retention.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/017_user_query_favorite.sql](../database/migrations/017_user_query_favorite.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/018_recent_query_usage_index.sql](../database/migrations/018_recent_query_usage_index.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/019_user_token_version.sql](../database/migrations/019_user_token_version.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/021_dashboard_display_layout.sql](../database/migrations/021_dashboard_display_layout.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/023_dynamic_date_parameters.sql](../database/migrations/023_dynamic_date_parameters.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/024_dashboard_visual_styling.sql](../database/migrations/024_dashboard_visual_styling.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/025_dashboard_display_device.sql](../database/migrations/025_dashboard_display_device.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/026_dashboard_device_ip_restriction.sql](../database/migrations/026_dashboard_device_ip_restriction.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/903_quick_pin_policy.sql](../database/migrations/903_quick_pin_policy.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/904_workstation_device_credentials.sql](../database/migrations/904_workstation_device_credentials.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/905_workstation_platform.sql](../database/migrations/905_workstation_platform.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/907_dataset_patient_audit_config.sql](../database/migrations/907_dataset_patient_audit_config.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/908_patient_audit_hmac_key_version.sql](../database/migrations/908_patient_audit_hmac_key_version.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/909_dashboard_device_disclosure.sql](../database/migrations/909_dashboard_device_disclosure.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/910_dataset_sensitive_columns.sql](../database/migrations/910_dataset_sensitive_columns.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/911_verify_dataset_sensitivity.sql](../database/migrations/911_verify_dataset_sensitivity.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/912_custom_device_mask.sql](../database/migrations/912_custom_device_mask.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/913_dashboard_multi_dataset_sources.sql](../database/migrations/913_dashboard_multi_dataset_sources.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/914_dashboard_source_paging.sql](../database/migrations/914_dashboard_source_paging.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/915_dashboard_security_reconciliation.sql](../database/migrations/915_dashboard_security_reconciliation.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/916_workstation_management.sql](../database/migrations/916_workstation_management.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/917_dashboard_query_source_model.sql](../database/migrations/917_dashboard_query_source_model.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/918_dashboard_query_playback_mode.sql](../database/migrations/918_dashboard_query_playback_mode.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/919_dashboard_dataset_security_contract.sql](../database/migrations/919_dashboard_dataset_security_contract.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/920_dataset_definition_rowversion.sql](../database/migrations/920_dataset_definition_rowversion.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/921_datasource_native_parameter_versions.sql](../database/migrations/921_datasource_native_parameter_versions.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [database/migrations/926_dashboard_device_lifecycle.sql](../database/migrations/926_dashboard_device_lifecycle.sql) | MIGRATION_ONLY | runner＋machine inventory 的歷史來源；禁止刪改 |
| [tools/sqlserver-acceptance/d0_catalog_readonly.sql](../tools/sqlserver-acceptance/d0_catalog_readonly.sql) | ACTIVE | 唯讀 acceptance／人工稽核工具；操作指南仍保留其用途，未執行 |
| [tools/sqlserver-acceptance/drafts/923/923_catalog_readonly.sql](../tools/sqlserver-acceptance/drafts/923/923_catalog_readonly.sql) | ACTIVE | 唯讀 acceptance／人工稽核工具；操作指南仍保留其用途，未執行 |
| [tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql) | ACTIVE | renderer golden、Catalog tests、隔離 acceptance；不是 scanner Migration |
| [tools/sqlserver-acceptance/drafts/923/923_f1a_environment_readonly.sql](../tools/sqlserver-acceptance/drafts/923/923_f1a_environment_readonly.sql) | ACTIVE | 唯讀 acceptance／人工稽核工具；操作指南仍保留其用途，未執行 |
| [tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql](../tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql) | ACTIVE | installDataset925、displayDdlUrl、Runtime requireDisplaySchema、release packaging |

## 清理與後續最小方案

- 實際移除檔案：**0**；UNUSED_CONFIRMED：**0**。未用「搜尋無引用」推導可刪除。
- 建議移除的 DB 物件：**無可核准候選**。本次無 Cleanup Migration，亦不執行 DROP。
- 923 當年安裝來源：已有目前 renderer／draft／Git 來源，但缺實際部署 commit／package／historical hash；正式原 byte UNKNOWN。
- 924：目前功能需要；正式未見 ScopeBinding 的原因、旗標與啟用規劃需 owner／DBA 提供既有證據，不自行安裝。
- 925：installer 設計上不寫 Ledger；仍需三表 exact Catalog 結果才能確認與來源一致。表名存在不構成驗證。
- 若將來提出 Cleanup Migration，先取得 DBA 唯讀 export、sql_expression_dependencies／module definition／synonym、外部 consumer owner 簽認、跨保留週期 workload，以及可回復升級／降版方案；另案審查，不能在本任務直接刪除。
- 現有 read-only inventory query 不是完整正式相依圖。本次不為填補證據而連正式 DB，UNKNOWN 保留。

## 驗證與未完成的環境證據

離線 inventory validator 核對 58 SQL／49 Migration 原 SHA、54 表／536 欄位、分類計數及來源集合。923 純 renderer 與 draft byte 相同。
Server Unit／Typecheck／Build、Client Tests／Build、Browser 與既有 CI 的最新結果記錄於 Commit 對應 CI；不使用上一次綠燈冒充這次結果。
SQL Schema Acceptance 在本機限既有離線 Catalog／installer guard／inventory tests；不呼叫會連 DB 或 bootstrap 的 CLI。
既有 CI 的 disposable lifecycle SQL 只覆蓋其受測子集；PR83 的 923／924 full-schema 工作被既有條件跳過，不能宣稱完整正式 Schema 或 925 正式一致性已 PASS。
因此 Repository 文件／來源完整性可驗證；正式 Schema／外部相依性全量驗收仍 **部分待證據（923已依提供證據結構PASS；925完整比對、922／926現況及外部依賴未閉合）**，不阻止保留未知物件完成安全盤點。

### 本機驗證紀錄

- Server Unit：2,187／2,187；Client Unit：69／69。
- Server／Client Typecheck 與 Build：通過。
- 既有離線 Catalog／installer guard／inventory 專項：104／104；新清冊 validator 通過。
- 923 renderer 輸出與 draft 逐 byte 相同；Migration 原 SHA 與 requires pin 未變。
- Browser 與最新完整 CI 結果另於 PR83 記錄；首次 Browser 因預設 browser binary 不存在未啟動，改用既有系統 Chromium 後重跑。未修改產品以配合測試。

### D5-C-4-C 文件驗證

本輪只跑離線inventory validator、文件相對連結／git diff檢查；不重跑前段完整Server／Client／Browser或手動觸發完整CI。
上方D5-C-3測試數字是歷史驗證紀錄，沒有冒充本輪執行。沒有修改驗證工具、Runtime、任何SQL／Migration或正式資料庫。
