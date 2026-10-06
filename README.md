# Universal Query Platform

通用低程式碼資料查詢與報表平台，設計方向類似企業級 Smart Query 類型工具。

管理者／設計者可以在瀏覽器中設定資料來源、Dataset、SQL 查詢條件、結果欄位、Query Icon 與使用權限；一般使用者只會看到自己被授權且已發布的查詢功能。

## 目前已完成

- React + Vite + TypeScript 前端
- Node.js + Express + TypeScript 後端
- SQL Server 平台設定資料庫
- Login / JWT / RBAC
- User / Role / Permission 管理
- SQL Server / Oracle DataSource Manager
- DataSource 密碼 AES-256-GCM 加密保存
- SQL Server / Oracle 測試連線
- Oracle Service Name / SID
- Oracle Thin / Thick driver 模式
- Dataset / Query Designer
- SELECT-only SQL 安全檢查
- 跨資料庫參數語法 `{{PARAM_NAME}}`
- Text / Number / Date / DateTime / Select / MultiSelect / Checkbox Parameter Designer
- 固定 Select 選項與 Lookup Dataset 選項
- Query Preview 與最大筆數 / Timeout 控制
- Query Publisher / Draft / Published
- Query Icon / Category / SortOrder
- Role 與 User 層級 Query View / Execute / Export 權限
- 使用者 Query Portal
- 動態查詢條件 UI
- Report Column Designer
- 欄位顯示/隱藏、標題、順序、寬度、對齊、格式
- SUM / AVG / MIN / MAX / COUNT 彙總
- Excel 匯出
- Query Execute / Excel Export Audit Log
- 首次 SYSTEM_ADMIN 初始化
- SQL Server migration runner
- GitHub Actions TypeScript CI

## 尚未完成／後續階段

- GroupOrder 的群組展開/收合顯示
- Pivot / 樞紐分析
- Chart Designer
- 更進階的動態 Filter Builder
- CSV / PDF 匯出
- 排程報表
- 正式部署加固與實際 SQL Server / Oracle 整合測試

## 權限模型

平台層級：

- `VIEW_QUERY`
- `EXECUTE_QUERY`
- `EXPORT_QUERY`
- `DESIGN_QUERY`
- `PUBLISH_QUERY`
- `MANAGE_DATASOURCE`
- `MANAGE_USERS`
- `VIEW_AUDIT`

Query 層級另外支援 Role / User 的：

- View
- Execute
- Export

一般使用者不能提交或修改 SQL，也不會取得 DataSource 帳密。

## SQL 安全

Query Designer 第一版只允許單一 SELECT / WITH 查詢。

後端會拒絕常見寫入或高風險語法，包括 INSERT、UPDATE、DELETE、MERGE、DDL、EXEC、SELECT INTO、FOR UPDATE 等；所有使用者輸入值都透過 Bind Parameter 執行。

正式業務資料庫仍建議使用唯讀帳號，作為第二層保護。

## Migration

Migration 位於：

```text
database/migrations/
001_platform_identity.sql
002_datasource.sql
003_dataset_query_designer.sql
004_parameter_designer.sql
005_query_definition_and_access.sql
006_audit_log.sql
007_report_designer.sql
```

Backend 提供 migration runner，會依檔名順序執行並記錄於 `uqp.SchemaMigration`。

## 第一次部署

### 1. 建立空的 Platform SQL Server Database

例如：

```sql
CREATE DATABASE UniversalQueryPlatform;
```

建議使用專用 DB 帳號，授予平台資料庫所需權限。

### 2. Backend 設定

```bat
cd server
copy .env.example .env
npm install
```

至少設定：

```env
PLATFORM_DB_SERVER=your-sql-server
PLATFORM_DB_PORT=1433
PLATFORM_DB_DATABASE=UniversalQueryPlatform
PLATFORM_DB_USER=your-user
PLATFORM_DB_PASSWORD=your-password

JWT_SECRET=請使用長且隨機的字串
BOOTSTRAP_ADMIN_TOKEN=首次初始化使用的長隨機字串

DATASOURCE_ENCRYPTION_KEY=32-byte Base64 key
```

產生 DataSource Encryption Key：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 3. 執行 Migration

```bash
npm run db:migrate
```

### 4. 啟動 Backend

```bash
npm run dev
```

預設：

```text
http://localhost:3000
```

Health Check：

```text
GET /api/health
```

### 5. Frontend

另一個 Terminal：

```bat
cd client
npm install
npm run dev
```

預設：

```text
http://localhost:5173
```

### 6. 建立第一位管理員

進入：

```text
http://localhost:5173/setup
```

輸入：

- `BOOTSTRAP_ADMIN_TOKEN`
- 管理員帳號
- 顯示名稱
- 初始密碼

成功建立 `SYSTEM_ADMIN` 後，建議立即從 `.env` 移除：

```env
BOOTSTRAP_ADMIN_TOKEN=
```

並重新啟動 Backend。

## Oracle

預設使用 node-oracledb Thin mode：

```env
ORACLE_DRIVER_MODE=THIN
```

不需要安裝 Oracle Client。

若要連線較舊 Oracle，例如某些 Oracle 11g 環境，可改用 Thick mode：

```env
ORACLE_DRIVER_MODE=THICK
ORACLE_CLIENT_LIB_DIR=C:\oracle\instantclient_19_x
```

需另外安裝相容的 Oracle Instant Client。

DataSource Manager 本身支援：

- Service Name
- SID

## 建議的建立流程

```text
DataSource
   ↓
Dataset / SQL
   ↓
執行 Preview 同步輸出欄位
   ↓
Parameter Designer
   ↓
Query Publisher
   ↓
Report Designer
   ↓
Role / User Query Access
   ↓
Publish
   ↓
Query Portal
   ↓
查詢 / Excel / Audit
```

若 Dataset SQL、Parameter、Query Definition 或 Report Layout 被修改，相關已發布 Query 會自動退回 Draft，必須重新檢查並 Publish。

## 安全注意事項

- 不要將 `.env` 提交 GitHub。
- DataSource 建議一律使用唯讀 DB 帳號。
- `DATASOURCE_ENCRYPTION_KEY` 不可遺失，否則已儲存的 DataSource 密碼無法解密。
- 正式環境應使用 HTTPS。
- 正式環境應限制 Backend 與資料庫的網路來源。
- Audit Log 應納入備份與保留政策。


## Generic ODBC compatibility

The platform prefers native database adapters for SQL Server, Oracle, MySQL, and PostgreSQL.
ODBC is available as a compatibility fallback for legacy or specialized databases.

ODBC supports:
- DSN mode
- encrypted full connection string mode
- positional parameter binding
- connection/query timeout
- max-row protection
- connection diagnostics

On Windows, install the appropriate ODBC driver for the target database and keep the Node.js/ODBC driver architecture consistent (normally 64-bit).
