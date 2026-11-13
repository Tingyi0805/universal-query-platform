# UQP CHART 928 — Gate 3 actor-binding / authorized Writer decision

> **送審決策書／REVIEW ONLY。** PR #99 Draft，來源基準 `b696c53602c0843fb89058e4475aa30908518126`，CI #1539 SUCCESS（既有隔離測試）；**不是正式資安或 DBA 採認，也不是安裝程序**。不修改院內 SQL、不新增 928 ledger、不啟用 CHART create/public playback、不合併 PR、不覆蓋 `C:\UQP`。任何「APPROVED」只能由院內具權責的獨立審查者記錄，不能從 CI、ChatGPT、程式作者或本文件推定。

## 唯一要決定的安全問題

當兩名使用者 **A 與 B 同時具備 CHART 設計權限**，B 不得只靠改寫 `ActorId=A`、重送簽章/Grant 或利用 UQP 伺服器權限，使資料庫誤認請求來自 A。**查詢 A 的帳號仍有效、A 具有權限，不代表目前這個請求是 A 發出的。**

目前 `dashboardChartSignerIssuerHandoff.ts` 的 `readLiveSession(plan.actorId)` 能重驗傳入 ActorId 的狀態，但若沒有獨立驗證「此網路請求由該身分發起」的來源，不能單獨當作防冒用證據。mTLS 只證明連線服務的身分，並不直接證明終端使用者；由應用程式設定的 `SESSION_CONTEXT`、HTTP `ActorId` 或 `EXECUTE AS OWNER` 亦不能作為獨立的人員身分權威。

## 必須由資安決定的權威身分來源（尚未採認）

審查者須指定**能獨立驗證的身分斷言來源**、簽發者、驗證方法、有效期間、單次請求綁定及撤銷管道。兩個可討論方向（**非既定實作或已符合要求的替代物**）：

- **A：獨立 IdP 簽署的使用者身分斷言。** 由獨立 Signer 直接驗證其 signature、issuer、audience、subject、expiration、session/token version、nonce 與本次操作的 RequestId/Scope，將 subject 映射為院內 `AppUser`。必須能阻止 B 拿自己的有效憑證要求簽署 A 的 ActorId。
- **B：經獨立授權的認證交換／工作階段權威。** 獨立 Signer 透過可信憑證交換／一次性挑戰，直接證明本次請求對應的 authenticated session；僅用 `readLiveSession(actorId)` 查到 A 活著**不合格**。審查者必須說明此權威如何與目前 UQP JWT 綁定、防止由主 UQP 或 SQL Writer 任意指定 ActorId，並記錄憑證輪替與失效處理。

**決定：PENDING。** 沒有可用的獨立權威及具體信任證據時，Signer／Issuer／Writer 仍維持硬性 OFF；不可退回「只驗 ActorId、權限與 TokenVersion」方案。

## 正式信任邊界（待獨立核准）

| 邊界 | 必要驗證與負責方 | 不可接受的替代證據 |
| --- | --- | --- |
| Browser → UQP | 現有登入、CSRF/授權、即時 TokenVersion/權限；RequestId/nonce 與標準化 CHART scope | Browser 傳來的 `ActorId` 自稱身分 |
| UQP → Independent Signer | mTLS 驗服務端，**另**核對獨立終端使用者斷言；簽署 ActorId、TokenVersion、Dashboard/Profile、RequestId、SourceKey、Config digest、expiry、audience | 只看 mTLS、只查 `AppUser` 存活或信任 UQP 指派 ActorId |
| Signer → SQL Issuer | SQL 隔離的 Issuer 主體核驗來源／canonical scope／一次性 nonce、TTL 和當前權限；從可信證據導出並與 ActorId 比對；Issuer 私鑰/SQL HMAC 不提供給一般 UQP | UQP 可自行造 HMAC、從環境變數注入角色／SID／秘密、單靠有效簽章但缺獨立使用者綁定 |
| SQL Issuer → Writer | Writer 以**核准且釘選的 SQL 身分**消費單次 Grant；DB 持鎖再驗 ActorId、TokenVersion、RBAC、查詢與 Dataset 可見範圍、版本、來源、失效與重放 | 僅由應用程式提供 `@ActorId` 或可寫 `SESSION_CONTEXT` |
| Writer → 928 CHART/Seal/Audit | 單一交易完成 permit、widget、seal、request ledger 和不可變稽核；任何失敗全回復 | 一般 UQP/Issuer/Writer 主體具直接 Widget/Permit/Seal DML 權限 |

**主體隔離**：平台登入、Issuer、Writer 必須是獨立 `ORIGINAL_LOGIN()` 與釘選 SID；審核 SQL GRANT/DENY、簽署模組的執行脈絡與私鑰保管者，並檢查固定 server role、ownership chaining 及 impersonation 權限。當前 `CHART_SQL_APPROVED_PLATFORM_SID`、`CHART_SQL_APPROVED_ISSUER_SID`、`CHART_SQL_APPROVED_WRITER_SID` 均為 `null`；`CHART_ISSUER_APPROVED_PROCEDURE_SHA256`、`CHART_WRITER_APPROVED_PROCEDURE_SHA256` 尚無核准值。**不得在未審查時填入或自動從線上目標學習。**

## 與 Gate 2 凍結版的唯一安全銜接

Gate 2 候選 `database/review/928_dashboard_chart_trust_base.production-review.sql.txt` **只建立禁止所有 CHART 寫入的凍結 Schema**；它有無條件阻擋執行的 `THROW`，不在自動 Migration 目錄。Gate 3 的授權建立必須由 DBA 核定**另外一份、版本化且具獨立精確 Hash 的凍結 → permit-protected Trigger 轉換**，明確記錄：

1. 轉換前後不同的 Trigger 定義 SHA-256，不能拿原始凍結 hash 接受 Writer 版，也不能悄悄 `DISABLE TRIGGER`。
2. Permit table 的精確欄位、TransactionId/SessionId 綁定、單筆 CHART 驗證、SQL Writer procedure 的 approved SHA-256、角色與封存/稽核語義。
3. 同一 SQL 交易的鎖定、Grant 消費、Seal/Audit 與失敗 rollback；沒有批准前不得把 disposable `WITH EXECUTE AS OWNER` prototype 搬入正式 SQL。
4. Schema 925/926/928、SchemaMigration、目標身分及備份還原須由 Gate 2 DBA 獨立簽認，不得靠 CI 或欄位數量代替精確比對。

**目前轉換方案：PENDING**，沒有核准的 Writer SQL 或 Trigger 來源。

## 審查採認必須提供的反證案例（不能以單純 PASS 代替）

- A、B **同權限**：B 以 `ActorId=A` 嘗試簽署、核發、消費，任何步驟不得讓 A 的權限成為 B 的授權。
- A 的已簽 nonce、Grant、RequestId 在相同、不同工作階段／不同 SQL 連線重用；或替換 Scope、Dashboard/Profile、Config digest，必須拒絕。
- 登入 TokenVersion／權限撤銷，或審查有效期／Query/Dataset revision 在簽署到 Writer 消費間改變，必須失敗並不留半完成 Widget/Seal/稽核。
- 任一私鑰不可用、Signer cert 輪替、SQL Issuer 原始 SID / 模組 digest 漂移、Writer 擁有多餘權限，必須 fail closed。
- 改寫／停用 928 凍結或 permit Trigger，或直寫 Widget/Permit/Seal，一般主體和錯誤 SQL 主體不得成功。
- 公共螢幕／裝置 Token、IP、到期、撤銷、分組小樣本及差分風險必須另有**資料主管的明確可播放決定**；Designer 已通過 Stage 18 不等於公共播放核准。

## 獨立審查決定欄（目前均 **NOT RECORDED**）

| 負責者 | 必填決策／證據 | 狀態 |
| --- | --- | --- |
| 身分／資安負責人 | 選定 A/B 或經審核的替代權威；issuer/audience/subject mapping、nonce/TTL、撤銷、A/B 冒用反證 | PENDING |
| Signer 服務負責人 | 獨立服務與實際身分、金鑰託管者、mTLS 憑證來源/輪替、簽署格式及 source digest | PENDING |
| SQL DBA | 核定三個 SQL 原始 SID、最小權限、獨立 Issuer／Writer procedure 原始碼 Hash、獨立授權 Trigger 版本/遷移 | PENDING |
| 資料主管／隱私負責人 | grouped-query 可揭露欄位、小樣本／差分限制、裝置及公共播放條件、稽核保存 | PENDING |
| 變更核准者 | Gate 2/3 reviewer、日期、正式變更單與 Gate 4 驗收／回復授權 | PENDING |

**正式決定：Gate 3 NOT APPROVED。** 請具權責審查者在既有 PR #99 Gate 2／3 審查流程提出具體核准或修改要求；本文件不構成自動簽核。維持所有 Release flags OFF、Hash/SID NULL、PR Draft 與正式 `C:\UQP` 不變。審查前不新增 synthetic-only CI/ZIP 或重跑 Stage 18。
