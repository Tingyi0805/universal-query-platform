# 第一次本機測試檢查表（Windows／SQL Server／Oracle）

> 適用 PR #64 草稿分支。此文件是測試準備，不代表已完成實機驗證。先在**測試用** SQL Server 資料庫執行，勿直接使用正式 HIS 帳密或正式患者資料。

## 1. 下載與環境

1. 由 GitHub PR #64 選擇分支 `feature/dashboard-device-server-masking` 下載 ZIP，解壓縮至沒有中文或空白的測試目錄（或以 Git checkout 該分支）。**不要下載 main**，因為本輪安全修正尚未合併。
2. 安裝符合專案相依套件的 Node.js LTS（建議 22.x）與 npm；確認 Windows 64 位元。部分 ODBC 套件需要對應驅動／原生建置工具。
3. 準備隔離的 SQL Server 測試資料庫及具備建表權限的帳號；先備份任何既有測試資料庫。
4. Oracle 初期可不連線；如需測 Oracle 11g，依 `server/.env.example` 的說明準備相容的 Oracle Instant Client，並改用 THICK 模式。

## 2. 後端

```bat
cd server
copy .env.example .env
npm install
npm run typecheck
npm test
npm run db:migrate:status
```

注意：請先完成 `.env` 的 SQL Server 連線設定，才能執行 `db:migrate:status`；否則會因平台資料庫未設定而失敗。

編輯 `server/.env`，至少設定 `PLATFORM_DB_SERVER`、`PLATFORM_DB_DATABASE`、`PLATFORM_DB_USER`、`PLATFORM_DB_PASSWORD`、`JWT_SECRET`、`DATASOURCE_ENCRYPTION_KEY` 與首次初始化用的 `BOOTSTRAP_ADMIN_TOKEN`。密鑰不可提交 GitHub。

**Migration 先核對狀態再執行**。尤其注意 `900_dashboard_device_archive.sql`、`910_dataset_sensitive_columns.sql`、`911_verify_dataset_sensitivity.sql`（911 是唯讀結構驗證，不是建立版本資料表；版本資料表由 910 建立）；如顯示手動執行但未記錄或結構不完整，先停下來檢查，不要強制覆蓋。

```bat
npm run db:migrate
npm run db:migrate:status
npm run dev
```

檢查 `http://localhost:3000/api/health`；Migration 失敗請保留完整錯誤與檔名／批次序號。

## 3. 前端

另開命令提示字元：

```bat
cd client
npm install
npm run build
npm run dev
```

開啟 `http://localhost:5173/setup` 建立測試管理員。完成後移除 `BOOTSTRAP_ADMIN_TOKEN` 並重新啟動後端。

## 4. 建議驗證順序

- [ ] SQL Server Migration status／apply／再次 status，確認無漏套用或重複執行
- [ ] 平台管理員初始化、登入與權限
- [ ] 新增 SQL Server 測試 DataSource，測試連線與唯讀查詢
- [ ] 新增 Dataset、預覽、Query 發布與 Excel 匯出
- [ ] 設定 Dataset 敏感欄位，驗證遮蔽／未核准欄位不傳送
- [ ] Dashboard 單頁、零筆、多頁、播放秒數、快照到期、網路斷線恢復
- [ ] 裝置 Token／PIN 重新驗證及撤銷後不再顯示患者資料
- [ ] Dataset SQL 別名變更、敏感規則版本衝突、Dashboard 啟用／清空規則競爭條件
- [ ] Oracle 測試 DataSource（如需 Oracle 11g，使用相容 Thick 模式）
- [ ] Windows、Android、iOS 實際瀏覽器／觸控輸入測試

## 5. 測試回報

請記錄：測試時間、分支 commit、Node/npm 版本、SQL Server/Oracle 版本、執行指令、Migration 狀態、API HTTP 狀態碼、畫面截圖（**遮蔽患者個資**）、後端錯誤日誌（**移除密碼／Token／連線字串**）。

> 本機測試不等於正式上線。正式上線前仍需 HTTPS、唯讀 HIS 帳號、稽核保留、備份還原、併發及跨裝置驗收。
