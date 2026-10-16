# R0-4：Migration 915 → 919 升級前安全驗收門檻

狀態：**OFFLINE_REVIEW / NOT APPROVED FOR PRODUCTION**。本文僅整理原始碼與既有清單，未執行 SQL、未連線正式資料庫，也不代表系統整合測試已完成。

## 分階段驗收矩陣

| 關卡 | 核對項目 | 已知依據 | 放行條件 |
| --- | --- | --- | --- |
| A：來源確認 | 目前正式 Migration ledger 與實際表／欄位／約束是否吻合 | 提供的 ledger 截止 915；名稱比對不代表表結構驗證 | DBA 確認唯讀 sys catalog 清單，人工處理所有 drift |
| B：916 | 工作站／裝置新表、欄位、FK、CHECK | 預期增加工作站對象與裝置關聯；尚未在 SQL Server 整合驗證 | 欄位、約束、既有裝置與角色相容性通過 |
| C：917 | Dashboard Query Source 新欄位和完整安裝檢查 | SQL 先拒絕部分安裝；現有資料不推測 Query 綁定 | 完整性、舊資料及寫入路徑測試通過 |
| D：918 | 舊 Dashboard 保留 LEGACY，不自動切換播放或授權 | DEFAULT LEGACY，QueryModeVersion=0；已有離線測試 | 獨立測試實例確認現有 Dashboard／裝置／Token 未改變 |
| E：919 | 患者核准 Metadata、ConfigurationVersion、RowVersion | 新安全 Schema guard 與 Mock 測試已存在 | 唯讀／寫入／交易回滾／舊版 API 相容測試通過 |
| F：應用程式 | 舊版 API、Dashboard、Dataset、Query 與權限 | GitHub CI 成功僅代表自動化檢查通過 | 使用合成資料驗證所有必要使用情境，確定舊版服務部署順序 |
| G：升級程序 | 備份、故障復原、Migration allowlist、執行 SHA-256 | 現有 migrate runner 並非唯讀 status，可能一次執行所有 pending | 獨立 SQL Server 實例完成回復演練與時間／鎖定評估，再經 DBA 核准 |

## 明確禁止事項

- 不執行正式 `db:migrate` 或 `db:migrate:status`；不在正式機測試 DDL/回滾。
- 不將 PR #64 合併，也不直接覆蓋正式 Windows Server 的 ZIP。
- 不將病患真實資料、正式密碼、私鑰與備份上傳至 GitHub。
- 同 SQL Server 實例的 `UQP_TEST` 只能在 DBA 同意、獨立帳密、合成資料與資源保護下進行低風險功能驗證；高風險 DDL、失敗回滾與併發壓力測試需獨立實例。

## 確認範圍

- SQL 917 已靜態確認：不自動新增 PRIMARY 來源列、既有查詢來源未指定新的 Query 綁定。
- SQL 918 已靜態確認：`QueryMode` 預設 `LEGACY`、`QueryModeVersion` 預設 0；不主動切換裝置憑證。
- 919 的依賴表：003、006、007、907、910、913；未要求先有 916～918。
- CI／Mock 通過不得等同 SQL Server 安裝通過。
- 真正的正式機應用程式版本、資料庫 Schema 與回復方式仍待核實。

下一步：完成 DBA 審查的唯讀盤點、明確區分同實例 `UQP_TEST` 與獨立實例驗證項目；在取得授權之前只進行離線工作。
