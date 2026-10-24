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
