# C6：集中遮蔽／公共顯示整合盤點

基底 `b068b38dccdfcced76171f7b5a728a32e1199757`，PR #66 Draft，既有 CI #1023 SUCCESS。不連使用者資料庫。

| 範圍 | 目前證據 | 差距 |
|---|---|---|
| Dataset | 910/912、SensitiveColumn Repository、四模式 UI、版本／稽核、metadata-only 同步已存在 | 公共顯示無持久化／API／UI |
| 公共顯示 | `datasetPublicDisplayPolicy/Confirmation/Writer` 及單元測試 | 純契約；未接資料庫，不能當作已發證 |
| Dashboard | Query-only、Token／ACL、模式、版本 fingerprint、患者稽核與快照均存在 | execution、legacy device、preview 仍讀 `deviceColumnMasks/deviceSourceColumnMasks`；user playback 還檢查舊核准 |
| 設計器 | managed PRIMARY／額外來源／參數與 legacy writer guard 已存在 | DataSettingsEditor 重複欄位核准；preview 應只使用 Dataset 預覽政策 |
| 範本 | `sensitivitySuggestions.ts` 固定精確別名建議，需明示套用 | 無維護 API、DB、停用／歷史版本／引用與管理介面 |
| 稽核 | 普通資料不要求患者 receipt；患者啟用時 requireDisclosure、HMAC、持久化 | 必須保留；新管理寫入與成功稽核須同交易 |

舊核准寫入／綁定保護：`dashboardApproval.service/repository`、`dashboardQuerySources.service`、`dashboardLegacyLocks`。保留歷史 JSON 及綁定／並行 guard，禁止將其轉成 Dataset 公開授權。公共播放改以 Dataset 政策判定；Legacy 播放不能藉新功能取得 Query-only 權限。

## C7～C10 實作順序

1. **C7**：925 獨立草稿（不置入自動 Migration Runner），Dataset 公開確認表與可維護範本／引用歷史。公開政策綁 D/S rowversion、來源 ID、敏感政策版本；ROWVERSION CAS、即時身份、Dataset 設計／相關 Query ACL、SERIALIZABLE、原子 Audit。Dataset UI 明示逐欄／批次勾選、確認、衝突保留；舊 Schema 回傳不可用，不自動核准歷史資料。
2. **C8**：Query-only public execution 讀最新 Dataset 公共政策並納入 fingerprint；designer preview 使用 Dataset 遮蔽，無 Device Token／公共核准依賴。舊 Legacy JSON 不授權新政策；移除 Dashboard 重複核准 UI，保留其他 guard。以合成 OR_001／EXAM_DATE 驗證既有日期設定，不連 HIS。
3. **C9**：管理者範本維護、查詢使用 Dataset、停用與 CAS／稽核。精確名優先、明示 alias 次之；模糊僅提示。選取／範本更新均不改既有 Dataset；套用必須明示並保存版本引用。
4. **C10**：完整 Server／Client／E2E、Windows、923/924 及 925 隔離 clean／upgrade／rollback／受限帳號測試。提供 ZIP 覆蓋、停機、備份與回復說明，不操作共用 SQL Server。

## Schema／部署風險

001～924 不改；922 不假設存在，923/924 專用安裝方式不變。925 僅在 CI disposable SQL2019 實際安裝；正式安裝需獨立預檢、備份／還原驗證、權限審查與明確授權。舊 Schema 的 Query／Excel／Dataset 遮蔽繼續運作；新公共播放沒有有效政策時 fail-closed。新功能不啟用 Dashboard／Device flags，不授予 Scope，不改 JWT、患者稽核或 Source Fence。

Oracle11g／OR_001 真實環境、共用 SQL Server 與 Windows ZIP 本機驗收皆待使用者最後執行；不能用 Mock 結果宣稱實機成功。

## 分階段提交／證據

- C6 `d93277a`：盤點，既有公共契約 13/13；基底 CI #1023 成功。
- C7 `3294612`：公共政策 Repository／API／Dataset UI；相關純函式與 Repository 23/23。925 DB 驗收於 C10 執行，提交當時 PENDING。
- C8 `096cc8e`：Dataset 權威公共播放／設計預覽分離；相關 Server 202/202。Windows／SQL／全量 CI 於 C10，提交當時 PENDING。
- C9 `b6c7d2d`：範本管理／引用；Server 全量初輪1746/1746、政策 API／範本／離線 installer42/42，新增 E2E 以最後 C10 結果為準。
- C10：完整回歸、925專用安裝與隔離實機、Windows／ZIP回復文件。狀態以最新提交 CI 為準；正式共享 DB／Oracle11g／Windows切換仍需獨立核准及人工驗收，不因 CI 轉為 PASS。

已觀測 CI #1027（`c5a804e`）的 Server／Client／Browser／Windows／923／完整 Schema 924+925 全部成功；925 真實 Catalog、受限交易、CAS／Audit 及範本歷史有成功 marker。後續安全修正額外涵蓋全數公開否決不執行查詢／不透露筆數、SQL 保存後狀態刷新、結果列鍵與 metadata 一致、患者稽核專用鍵必須 OMIT，以及 DEFAULT 綁定欄位／索引方向的精確查核；最終交付以最新 HEAD 的完整 CI 為準。

C8 最終覆核另移除 TABLE/FIELD 版型遮蔽控制項、瀏覽器二次遮蔽及播放管理對 column-approvals 的依賴；managed 換綁保留歷史 JSON，但其內容不再阻止版本化的停用草稿換綁。ACL、CAS、source-in-use、同 Dataset pending conversion 與交易內綁定重驗仍保留，啟用／核發／交付改由 Dataset 公共政策准入。隔離 SQL 亦驗證同一 owner 下的模式政策 gate 不需任何 Dashboard 核准 JSON。
