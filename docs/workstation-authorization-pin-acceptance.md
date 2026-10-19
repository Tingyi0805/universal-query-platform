# 第二批工作站、授權與 PIN 修正交付

分支：`feature/dashboard-device-server-masking`。PR #64 保持 Draft，Issue #65 保持開啟。第一批 `e9ca04e` 是本次提交祖先，Dataset Parameter 實作未回退。

## 功能與授權規則

- 前端把 SQL Server JSON 的字串／數字 ID 正規化為安全正整數並去重；後端仍拒絕字串、重複值、不安全整數及未定義欄位。舊個人清單 API 上限 100，新授權 API 上限 500 個人、100 部門、100 群組；單一分類成員上限 2000。
- 工作站允許名單為個人、部門、自訂群組成員的聯集。分類或員工停用時立即從有效集合排除；其設定保留，重新啟用後重新計算。這些分類不是 RBAC 角色，沒有新的 Permission／Role／JWT 系統。
- 工作站、分類與成員搜尋／分頁、批次選取、複製其他工作站授權和有效權限預覽已加入 UI。預覽顯示目前角色權限與工作站狀態，不表示已獲得所有 Query 權限；實際 API 仍使用既有 JWT／TokenVersion／角色及 Query 權限檢查。
- 授權與分類異動會撤銷相關工作站憑證和 Session，以及已綁定的 Dashboard 播放 Token。允許名單由目前會員關係計算，不另存一份靜態有效名單。
- 支援名稱、SHARED_QUERY／DASHBOARD 用途、排序、啟用／停用／重新啟用、永久安全退役。重新啟用不會恢復舊憑證或 Token。退役不可重新啟用。
- Dashboard 用途可綁定現有播放裝置。綁定會撤銷原 Token；之後須在既有 Dashboard 管理重新啟用／核發。播放驗證額外檢查被綁定工作站的狀態及用途，仍保留原設計者權限、資料遮蔽、快照與患者揭露稽核。
- 僅允許刪除停用、未退役、無使用標記、無任何憑證／Session／患者揭露／播放綁定歷史的誤建記錄；刪除前在同一交易保留稽核。
- 新管理寫入使用 SERIALIZABLE、設定鎖及版本／Revision 檢查；過期版本拒絕覆寫。稽核持久化失敗會回滾新工作站管理操作。讀取授權失敗時，UI 不允許提交空授權。

## PIN 與敏感憑證

- PIN 安全設定已整合到 `/admin/users?tab=pin`；舊 `/admin/quick-pin-policy` 網址轉址至該頁籤。
- 既有預設 6 位、管理者可選 4–12 位。長度改變會在交易內停用所有既有 PIN、增加 PinVersion 並撤銷工作站 Session；長度不變不撤銷。
- 個人 PIN 保持正式密碼再驗證及本機帳號限制，使用 bcrypt cost 12。新增／更新／撤銷均鎖定目前政策及 PIN 記錄，重新檢查帳號 TokenVersion／PasswordHash；舊長度不能在政策競爭後被接受。更新替換 Hash／增加 PinVersion，舊 PIN 不再有效。
- 有 PIN 記錄的密碼再驗證錯誤累計 5 次鎖定 15 分鐘；管理操作另有每個帳號 10 次／15 分鐘的有界、程序內速率限制。**程序內限速不是跨實例共享限速；首次註冊尚無 PIN 記錄時的跨實例失敗計數仍需額外正式環境驗證及共享防護，不能據此啟用 PIN 登入。**
- 工作站 PIN 登入仍沒有啟用，沒有新增 PIN 登入 API，所有變更保持 `PinLoginEnabled=0`。一般帳密登入及既有 JWT 流程保留。
- 觸控數字鍵盤支援 numeric inputMode、純數字過濾、刪除／清除、二次確認及旋轉尺寸。送出完成或失敗、頁面隱藏時清除 PIN／密碼；政策讀取失敗不能提交。
- 舊 Dashboard 長期 Token 不再寫入 localStorage／sessionStorage。相容讀取既有儲存值一次後移除；新啟用僅保留頁面記憶體，同源視窗交接檢查來源視窗、origin、Dashboard ID 和 Token 格式。**重新整理、關閉或瀏覽器重新啟動後需重新啟用播放；Windows 啟動腳本不再可依賴瀏覽器設定檔內的持久 Token。**現有一般登入 session JWT 不變。
- API 錯誤／日誌不輸出 SQL、Bind、患者資料、PIN、密碼、Token 或連線字串。管理稽核失敗警告改用安全分類，新增 Hash 欄位遮蔽。既有 PIN 設定／撤銷稽核沿用原稽核路徑。

## Schema 與 Migration

已檢查 001 的 AppUser／Role／Permission、019 TokenVersion、902–905 工作站／PIN／憑證、906 揭露稽核及現有 Dashboard 裝置定義；最高既有 Migration 為 915。
新增 `916_workstation_management.sql`：僅新增工作站 metadata／退役欄位、分類／成員／工作站分類關聯、DashboardDisplayDevice 的工作站關聯與限制。沒有建立第二套 RBAC、沒有修改患者資料或移除既有表。

**本次只建立腳本，完全沒有執行 Migration，也沒有連接共用 SQL Server 執行寫入、資料修正或整合測試。沒有重跑 001–915。**
缺少 916 結構時，新管理寫入回傳可辨識的 503；既有工作站清單及個別員工授權仍可使用。新功能須先在隔離資料庫驗證 Schema 與相容性，再依既定變更流程處理；不是要求現在對共用庫執行。

## 測試結果

- 後端：154 項通過，含 3 項新 Mock management API 案例、工作站／分類交易、撤銷、PIN 政策與鎖定、授權拒絕及 Migration 靜態檢查；第一批及原有測試保留。
- 前端單元：10 項通過，含 ID 正規化／去重與 Token 記憶體／舊儲存清除。
- Chromium：17 項通過，其中第二批新增 11 項。API 全部 Mock；包含舊 ID payload、聯集授權、複製、成員更新、退役、讀取失敗保護、PIN 頁籤、三個觸控尺寸及旋轉、Token 視窗交接／重新整理。尺寸案例不是 Windows／Android／iOS 真機驗收。
- 前後端 TypeScript 型別檢查與 build 通過。Vite 有既有 bundle 大小提示。
- 最終失敗：0。初次 PIN 尺寸案例使用錯誤的欄位 label，已修正測試選取器並通過重驗。

## 尚待本機／隔離環境驗證

1. 916 在 SQL Server 2019 隔離資料庫的實際執行、FK／CHECK／批次相容性；不得在共用正式／測試庫執行。
2. 真實交易、sp_getapplock、併發授權／會員異動、憑證核發、政策異動與 Session 撤銷；Mock 不能證明 SQL Server driver／鎖定語意。
3. Windows／Android／iOS 真機：系統原生鍵盤、觸控、旋轉、休眠／喚醒、popup 限制；新的記憶體 Token 流程及 Windows 開機播放重新啟用流程。
4. 多服務實例的共享速率限制、首次 PIN 註冊失敗計數及完整登入安全驗證。未完成前仍不得啟用 PIN 登入。
5. 原患者基本資料查詢 HTTP 500 仍待本機 Request ID 與安全錯誤分類確認，本次未把它認定為已修正。

沒有合併 main、沒有部署、沒有關閉 Issue／PR，也沒有宣稱正式驗收通過。

## 修改檔案
- `client/e2e/dashboard-playback.spec.ts`
- `client/e2e/workstation-pin.spec.ts`
- `client/package.json`
- `client/src/App.tsx`
- `client/src/components/WorkstationAudienceManager.tsx`
- `client/src/pages/AdminUsersPage.tsx`
- `client/src/pages/DashboardDesignerPage.tsx`
- `client/src/pages/DashboardDisplayPage.tsx`
- `client/src/pages/QuickPinEnrollmentPage.tsx`
- `client/src/pages/QuickPinPolicyPage.tsx`
- `client/src/pages/SharedWorkstationsPage.tsx`
- `client/src/pages/WorkstationManagement.css`
- `client/src/security/dashboardToken.test.ts`
- `client/src/security/dashboardToken.ts`
- `client/src/security/ids.test.ts`
- `client/src/security/ids.ts`
- `database/migrations/916_workstation_management.sql`
- `docs/workstation-authorization-pin-acceptance.md`
- `server/src/config/logger.test.ts`
- `server/src/config/logger.ts`
- `server/src/middleware/safeErrorDiagnostic.ts`
- `server/src/modules/admin/admin.routes.ts`
- `server/src/modules/admin/quickPinPolicy.repository.test.ts`
- `server/src/modules/admin/quickPinPolicy.repository.ts`
- `server/src/modules/admin/sharedWorkstation.repository.ts`
- `server/src/modules/admin/workstationCredential.repository.ts`
- `server/src/modules/admin/workstationManagement.repository.test.ts`
- `server/src/modules/admin/workstationManagement.repository.ts`
- `server/src/modules/admin/workstationManagement.routes.test.ts`
- `server/src/modules/admin/workstationManagement.routes.ts`
- `server/src/modules/admin/workstationManagement.test.ts`
- `server/src/modules/admin/workstationManagement.ts`
- `server/src/modules/admin/workstationMigration.test.ts`
- `server/src/modules/audit/audit.repository.ts`
- `server/src/modules/auth/auth.middleware.ts`
- `server/src/modules/auth/auth.routes.ts`
- `server/src/modules/auth/pinRateLimit.test.ts`
- `server/src/modules/auth/pinRateLimit.ts`
- `server/src/modules/auth/quickPin.mutation.test.ts`
- `server/src/modules/auth/quickPin.service.ts`
- `server/src/modules/auth/workstationCredential.service.test.ts`
- `server/src/modules/auth/workstationCredential.service.ts`
- `server/src/modules/dashboard/dashboardDevice.repository.ts`
