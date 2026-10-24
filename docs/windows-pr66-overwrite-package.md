# PR #66 — C:\UQP 覆蓋式更新包操作說明

本 ZIP 是以既有 C:\UQP 為目標、採「同磁碟整個目錄先備份再切換」的 Windows 更新包。
不得在服務執行中直接解壓縮覆蓋 node_modules 或 .env。本更新腳本**不會執行 SQL Migration、不會停止或啟動服務**。

## 更新包內容

- `payload/server/dist`：已編譯 Server
- `payload/server/node_modules`：Windows Runner 安裝的相依套件
- `payload/client/dist`：已編譯 Client
- `payload/server/src`：專用 925 安裝程式來源（非供直接取代已編譯 Runtime）
- `payload/tools/install-uqp-925.ps1`：需明確 DBA 核准的 925 Preflight／Apply／Verify
- `payload/tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql`：925 結構定義，**供核對，不得直接以 SSMS 跳過專用安裝檢查執行**
- `payload/database/925_dataset_display_policy.sql`：供 DBA 閱讀的同份 925 定義
- `install-uqp-pr66-offline.ps1`：驗證雜湊、更新、備份與失敗回復
- `SHA256SUMS.txt`：更新包內部檔案雜湊

## 現有共用 SQL Server 的必要安全門檻

1. 確認目前資料庫備份已成功，且備份有可還原驗證。
2. 由 DBA 在獨立資料庫副本先做 925 Preflight／Apply／Verify。
3. 若實際正式 DB 尚未安裝 925，須先經正式維護核准，使用專用 925 工具核對 Server、DB、Login、DB 版本及完整 Catalog；**不得單獨直接執行 CREATE TABLE 腳本**。
4. 核實 Runtime 的最小權限、既有 923／924 前置及新功能旗標。不得提升 Runtime 為 dbo。
5. OR_001／Oracle 11g Thick 實際測試仍需完成。GitHub CI 未連接 HIS。

## 更新順序

1. 先解壓本 ZIP 到 C:\UQP_Update，不能解壓到使用中的 C:\UQP。
2. 先執行唯讀預檢：

   ```powershell
   cd C:\UQP_Update
   .\install-uqp-pr66-offline.ps1 -Target C:\UQP -PreflightOnly
   ```

3. 在 SQL 925 前置與資料庫權限已核實、完成備份且維護時間正式核准後，先停止現有 UQP Server 和背景工作（此腳本不會代為停止）。
4. 如需使用這次更新包內的專用 925 工具，在 DBA 核准且已有獨立副本測試證據後，可以從 ZIP 解壓目錄執行唯讀預檢，沿用現有設定而**不複製密碼至更新包**：

   ```powershell
   .\payload\tools\install-uqp-925.ps1 -Mode Preflight -ExistingServerEnv C:\UQP\server\.env
   ```

   此工具會要求手動輸入目標 Server／DB／安裝者 Login，以及獨立安裝帳號密碼；必須確實核對結果。正式 Apply 仍需額外維護核准，不能當作普通更新步驟無條件執行。
5. 僅在以上條件都實際符合後執行：

   ```powershell
   .\install-uqp-pr66-offline.ps1 -Target C:\UQP -Schema925Verified -ServiceStopped -AcceptMaintenance
   ```

   `-Schema925Verified` 是操作者對已驗證事實的確認旗標，不會替代 DBA 的實際資料庫檢查。
5. 腳本會建立相鄰的 `C:\UQP.backup.<時間>`，並以新程式切換目錄；原本的 `server\.env` 與 `client\.env` 會複製至新目錄。
6. 在恢復服務前，核實所有原有本機設定、非標準設定檔、外掛及資料資料夾。這些非標準檔案不保證由工具自動保留；原目錄完整內容在 backup 內。
7. 手動恢復服務，依序測試 health、登入、Query、Dataset 欄位遮蔽、Audit、Dashboard。核准前不得啟用新公共播放。
8. 如需回復程式，先停止服務與公共播放；將目前 C:\UQP 改名保留，將剛才的 C:\UQP.backup.<時間> 還原為 C:\UQP。SQL 925 結構不要自動 DROP，稽核紀錄不可刪除。

**未通過 SQL 925、Runtime 權限與實際環境驗收時，不應解讀為可立即全面使用所有 PR #66 新功能。**
