# Dataset Parameter Designer 與患者查詢穩定性修正

工作分支：`feature/dashboard-device-server-masking`；PR #64 保持 Draft；Issue #65 保持開啟。

## 已證實的程式缺陷及修正

- 原 GET `/api/datasets/:id/parameters` 呼叫同步，且 Dataset 新增／儲存也會隱含同步。同步會 UPDATE 排序、INSERT 新設定，並 DELETE 未偵測到的設定；空偵測會 DELETE 全部。已移除三個隱含同步入口。GET 只讀 Dataset／DatasetParameter，回傳已儲存設定及差異。
- 原 Designer 載入失敗仍顯示空狀態。已分開 loading／失敗／成功空結果，提供重試與 Request ID；讀取失敗無法儲存。預覽參數載入失敗或尚未完成時也不允許以缺失的設定執行 SQL 預覽。
- 原患者查詢 `executeSavedDataset` 會讀取／轉換參數，再透過 `previewDataset` 重複讀取／轉換，可能使用兩個不同版本的設定。現改為一次載入、驗證、轉換；保留未使用的設定，但它們不參與當次查詢輸入畫面、Lookup 載入、驗證或 Bind。
- 原未知錯誤只有泛用 500，查詢失敗稽核還使用原始 `error.message`。現在安全日誌記錄固定模組、錯誤分類、允許的 driver/application code、必要的數字 SQL Server 錯誤編號與 Request ID；查詢失敗稽核只儲存安全分類碼。API 500 不回傳原始錯誤、SQL、Bind、患者資料、密碼、Token、連線字串或 stack。

**沒有取得本機患者基本資料查詢的 Request ID／錯誤分類，也未連線該 SQL Server。上述可重現缺陷不構成那次 HTTP 500 的實際根因證明。該事件仍待本機安全診斷確認。**

## 明確同步與設定儲存規則

1. GET 回傳 `parameters` 與 `preview`：新增名稱、保留名稱、SQL 未使用的名稱、解析狀態和 `previewToken`。讀取不變更資料；封存 Dataset 也可讀取。
2. POST `/api/datasets/:id/parameters/sync` 必須帶入目前的 `previewToken`。預設只新增缺少的參數：STRING／TEXT、非必填、排序追加；Label 初始化為名稱，其餘欄位使用既有 Schema 的預設值。
3. 同步完全不 UPDATE 既有參數。移除必須在 UI 選取、確認並傳入 `removeNames`；只允許移除目前預覽中 SQL 未使用的名稱。解析失敗或零偵測時一律不允許移除。參數總數上限 100，新增排序上限 10000；超出時拒絕操作，不重排既有設定。
4. PUT `/api/datasets/:id/parameters` 也必須帶入目前的 `previewToken`，且名稱集合必須與已儲存設定完全一致。此操作只 UPDATE 已知欄位，保持 ID 和其他自訂欄位，不透過 DELETE／INSERT 重建資料；新增或移除只能使用明確同步。
5. 同步／設定儲存在 SERIALIZABLE 交易內先鎖定 Dataset，再鎖定參數；重新檢查 SQL＋設定的預覽版本及封存狀態。過期預覽回傳 409，不部分套用。設定變更保留版本快照與取消受影響查詢的發布狀態；錯誤時回滾，回滾錯誤不覆蓋原始診斷。
6. Dataset 新增／儲存不再自動初始化參數，使用者須進入 Parameter Designer 檢視及套用同步。舊版 API client 未提供 token 的 PUT 會收到 400，不會隱含清除設定。
7. `DESIGN_QUERY`、JWT 與既有 runtime Query RBAC 均保留。患者揭露稽核、遮蔽與 device playback 保護維持原有順序；未完整配置的必要參數不會執行 driver SQL，回傳可辨識的設定錯誤。

## Schema／其他流程檢查

已檢查 003（DatasetParameter／唯一性與型別）、004（選項／Lookup）及 023（日期輸出設定）Migration 定義。
本次不需要 Schema 變更，沒有新增或執行 Migration，也沒有重新執行 001–915。
版本還原本身是既有明確的還原操作，會在交易內先建立目前版本快照再還原歷史參數；這次未變更其語意，也沒有執行它。

## 修改檔案

- 後端讀取／同步／儲存：`server/src/modules/dataset/dataset.routes.ts`、`parameter.routes.ts`、`parameter.repository.ts`、`parameterSync.ts`。
- 後端執行／診斷／稽核：`server/src/modules/dataset/dataset.service.ts`、`server/src/modules/queryDefinition/queryRuntime.routes.ts`、`server/src/middleware/errorHandler.ts`、`safeErrorDiagnostic.ts`。
- 前端：`client/src/components/DatasetParametersEditor.tsx`、`client/src/pages/DatasetDesignerPage.tsx`、`client/src/api/client.ts`。
- 隔離測試：`parameter.repository.test.ts`、`parameter.routes.test.ts`、`dataset.service.test.ts`、`parameterTestFixture.ts`、`safeErrorDiagnostic.test.ts`、`client/e2e/dataset-parameters.spec.ts`。
- 本交付文件：`docs/dataset-parameter-stability.md`。

## 驗證結果

- Server TypeScript 型別檢查／build：通過。
- Client TypeScript 型別檢查／production build：通過。Vite 有既有 bundle 大小提示，不影響 build 成功。
- 後端：128／128 通過，其中新增 30 項。
- 前端單元：6／6 通過。
- Chromium：6／6 通過（原有 3 項 playback 與新增 3 項參數 Designer）；全部 Mock API／合成資料。
- GET SQL Mock 只允許 SELECT，確認沒有交易或寫入。同步測試涵蓋保留自訂欄位與 ID、解析失敗／空結果保護、過期預覽、明確移除、界限拒絕與原子回滾。
- 日誌測試檢查實際 logger 輸出與 API response，確認敏感錯誤內容不會出現；患者參數載入與 driver 執行失敗會記錄不同模組。
- 最終失敗項目：0。最初新增瀏覽器測試的 Mock URL 規則誤攔截 Vite 模組，已修正並重新通過。

以上均未對共用資料庫執行寫入整合測試。

## 本機待驗證

- 以 GET 讀取重現 Dataset 2 的參數載入，確認現有設定及差異顯示；若仍失敗，只提供 Request ID、module、errorType、driverCode／sqlServerNumber，不提供 SQL 或資料值。
- 患者基本資料查詢的實際失敗原因：分辨參數載入、參數驗證、查詢編譯、資料來源執行、欄位同步或患者揭露稽核階段。不能將 Mock 229／208 當作真實錯誤編號。
- 真實 SQL Server Schema、權限、鎖定／併發與 driver 行為仍未驗證。同步與設定儲存的寫入驗證只能在另建的隔離資料庫進行；不得在正式／測試共用資料庫操作或執行任何 Migration。
- 未合併 main、未部署、未關閉 Issue／PR，PR 維持 Draft。
