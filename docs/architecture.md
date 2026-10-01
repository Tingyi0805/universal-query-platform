# Architecture

## 產品核心

Universal Query Platform 是「低程式碼資料查詢與報表設計平台」。

設計者建立：

DataSource -> Dataset -> Query Parameters -> Result Columns -> Report Layout -> Publish -> Portal Icon

一般使用者只操作已發布的 Query / Report，不直接接觸 SQL。

## 核心領域模型

### DataSource
定義 SQL Server、Oracle 等資料來源及連線方式。

### Dataset
定義一組可查詢資料，包含：
- DataSource
- SQL Template
- Columns
- Default Sort
- Maximum Rows
- Timeout

### Query Parameter
將 SQL Bind Parameter 對應成 UI 控制項，例如：
- Text
- Number
- Date
- Date Range
- Select
- Multi Select
- Checkbox

Select 選項可來自固定清單或 Lookup Dataset。

### Query Definition
定義使用者可以看到及操作的查詢：
- 名稱
- 分類
- Icon
- Dataset
- Parameters
- Result Columns
- Default Filters
- Sort
- Export Permission

### Report Definition
在 Query Result 上定義：
- 欄位標題
- 欄寬與格式
- Group
- Aggregate
- Header / Footer
- Report Layout
- Excel Export Settings

### Publication
Query / Report 採 Draft / Published 狀態。正式使用者只能看到 Published Version。

## 執行資料流

Browser
  -> Query/Report ID + Parameters
  -> REST API
  -> Permission Check
  -> Load Published Definition
  -> Validate Parameters
  -> SQL Compiler / Bind Parameters
  -> DataSource Adapter
  -> SQL Server / Oracle
  -> Result Normalizer
  -> Grid / Report / Excel

## 權限模型

User -> Role -> Permission

權限至少分為：
- VIEW_QUERY
- EXECUTE_QUERY
- EXPORT_QUERY
- DESIGN_QUERY
- PUBLISH_QUERY
- MANAGE_DATASOURCE
- MANAGE_USERS
- VIEW_AUDIT

並預留 User Override。

## SQL 安全

1. 一般使用者不得提交或修改 SQL。
2. SQL 只存在平台設定資料庫，由具設計權限的使用者維護。
3. Runtime 僅執行已發布版本。
4. 所有使用者輸入透過 Bind Parameter。
5. 正式 DataSource 原則上使用唯讀帳號。
6. 第一版 Query Designer 限制為 SELECT 查詢。
7. Query Timeout / Max Rows / Pagination 必須由後端強制執行。

## Audit

至少記錄：
- Login
- Query Execute
- Excel Export
- Query Definition Create / Update
- Publish
- Permission Change
- DataSource Change

## 後續擴充

- Dynamic Filter Builder
- Pivot Table
- Charts
- Scheduled Report
- CSV / PDF
- Cross-Database Dataset（後續評估，不列為第一版必要功能）
