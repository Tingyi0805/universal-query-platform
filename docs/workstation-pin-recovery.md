# PIN 最小恢復紀錄

基準：`f0022ea8610861b1d687664f634317d1490ff4c0`。
原未提交成果未恢復；以下是依既有 readiness 補回的內容，不宣稱找回原草稿。
使用者已指示沿用既定方案，僅補必要缺口；不重做架構或正式資料庫盤點。

## 第一批：唯讀 Schema 檢查 SQL

- [SQL](../database/acceptance/production-workstation-pin-readonly.sql) 僅查系統 Catalog 與目前執行環境；不讀取任何應用資料列。
- 包含 902–905／916 相關表與欄位、型別、DEFAULT、CHECK、PK／UQ／Index、雙向 FK、Trigger metadata；926 的既有裝置 CHECK／Trigger 納入描述，沒有改動。
- 物件不存在及權限不足不當作正式環境缺漏的證明。這是人工比對證據，不是 exact Schema validator，也不以物件存在宣告可部署。
- Ledger 資料、備份與正式資料不重查；未連線或執行本 SQL。後續若核准手動執行，先確認實際 Server／Database 與 metadata 可見性，再與既有 Migration 定義比對。
- `WorkstationPinAttemptBucket` 僅是 readiness 既定共享計數名稱的 Catalog 查詢，這批沒有建立表或正式 Migration。generation／Session 綁定仍待下一批。
- Runtime、CI、歷史 Migration 均未修改；PIN 登入仍未啟用。

## 本批離線驗證

使用 sqlglot 28.0.0，執行 `python3 tools/validate-workstation-pin-readonly.py`：7 個 T-SQL SELECT AST；僅 sys Catalog，無 INTO／星號／寫入／EXEC，5 個不安全 SQL 拒絕案例通過。
Parser 靜態檢查不等同 SQL Server 編譯或執行；未宣稱隔離 SQL 或正式 SQL 驗收通過。

`node tools/validate-database-schema-inventory.mjs` 通過：61 SQL 來源、原 49 Migration SHA／集合與物件數量不變。
`git diff --check` 通過。本批未改 Runtime，未執行 Server／Client／Browser 全套或 Windows 測試。

下一批沿用 readiness 的 SwitchVersion 與 SQL bucket 設計，確認編號及必要相容性後補 forward SQL；本紀錄不代表整體 PIN Runtime 完成或可交付。

## 第二批：PIN verifier

新增固定參數 Node scrypt（N=32768、r=8、p=3）、每筆隨機 16-byte salt、32-byte verifier；以外置 32-byte pepper 做帶 domain 的 HMAC 預處理。格式保存版本與 pepper ID，不含 pepper。參數與編碼嚴格限制，資料庫中的 Hash 不能提高 KDF 成本；每個程序最多兩個同時 KDF，忙碌拒絕、不無限排隊。

設定 `WORKSTATION_PIN_PEPPER_ID` 與 `WORKSTATION_PIN_PEPPER`（標準 base64 32 bytes），不在 Repository 或 SQL 保存正式值。`WORKSTATION_PIN_RUNTIME` 預設 false；本批沒有登入 API。任一 pepper 設定出現或旗標為 true 時，新的 PIN 設定必須使用有效 pepper 的 scrypt，缺少／錯誤配置拒絕，不回退 bcrypt。預設未配置且旗標關閉的既有安裝維持原 bcrypt 設定流程。

既有 bcrypt 僅保留正式密碼與管理流程的相容比對；新的 runtime verifier 不接受 bcrypt。舊 PIN 須以正式密碼重新設定，沒有批次轉換明文或放寬 PIN 重用限制。pepper ID／key 改變會拒絕舊 verifier，須重新設定 PIN；不宣稱已有多 key 自動輪替。pepper 欄位加入既有日誌遮蔽。

驗證：PIN verifier／管理異動／政策／日誌相關 18 項測試、Server Typecheck／Build 通過。這不是登入、Session 或共享計數的完成驗收。

隔離 SQL：Docker 可用，但 `mcr.microsoft.com/mssql/server:2022-latest` 下載回覆 `Forbidden`；沒有 SQL Server 容器啟動，沒有 SQL 執行。forward SQL 不得據此標示已通過隔離驗收或可正式執行。
