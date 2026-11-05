# UQP 4B-2 — 離線安全驗收工具交付界線

基準：PR #64 feature/dashboard-device-server-masking。本階段只有驗收**規劃**與離線檢查工具，未授權連線、安裝或修改 SQL Server。離線測試通過並不代表 Migration 919 可在 SQL Server 2019 執行。

## 工具與不可跨越的邊界

| 工具 | 功能 | 不具備的能力 |
| --- | --- | --- |
| securityAcceptancePlan.ts | 依 SHA-256 固定庫存比對 46 份 Migration、產出 legacy (43) / coexistence (46) 清單 | 不連線、不執行 SQL |
| securityAcceptanceManifest.ts | 產生 27 項 M/D/L/S 案例清單（全部 NOT_RUN） | 不允許 --execute / --apply |
| securityAcceptanceIsolation.ts | 檢查操作人員填入的隔離聲明完整性 | 不證明 host/port 真的隔離，不授權連線 |
| securityAcceptanceRehearsal.ts | 檢查 PRE919 備份、實際還原、故障注入及雙 session 測試是否已列入計畫 | 不實作備份、還原、故障注入或交易 |
| securityAcceptanceEvidence.ts | 僅讀取指定離線 JSON、檢查識別資訊及案例狀態 | 不驗證實際 SQL、永遠不簽核（eligibleForSignoff:false） |
| catalog-probe.sql | 人工確認隔離後才可使用的預設拒絕唯讀模板 | 不可將探針當成實例身分的充分證明 |

**禁止**對既有環境執行 `db:migrate` 或 `db:migrate:status` 作為探測：目前 Runner 在辨識 status 前就可能建立 SchemaMigration，且自動選擇 916–919；三個 Dashboard 旗標關閉也不能阻止 DDL。

## 進入現場測試的停止條件

以下任一未完成時一律 STOP，保持全部 M/D/L/S 案例 NOT_RUN：

1. DBA 與驗收負責人確認是專用 SQL Server 2019（major15/compat150）實例；實體/容器 ID、TLS 憑證、路由、port、volume、無共享掛載都要人工驗證，不能只靠 127.0.0.1。
2. 只使用一次性資料庫 `UQP_ACCEPT_<12位小寫hex>`，一個 profile 一個獨立 DB/還原副本；不得用正式患者、正式備份、共享 credential、linked server 或現有 .env。
3. 隔離帳號遵循最小權限；API/資料來源/DDL/觀察者角色分離，測試身分與核准記錄可追溯。
4. 有核准的 PRE919 完整備份、CHECKSUM、RESTORE VERIFYONLY 與**實際還原**方案；每個破壞性負向案例自不同還原副本開始。
5. 經審查的白名單執行器必須驗證檔名+SHA-256、profile 前置相依、嚴格外層交易與 GO 分批；錯誤即停止，不得以通用 Runner 的全目錄 apply 取代，不得自行 adopt。
6. 919 內含交易/ROLLBACK；負向 DDL 失敗必須驗證外層紀錄與部分 DDL 完整回滾，不能只看錯誤碼。
7. 雙 session、稽核失敗注入、HMAC keyring、撤權/裝置實測所需的隔離程序、合成帳號和證據保護均已核准。
8. GitHub CI 全綠且最新 HEAD 已複核。若安全測試結果是 timeout、缺證據、或實例身分不符，不得標 PASS。

## 真實驗收前仍需開發

- 安全實例驗證：由 DBA 獨立確認連線終點身分，並以唯讀 catalog 證據相互核對；不得用一份自填清單放行。
- 獨立白名單 SQL 執行器：預設 dry-run，明確目標＋多重授權、逐檔 hash、隔離交易、錯誤停止、永不對共享目標操作。此元件**尚未存在**。
- M01–M09、D01–D08、L01–L05、S01–S05 的實際自動化/人工測試工具與證據封存；目前只定義驗收矩陣，不代表已執行。
- 追蹤外部相依：SQL Server 實例與權限、資料庫備份還原、實際鎖與回滾、SQL/Oracle 驅動整合、觸控/裝置環境。

## 驗收報告不可誤報

離線清單 `checklistComplete: true` 只表示自填欄位齊全，不表示隔離環境已驗證；`acceptedForReview` 只表示離線 JSON 格式可審查，`verifiedByDatabase: false` 永遠不應改寫成 PASS。報告須標示每個案例 PASS / FAIL / BLOCKED / NOT_RUN 與證據來源。未經 DBA 審核的自填證據，即使全部宣稱 PASS，也不構成部署/合併許可。

## 狀態與交付

此階段不更新 .env、不打開 `DASHBOARD_QUERY_SOURCE_MANAGEMENT`、`DASHBOARD_QUERY_SOURCE_EXECUTION`、`DASHBOARD_QUERY_DEVICE_PLAYBACK`、不連接共用 SQL Server、不執行 Migration、不部署、不合併 PR #64。PR 保持 Draft，真正 SQL Server 驗收排入後續獨立階段。
