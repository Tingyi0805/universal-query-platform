# PIN 最小恢復紀錄

本輪已從遠端備份分支核對完整 HEAD／tree 與四筆提交後接續；下方第一至四批為恢復歷史，並非目前未接線結論。[Session／登入／受限 QueryDelivery／UI／Migration 927 與驗證邊界](workstation-pin-runtime.md) 記錄本輪新增工作。Runtime 仍預設關閉，SQL 未實測、未正式部署；備份分支或單元測試通過都不代表整體驗收。

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

## 第三批：恢復 forward 草稿（未完成正式 Migration）

[forward SQL](../database/drafts/workstation_pin_runtime.forward.sql) 僅增加 `SharedWorkstation.SwitchVersion` 及 `WorkstationPinAttemptBucket`，沿用 readiness 設計。Schema 交易使用專用 applock；缺前置、已有／部分安裝或名稱衝突時拒絕，不採認／修補既有物件，不重設 generation 或計數。未增 Session 表、RBAC、服務或資料庫，也未變更既有 902–905、916、926。計數 key 預期使用外置 key 的不可逆 digest，不保存原始 PIN／帳號／IP。

草稿目前要求無外層交易的專用 connection，尚未接入 Migration runner。正式編號前仍需加入完整已安裝狀態 attestation／安全重跑契約，以及隔離執行、失敗回滾和既有 writer 相容性驗證；目前不得以此草稿取代可交付的 Migration。

驗證：3 個 additive DDL 經 sqlglot 28.0.0 T-SQL 解析；靜態範圍檢查確認沒有 DML、Ledger 寫入或破壞性 DDL。TRY／transaction／applock 尚未在 SQL Server 執行。清冊 validator 通過：62 SQL 來源、49 歷史 Migration SHA／集合不變；新增草稿 17 個宣告物件列 UNKNOWN，不代表正式 DB 新增物件。

後續未完成：正式 Migration、SQL 共享計數 Runtime、generation CAS Runtime、Session／Cookie／CSRF、受限 QueryDelivery 與 PIN 登入／切換／閒置鎖定 UI。沒有以 verifier 或 Schema 草稿冒充這些功能已完成，也沒有推送可交付版本。

## 本機完整 Server 回歸

Node v24.19.0，Server 全套 **2263／2263 PASS**，0 skipped；Typecheck／Build PASS。初輪因安裝時未建置 ODBC native 元件而有兩個依賴測試失敗，`npm rebuild odbc` 後 11 項相關案例及完整重跑通過；沒有修改依賴版本、lockfile 或測試規則。

本輪沒有 Client／Browser 變更，尚未執行完整 Client／Browser、Windows Node v24.22.1 或實機觸控驗收。沒有推送／觸發 CI；不把本機 Server 綠燈當作整體 PIN 可交付。

## 第四批：共享失敗計數與 generation Repository（未接登入）

依最新使用者指示，不下載 SQL Server 映像、不要求調整網路允許清單；不把容器隔離驗證當作繼續編寫程式的前置條件。先前 Docker 測試受阻的紀錄不代表需要使用者安裝 SQL Server，也不代表正式資料庫有變動。SQL 實際鎖定與回滾語意仍屬未驗證。

新增 `workstationPinState.repository.ts`，預設旗標關閉時不存取 DB。這是待 Session 流程使用的內部 Repository，沒有新增或開放登入路由：

- 使用外置 32-byte key 的 domain-separated HMAC digest，涵蓋 ACCOUNT／WORKSTATION／NETWORK，含不存在的帳號。呼叫端必須提供正規化帳號與既有可信 IP resolver 的網路識別，不接受直接採信任意 forwarded header。
- SERIALIZABLE 交易先取得既有 workstation config shared lock，再按固定順序取得三個 bucket 的 transaction applock；同一交易持鎖穿過驗證／Audit callback 與計數寫入。查完所有封鎖狀態才分配新 bucket，避免封鎖的網路持續製造帳號資料列。
- 帳號 5 次、工作站 20 次、網路 50 次失敗封鎖 15 分鐘；帳號第 3／4 次分別延遲 5／30 秒。使用 SQL Server 時間；視窗到期且封鎖已解除才重置。成功只重置帳號，不清除共享工作站／網路失敗紀錄。
- 第一階段原子增加 SwitchVersion、撤銷 A 並要求 Audit callback 成功才 commit；第二階段在呼叫端同一交易以 generation CAS 防止過期意圖。BIGINT generation 使用十進位字串，不轉 JS Number；停用／退役／用途與 PIN 旗標亦限制 claim。
- 呼叫端仍須先驗工作站憑證，驗證 live user／PIN／TokenVersion／有效授權，寫入新 Session、Audit，並記錄 LOCKED 拒絕；這些接線尚未完成。Repository 本身不能當作身份驗證 API。

本批測試是離線交易模擬，不能證明真實 SQL Server 的跨 instance 併發與鎖定行為。沒有執行 SQL／Migration，沒有修改 CI 或正式環境。

第四批驗證：新增 Repository 9 項交易模擬測試，連同 scrypt／PIN 管理共 **22／22 PASS**；Server Typecheck／Build、既有清冊 validator 及 diff whitespace 檢查通過。本批沒有重跑完整 Server／Client／Browser，不沿用前批 2263 項結果宣稱本批完整回歸。
