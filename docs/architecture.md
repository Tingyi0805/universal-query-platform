# Architecture

## 核心原則

1. 一般使用者不得提交或修改 SQL。
2. 前端只提交 Query ID 與已定義的參數。
3. 後端負責讀取 Query Definition、驗證參數、Bind Parameter 與執行查詢。
4. 外部正式資料來源原則上使用唯讀帳號。
5. DataSource 密碼不得存入 Git。
6. 權限採 RBAC，並預留 User Override。
7. 查詢及 Excel 匯出必須可記錄 Audit Log。

## 高階資料流

Browser -> React -> REST API -> Query Engine -> DataSource Adapter -> SQL Server / Oracle

平台設定資料存於獨立 SQL Server，包含 DataSource、Query Definition、Parameters、Roles、Permissions、Audit Log。
