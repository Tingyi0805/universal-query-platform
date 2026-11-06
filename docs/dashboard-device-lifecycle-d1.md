# Dashboard Device D1 — 926 Schema 與狀態契約

基準 PR #83 `a7b27d968555c4d1e602bc40e42d5773f725dc5d`。D1 只提供 Schema／狀態／轉移契約及既有播放的必要拒絕防護，**沒有暫停／恢復 API 或 UI**。不變更 Cookie 格式／key、IIS、BAT、IP resolver、RBAC、Query-only、遮蔽或患者 Audit。未操作現有 C:\UQP 或正式 SQL Server。

## Migration 926

[完整 SQL](../database/migrations/926_dashboard_device_lifecycle.sql) 新增：

```sql
SuspendedAtUtc DATETIME2(0) NULL,
ReenrollmentRequired BIT NULL
```

兩欄都無 default／backfill。所有舊列保持 NULL，不更改 IsActive、TokenHash、RevokedAtUtc、ArchivedAtUtc、期限或 grant。922–925 已被現有部署草稿使用，故採 926；不修改任何既有 Migration 的 SQL／SHA。更新離線 inventory 至 49 筆，新增依賴 025／900／918；既有 legacy／coexistence 驗收 profile 仍固定至 919，不把 926 偷加進舊計畫。

**為何需要第二欄：**現有 TokenHash 同時可能是有效 Token 的 hash 或不可使用的 tombstone；grant pair 表示核發證據，無法證明恢復後已完成瀏覽器 enrollment。ReenrollmentRequired=true 明確表示本輪待重授權；false 僅由 D2 驗證本輪已核發的新 Token 後清除；NULL 保留舊環境／未知證據，不能當成「已完成」。成功 enrollment 是每個瀏覽器的流程；這個裝置標記不是每個瀏覽器的 session ledger。

三個 WITH CHECK 約束要求 terminal 裝置 IsActive=0；暫停必須未撤銷／封存、ReenrollmentRequired=true 且兩個 grant 都清空；明確的 reenrollment 標記不能出現在永久撤銷／封存或無暫停證據的 inactive 列。CASE 處理 SQL UNKNOWN，避免 NULL 讓非法組合通過 CHECK。歷史不一致資料不會自動修復：安裝失敗並回滾，留待獨立審查。

CHECK 無法檢查前後兩次更新，故 UPDATE trigger 額外保證：撤銷／封存時間不可清除或改寫；新封存必須先永久撤銷；暫停必須旋轉 hash；恢復只能成為未到期、grant 清空、hash 再旋轉的待重授權列，不能直接 ACTIVE 或順便延長到期日；明確管理的永久撤銷必須旋轉 hash；pending 不能靠改回 NULL 逃過驗證，清為 false 必須保留本輪已核發 hash 並已有完整 grant。trigger 不產生 Token、不寫 Audit、不宣稱能證明 HTTP Token 持有者或 RBAC。

上述 trigger 會讓 SQL Server 拒絕 UPDATE 的 OUTPUT-without-INTO；既有設定／重發／續期查詢改用 OUTPUT Id INTO table variable，再回讀同一列，保留回傳語意及所有原授權／期限條件。INSERT 無 UPDATE trigger 的限制差異另由隔離 SQL 測試驗證。舊手動封存原先只檢查 IsActive=0，926 會拒絕尚未永久撤銷的封存；不把未知歷史 inactive 列推測為撤銷或暫停。

Migration 使用 XACT_ABORT／單一交易／交易鎖。僅接受兩個欄位均不存在且沒有同名物件，或完全相符的已安裝狀態；單欄部分安裝、錯型別／nullable／default、disabled／untrusted／錯誤定義 CHECK、disabled／被修改 trigger 均拒絕，不自行修復。重跑完成 Schema 只檢查 catalog，不更新業務列。

既有 runner 仍以檔名排序、每支 Migration 與 SchemaMigration ledger 同交易執行；926 已接入手動完成驗證／adopt。`deviceLifecycleSchemaSql` 與 Migration 共用逐字一致的 catalog 檢查，並驗 trigger 定義 hash。**不要把 db:migrate 或其 status 當作本階段正式環境的唯讀檢查**：既有 runner 有 ledger bootstrap 行為；本 PR 未在正式環境執行。D2 在新操作交易內須呼叫 read-only `requireDeviceLifecycleSchema`。既有管理／播放沒有新增強制 926 readiness，未安裝 926 的 PR83 站台仍能使用原有功能。

## 狀態判定

`dashboardDeviceLifecycle.ts` 接收 private server projection，先拒絕非法組合。判定優先序：ARCHIVED → REVOKED → EXPIRED → SUSPENDED → PENDING_REENROLLMENT → ACTIVE／UNVERIFIED。

| 狀態 | 條件 |
| --- | --- |
| ARCHIVED | ArchivedAtUtc 有值、IsActive=false；不可播放／還原。允許保留歷史已封存但無撤銷時間的舊列，不幫它補寫撤銷。 |
| REVOKED | RevokedAtUtc 有值、未封存；優先於到期，永久禁止恢復。 |
| EXPIRED | 未封存／撤銷且 ExpiresAtUtc ≤ server as-of；保留原暫停／pending 標記，不覆寫資料。 |
| SUSPENDED | 未到期、SuspendedAtUtc 有值、inactive、pending=true、grant pair NULL。 |
| PENDING_REENROLLMENT | 未到期／撤銷／封存／暫停，active、pending=true；即使已核發 grant 也仍是 pending。 |
| ACTIVE | 上述狀態皆不適用、active、完整 grant pair，且呼叫端提供**經既有 live Device／ACL／政策驗證**並匹配當前 TokenHash 的證據。不是只依 IsActive，也不是只看 false／NULL 標記。 |
| UNVERIFIED | 保守後備：例如舊 inactive 無撤銷證據、未核發 tombstone、或只有管理快照但沒有 live 授權證據。不能猜為 revoked、pending 或 ACTIVE。 |

狀態標籤不是授權票證，不得取代每次資料交付的驗證。D1 沒有新增公開狀態 API，也不把 hash 投影到管理清單。READ/分類不修改 row。

## 合法轉移與 D1 保證界線

1. ACTIVE／待授權的有效設定 → SUSPENDED：停用、記 DB UTC 時間、hash 換 tombstone、清 grant、pending=true。
2. SUSPENDED → PENDING_REENROLLMENT：未到期／撤銷／封存，保留相同 Device／Dashboard／到期日，清暫停時間、active=true、再旋轉 tombstone；不核發 Token。
3. PENDING → ISSUE：用 CSPRNG 產生新 Token／hash、重新驗證並寫 grant；pending **仍 true**。不可重用舊 Token、不得只改 IsActive。
4. 本輪 ISSUE → ENROLL → ACTIVE：驗證新 Token 持有證據、IP／RBAC／Query-only／ACL／公共政策，原子清 pending=false；才建立 Cookie。單純「核發成功」不等於已 enrollment。
5. 未封存／撤銷的裝置（含暫停、待授權、到期）→ REVOKED：清暫停／pending、停用、旋轉 hash、清 grant、記永久時間。不能反向。
6. REVOKED → ARCHIVED：沿用手動／自動封存政策與 history；不能反向。SUSPENDED 不能直接 ARCHIVED。

純轉移 validator 同時限制可修改欄位、身分／期限不變、hash 更換、ENROLL 必須匹配當前 hash；測試使用 DB DATETIME2(0) 精度的事件時間。D2 應以 DB 回傳的 UTC 事件時間驗證，不接受客戶端時間作安全證據。

既有播放 repository 現在會在其他檢查前拒絕 SuspendedAtUtc 非 NULL、pending=true 或異常型別的標記；欄位 absent／NULL 保留原流程。因此即使舊瀏覽器未觀察到暫停、Cookie 尚未清除，也無法在恢復 pending 時取得資料。所有舊裝置 NULL 標記保持原有持久授權／撤銷行為。

DB trigger 不可能單憑 SQL 更新證明瀏覽器 possession、RBAC、CSPRNG 或 Audit 成功；D1 不提供這些寫入入口。不能把測試用 SQL 當 D2 API。D2 完整接線前，明確 pending 的裝置會安全拒絕既有 enrollment，這是刻意的 fail-closed；本階段沒有可供使用者操作的暫停／恢復功能。

## D2 必須接線的位置

- `dashboardDeviceManagement.{schema,service,repository,routes}.ts`：新操作、完整 Device 版本、確認、RBAC、交易、readiness 與原子 Audit。停用／永久撤銷不應因已失去 Query ACL 而無法止血；恢復及核發完整重驗。不要用此純 validator 當 permission check。
- `dashboardQueryMode.repository.ts`／核發 service：永久撤銷 WHERE 接受暫停列；所有核發、metadata 變更、模式切換等憑證失效 writer 維護 pending 標記，不讓既有核發路徑繞過新狀態；核發不清 pending。
- `dashboardKiosk.routes.ts` 與裝置 verifier：增加受限 enrollment proof 路徑，可驗證 pending 的新 Token，**不交付患者資料**；成功且 live recheck／交易提交後才能清標記、建立既有 Cookie。一般 layout／page 繼續拒絕 pending；不要全域取消本階段的播放防護。
- 封存入口：沿用 history／auto sweep，先確認永久撤銷，納入版本與 Audit；不解除 legacyDeviceWriteGuard。管理 DTO 後續才加入 markers／狀態，永不公開 TokenHash。

## 驗證與部署界線

單元／靜態測試涵蓋舊列不變、未知證據不猜測、每個狀態與優先序、非法組合、停復用 hash、matching proof enrollment、不可逆撤銷／封存、到期、身分與期限不可順便變更，以及共用 catalog／inventory。Server 全量回歸、Typecheck／Build 由本機與 CI 執行；既有 Client／Browser／BAT 回歸保留。

本機 Docker daemon 可用，但 MCR image layer 下載被環境政策拒絕，**本機未執行 SQL Migration**。新增專用 CI job 使用公開 SQL Server 2022 容器、獨立 loopback 14336、隨機且驗證的 MachineName、CSPRNG 密碼與新 UQP_D1_* 資料庫；不讀 app .env／平台連線／正式資料。只套用 926 到合成前置表，驗 fresh／repeat、不改舊列、非法 SQL、trigger／hash／永久撤銷／封存、實際續期 SQL 的 OUTPUT INTO 相容性、disabled／partial／錯型別拒絕與失敗回滾；最後刪除該 DB 與容器。測試不證明正式資料庫已可套用。

正式環境 926 尚未套用。下一階段執行前仍需備份、唯讀盤點 legacy inconsistent rows／DB 權限／現有 trigger、評估 DDL lock 與所有 Device writer、核准精確 SQL／ledger 程序；先在使用者隔離測試 DB 驗收。未宣稱 D2 API、暫停後恢復或新的 Windows 冷開機驗收完成。原 PR83 實機驗收紀錄仍有效，本階段不重寫它。
