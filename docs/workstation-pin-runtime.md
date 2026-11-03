# PIN 共用工作站 Runtime：開發與驗證契約

本輪從遠端 `recovery/pr83-pin-minimal` 恢復，核對 HEAD
`1b03a71fe67c47d73693455f7926fd5e7b586aa6`、tree
`c0003389b8aee9f46550af78cc0e493c5e7cafac`，四筆既有恢復提交完整保留。
獨立 worktree `/workspace/work/uqp-pr83-pin`；未操作原工作目錄。
PR #83 保持 Draft、不合併。本文件是程式契約，**不是正式部署核准**。

## Session／登入與撤銷

- `WORKSTATION_PIN_RUNTIME` 預設 false；未啟用時工作站 Runtime 路由 404，Repository 不查 DB。
- 沿用 `SharedWorkstationCredential`、`SharedWorkstationSession`、`AppUser`、`UserQuickPin`、既有角色／權限與個人／部門／群組聯集授權，不增加另一套身分或 Session 表。
- 既有管理流程核發的工作站 credential 以 `id.secret` 一次輸入配對頁；僅在 HTTPS 同源 JSON＋自訂 header 下寫入 `__Host-uqp-workstation` Cookie。此 Cookie 30 日、Secure／HttpOnly／SameSite=Strict／Path=/，沒有 Domain。配對不核發或擴張管理權限，也不接受 Dashboard Device Token。
- PIN Session 為獨立隨機 UUID＋256-bit secret，不發 JWT。Session Cookie `__Host-uqp-pin-session` 為 Secure／HttpOnly／Strict、無持久 Max-Age；DB 僅存 hash。hash 同時綁定 credential、CredentialVersion 與十進位 BIGINT generation。
- 每次 Session 讀取重驗工作站啟用、PIN 開關、用途、未退役、credential 未撤銷／版本、live LOCAL 使用者與 TokenVersion、PIN 啟用與 PinVersion、有效允許名單。權限只保留 VIEW_QUERY／EXECUTE_QUERY，不授予管理、匯出或 PIN 管理能力。
- 固定 idle 180 秒、absolute 3600 秒；SQL Server 時間裁決。讀取、QueryDelivery 重驗與背景 poll 不延長 idle；只有前端實際操作觸發的受 CSRF 保護 activity 才更新。Session status 在同一交易撤銷到期 Session 並寫 Audit；Audit 失敗拒絕交付。Query 讀取亦獨立檢查到期，不依賴 poll 正常運作。
- 登入與切換先提交 generation 增加、A 撤銷與必要 Audit，再取得 B verifier／驗證。最終 generation CAS、B Session INSERT 與登入 Audit 同交易提交。B 失敗、CAS 過期、第二階段 Audit／commit 失敗都不恢復 A；格式錯誤的 B 切換也先撤銷 A。
- 沿用固定成本 scrypt／外置 pepper、4–12 政策（當次須符合 live PinLength），不接受 legacy bcrypt 兌換 PIN Session。無帳號／不適用帳號亦執行 dummy KDF；所有錯誤回覆不帶 verifier 或原始 DB 例外。KDF 併發上限沿用既有兩個工作。
- 帳號 bucket 優先採 DB collation 解析到的 AppUser ID，避免帳號拼法 alias 分散失敗計數；未知帳號使用固定長度不可逆 key。跨實例 SQL 帳號／工作站／可信網路三種 bucket、漸進延遲、封鎖與 generation Repository 沿用恢復成果，不用記憶體 Map 取代。

## Cookie／CSRF 邊界與 API

啟用前須由管理者另外配置既有外置 pepper 及 `WORKSTATION_PIN_ORIGIN`（純 HTTPS origin，無路徑／尾斜線），並確認 CLIENT_ORIGIN、站台 Host 與既有可信代理 resolver 設定一致。本次未讀取、產生或配置正式 pepper，未啟用 Runtime。

GET 僅接受 pinned Host／TLS 邊界；POST 還要求精確 Origin、同源 fetch metadata（若有）、JSON／自訂 pairing header 或與當前 Cookie 綁定的 HMAC CSRF header。忽略非可信 peer 的 forwarded TLS／Host 宣告，拒絕 Bearer、Device Token、混合 credential header。CSRF 經同源 JSON 回傳，僅存記憶體，綁定當前工作站與 Session；登入後舊 CSRF 失效。

所有下列 API 位於 `/api/workstations/current`，回應 no-store：

| 方法／路徑 | 契約 |
|---|---|
| POST `/pair` | 輸入既有管理員核發 credential；不在 URL 或 storage 保存；配對先撤銷該工作站 Session 並 Audit |
| GET `/session` | live Session 或已鎖定狀態、當前 CSRF、公開使用者資訊；不回傳 opaque Cookie／hash |
| POST `/login`、`/switch` | username／pin；兩階段 revoke→verify→CAS，成功才設定 opaque Session Cookie |
| POST `/lock`、`/logout` | SQL generation＋撤銷＋Audit；不依賴只清畫面 |
| POST `/activity` | 未到期 Session 才可延長 idle，不延長 absolute |
| GET `/queries`、`/queries/:id` | 只列出通過 PIN 最低 assurance 與既有 ACL 的 Query；清單交付前再次重驗所有已選內容 |
| GET `/queries/:id/parameters/:name/options` | 沿用既有 NONE／FIXED options；Lookup Dataset 未有完整交付契約仍拒絕 |
| POST `/queries/:id/execute` | 沿用既有 QueryDelivery、政策遮蔽、usage Audit 與 final Audit 協調器 |

## 受限 QueryDelivery

PIN 只可操作已發布、啟用、未封存且有 live ACL 與個人 RBAC 的唯讀 Query。
最低 assurance 採保守規則：已確認、同版本、完整列出的 Dataset 欄位分類全部為 `OTHER`，沒有患者 Audit 設定或 audit-only 欄位；敏感資料即使遮蔽也不能以 PIN 進入。未確認／空／部分分類／版本不符全部拒絕。

QueryExecution、伺服器政策遮蔽、metadata、固定 options、usage Audit 沿用原流程。身分指紋增加 Session ID／generation／CredentialVersion／PinVersion；SQL 後、最終 Audit 交易內及 Audit 完成後、送出前都重驗。拒絕 A 的在途晚結果。原 JWT 路由與既有患者交付流程保留；PIN 不接入 Dashboard playback、匯出、管理、favorites 或敏感患者 drill-down。

## 前端生命週期與觸控

入口 `/workstation`。進入時沿用既有 JWT logout／interactive-clear；PIN 身分不進 AuthContext，也不交換 JWT。PIN／credential／CSRF 不寫 localStorage、sessionStorage 或 URL。登入、鎖定、切換、pagehide、hidden、卸載或身分失效時清除帳號秘密、查詢參數／結果與 metadata，取消可取消的在途讀取並遞增 epoch；寫入即使已送出也不自動重送。即使 transport 忽略 abort，舊 epoch 的成功結果也不再採用。

背景確認不更新伺服器 idle；失去可確認的 Session 時清畫面。BroadcastChannel 只傳 clear 通知，不傳身分或秘密。明確 switch 與 hidden／離頁會請求伺服器 lock；網路失敗時不能保證該 lock 已提交，畫面會清除，伺服器 idle／absolute 與每次交付重驗繼續生效。晚到失敗／lock 回覆不發刪除 Cookie，避免清掉較新的登入。

PIN 輸入使用 numeric inputMode、4–12 位、觸控區最小 48px，支援窄版與橫向版面。Windows／Android／iOS 的 Chromium viewport／hasTouch 模擬不等於原生 Windows 或 Android／iOS 實機驗收。

## SQL 與正式執行前 gate

- 正式檔案：[927_workstation_pin_runtime.sql](../database/migrations/927_workstation_pin_runtime.sql)。保留同步 [forward review copy](../database/drafts/workstation_pin_runtime.forward.sql)。新增 SwitchVersion 與 bucket，沒有 Session／RBAC 重建、舊資料重寫或 PIN 開關啟用。
- 單批次、schema applock，支援 dedicated connection 與 runner 外層交易／savepoint；外層 doomed 時交回 runner rollback，Ledger 與 DDL 同外層交易。缺前置、部分安裝、名稱衝突與不符完整狀態皆拒絕，不自動修補／reset。
- 欄位、型別／NULL、DEFAULT 綁定與定義、CHECK 定義／enabled／trusted／NFR、scope literal、PK／索引鍵／INCLUDE／方向／屬性、額外 Trigger／FK／partition／壓縮與 generation 依賴皆檢查。runner 對已記錄 927 也檢查 Catalog，不能只因 Ledger 存在就跳過；既有歷史 runner 範圍不擴張。
- 原 49 歷史 Migration byte 與 manifest entries 不變。新增 927 後來源清冊共 50 份，legacy／coexistence 驗收 profile 不包含 927。
- 唯讀檢查 SQL 沿用 [production-workstation-pin-readonly.sql](../database/acceptance/production-workstation-pin-readonly.sql)，未執行，沒有新增全面正式 DB 盤點。
- 靜態 AST／來源 hash 與離線交易模擬不能證明 SQL Server 編譯、鎖定、跨實例併發、deadlock、失敗 rollback／savepoint／Ledger 與既有 writer 相容性。上述 SQL Server 實測全部待驗證。本次不下載映像、不連正式 SQL Server、不執行 Migration、不操作 C:\\UQP、不製作正式更新包。
- 正式執行前仍須：對照唯讀 Schema 結果與 metadata 權限、隔離 SQL 實測、既有部署／writer 相容性、核准低敏 Query 範圍與 PIN-only／跨重啟政策、外置 key 與 Cookie／TLS／代理設定、實機驗收、容量／保留清理策略，以及停寫與可還原備份核准。Runtime 保持 false，沒有宣告正式部署已獲准。

## 本輪驗證紀錄

本輪本機 Node v24.19.0／Linux；未修改 lockfile 或 CI 工作流程。npm cache 使用 `/workspace/work/npm-cache`。

| 檢查 | 本輪結果 |
|---|---|
| Server 完整測試（最終程式及 Catalog 修正後重跑） | 2297／2297，0 skipped |
| Client 完整單元測試 | npm test 通過；展開案例 80／80 |
| Browser 完整回歸 | 342／342（含新增 7 項工作站 Runtime） |
| Server／Client Typecheck／Build | 全部通過；Client 仍有既有 chunk 大小提示，未調整門檻 |
| PIN／Query HTTP 專項 | CSRF／Cookie／A→B／Audit 失敗／過期 generation／晚到交付／敏感拒絕；通過，屬 mock SQL |
| SQL AST 靜態檢查 | 唯讀 7 SELECT AST＋5 拒絕案例；927 additive 3 DDL AST＋4 拒絕案例；沒有 SQL Server 執行 |
| Schema inventory | 63 SQL 來源、50 Migration；原 49 source bytes／manifest entries 未改 |
| Windows Node v24.22.1 原生相容性 | 本機 Linux 無法執行，交由既有 Windows CI；不能以本機 Build 代替 |
| 927 真實 SQL／跨實例 Session／bucket | 未執行，待隔離驗收；既有 CI SQL smoke／926 測試也不能冒充 927 實測 |
| Android／iOS／Windows 實機觸控 | 未執行；viewport／hasTouch 模擬通過不等於實機驗收 |

本次已取得使用者明確授權，正常推送 PR 後可執行既有 CI 的隔離 SQL 與 staging 驗證；不修改 CI 規則，不製作正式更新包。CI 實際結果須以本輪推送 SHA 的 Actions／checks 為準，不能以此處本機結果或舊 CI 宣稱通過。

開發批次：`412de5f` Cookie／CSRF、`588ed8a` Session／登入接線、`9c32715` 受限 QueryDelivery、`71bb21d` 觸控介面、`e41bc56` Migration／runner、`b2e3178` 伺服器 expiry／帳號 alias／晚交付、`3b4908e` absolute／Catalog／dummy verifier 安全補強。
本輪所有 HTTP／Browser／Repository 測試使用合成資料與模擬 SQL，沒有以此宣稱 SQL Server 實測。
