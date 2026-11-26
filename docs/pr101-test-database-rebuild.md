# PR101 測試資料庫重建與回復方案

## 決策
沿用現有 Windows 測試環境、SQL Server 執行個體、平台資料庫名稱、C:\UQP、原 .env、IIS Web.config 與既有 Port。不使用新的 SQL Server 執行個體。只處理 UQP 平台測試資料庫，絕不處理 HIS／PACS／Oracle／其他 DataSource 指向的來源資料庫。

優先保留可完整回復的舊測試資料庫，避免直接清除設定。若同一資料庫仍有正式使用者或正式資料，不進行重建；須使用獨立的隔離測試副本。測試資料採合成資料，不將舊患者資料複製到新測試資料庫。

## 操作順序（方案，尚未執行）
1. 先確認完整測試包版本及 CI，並確認目前平台 DB 的實際 SQL Server／DB 名稱。使用 database/tools/uqp-test-reset-inventory.sql 唯讀盤點現有 schema、migration ledger、各資料表估計筆數及 FK 依賴。
2. 在獨立備份路徑做完整 COPY_ONLY 備份、CHECKSUM、RESTORE VERIFYONLY，並實際在隔離位置試還原。保留原始資料庫及完整 C:\UQP 應用程式備份。備份及試還原成功不能只用檔案存在判斷。
3. 在確認只供測試、無其他系統使用並停止原 UQP 後，才安排原資料庫改名保留及同名空資料庫初始化（需另行確認）。不得 DROP DATABASE、TRUNCATE 或刪除 Audit/歷史紀錄以便測試通過。
4. 僅執行該整合版本正式允許的完整 migration 順序。Migration runner 指向 database/migrations；928 具有獨立授權檢查，929 亦須依整合版本的相容性驗收處理。不可假冒 ledger、跳過缺失 schema、以舊版 migration runner 蓋過 Gate。新的空 DB 尚未證實可由目前封裝的 migration runner 建成完整 PR99+PR100 schema，因此此步目前 BLOCKED。
5. 使用既有 Bootstrap 管理者初始化流程。原本帳號／角色若需保留，採另行驗證的最小匯入方案，不能整表盲目覆蓋系統預設權限。DataSource 重新建立並使用唯讀測試連線；不輸出密碼或加密憑證。
6. 依序建立合成 Dataset、管理者使用核准、同步欄位、管理者發佈 Query、匯出、多層次查詢、Dashboard 設計預覽及播放測試。公共播放只使用已確認可公開的資料及既有公共顯示政策；新無政策 Dataset 尚不能正式公共播放。保留 CHART release gates、基本登入授權及必要醫療資料保護。
7. 驗收未通過即停止 UQP、保留失敗資料庫供檢查，回復原 DB 名稱及應用程式備份，檢查原 .env、Web.config、Port 與登入後再恢復服務。

## 928／929 核對結論
- 001 至 927 是既有一般 migration 來源；929 真實 SQL 驗收程式使用 SQL Server 2019 隔離環境建立此 baseline（50 個 SQL 檔案）。這是歷史隔離驗收證據，不代表目前醫院資料庫或 Windows ZIP 已具備完整初始化能力。
- 928 的 `database/drafts/928_dashboard_chart_trust_schema.sql.draft` 明確限制為 disposable database，不能用於原 UQP 同名資料庫；通用 migration runner 對納入掃描範圍的 928 SQL 有阻擋，不能改副檔名繞過。
- 929 的 `database/review/929_query_hierarchy.sql.txt` 不由通用 runner 掃描；需由已核准安裝程序持有單一交易並驗證實際 catalog。929 不以 928 為前置條件。
- 因此，現階段優先沿用已成功覆蓋更新的既有測試資料庫，建立全新合成 Dataset / Query（使用不同代碼），無需先重建整庫。這可隔離舊設定並保留現有 CHART／階層 schema，避免重建後失去已安裝的結構。若目前測試 DB 仍供正式服務或包含真實患者資料，先隔離，不能用公共播放作為測試。
- 最小驗收：以唯讀測試來源執行例如 `SELECT N'TEST' AS ROOM, CAST(17 AS int) AS TOTAL`（SQL Server）；Oracle 使用 `SELECT 'TEST' AS ROOM, 17 AS TOTAL FROM DUAL`。先儲存欄位與 SQL，管理者核准使用，執行預覽、發佈、Query 查詢、匯出；不混入病歷或員工資料。不應把這個測試的成功推論為公共播放已完成。

## 尚未完成
- 未執行任何 DB 操作、備份或還原。
- 尚未提供可以直接執行的破壞性重建腳本。需先確定完全隔離的測試目標及受核准的 migration 928/929 版本。
- 尚未解除公共播放的舊政策依賴。不能透過重建資料庫或刪除舊資料規則將未確認的醫療資料公開。
