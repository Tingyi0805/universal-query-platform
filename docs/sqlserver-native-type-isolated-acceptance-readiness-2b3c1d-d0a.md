# 隔離 SQL Server 驗收準備包（2B-3C-1D-B3-D0A）

基準 `deeae4e8d582488624a093ad6a60632ec7d9febb`；開工 PR #66 為 Draft、未 Merge，CI #882 Server/Client 與 workflow 最終皆 success。僅新增本文件、[純 SELECT Catalog](../tools/sqlserver-acceptance/d0_catalog_readonly.sql)、[T1–T10 驗收矩陣](../tools/sqlserver-acceptance/d0_acceptance_matrix.md)。本階段**沒有安裝、啟動、建立或連線測試環境，沒有執行 SQL**，也不擴充 C2/C4/C5、不改正式程式或 Migration。

依據：[B3-A](sqlserver-native-type-b3a-feasibility-review.md)、[Writer/Lock Matrix](sqlserver-native-type-writer-lock-contract-2b3c1d-b3b3.md)、[C1](sqlserver-native-type-common-acquisition-design-2b3c1d-b3c1.md)、[C3 Predicate/Index/FK](sqlserver-native-type-mutation-reservation-design-2b3c1d-b3c3.md)、[C5](sqlserver-native-type-write-inventory-2b3c1d-b3c5.md)。此包是規格，不是環境 readiness 證書、資料庫驗收結果或交付授權。

## 1. 環境 Manifest：要求與實際觀測分開

下表「候選／必需」只供另案審核；**所有實際值、負責人、授權及證據目前 UNKNOWN**。不得拿本地 Node、CI 綠燈、版本名稱或成功連線當成 SQL Server readiness。

| 項目 | 候選／必需的驗收規格 | 實際狀態 |
| --- | --- | --- |
| Engine | 候選 SQL Server 2022 Developer（僅非正式測試）＋compatibility 160；DBA 固定 CU/build、映像 digest、OS/架構、Edition/license。正式環境版本/Edition/CL 尚未知，不能宣稱代表 production；不同版本需另驗 | UNKNOWN |
| Instance/DB | 獨立、可棄置 instance 及唯一 run 專用 DB；不得以正式 instance 的另一 schema 冒充隔離。核對 DB ownership、default collation、RCSI/SNAPSHOT、triggers、jobs、linked servers、restore/failover 邊界；關閉不需要的外連能力 | UNKNOWN |
| 網路 | allowlist 僅 test runner→指定隔離 endpoint；deny HIS、正式資料來源、Oracle、任意 Internet/linked-server/跨 DB 外部依賴。需網路管理員規則審核及隔離 canary 拒絕連通見證，不能探測真 HIS/正式端點；「沒有使用正式連線字串」不能代替隔離 | UNKNOWN |
| 身份／secrets | 分離下表角色；秘密由核准的短期 secret channel 注入，Git/artifacts/終端紀錄不含密碼、token、私鑰、正式憑證或完整連線字串。本包不提供真 endpoint/account/secrets | UNKNOWN |
| Driver/TLS | 鎖定 Node、mssql/底層 TDS driver 精確版本及鎖檔；候選 encrypt=true、trustServerCertificate=false，核對 CA chain/SAN/hostname/有效期、TLS 最低 1.2 與實際 negotiated encryption、auth scheme、credential rotation。只輸出去敏 pass/fail/版本；不修改既有設定 | UNKNOWN |
| Connections | 至少 A/B 兩條獨立實體 connection，同一指定 DB、不同 session；避免 pool 借用同一 session 或跨 session transaction。另設必要 observer C；用去敏 session/transaction correlation 證明獨立性、owner/生命週期 | UNKNOWN |
| Fixture | 只用明確合成 user/role/query/SQL/parameter/dashboard/audit；涵蓋 >2^53 BIGINT、空集合、多列、lookup、historical Dataset≠effective Dataset、最後兩名 admin。禁止患者/正式資料、備份或真查詢結果匯入 | UNKNOWN |
| 重建來源 | 固定 repo SHA、經 DBA 審核的**完整**既有 Migration manifest/checksums、fixture/seed 版本與 deterministic IDs。001/002/003/004/005/006/014/016/020/022/913/917/919/920/921 為本包引用來源，不宣稱此子集合已足夠安裝。沒有 922 或臨時 AE/Q 替身 | UNKNOWN |
| 控制／觀測 | Barrier timeout、整體 deadline、取消/斷線故障注入、獨立 readback、證據收集/去敏與最小權限方案需先審核；不靠固定 sleep 推斷順序，不把 observer 查詢當 owner 業務鎖 | UNKNOWN |

最小權限分工（尚未建立/授權）：

| 角色 | 必要範圍／不能推定的能力 |
| --- | --- |
| Provisioner/DBA | 僅未來批准的專用 instance：安裝既有 schema/fixture、故障復原及觀測設施；不將管理權給 application/test writer |
| Catalog reader | CONNECT＋隔離 DB 的 VIEW DEFINITION／必要 metadata 可見性，無業務表 SELECT 或 DML/DDL。DBA 檢查 object-level DENY/隱藏物件；單一 HAS_PERMS_BY_NAME=1 不保證全 Catalog 完整 |
| Writer A/B | 僅合成 fixture 指定物件的必要讀寫／模組執行；候選 app-lock DB principal membership 另驗，不授權任意 DDL、外部來源、sysadmin/db_owner。T7 reseed/identity 故障只由 DBA 在可棄置 DB 操作 |
| Observer | DBA 限定收集對應 session 的 lock/transaction/plan/deadlock 證據；SQL Server 2022 相關 DMV/XE 可能需 VIEW SERVER PERFORMANCE STATE 或其他權限，版本及實際最小 grant 待驗。不能為了觀測擴大 Writer 權限 |

## 2. Catalog 使用契約（本階段不執行）

未來先由 DBA/環境管理員見證正確 isolated endpoint/DB、權限及 manifest，才另行授權執行 Catalog。腳本沒有 USE、SQLCMD、connection、transaction、DML、DDL、EXEC、動態 SQL、外部 rowset 或業務表讀取；只有 SELECT/CTE/常數及必要內建 metadata 函式，FROM/JOIN 限 sys views 或 CTE/VALUES。

| Result set | 必須人工對照的內容／fail-closed 邊界 |
| --- | --- |
| R0/R1 | 實際 Engine/Edition/CL/collation/RCSI、schema/table/object 類型及 visibility；不輸出 server/login 名稱。metadata denial、NULL、空結果或不完整任一項都 UNKNOWN/BLOCKED，不能判定「不存在」 |
| R2/R3 | 所有可見 uqp tables/columns、型別/alias/長度/精度/nullability/identity/computed、NVARCHAR collation、ROWVERSION；PK/Unique、索引 key ordinal/ASC/DESC/INCLUDE、filter/disabled/hypothetical。不能只看 index 名稱 |
| R4/R5/R6 | uqp 的入/出 FK（含其他 schema）、NO ACTION/CASCADE/SET NULL、trusted/enabled/replication；DML/DB-scope DDL triggers；CHECK/default 的摘要。沒有讀 module bodies、帳密/參數/查詢資料列。server-scope triggers、Agent/DBA/外部 Writer 不在腳本證明範圍 |
| R7 | 明列 UserRole/RolePermission、雙向 ACL、Dataset→Query、owner/lookup→Parameter、Query/Dataset→Dashboard source、Username/Role Code 等 prefix。只檢查**明示 key 前綴**；implicit clustered keys、INCLUDE、filtered index 或不同合法計畫另由 DBA 審查，不以 GAP 推論 SQL 必不保護 phantom |
| R8a–g | 對照 [920](../database/migrations/920_dataset_definition_rowversion.sql)／[921](../database/migrations/921_datasource_native_parameter_versions.sql)：D/S 各唯一真 ROWVERSION；contract 恰八欄、精確 system/user type/nullability；非 temporal/memory optimized、無 trigger、唯一 PK(DatasetId)、兩個可信 NO ACTION FK、四個精確 CHECK、單一 UNCONFIRMED default。欄/約束少、多、partial install 均拒絕，不自動修復 |

R8 使用 921 同版保守 expression normalization 只回「可見形狀相符」，**不是另一個 Schema verifier/issuer**；必須合併 counts、每項結果與完整可見性審核，缺 result set 不可放行。不存在的表造成 R8d 空集也不是 pass。921 仍只允許 UNCONFIRMED；不查/新增資料列、不建立 CONFIRMED。

Filter/CHECK/default 定義只輸出 hash 或已知規則的比對結果，避免未知 metadata literals 外洩；hash 不能證明 filter predicate 等價。DBA 須在隔離環境本地審閱實際定義、對照 manifest，僅提交去敏結論及被審定義版本。Catalog 可能於多個 SELECT 間漂移；未來需無 schema writer 的受控窗口及前後重查，不能宣稱原子 Catalog snapshot、鎖序正確或跨 DB lease。

## 3. 故障、保存與回復（僅規格）

每 run 先記 runId、repo/fixture/schema/catalog/driver/環境 manifest digest、時序/barrier、case ID 及預期結果；證據只保存合成 opaque IDs、精確 BIGINT/RV、允許欄位/counts、lock mode/resource、plan operators/index mapping、錯誤 code/transaction outcome。原始 query text、bind 值、plan XML runtime literals、connection string、帳密/患者資料不得寫入報告；需要的原始診斷只准在已核准且確認全合成的受控位置，否則不收集並標記證據不足。禁止把完整 deadlock XML 直接貼到 CI。

故障後：停止新工作→取消/有責任 owner 嘗試 rollback→observer 驗證各 session/transaction 是否結束→獨立 connection 精確 readback。Rollback failure/commit unknown 均 quarantine，不回成功、不盲重放，也不憑 client 例外假定 rollback。先保存去敏證據與失敗狀態，才由 DBA 依核准 manifest 重建**該 run 專用** fixture/DB；不得接觸其他 DB、刪正式 audit 或修改真設定。Identity gap 不假定能 rollback；restore/reseed/重建須新 run/incarnation，舊證據不可復用。

證據存放位置、存取人、保留期限/刪除批准者、容量/加密、故障復原時限目前 UNKNOWN；先定案才能 DB_TEST_ENV_READY。摘要/CI artifact 並非 append-only、永久保存或 durable audit proof。

## 4. Release Gates 與本次驗證

| Gate | 本次狀態／所需證據 |
| --- | --- |
| ISOLATED_MODEL_COMPLETE | 已有 C2/C4/C5 各自**受限合成契約**及 CI #882 證據；不代表 production scope/授權完整 |
| DB_TEST_ENV_READY | **UNKNOWN／NOT_READY**；manifest、隔離網路、帳號/TLS、兩 connection、fixture/rebuild/保存政策及 DBA Catalog 審核均未觀測 |
| SQL_LOCK_VERIFIED | **NOT_RUN／BLOCKED**；矩陣全部需真機、barrier、plan/range/FK/deadlock/故障證據；不得稱 deadlock-free |
| WRITER_COVERAGE_VERIFIED | **GAP／BLOCKED**；AE/Q schema 及全 Writer 尚未建立/覆蓋；deleteUser/cascade、DBA/腳本/舊 Worker/混合部署仍有旁路，ACL hash/UpdatedAtUtc 不補此缺口 |
| PRODUCTION_SAFETY_BLOCKED | **TRUE**；DB-generated 精確 Reader、Audit/Decision 保存/同交易持久性、Identity/collation、外部 restore incarnation、Source identity/generation/lease/DDL fence 皆未證明 |

原 ACL/遮蔽/患者稽核/Legacy及Managed Dashboard guards 不動；authority=NONE、runtimeBindVerified=false、deliveryAllowed=false、persistence=NOT_PROVEN、productionSafetyProven=false。沒有可信來源證據與完整交易驗收，Native Type confirmation／Runtime／delivery 均 BLOCKED；DB_TEST_ENV_READY 即使未來通過也不解除這些 gate。

本次靜態檢查：16 個 SELECT/CTE statements、15 種 allowlisted sys views，無業務表來源、mutation/SQLCMD/外部 rowset，括號及文件連結檢查通過；另做 staged diff 檢查。本地 Server typecheck/build 通過；本地 Client 未安裝依賴（tsc not found），typecheck/build 未能執行，交由既有 Server/Client CI 驗證，最終結果見提交回報。SQL Server parser/compile、Catalog 實測、TLS/權限/網路/Lock/隔離與 T1–T10 **全部未執行**，靜態檢查不是其替代；未安裝任何 SQL Server 或建立測試環境。

下一最小階段 **CONDITIONAL：D0B 環境見證與唯讀 baseline 驗收**，另行授權後才準備隔離 instance/fixture、確認 manifest/網路/帳號/TLS/兩 connection，先執行及審核本 Catalog；有缺口先停，不自動補索引/DDL、不引入 922/AE/Q/正式 Writer。後續再分批申請 T1/T6/T7 的純合成 DB 實測；其餘依前提開放，未具備 AE/Q/Decision 的案例保持 BLOCKED。本準備包不授權環境安裝或任何 DB 動作。
