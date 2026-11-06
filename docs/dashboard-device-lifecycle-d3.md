# Dashboard Device D3 — 永久撤銷與封存

基準 `cf9c3410ac430b5e8363c573244e517c2480b07d`；沿用 D1、D2-A、D2-B 與原樣 Migration 926。

新增 `POST /api/dashboards/:id/device-management/v1/:deviceId/revoke`、`.../archive`。兩者嚴格接受 `{ expectedVersion, confirmed:true }`，使用完整管理版本、live JWT／TokenVersion、DESIGN_QUERY、安全 schema 與 926 catalog attestation。沿用 safetyRead 與 SERIALIZABLE Dashboard→Device→placement 鎖序，不要求已失效的來源執行權限才能撤除授權或封存。功能旗標與既有 legacyDeviceWriteGuard 不變。

撤銷重用 revokeDashboardQueryDevice，涵蓋所有合法非終止狀態（含暫停、pending、過期），清 suspended／pending／兩個 grant、CSPRNG 旋轉 Hash；提交後不可恢復。Legacy 撤銷 writer 也重用同函式，無 926 時保留舊 schema 分支。封存重用 archiveDashboardDevices，只允許 inactive、已永久撤銷且未封存；只寫封存時間及既有 DashboardDeviceArchiveHistory。保留 Device、placement、歷史與 Audit，無實體刪除。兩種管理操作均經原 validator 驗證轉移、touch Dashboard，再寫有效 ID 的原子 Audit；失敗全部回滾。重送舊版本衝突，使用新版本重送終止操作拒絕，不新增歷史。

手動及自動封存使用同一既有歷史表／政策／掃描程序。SQL 改成 OUTPUT INTO 無限制的 table variable，再 INSERT 到既有帶 CHECK 的歷史表，避免 SQL Server 對 OUTPUT 目的表的限制。更新與歷史寫入在同一交易；版本化手動封存的內層 COMMIT 不提交外層管理交易，Audit 失敗仍回滾歷史。自動封存保留 200 筆、預設 90 天、啟用旗標與永久撤銷條件；不新增排程或機制。

## Writer 相容性

- D2 suspend／restore／issue／proof 使用既有 OUTPUT table variable、926 CHECK／Trigger；SQL 隔離驗收執行實際 writer。
- revoke 使用既有 optional schema 分支；有任一 926 欄位即要求完整 attestation，清除 marker／grant 及旋轉 Hash，不更新已終止列。
- manual／auto archive 明確要求 RevokedAtUtc，僅更新封存時間，歷史同交易。
- metadata 對 managed 裝置保持 pending=true、清 grant／旋轉 Hash；renew／placement／LastUsed 不更動 marker 或 grant。
- Query mode／Legacy transition 使用既有 pending invalidation clause，NULL 保持 NULL，其餘維持 true；舊 credential writer 保留 unmanaged guard。
- workstation invalidation 保留清 marker／grant、隨機 tombstone 與不重寫終止時間的既有分支。
- create 是 INSERT；926 只有 UPDATE Trigger，原 INSERT OUTPUT 合法。未修改既有 Cookie、BAT、IIS、IP resolver、UI 或日期選擇器。

## 驗證與 D4

新增 D3 service／HTTP 回歸，及既有 disposable SQL harness 的 D3 驗收：真實 management store／writer／926、ACTIVE／SUSPENDED／pending、D2 SQL writer、重送／版本衝突／並行提交、Audit throw／無效 ID 回滾（包含歷史）、手動與自動封存競爭、政策停用／retention／重複掃描。來源／ACL schema 以明確 synthetic adapter 取代；Device、交易、鎖、轉移、Audit、歷史與 commit 使用實際 SQL。SQL harness 沿用 loopback、隨機 database、指定 disposable machine identity 與清理保護，不使用正式連線或 C:\UQP。

本機 SQL 映像下載受代理 Forbidden 阻擋，由 PR CI 的 disposable SQL job 驗證。正式 Migration 926 不曾執行或修改。

D4 尚需 UI 接線：GET lifecycle 取得完整版本，POST suspend／restore／credential／revoke／archive 帶確認與 expectedVersion；版本衝突後重新讀取及再次確認；credential 明文一次顯示並交付 enrollment-proof。API 均已存在，本階段不新增 UI。既有 archive policy／history 管理若需 Query-only 編輯，仍須另定受控版本化 API，不能解除 legacy guard。
