# BUG-002 / 923-D1：離線 DDL 與 Catalog 契約

依 [923 核准決策](dataset-metadata-923-owner-fence-decision.md)，基準 `c2e09554bd218ef8462c94fa4a3f9f2d317521a3`，PR #66 保持 Draft。**本次只交付原始碼及合成測試；沒有執行任何 SQL、連接 DB、安裝 Migration 或接線功能。**

## 原始碼與防誤執行

- [DDL 草稿](../tools/sqlserver-acceptance/drafts/923/923_dataset_metadata.draft.sql)：四表、一個 Sequence，無 DML、權限／Scope seed、SchemaMigration 寫入或有效確認。
- [唯讀 Catalog Validator](../tools/sqlserver-acceptance/drafts/923/923_catalog_readonly.sql)：單一 SELECT/CTE，只讀 sys catalog、內建 metadata 函式。
- [離線契約](../server/src/modules/dataset/datasetMetadata923Catalog.ts) 統一產生上述兩份文字；[測試](../server/src/modules/dataset/datasetMetadata923Catalog.test.ts) 比對已提交檔案，防止手改 SQL 後與契約分歧。此 module 未由正式 API／Repository 匯入，不執行 SQL。

`server/src/scripts/migrate.ts` 以非遞迴 `readdir(database/migrations)` 搭配 `/^\d+_.*\.sql$/i` 選取檔案。草稿位於該目錄**之外**，不會被自動掃描；不新增假的 922。Runner 的一般 `status/adopt` 亦可能先建立 schema／追蹤表，且 module 會自行呼叫 main；離線測試只讀原始碼，不 import 或呼叫 Runner。**不要將草稿複製進 migrations 或執行 db:migrate/status/adopt。** 本交付不是可重入 installer：未來需由核准 owner 先驗全無／一致、拒絕 partial，再於獨立批准的交易安裝；不提供自動修復。

## 固定 Schema

| 物件 | 欄位／實體 ROWVERSION | 鍵、索引與 FK |
|---|---|---|
| DatasetFieldSnapshot | 30／1 | clustered PK(Id)；nonclustered UQ(DatasetId,Id)；DatasetState index 含三個 INCLUDE；Source 反查；Dataset/Source FK |
| DatasetSecurityScope | 13／1 | clustered PK(DatasetId,UserId,ScopeKind)；LastRequestId UQ；User/Parent/Source index；Dataset/User/Source 與同 Dataset parent OWNER 自參照 FK |
| DatasetSecurityDecision | 25／0 | clustered PK(Id)；RequestId UQ；Dataset/Snapshot index；每 Snapshot 一次 collection 的 filtered unique index；Dataset/Snapshot/Scope FK |
| DatasetSecurityConfirmation | 19／1 | clustered PK(DatasetId)；Snapshot index；(DatasetId,SnapshotId) 複合 FK；不建 DecisionId 回指 FK |
| DatasetSecurityDecisionSeq | BIGINT | START/MIN/INCREMENT=1，MAX=9223372036854775807，NO CYCLE；明訂 NO CACHE 以固定離線 baseline，仍允許 rollback gaps，不預測 ROWVERSION |

共 **87 欄、16 索引（含 PK/UQ）、10 FK、24 CHECK、4 DEFAULT**。文字皆明訂 Latin1_General_100_BIN2；引用版本為 BINARY(8)，digest 為 BINARY(32)，日期 DATETIME2(7)，SourceGeneration/LeaseVersion 為正 BIGINT。ID/版本的 SQL metadata 字串保留精確值；只在欄位 ordinal／固定 byte 長度使用小整數，沒有 ID 的 Number 修復。所有 FK 為 trusted、enabled、NO ACTION。

固定 enum 逐值配對 DATALENGTH，避免 BIN2 比較仍忽略尾端空白。所有 CHECK 以 `CASE WHEN predicate THEN 1 ELSE 0 END=1` 包裝，FALSE／UNKNOWN 都拒絕。另明列 SOURCE_BOUND 的全部 source nullable 欄位、ACTIVE 的分類／政策／簽署者／scope/token，以及 REVIEWER parent 與 Decision nullable composite FK 的必要非 NULL 條件。Patient/A/B 欄位組合、PreviousState=MISSING iff 版本 NULL、非 NULL 版本不可全零、JSON 的 ISJSON 與 byte 上限皆列入。合法跨表狀態轉移、來源可信度及當前 Scope 授權仍須未來交易 Writer 驗證；CHECK 不發證。

Snapshot/Scope/Confirmation 預設僅 DESCRIBED/REVOKED/PENDING。無 SOURCE_BOUND/ACTIVE INSERT/UPDATE、權限 seed、自動分類或既有業務資料修改。舊政策／患者設定不清空；與 922 完全無引用關係。

## Catalog 判定與嚴格邊界

| 結果 | 含義 |
|---|---|
| NOT_INSTALLED | 完整可見前提下，五個目標物件及預期 constraint namespace 無衝突；不是安裝核准或既有 001–921 前提通過 |
| EXACT_MATCH | 四表／Sequence 的**定義**與固定 baseline 一致；不表示資料、授權、append-only、原子性或持久性有效 |
| REJECTED_PARTIAL_OR_DIFFERENT | 部分安裝、同名異形、遺漏／額外定義或重複 Catalog row；停止，不自動修復 |
| REJECTED_UNKNOWN | 可見性／引擎／compatibility 不符、未知合成格式或不安全輸入；SQL 錯誤／沒有完整結果也須視為 UNKNOWN |

SQL 要求 SQL Server major 15、compatibility 150、有效 DB VIEW DEFINITION，並保守限定 `USER_ID()=1` 的 dbo metadata context。只持 database VIEW DEFINITION 的一般帳號可能仍有個別 securable DENY，不能據此證明沒有隱藏物件／反向 FK。**本次不授予權限或要求把 application 帳號升為 dbo**；未來由另案核准的管理端提供只讀 catalog witness，若要放寬為專用低權限帳號，須先證明完整 visibility 契約，不能直接移除閘門。合成 `OWNER_VISIBLE_CATALOG` 字串只供測試，不是真實身分證據。

比對含 column ordinal/type/length/precision/scale/nullability/collation、identity seed/increment、computed/hidden/sparse/masking/encryption 等異形旗標；PK/UQ 的 backing index、FK 雙方欄位順序／引用／NO ACTION/trust/disabled、CHECK/DEFAULT 原文、index keys/ASC/INCLUDE/filter/unique/disabled、每表 ROWVERSION 數量與 Sequence 定義。多餘欄位、index、constraint、table trigger、未知子物件、外來 inbound FK 或 constraint 名稱佔用均拒絕。Sequence current value、identity last value、ROWVERSION 值不屬定義 baseline，不推測下一值。922 的其他物件不進此投影。

文字使用 BIN2 並比對 DATALENGTH，避免 SQL 比較忽略尾端空白。**CHECK/DEFAULT/filter 的 Catalog 回存原文採嚴格 spelling gate**：不刪括號、不改 literal／Unicode、不接受未知等價式。尚未在真 SQL Server 取得這份 DDL 的回存定義，SQL Server 自動補括號／格式差異可能保守拒絕；F1 必須校準並審查有限的精確 baseline，不能以去掉括號或放寬邏輯來讓驗證通過。因此合成 EXACT_MATCH 不代表真實安裝後已驗證一致。

## 離線驗證與未解除條件

合成測試涵蓋全無／一致／部分／同名異形、逐類遺漏與額外項目、型別及 BIN2、nullable、FK/CHECK/index 篡改、UNKNOWN 漏洞防護、922 缺席／存在、重複驗證、>2^53/最大 BIGINT 文字、getter/Proxy 不執行及去敏結果，以及草稿隔離與唯讀 SQL 靜態檢查。這些不是 T-SQL 引擎執行、實際 Catalog 或交易測試。

本地驗證：新增離線測試 **67/67**、Server 全量 **1,577/1,577**、Client 單元 **37/37**、Playwright **123/123**；Server/Client typecheck 與 build 全通過。Server 測試以網路 guard 禁止外部／DB 連線，只允許合成 loopback HTTP Mock；瀏覽器使用 Mock API。GitHub CI 另核對該 commit。

**Append-only 仍 NOT_PROVEN**：應用 principal 必須無四表直接 DML/ALTER 與 Sequence restart 權限，只能走審核模組；尚無 module／grant／permission 驗收。dbo/sysadmin 不在不可覆寫保證內。Decision 不 FK 線上 AuditLog，保留精確 AuditLogId，未來 archive Reader／Decision＋Audit 同交易、冪等與 CAS 必須另外驗收。

下一個最小任務：先提交並核准 **獨立 SQL Server 2019 的 F1 安裝／Catalog round-trip 驗收規格與環境 witness**，包括既有 Dataset/DataSource/AppUser 鍵前提、922 有／無、全無／精確／部分、每項非法 nullable 組合與 JSON byte 邊界、FK trust/NO ACTION、SQL 必要 SET options、精確 OUTPUT 及失敗 rollback；取得明確環境及執行授權後才能另案執行。之後才實作精確 Reader／owned transaction port，進 F1/F5 雙連線與 audit/decision 驗收。

**離線原始碼 GO；Migration 安裝、SQL_LOCK_VERIFIED、SOURCE_BOUND 發證、網站初始化、Native Runtime 與交付仍 BLOCKED。** Source identity/incarnation/generation/lease/Fence、全 Writer 覆蓋、Scope/Token 撤權與 F1–F6 皆未由本次解除。所有驗證輸出固定 authority=NONE、runtimeBindVerified=false、deliveryAllowed=false、persistence=NOT_PROVEN、productionSafetyProven=false。
