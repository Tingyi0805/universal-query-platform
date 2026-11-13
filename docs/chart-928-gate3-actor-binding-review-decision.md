# UQP Dashboard CHART 928 — Gate 3：方案 A（LOCAL JWT＋專用 SQL Writer）

> **架構決策：已選定方案 A（2026-11-13，專案負責人）。正式環境核准：尚未完成。**
> 本文件取代先前 Gate 3「必須建置獨立 Signer／Issuer 或 IdP」的選項分析。
> 保留原本四個 Gate，不新增階段；不能把選定架構視為已安裝 928、核准資料揭露、開啟 Release Gate 或授權覆蓋 `C:\UQP`。

## A 的明確信任模型與取捨

- **UQP 本身就是原始登入身分權威。** 使用現有 `LOCAL` 帳號、`JWT_SECRET` 簽發的 JWT、`jwt.verify`、SQL 即時 `TokenVersion`／帳號狀態／權限。這不是獨立 IdP，不再另外建置 Signer／Issuer／mTLS 簽章服務。
- 從 `authenticateJwt` 成功且即時 DB 權限通過的 Request 私有 WeakMap 取得 `userId`、`tokenVersion`；`DESIGN_QUERY` + `EXECUTE_QUERY` 必須同時存在。前端不能提供 `ActorId`、TokenVersion、GrantId、角色或簽章來覆蓋該身分；原始 JWT 不提供給 SQL Writer。
- **殘餘風險已明確揭露：** 若 UQP 應用程式主機或其登入金鑰被完全入侵，專用 SQL Writer 無法獨立證明 `@ActorId` 是哪個真人所發出的請求；這個模型降低 SQL 過度授權，但不聲稱具備獨立身分防偽。院內應以最小權限、主機防護、稽核及變更控管管理此風險。
- 不分享 `JWT_SECRET` 給 Writer、IIS 新服務、瀏覽器或其他 SQL 連線。舊獨立 Signer／Issuer 模組留在原始碼供追溯但**不走方案 A 正式路徑**；其 Release 常數仍關閉。

## 實際程式介接（目前為已接線、仍硬性停用）

| 邊界 | 已有或新增的來源 | 不能省略的檢查 |
| --- | --- | --- |
| HTTP → 認證使用者 | `auth.middleware.ts`、`dashboardChartAuthenticatedCreate.ts` | 簽章、登入有效期、帳號啟用、TokenVersion、即時雙權限、不可被 `req.authUser` 或 Header 後續覆寫 |
| CHART CREATE Router | `dashboardChartCreate.routes.ts` | 僅收 `profileId`、`requestId`、標準 CHART config 與 placement，server-side 綁定 ActorId；所有 release gates OFF 時 404／UI canCreate=false |
| 專用 SQL Writer | **`dashboardChartLocalJwtSqlCreate.ts`（方案 A 新增）** | 含 exact plan、兩組不同 `ORIGINAL_LOGIN()` SID、Procedure SHA256、最小權限、單筆嚴格 Writer receipt；不呼叫 Signer、Issuer 或使用 Grant／HMAC |
| Writer 連線 | `config/chartWriterDatabase.ts` | 與平台 SQL 連線池／憑證分離；同一已核定目標、TLS 驗證、禁止直接 Widget／Permit／Seal DML，呼叫前檢查 SHA 與 SID |
| 已儲存圖表／公共播放 | 既有 Widget Seal／Audit／Query aggregate／裝置權限模組 | 只讀經核准彙總 Query；可見範圍、Token/IP／撤銷、小樣本／差分風險、讀取稽核，和 Designer 不共用公共播放授權 |

## Gate 2／3 要完成的正式 SQL 契約

**Gate 2：** `database/review/928_dashboard_chart_trust_base.production-review.sql.txt` 是凍結版送審來源，含無條件 `THROW`，不在自動 migrations 內。必須依院內真實資料庫 925/926／928 exact catalog＋ledger、備份還原、變更紀錄，建立核准的正式交易 Migration。現存 925 CHECK/DEFAULT 差異不得用數量判斷或自動補 ledger。

**Gate 3：** 方案 A 需要**一個經核准的 `uqp.usp_DashboardChartCreate` Stored Procedure**，而非原先使用外部 Issuer／Grant 的 disposable prototype。DBA／資安審查時須逐項確認：

1. 在 SQL Server 同一個 `SERIALIZABLE` transaction 內重查 `AppUser.IsActive`、`TokenVersion`、`DESIGN_QUERY` + `EXECUTE_QUERY`、Query 對該人當下的 CanView／CanExecute、Dashboard/Profile/SourceKey/Query/Dataset 與版本，以及 RequestId 單次重放保護；不能把 Node 的預先檢查當成交易保證。
2. 必須另外核准凍結 Trigger → **只容許已核准 Writer 交易建立一個 Widget** 的 permit-protected Trigger 轉換；兩種 Trigger 要有各自精確的原始碼 SHA 與欄位／約束證據。禁止 `DISABLE TRIGGER` 或廣泛開放 INSERT/UPDATE/DELETE。
3. SQL 專用 Writer 只能 `EXECUTE` 經核定的 Procedure，不具有直接 Widget／Permit／Seal／Audit 業務資料 DML、db_owner、db_ddladmin、impersonation 權限。經核定的 `ORIGINAL_LOGIN()` SID、Writer SQL Procedure SHA-256 均由審查過的 source pin 固定，不接受 HTTP／環境變數或執行時自動學習。
4. 一次交易中完成 Permit → Widget → Seal → Audit → Request ledger，必須確保失敗完整 rollback；回傳唯一 `WidgetId`、`Digest`、`SealRevision`、`AuditLogId`，驗證者只承認四個欄位，任何 SQL 錯誤／多餘欄位不回傳給瀏覽器。
5. A、B **均有權限**：B 用自己的登入 Cookie/JWT 卻在 POST body 插入 `ActorId=A` 必須 HTTP 拒絕；A 被停用、TokenVersion 或 Query 權限在請求期間撤銷，必須由 SQL Writer 交易拒絕。**不宣稱這能防住完全遭入侵的 UQP 主程式**。
6. 公共螢幕／裝置 Token、來源 IP、Query 彙總、小樣本與差分揭露需另有明確院內資料主管核准。Stage 18 設計器測試通過**不等於**公開病患相關資訊獲准播放。

## 四個 Gate 的固定進度與放行條件

| Gate | 目前狀態 | 放行證據 |
| --- | --- | --- |
| Gate 1 — UI／隔離基線 | Stage 18 已通過 | 保留原 UAT，不因架構文字調整重測 |
| Gate 2 — 928 Schema／實機核對 | **待完成** | 正式 928 SQL source/hash、精確 925/926/928 SQL 目標驗證、交易和回復、單位決策 |
| Gate 3 — LOCAL JWT＋專用 Writer／隱私 | **方案 A 已選定；正式放行待完成** | Writer/Trigger source/hash、SQL 原始 SID、同交易權限測試、暴露風險接受、資料主管核准 |
| Gate 4 — IIS 測試／正式更新 | **尚未開始** | 前兩 Gate 放行後，再一次 Windows/IIS、SQL 測試主機驗收；人工核准後才 ZIP 覆蓋 |

## 本次決策紀錄

- **架構**：方案 A LOCAL JWT＋專用 SQL Writer；由 UQP 既有身分權威保證一般合法請求的 ActorId，SQL 內再驗活體授權。
- **正式核定的 SQL source hash、SQL SIDs、928 installer、Writer、資料主管隱私決定**：均 **NOT RECORDED**。
- **硬式 Release 常數**：`CHART_CREATE_HTTP_RELEASE_APPROVED=false`、`CHART_LOCAL_JWT_WRITER_RELEASE_APPROVED=false`、`CHART_ATOMIC_CREATE_RUNTIME_ENABLED=false`、Writer SHA/SID NULL；獨立 Signer／Issuer 的舊路徑亦維持 OFF。
- **部署結論**：PR #99 仍 Draft，不能進行正式 SQL、928 ledger、啟用公開播放或覆蓋 `C:\UQP`。須在 Gate 2／3 做出具體技術核對與正式放行，不再以等待另一個獨立 Signer/IdP 作為方案 A 的必要前提。
