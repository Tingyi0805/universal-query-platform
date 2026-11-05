# Windows 11 離線下載測試指南（4B-2）

> **限定用途：** 驗證 TypeScript、離線單元測試與 Playwright 合成資料 Mock；不得用於真實 SQL Server / Oracle 整合驗收。PR #64 保持 Draft，且不能自行合併或部署。

## 前置需求

- Windows 11、Git、Node.js 22 LTS 與 npm；建議使用 PowerShell。
- GitHub 來源：`Tingyi0805/universal-query-platform`，分支 `feature/dashboard-device-server-masking`。下載前先在 GitHub Actions 確認對應 HEAD 的 Server/Client CI 均成功。
- 只使用乾淨的測試工作目錄，不複製公司正式 `.env`、SQL/Oracle 帳密、病患或正式業務資料。

## 下載與純離線驗證（PowerShell）

```powershell
git clone --branch feature/dashboard-device-server-masking --single-branch https://github.com/Tingyi0805/universal-query-platform.git
cd universal-query-platform
git rev-parse HEAD
cd server
npm ci
npm test
npm run typecheck
cd ../client
npm ci
npm test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

**安全限制：**
- 不執行 `npm run dev`（Server）、`npm start`、`npm run db:migrate`、`npm run db:migrate:status` 或 `npm run db:migrate:adopt`。
- `client` 的 Playwright 設定會在本機 `127.0.0.1:4173` 啟動 Vite 測試伺服器，E2E 會模擬 `/api/` 回應；不需要啟動真實後端，也不應指向醫院內網。
- E2E 只使用合成患者資料，驗證遮蔽、Legacy 核准衝突、裝置權限與保護性錯誤提示；**不驗證真實資料庫回滾或稽核落庫**。
- Playwright 首次安裝可能下載 Chromium。請依院內政策檢查下載權限；無法安裝時可先執行其餘 npm 驗證。
- 切勿在有正式環境連線設定的目錄進行上述測試。

## 回報結果

請保留以下資訊以便後續追蹤：
1. `git rev-parse HEAD` 顯示的完整 SHA。
2. Server `npm test`、`npm run typecheck` 成敗。
3. Client `npm test`、`npm run typecheck`、`npm run build` 與 `npm run test:e2e` 成敗。
4. 若失敗，僅回報錯誤碼與已遮蔽的訊息，不分享密碼、Token、患者資料或正式連線資訊。

## 尚未開放

此階段沒有獨立 SQL Server 2019 的核准實例、具備明確授權的白名單 Migration 執行器及已驗證的備份還原；M01–M09、D01–D08、L01–L05、S01–S05 的實機案例仍全部 NOT_RUN。

**注意：** `db:migrate:status` 可能觸發資料庫寫入；不能當作安全的唯讀探測指令。
