# Dataset 欄位／敏感政策循環阻擋修復

## 根因

1. 儲存 Dataset SQL 不等於同步 `DatasetColumn`。原先欄位描述及同步交易只接受空參數集合，含參數的 SQL 無法建立欄位選項。
2. 前端把同步按鈕綁在政策 GET 成功之後；政策讀取失敗時連 metadata-only 同步也無法操作。初始政策讀取的延遲回應亦可能覆蓋剛同步的清單。
3. SELECT／lookup 參數選單受資料交付政策保護，初次讀取遭拒後，儲存政策沒有重新載入選項，預覽持續被舊錯誤阻擋。
4. 空規則陣列在既有統一遮蔽契約代表「沒有欄位獲准傳送」，不能改成 raw wildcard。UI 原先只確認空陣列，無法完成普通資料明確原樣顯示的操作。

最新基底已修正普通 Dataset／Dashboard 誤要求患者專用稽核的問題；本次保留該行為及啟用患者稽核時的全部檢查。

## 最小修正及安全邊界

- `POST /datasets/:id/columns/sync` 不讀敏感政策，僅接受空 request body、已儲存 SQL、DESIGN_QUERY＋EXECUTE_QUERY 及即時身份重驗；前端不再以政策 GET 失敗阻止同步。同步後若政策仍無法載入，只展示欄位，禁止覆寫未知政策。
- SQL Server：相同唯讀 lexer → `sp_describe_undeclared_parameters` → 嚴格驗證內建型別／bind 名稱 → `sp_describe_first_result_set`。Oracle：同一 lexer → `getStatementInfo()` 並比對命名 bind。兩者不執行 SELECT、不傳實際值／預設值、不回傳資料列；沒有 executeQuery fallback。
- 輸出僅為 `UNBOUND_CANDIDATE`／`DISPLAY_COLUMN_OPTIONS_ONLY`。引擎推導型別不是可信 Runtime Native Type，原 Typed Bind 契約不變。不寫 923 Snapshot 或患者識別證據。
- 同步沿用 owned SERIALIZABLE、XACT_ABORT、D／S rowversion、綁定及權限重驗；新增完整參數 fingerprint 的交易內前後檢查。欄位與成功操作稽核同交易；失敗 rollback、commit unknown 不回報成功。
- 不改既有規則；若同步會移除規則所用欄名則整筆拒絕。同步不自動設定分類／遮蔽。
- 明確確認「空敏感政策」時，UI 顯示目前清單將原樣傳送，並儲存該清單逐欄 `NONE/OTHER` 明示規則。新增／未設定欄位仍不傳送；直接儲存 `[]` 仍不代表原值授權。四種模式及既有 Dashboard 傳送授權不變。
- 政策儲存成功後重新讀取參數選單。錯誤顯示固定安全訊息、code 及 Request ID，不顯示 SQL、輸入值或 driver 例外。

## 重測與驗證

1. 新建合成 Dataset，儲存 SQL；有參數先同步及儲存參數定義。
2. 按「取得並同步欄位清單」，即使政策未確認也應取得欄位。此時不交付任何結果資料列，零筆結果亦有結構。
3. 逐欄設定原值／自訂／全遮蔽／不傳送並儲存；無需遮蔽時明確確認空敏感政策。重新開啟及重新同步，原規則須保留。
4. 已授權者預覽；Query／Dashboard／Excel 使用同一 Dataset 規則。患者稽核已啟用者須先完成原有識別、HMAC 及揭露稽核，不可停用繞過。未確認政策或無權限者仍拒絕資料交付。

離線單元／HTTP 測試涵蓋兩種 adapter 的標量 metadata、名稱／型別拒絕、參數漂移、政策未確認、零筆、權限及 rollback。瀏覽器使用合成 API 驗證新建→同步→四模式→預覽、規則保留、空敏感政策與可追蹤錯誤；不冒充真實 Oracle 驗收。全量測試繼續覆蓋 Dashboard、患者揭露與 Excel。

隔離 SQL Server 2019 full-schema CI 新增真實雙 metadata RPC、零筆結果欄位持久化與交易內參數衝突案例；沿用既有受限帳號、真實 audit failure rollback／版本衝突案例。實際執行結果以本次 CI 為準。

## 仍拒絕的情況

- MULTISELECT 沒有固定展開 arity；未知／UDT／CLR 推導型別或引擎不能推導的 SQL，須修正 SQL／明確 CAST 後重試，不猜測或查資料補救。
- Oracle 仍受既有 driver／client／server statement-info 相容性限制，本階段沒有 Oracle 實機連線。
- 外部來源 DDL fence、正式 Native Runtime、SOURCE_BOUND、SQL_LOCK_VERIFIED 均未解鎖。

不新增 Migration、不操作使用者資料庫、不改 JWT／`.env`。本機測試需更新同一 commit 的 Server 與 Client 並重啟服務；不需重建資料庫。
