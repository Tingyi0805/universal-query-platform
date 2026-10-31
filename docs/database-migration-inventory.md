# Migration Inventory 與獨立安裝來源（D5-C-3／D5-C-4-C／D5-C-4-D）

基準 `ae1b367`；2026-10-31。這份文件補充 [原有 machine inventory](../database/acceptance/migration-inventory.json)，不修改其中歷史 SHA／requires。
[Schema 清冊](database-schema-inventory.md) 是 Repository 結構索引，舊 R0／923／924／925 文件仍是各階段證據，不用新文件改寫歷史。

## D5-C-4-C／D5-C-4-D 證據更新

本輪Repository基準 `9f8dfb244c5b5b831df021e955bad27cd6f30b8b`；[正式核對報告](database-schema-production-drift-d5-c4.md) 區分使用者提供的正式事實、來源DDL、Runtime與歷史證明。
D5-C-4-D補正基準 `69c319292c30e0a5473e12874be2175a3995f178`；原49份Migration／SHA／requires不變。正式Ledger查詢包含922～926，當次只有923（2026-10-23 13:08:48）；922／924／925／926無紀錄已確認。無紀錄不代表物件不存在或歷史上從未採其他安裝方式；923結構PASS不證明原始檔，925 installer原設計不寫Ledger。

## 已知執行事實與來源身分

| ID | Repository／程式來源 | 正式情況（使用者提供，未連線核實） | 本次處理 |
|---|---|---|---|
| 001–026 | database/migrations，26 份 | Ledger 有紀錄 | 保留原 byte／hash，MIGRATION_ONLY（腳本） |
| 900–921 | database/migrations，22 份 | Ledger 有紀錄 | 保留原 byte／hash，MIGRATION_ONLY（腳本） |
| 922 | 沒有 SQL／scanner entry；可達歷史未找到路徑 | 當次正式Ledger無紀錄（查詢明確涵蓋922～926） | 不推定已安裝／不需要，不新增空 Migration |
| 923 | renderer＋tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql；非 scanner SQL | Ledger 923_dataset_metadata.sql：2026-10-23 13:08:48；結構比對 PASS（本輪提供） | 四表0筆仍保留；原始部署檔／byte仍UNKNOWN，不補登 |
| 924 | database/drafts/924_dataset_security_scope_binding.sql＋專用 installer／既有SchemaMigration紀錄 | ScopeBinding NOT_FOUND；924 Ledger無紀錄；Permission未確認 | 可選Scope管理與923欄位初始化需要；非啟動必備。部署必要性待功能／安全審查，不重跑或授權 |
| 925 | tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql＋專用 installer | 三表／34欄位及Constraint／7索引／0 Trigger明細已提供；CreatedBy／UpdatedBy允許NULL相符；當次Ledger無紀錄 | installer不寫Ledger；已提供結果可人工比對，exact validator未執行；補充Identity seed/increment等未驗收，不宣告EXACT_MATCH、不重裝 |
| 926 | database/migrations/926_dashboard_device_lifecycle.sql；runner／Runtime attestation | 當次正式Ledger無紀錄；相關Schema存在性仍待Catalog | 保留原Migration；不從現有表存在推定新增欄位／Constraint／Trigger已安裝 |

## 923 原始來源追查

- 本地 repository 不是 shallow；檢查目前可達 Git history，並 fetch 已配置的 origin/main。未宣稱已取得所有遠端／已刪分支或部署機備份。
- `git log --all -- database/migrations/923_dataset_metadata.sql` 沒有該檔歷史。
- `5087dfe` 已包含 draft 與 datasetMetadata923Catalog.ts。`d71ea0b`、`7612c5d` 等後續 Catalog/installer 調整仍保留可重建來源；不將最新版本冒認當年版本。
- `installDataset923.ts` 的 `fileName` 固定為 `923_dataset_metadata.sql`，執行的是 `render923Draft()`，成功後寫 Ledger；所以 Ledger 名稱**不必對應一份 scanner 內的同名實體 SQL**。
- D5-C-3曾只執行純 renderer 產生暫存檔，與 tracked draft `cmp` 完全相同；沒有執行 SQL 或 installer。
- 檢查 CI／release packaging：有原始碼打包路徑，但本次基準 PR83 CI #1249 與 7612c5d 對應歷史 CI #959（run 39976099234）的 artifact 清單均為空；PR66 release job 受 PR number gate，不把其設定當成已下載部署包的證明。
- 結論：**可恢復目前 Repository 的安裝 DDL；正式當年原始版本／byte 仍 UNKNOWN**。本輪正式結構比對已由使用者提供 PASS，但歷史來源仍需正式部署包 commit／manifest 或留存 artifact 閉合；不能用目前結構相符反證當年原始 byte。不得自行補登 923。

## 924 Runtime 需求

`app.ts` 已掛載 `/api/dataset-security`，datasetScopeManagement.repository 在 feature flag／incarnation／權限／exact schema gate 後以 SERIALIZABLE 讀寫 ScopeBinding。
D5-C-4-C另追查到923欄位初始化status／collect透過withMetadataOwner共用此binding；Server啟動／health不要求924。兩項Permission已有Runtime消費者，非單純預留；不自動授予角色。
ScopeVersion、subject/parent TokenVersion、DefinitionVersion、ConfigurationVersion、PlatformIncarnation 將 923 Scope 與目前安全狀態綁定；不是可刪除的重複欄位。
專用 installer 限定 001–921＋923 的基線，寫入獨立 924 Ledger；不能直接用於含後續 926 的任意環境。
缺表時 fail closed；本次不變更安全契約、不重跑 installer、不為清理新增 Migration。

## 925 來源與正式一致性界線

獨立 SQL 定義 DatasetPublicDisplayPolicy、DatasetMaskTemplate、DatasetMaskTemplateUse。
`installDisplay925` 及 Runtime `requireDisplaySchema` 共用 displayDdlUrl 與 validateDisplayCatalog：檢查 columns/type/null/identity/collation、DEFAULT/CHECK、PK/UQ/Index/include、FK/action、extra Trigger 等。
installer 只接受 ABSENT 或 EXACT_MATCH，SERIALIZABLE＋applock，重驗後 commit；不寫 SchemaMigration。
Windows installer 與 release 將同一來源複製到相容路徑，不是第二份可移除的 Schema 來源。
正式三表存在且當次Ledger無紀錄，與獨立安裝模式相容。已取得34欄位、8 CHECK、8 DEFAULT、3 PK、2 UQ、2 FK、7索引（含backing）、0 Trigger，及型別／NULL／Collation／Default／FK動作／鍵／INCLUDE等結果，可人工比對；不是整批UNKNOWN。
CreatedBy／UpdatedBy允許NULL已確認相符，非Drift；**exact validator尚未執行，不宣告完整EXACT_MATCH**。Identity seed/increment等為補充證據／驗收缺口，不能反向抹除已提供結果。本次不連線、不 apply、不 verify。

## 歷史 Migration 明細

來源 SHA／requires 以 machine inventory 為準；以下全部腳本分類 MIGRATION_ONLY，即使建立的表仍 ACTIVE。

| ID | 檔案 | 直接 prerequisite | 正式 Ledger 事實 |
|---|---|---|---|
| 1 | [001_platform_identity.sql](../database/migrations/001_platform_identity.sql) | 無 | 有紀錄（使用者提供） |
| 2 | [002_datasource.sql](../database/migrations/002_datasource.sql) | 無 | 有紀錄（使用者提供） |
| 3 | [003_dataset_query_designer.sql](../database/migrations/003_dataset_query_designer.sql) | 2 | 有紀錄（使用者提供） |
| 4 | [004_parameter_designer.sql](../database/migrations/004_parameter_designer.sql) | 3 | 有紀錄（使用者提供） |
| 5 | [005_query_definition_and_access.sql](../database/migrations/005_query_definition_and_access.sql) | 1, 3 | 有紀錄（使用者提供） |
| 6 | [006_audit_log.sql](../database/migrations/006_audit_log.sql) | 1, 3, 5 | 有紀錄（使用者提供） |
| 7 | [007_report_designer.sql](../database/migrations/007_report_designer.sql) | 3, 5 | 有紀錄（使用者提供） |
| 8 | [008_system_settings.sql](../database/migrations/008_system_settings.sql) | 1 | 有紀錄（使用者提供） |
| 9 | [009_mysql_postgresql_datasource.sql](../database/migrations/009_mysql_postgresql_datasource.sql) | 2 | 有紀錄（使用者提供） |
| 10 | [010_odbc_datasource.sql](../database/migrations/010_odbc_datasource.sql) | 9 | 有紀錄（使用者提供） |
| 11 | [011_query_category.sql](../database/migrations/011_query_category.sql) | 5 | 有紀錄（使用者提供） |
| 12 | [012_query_archive.sql](../database/migrations/012_query_archive.sql) | 1, 5 | 有紀錄（使用者提供） |
| 13 | [013_dataset_archive.sql](../database/migrations/013_dataset_archive.sql) | 1, 3 | 有紀錄（使用者提供） |
| 14 | [014_version_history.sql](../database/migrations/014_version_history.sql) | 1, 3, 5 | 有紀錄（使用者提供） |
| 15 | [015_version_retention.sql](../database/migrations/015_version_retention.sql) | 8, 14 | 有紀錄（使用者提供） |
| 16 | [016_audit_retention.sql](../database/migrations/016_audit_retention.sql) | 6, 8 | 有紀錄（使用者提供） |
| 17 | [017_user_query_favorite.sql](../database/migrations/017_user_query_favorite.sql) | 1, 5 | 有紀錄（使用者提供） |
| 18 | [018_recent_query_usage_index.sql](../database/migrations/018_recent_query_usage_index.sql) | 6 | 有紀錄（使用者提供） |
| 19 | [019_user_token_version.sql](../database/migrations/019_user_token_version.sql) | 1 | 有紀錄（使用者提供） |
| 20 | [020_dashboard_base.sql](../database/migrations/020_dashboard_base.sql) | 1, 5 | 有紀錄（使用者提供） |
| 21 | [021_dashboard_display_layout.sql](../database/migrations/021_dashboard_display_layout.sql) | 20 | 有紀錄（使用者提供） |
| 22 | [022_dashboard_layout_designer.sql](../database/migrations/022_dashboard_layout_designer.sql) | 21 | 有紀錄（使用者提供） |
| 23 | [023_dynamic_date_parameters.sql](../database/migrations/023_dynamic_date_parameters.sql) | 4 | 有紀錄（使用者提供） |
| 24 | [024_dashboard_visual_styling.sql](../database/migrations/024_dashboard_visual_styling.sql) | 22 | 有紀錄（使用者提供） |
| 25 | [025_dashboard_display_device.sql](../database/migrations/025_dashboard_display_device.sql) | 1, 20 | 有紀錄（使用者提供） |
| 26 | [026_dashboard_device_ip_restriction.sql](../database/migrations/026_dashboard_device_ip_restriction.sql) | 25 | 有紀錄（使用者提供） |
| 900 | [900_dashboard_device_archive.sql](../database/migrations/900_dashboard_device_archive.sql) | 25 | 有紀錄（使用者提供） |
| 901 | [901_dashboard_device_playback_settings.sql](../database/migrations/901_dashboard_device_playback_settings.sql) | 25 | 有紀錄（使用者提供） |
| 902 | [902_shared_workstation_foundation.sql](../database/migrations/902_shared_workstation_foundation.sql) | 無 | 有紀錄（使用者提供） |
| 903 | [903_quick_pin_policy.sql](../database/migrations/903_quick_pin_policy.sql) | 無 | 有紀錄（使用者提供） |
| 904 | [904_workstation_device_credentials.sql](../database/migrations/904_workstation_device_credentials.sql) | 902 | 有紀錄（使用者提供） |
| 905 | [905_workstation_platform.sql](../database/migrations/905_workstation_platform.sql) | 902 | 有紀錄（使用者提供） |
| 906 | [906_patient_list_disclosure_audit.sql](../database/migrations/906_patient_list_disclosure_audit.sql) | 無 | 有紀錄（使用者提供） |
| 907 | [907_dataset_patient_audit_config.sql](../database/migrations/907_dataset_patient_audit_config.sql) | 3 | 有紀錄（使用者提供） |
| 908 | [908_patient_audit_hmac_key_version.sql](../database/migrations/908_patient_audit_hmac_key_version.sql) | 906 | 有紀錄（使用者提供） |
| 909 | [909_dashboard_device_disclosure.sql](../database/migrations/909_dashboard_device_disclosure.sql) | 25, 906 | 有紀錄（使用者提供） |
| 910 | [910_dataset_sensitive_columns.sql](../database/migrations/910_dataset_sensitive_columns.sql) | 3, 6 | 有紀錄（使用者提供） |
| 911 | [911_verify_dataset_sensitivity.sql](../database/migrations/911_verify_dataset_sensitivity.sql) | 910 | 有紀錄（使用者提供） |
| 912 | [912_custom_device_mask.sql](../database/migrations/912_custom_device_mask.sql) | 910 | 有紀錄（使用者提供） |
| 913 | [913_dashboard_multi_dataset_sources.sql](../database/migrations/913_dashboard_multi_dataset_sources.sql) | 3, 20 | 有紀錄（使用者提供） |
| 914 | [914_dashboard_source_paging.sql](../database/migrations/914_dashboard_source_paging.sql) | 913 | 有紀錄（使用者提供） |
| 915 | [915_dashboard_security_reconciliation.sql](../database/migrations/915_dashboard_security_reconciliation.sql) | 912, 914 | 有紀錄（使用者提供） |
| 916 | [916_workstation_management.sql](../database/migrations/916_workstation_management.sql) | 1, 6, 25, 902, 904, 906, 915 | 有紀錄（使用者提供） |
| 917 | [917_dashboard_query_source_model.sql](../database/migrations/917_dashboard_query_source_model.sql) | 5, 20, 914 | 有紀錄（使用者提供） |
| 918 | [918_dashboard_query_playback_mode.sql](../database/migrations/918_dashboard_query_playback_mode.sql) | 25, 917 | 有紀錄（使用者提供） |
| 919 | [919_dashboard_dataset_security_contract.sql](../database/migrations/919_dashboard_dataset_security_contract.sql) | 3, 6, 7, 907, 910, 913 | 有紀錄（使用者提供） |
| 920 | [920_dataset_definition_rowversion.sql](../database/migrations/920_dataset_definition_rowversion.sql) | 3, 907, 910, 919 | 有紀錄（使用者提供） |
| 921 | [921_datasource_native_parameter_versions.sql](../database/migrations/921_datasource_native_parameter_versions.sql) | 2, 3, 4, 9, 10, 13, 920 | 有紀錄（使用者提供） |
| 926 | [926_dashboard_device_lifecycle.sql](../database/migrations/926_dashboard_device_lifecycle.sql) | 25, 900, 918 | 當次正式Ledger無紀錄；Schema存在性另待Catalog |

## 驗證方式

`node tools/validate-database-schema-inventory.mjs`：離線 source-set／SHA／清冊計數／49 份 Migration pin 核對。
`server/src/scripts/securityAcceptancePlan.ts` 及既有 plan/manifest tests：原有 prerequisite 與 hash 驗證，不載入 DB。
不要為了盤點呼叫 db:migrate status；其 bootstrap 不保證唯讀。
本次不新增空 922，不將 923/924/925 塞入 scanner，不改 926 或任何歷史 Migration。
