# Dashboard Chart｜交付關卡 18：合成資料操作測試包

此關卡只交付**可用瀏覽器操作的合成圖表測試工具**，不等於正式 CHART CRUD、正式患者查詢或正式播放已核准。

## 功能範圍

- 長條圖／折線圖／圓餅圖，三組虛構數字與標籤；僅 React 本地呈現。
- 可新增、複製、刪除多張圖表；選擇來源標籤、欄位名稱及圖例，修改位置及尺寸。
- 可在 1920×1080、1080×1920、1366×768 畫布上預覽，拖曳標題移位，使用全螢幕預覽。
- 無 fetch／API／患者資料／SQL／持久化；重整即復原初始草稿。
- UQP 已登入且具 DESIGN_QUERY 權限者，可從 Dashboard 設計頁進入同一實測元件。

## 獨立展示包

`client/chart-lab.html` + `client/src/chartLabMain.tsx` 以 Vite 的獨立設定輸出 `chart-lab-dist`；
GitHub CI 的 client Job 先跑單元／型別／Build／Playwright，再以 `npm run build:chart-lab` 建置。
成功後可從該 Run 的 Artifacts 下載 `uqp-chart-synthetic-lab-NOT-FOR-PRODUCTION-<HEAD>`。
只包含 `chart-lab-dist/`、`chart-lab-preview-server.mjs`、`start-chart-lab.bat`、`CHART-LAB-README.txt`。
解壓至獨立目錄後 Windows 執行 BAT，以 Node 24 在 localhost 4174 展示；
靜態伺服器限制 loopback、無 API 路由，CSP 禁止網路 connect。

## 驗收條件

CI 最新 HEAD 的 Server、Client、Windows Node.js、SQL 2019／2022 保持成功；
新增 Playwright 確認多張圖表、編輯、畫布、全螢幕、重整不持久化、無 API 呼叫。
本機專用展示包需有 Artifact 且可下載；否則標記交付未完成。

## 不可越界

PR #83 繼續 Draft／未合併；正式 `C:\UQP` 不能覆蓋；Migration 928 不執行，
`CHART_ATOMIC_CREATE_RUNTIME_ENABLED=false`、`CHART_WRITER_DB_ACTOR_BINDING_APPROVED=false`，
Writer/Issuer 核准 SHA256=null。
第 19 關卡讓使用者操作此包；第 20 關卡另行處理正式 Signer／SQL Login／隱私／稽核上線安全。
