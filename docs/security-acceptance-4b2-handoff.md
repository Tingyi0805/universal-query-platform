# 4B-2 交接與驗收狀態

本文件是 PR #64 的離線驗收交接紀錄。所有欄位皆是**設計與程式檢查狀態**，不得當作真實 SQL Server 測試報告。

## 離線交付範圍

| 項目 | 交付內容 | 目前證據 |
| --- | --- | --- |
| Migration 庫存 | 46 檔 SHA-256 鎖定；legacy 43 / coexistence 46 | securityAcceptancePlan / Manifest 單元測試 |
| 目標宣告 | loopback、非預設埠、專用資料庫識別格式 | Isolation 檢查及負向測試；僅自填，不代表已驗證 |
| 方案綁定 | rehearsal、isolation、manifest profile 和 target 一致 | Rehearsal 單元測試 |
| 備份與失敗方案 | PRE919 備份、實際還原、DDL 回滾與競爭情境須納入規劃 | Rehearsal 清單；未執行 SQL |
| 離線證據 | 固定案例、阻擋無證據 PASS，拒絕非一般檔案與過大資料 | Evidence 單元測試 |
| 遮蔽前端 | 在 Dataset 安全政策完成載入後檢查 INHERIT | Playwright E2E；需觀察多輪穩定性 |

## 本階段可做與不可做

可以：產生固定 Migration 清單、對人工聲明的欄位做格式/相依性驗證、以合成資料執行離線單元與 UI 測試、報告缺少哪些驗收證據。

不可以：連接 SQL Server、推論 127.0.0.1 必然是安全環境、啟用 916–919、透過既有 Runner 嘗試 status/adopt、執行 DDL、使用正式病患資料、部署、合併 PR、將任何自填 PASS 轉為正式核准。

## 真實驗收尚未執行

下列案例**全部 NOT_RUN**，不能宣稱通過：
- M01–M09：Migration 先決條件、重跑、衝突、回滾、鎖競爭及錯誤恢復。
- D01–D08：Dataset 核准版本、患者清單曝光稽核、HMAC、錯誤保護。
- L01–L05：Legacy 與新舊權限共存條件。
- S01–S05：快照、撤權、裝置播放、UI、環境隔離。

## 進入下一階段前的人工簽核條件

1. DBA 獨立核對 SQL Server 2019 實例 ID、容器/VM、port、連線路由、資料磁碟、認證及沒有共享掛載／轉送。
2. 確認兩組獨立合成測試資料庫及 profile，使用專用權限，不可採正式環境/正式備份。
3. DBA 核准備份、CHECKSUM、VERIFYONLY、**實際還原**及銷毀測試資料流程。
4. 開發與資安共同審核獨立白名單 SQL 執行器（目前不存在），包含檔案完整性、顯式允許、錯誤停止、外層交易與 rollback；通用 migrate runner 不能代用。
5. 完成測試證據來源驗證、HMAC/稽核測試，以及測試後環境清理。

## 風險與解讀

- Evidence 的 `acceptedForReview: true` 僅表示資料格式可以進一步審查；`verifiedByDatabase` 和 `eligibleForSignoff` 仍為 false。
- Isolation 的 `checklistComplete: true` 僅表示人工聲明填寫齊全；無法驗證實例或網路隔離。
- Rehearsal 的 `checklistComplete: true` 僅表示規劃完整；`authorizesSqlExecution` 必須維持 false。
- GitHub CI 只能證明已涵蓋的離線程式與模擬 UI 測試通過，不能替代真實 SQL Server 驗收。

**結論：4B-2 為離線準備階段；是否完成需以最後 HEAD 的 CI、程式碼審查及上述範圍核對為準。實機驗收另行核准。**
