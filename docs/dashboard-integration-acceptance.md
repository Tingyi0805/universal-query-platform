# 多 SQL Dashboard 整合驗收與部署（Issue #65 / PR #64）

本輪在 `feature/dashboard-device-server-masking` 收尾，基準 commit 為 `3f5d4b8`。未修改 main、未合併 PR、未存取正式資料庫。僅使用合成資料。

## 已完成的整合

- 保留 PRIMARY / 舊版單一 Query Dashboard；可綁定最多 8 個額外 saved Dataset。各 Dataset 使用既有 DataSource adapter，因此 SQL Server / Oracle 可並存。播放客戶端不能提交 SQL。
- 每個來源獨立設定 parameters、refreshSeconds（5～3600）、pageSize（1～100）、pageSeconds（5～3600）。來源代碼不可重複，PRIMARY 是保留字。
- FIELD / TABLE 元件選擇來源、版面設計遮蔽預覽、播放預覽及裝置多表格播放已接通。設計者的額外來源預覽最多 100 筆，與裝置分頁接口分開授權。
- SQL 更新與換頁使用不同期限；換頁與輪播回到第一頁都重用快照。修復 React StrictMode 倒數 updater 可能一次跳兩頁的問題。
- 表頭與 TEXT 固定資訊不隨換頁重建；來源失敗僅清空該來源資料列，保留表頭。主要來源失敗也不隱藏其他健康來源。
- 每個來源一次一個播放請求、指數重試 5～60 秒、瀏覽器請求期限 75 秒。伺服器 SQL 工作全域上限 4，等待上限 16，總等待/執行期限 65 秒；同裝置/來源/設定的同時 SQL 請求合併。
- SQL 超時會回 504，但驅動工作保留名額直到實際結束，防止重試累積。這不宣稱能強制取消所有資料庫驅動；實際驅動的 timeout / connection cleanup 仍需本機驗收。

## 安全邊界

- Device Token 為 32-byte 隨機 base64url，DB 存 SHA-256 摘要；每次送頁重查裝置、停用/封存/撤銷、期限、IP 及核發者目前的 DESIGN_QUERY 權限。管理 API 使用伺服器現有權限，不能依舊 JWT 的 permission 宣告繼續操作。
- 已移除原始整批裝置資料接口（410）；僅提供當頁後端遮蔽結果。未核准欄位 OMIT。CLASSIFIED / Dataset 規則不可被版面或較弱遮蔽覆蓋。不同 partial / CUSTOM 規則衝突採 FULL。
- CUSTOM 以 Unicode code point 計算；無效、重疊保留範圍、控制字元失敗時安全遮蔽。大小寫有歧義的核准欄位拒絕顯示。
- 快照指紋綁定裝置/Token 雜湊/核發者授權版本、Dashboard、Query、Dataset SQL 與參數定義、DataSource 設定修訂、來源參數與分頁、敏感政策版本、版面、報表欄位及 Query Role/User ACL 修訂。資料來源停用及設定/權限變更會阻擋舊快照。SQL 前後及稽核完成後重查。
- 原始識別碼只保留於受限制的伺服器記憶體快照與稽核輸入；稽核持久化保存具版本的 HMAC 識別摘要。非空裝置頁必須成功稽核，否則不傳送資料列。
- 斷線、授權失效與逾時不保留可見患者資料；晚到的舊請求失效，cleanup 取消補充來源請求。伺服器錯誤不向裝置回傳 SQL/bind/患者詳細資料，Device Token / PIN / credential 已加入日誌遮蔽。
- PIN 原有功能是登入後驗證正式密碼的註冊/撤銷；PIN sign-in 仍刻意停用，不能作為裝置 Token 或 Dashboard 權限的替代品。未新增未規劃的短 PIN 登入流程。
- 快照為單程序記憶體快取（最多 100、總 32 MiB、單份 8 MiB / 10000 列、TTL 上限一小時）；重啟或切換伺服器可能回 409，客戶端重新取第一頁。多節點需要 sticky routing 或接受此安全重載行為。

## 自動驗收證據

| 檢查 | 雲端結果 | 範圍 |
| --- | --- | --- |
| Backend typecheck / production build | 通過 | Node 22.23.3 |
| Backend tests | 98 通過，0 失敗/跳過 | 含真實 HTTP handler，repository/資料庫由合成 fixtures 替代 |
| Frontend typecheck / production build | 通過 | Vite bundle size 有非阻斷警告 |
| Frontend 排程測試 | 6 通過 | 獨立更新/換頁、失敗隔離、重試、過期、授權、晚到回應 |
| Chromium 瀏覽器驗收 | 3 通過 | 真實 React 元件；API 攔截回傳合成遮蔽資料 |
| 實際服務 smoke | 通過 | /api/status、Vite API 代理、未授權裝置 API 拒絕 |
| Migration 靜態回歸 | 通過 | GO 批次分界、先決條件、非破壞結構、915 修復約束；不等於 SQL 執行 |
| SQL Server / Oracle 實機 | 未執行 | 雲端未提供測試 DB/憑證/醫院內網 |

CI 已改成探索所有後端 `src/**/*.test.ts`，前端包含排程測試、typecheck、build 及 Playwright Chromium。最新遠端結果以 [PR #64 checks](https://github.com/Tingyi0805/universal-query-platform/pull/64/checks) 為準；雲端本機通過不等同遠端 CI 通過。

重現本機自動驗收：

```bash
cd server
npm install
npm run typecheck
npm test
npm run build
cd ../client
npm install
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

已有 Chromium 的 Linux 可使用 `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`。瀏覽器 runner 自行管理 4173 測試服務，不使用正式資料庫。Windows 使用 Playwright 安裝的 Chromium。

## 一次下載後的本機 SQL Server / Oracle 驗收

1. 取得此開發分支的完整整合版本；先確認該 commit 的 PR checks 通過。準備隔離、備份過的測試平台 SQL Server（SQL Server 2016+，compatibility level 至少 130；使用 JSON 功能）。不要改正式資料庫。
2. 安全設定 server/.env，使用測試用 DB 帳密、JWT_SECRET、DATASOURCE_ENCRYPTION_KEY、初始化 token。預設 server 3000 與 Vite proxy 3000 已對齊；如果改 PORT，同時設定 VITE_API_PROXY_TARGET。
3. `npm run db:migrate:status` → `npm run db:migrate` → 再次 status。Runner 逐檔交易、逐 GO batch，成功後才記錄 SchemaMigration。再次 apply 應跳過已記錄 migration。
4. 910 建立敏感欄位與版本表；911 只驗證 910；912 增加 CUSTOM 並驗證 JSON；913 新增來源表（Dashboard cascade、Dataset NO ACTION）；914 增加獨立分頁欄位；915 修復早期已記錄 912/914 缺少的約束。首次套用與有舊資料升級兩種情境都必須測試。若既有 CUSTOM JSON 不合法，915 應失敗並保留資料，由管理員調整規則後重試，不強制刪除政策。
5. 在測試 DB 驗證 FK/索引/default/check constraints 及 trusted/enabled 狀態：來源移除/停用、Dataset 不可任意刪除被引用資料、PageSize default 10 / PageSeconds default 15、非法 bounds / 非法 JSON 被拒絕。備份的舊單 Query Dashboard 應不需重新設定 sources。
6. 建立至少一個 SQL Server Dataset 與一個 Oracle Dataset，皆只用合成患者資料，設定不同參數、更新/換頁秒數與每頁筆數。套用 CUSTOM / FULL / OMIT，確認裝置 network payload 與 DOM 無原始姓名/MRN，未核准欄位沒有出現。
7. **每個送至裝置的 Dataset 啟用 patient-audit config**，patientKeyColumn 指向實際 SQL alias 的原始識別欄位。安全注入 `PATIENT_AUDIT_ACTIVE_KEY_VERSION`、`PATIENT_AUDIT_HMAC_KEYRING_JSON`；每把 HMAC key 至少 32-byte Base64，不得入 Git/截圖/log。依現有 [稽核金鑰輪替](patient-audit-key-rotation.md) 保留受控舊版本。
8. 每次送頁確認 PatientListDisclosure 包含正確 DashboardDeviceId / DatasetId / PageNumber；Subject 為正確來源範圍的 HMAC 摘要，無原始患者識別碼。關閉稽核或造成寫入失敗時，非空頁必須 503 且沒有資料列。
9. 變更 SQL、來源參數/連線/停用、敏感版本、Query publish/停用、Dashboard/版面、Role/核發者權限；舊 snapshotId 應 409/401/403 而非送出舊資料。Token 重發、到期、IP 不符及裝置停用也必須阻擋。
10. 以合成慢 SELECT 驗證兩種驅動的查詢/連線逾時與連線關閉；其中一個來源失敗不影響其他表格。檢查 DB 實際 SQL 次數：換頁不執行 SQL，按各來源 refreshSeconds 重新查詢，最多四個進行中的 SQL 工作。切斷網路、重連、資料縮減、零筆、快照過期都需檢查。
11. Oracle Thin 支援的版本先驗；若需 Oracle 11g，另驗相容 Instant Client / THICK、Service Name / SID。Windows / Android / iOS 的實際 kiosk、背景節流、觸控與全螢幕仍需目標裝置驗收。

## 發布與回復

保持 PR #64 供 review；本輪不自行合併。正式部署須經本機 DB 驗收及既有發布流程。先備份平台 DB、現有環境設定及應用版本。915 為加法約束修復，沒有破壞性 down migration；回復應用時保留 schema，勿刪除稽核或敏感政策表。敏感規則不合法時先停用裝置/來源，再人工修正规則。

GitHub API 若受環境 egress 阻擋，Issue/PR 寫入可待允許 `api.github.com` 後繼續；不把 API 無法寫入宣稱為已更新，也不把待本機項目勾選完成。
