# F2-924：完整 Schema 驗收與安裝準備

本階段只允許 GitHub Actions 獨立 SQL Server 2019 容器實際安裝；**不在使用中的 UQP 執行、不覆蓋現有程式**。管理功能仍預設關閉；本文件不是使用者資料庫的執行核准。

## 完整建置與驗收

`sql-924-full-schema` 使用獨立 `uqp-924-full-schema` Instance、固定 loopback 14334、SQL Server 15.x／compatibility 150、隨機且遮蔽的測試登入密碼。`dataset924FullSchemaAcceptance.ts` 不讀 PLATFORM_DB 連線設定：建立全新 CI DB，執行 `database/migrations` 全部 **48 份正式 001～921 原文**與各自交易／GO batch，再呼叫專用 923 CLI。沒有 922，不造假 Ledger，也不以簡化 parent table 代替正式結構；923 裝妥後才驗收 924。完成／失敗均銷毀測試 DB／容器。

| 驗收 | 通過條件 |
|---|---|
| 完整基礎 | 48 個真實 Migration 記錄、46 張基礎表、923 專用安裝與 EXACT_MATCH |
| 924 absent／partial／wrong target | absent 可預檢；同名異形、部分安裝、錯誤 Instance／DB／Login、缺核准均拒絕 |
| DDL 失敗 | 在新增第二個能力時以合成 CHECK 拒絕；新 Binding、第一個能力、Ledger 均 rollback；另於 Ledger 寫入失敗時驗證 Binding、兩個能力與 Decision DENY 一起回復，不清除失敗現場來假裝成功 |
| 安裝／再入 | 924 精確 Catalog、兩個能力定義、public Decision UPDATE/DELETE DENY 與唯一 Ledger 同交易提交；第二次 apply 拒絕，不修補／adopt |
| 精確結構 | 10 欄、BINARY(8)（非新 ROWVERSION）、BIN2、複合 clustered PK、兩個 trusted NO ACTION FK、完整 CHECK 文字／flags；額外欄、索引、disabled CHECK/FK 拒絕 |
| CHECK／FK | 合法 Owner 可寫；尾端空白 kind、零 ID/token/version、NULL 必填、Owner 帶 parent、未知 Dataset FK 均拒絕 |
| 既有資料 | 安裝前後所有既有業務表內容雜湊相同（包含合成帳號雜湊、角色關聯、Dataset、Query、Dashboard/source、Audit）；只允許兩個新 Permission 定義與 Ledger，新 Scope 零筆 |
| 正式管理 Repository | 非 dbo／非 db_owner；明確能力、JWT 即時 TokenVersion；Owner/Reviewer、revoke/regrant、parent 版本失效、CAS 競爭、重放／碰撞、Dataset source ABA／Source RV |
| 原子性／保存 | Audit 或 Decision INSERT 拒絕後 Scope、Binding、Audit、Decision 恢復原狀；精確 Audit ID >2^53；Decision UPDATE/DELETE 拒絕；archive 後重放仍可關聯，清理後 fail-closed |
| 回歸 | Server、Client、Browser 全量；Windows PowerShell 5.1 parser 與離線 CLI 防護。Windows CI 不等於 Windows SQL Server 安裝實測 |

Catalog 使用固定版本 manifest 與 SQL Server 2019 精確 CHECK 回存格式；不把 target expression 正規化成看似相同。923 只抽出共用唯讀 Catalog projection，既有 manifest／DDL／驗收維持原契約。924 不新增指向 923 表的 inbound FK，因此 923 前後皆須 EXACT_MATCH。Binding 僅有 `(DatasetId,UserId,ScopeKind)` clustered PK：管理查詢以 Dataset 為前綴，首版沒有證據要求增加反向索引。Binding 與 Scope 的對應由既有同交易 CAS／版本 join 維持，不能把孤立 Binding 當 Scope。

## 專用工具及權限

SQL 草稿仍位於 `database/drafts/924_dataset_security_scope_binding.sql`，**不進一般 Migration Runner**。新 CLI：`npm run db:924:preflight`／`db:924:apply -- --confirm`／`db:924:verify`；Windows wrapper 是 `tools/install-uqp-924.ps1`（Preflight/Install/Verify）與 `.bat`。僅供未來另行核准的維護時段使用。

安裝程序必須同時具備：

1. 人員核准的隔離目標、無線上 Worker、備份與還原演練完成；禁止僅靠 DB 名稱認定隔離。
2. 專用安裝身分，於指定 DB 具有 dbo 完整 Catalog 可見性與安裝權限；不要提升平日 Runtime。Wrapper 強制使用獨立 SQL 安裝登入，隱藏密碼只存本次程序，最後還原原環境，不寫 `.env`。
3. 精確 `UQP_924_EXPECTED_SERVER`（@@SERVERNAME）、`...DATABASE`、`...LOGIN`（ORIGINAL_LOGIN）三項 attestation。
4. apply 另需 `UQP_924_APPROVE_INSTALL=I_APPROVE_ISOLATED_924`、`UQP_924_BACKUP_VERIFIED=YES`、`UQP_924_MAINTENANCE_APPROVED=YES` 及 `--confirm`。缺少即在連線前拒絕。
5. 安裝前所有 48 份 Migration＋923 已登錄且 923 EXACT_MATCH，924 全無且未登錄。SERIALIZABLE owned transaction／XACT_ABORT／installer application lock 後再次檢查；DDL、精確驗證、Ledger 一起提交，最後 verify。

日常 **Scope 管理的新增最小權限**（不是整套舊 UQP 的完整 Runtime 權限清單）：

- SELECT：AppUser、Role、Permission、UserRole、RolePermission、Dataset、DataSource、DatasetSecurityScope、Binding、Decision、AuditLog、AuditLogArchive。
- INSERT/UPDATE：Scope；INSERT/DELETE：Binding；INSERT：Decision、AuditLog。
- 物件層級 VIEW DEFINITION：Binding、Decision。sp_getapplock 使用既有 public 執行權限；沒有擴大 schema 或 database 權限。
- **不授予** sa/sysadmin、db_owner、db_datawriter、CONTROL、ALTER、Decision UPDATE/DELETE、VIEW SERVER STATE。SQL Server 2019 自身 session 的 DMV 可見性足以驗證 SERIALIZABLE；CI 使用無 VIEW SERVER STATE 的登入實測，不能把伺服器級授權當日常前提。
- 923 Sequence default 與 Decision 的同 owner chaining 需要實測成功；不因此泛授整個 schema UPDATE。任何簽章模組／不同 owner／DENY 差異需另行預檢，不自動補權限。

專用 installer 權限只在維護時使用。Runtime 還有 JWT／DESIGN_QUERY／Query ACL／患者稽核／遮蔽等原有需求；上述物件 grant 不替代原 RBAC，亦不自動授予任何帳號新能力或 Dataset Scope。

## 安裝風險與失敗處理

- 924 的 public DENY 會影響所有非 dbo 的 Decision 更新／刪除路徑；這是 append-only 前提。dbo/sysadmin 仍可繞過，管理 API 拒絕此種身分。既有正式 Writer 不應更新此 Ledger。
- 新 FK 會阻擋刪除有 Binding 的 Dataset/User；原 923 Scope 已有同類 FK，應停用／撤銷並保存歷史，不能刪 Ledger／Binding 硬闖。
- 不完整／未登錄／同名異形一律停止；工具不 repair、不 adopt、不重跑 001、不自動卸載。DDL fail 時可驗證 rollback；斷線、commit unknown、rollback failure 不能由例外推定回復成功，先停寫並用安裝身分 verify／唯讀查核 Ledger，再由 DBA 決定備份還原。
- 一般 db:migrate 不處理 924。未來部署須另審草稿與專用工具；目前沒有對使用者 DB 的執行授權。TLS 自簽信任只用於 CI 容器，Windows 真實部署須驗證伺服器憑證，不能照抄 trustServerCertificate=true。
- 平台 incarnation 的備份外登記及還原更新、外部 DBA／舊 Worker 的 TokenVersion 覆蓋尚未解除；安裝成功不等於可開功能。管理設定仍關閉，不改 JWT_SECRET。

## 下一階段最小計畫

1. **先給可操作結果**：在完整隔離環境以現有管理頁完成逐 Dataset 指派／撤銷 UAT；核對受限 Runtime、明確能力與平台 incarnation。無須新建另一套 Scope 架構。
2. **可信欄位初始化**：只支援已儲存、無參數 SQL Server SELECT；沿用 Saved Metadata Collector／923 Snapshot，補最小來源 identity/incarnation、依賴集合與 DDL Fence 協定。先在單一受控 source DB 用兩 connection 驗收 describe→confirm→execute 的 ALTER/DROP/權限變動，不能拿 descriptor hash／TTL 當 Fence。跨 DB／Synonym／Function 或參數未證明者保持拒絕，不擴成通用 SQL executor。
3. **Owner/Reviewer 分類確認**：直接沿用有效 Binding／CAS／Decision／精確 Audit；三類分類由使用者明確選擇。A 普通資料需可稽核確認；B 自選敏感欄＋CUSTOM/FULL/OMIT；C 另需患者識別、HMAC 與揭露稽核。變更 SQL／來源／Scope 保留舊規則但失效，不用欄名猜測。
4. **最早資料列預覽**：只在上述來源 Fence 與分類／政策／患者 Gate 全部成立的隔離合成 A 類 Dataset 接入既有 delivery 檢查；先驗證成功及每個失效負例，再擴 B/C。Source Fence 未成立前只回欄位 metadata，不讀原始資料列、不啟用正式 Native Runtime。

目前 Source Fence、SOURCE_BOUND 發證、SQL_LOCK_VERIFIED、正式敏感分類與資料列 Preview/Execute/Export 仍 BLOCKED。完整 Schema SQL 測試只證明此次安裝與管理 Writer 的受測路徑，不宣稱全 Writer deadlock-free、跨來源穩定性、永久 Audit 保留或使用者環境已驗收。
