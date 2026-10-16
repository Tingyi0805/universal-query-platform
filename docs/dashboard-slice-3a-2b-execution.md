# Slice 3A-2B：隔離執行核心與來源錯誤

基準 c05f24c。沒有修改／執行 916、917，沒有連接共用 SQL Server。此批交付 Query-only 分頁執行核心與 JWT 預覽，**尚未交付或啟用裝置 Query-only 播放**，未解除 3A-2A 停用保護。

## 已實作契約

`DASHBOARD_QUERY_SOURCE_EXECUTION=false` 為預設。明確啟用後可用 `POST /api/dashboards/:id/query-sources/v1/:sourceKey/page`，body 只允許 `page`、optional `snapshotId`；不接受任意 SQL、DatasetId 或客戶端遮蔽設定。本批只支援額外來源；PRIMARY 仍採既有契約。

必須先經既有 JWT 驗證及 `DESIGN_QUERY`／`EXECUTE_QUERY`，執行核心再核對 TokenVersion、帳號／權限現況、917 Schema、已隔離且停用的 Dashboard、來源啟用、非 pending Query 綁定、binding revision、maxRows、Query 發布／啟用／封存、現行 Query canView/canExecute、Dataset／實體來源及必要參數。缺少 Schema 或能力關閉均安全拒絕，不使用歷史 DatasetId。僅讀目前來源的設定，其他來源無效參數不會使此來源失敗。

只透過 Query.datasetId 呼叫既有 saved-Dataset 執行器，傳入來源 maxRows；保留 SELECT-only、參數 coercion 與原有上限。只回要求的頁，欄位依後端敏感政策篩選／遮蔽，原始識別僅交給既有患者揭露稽核。非空頁缺少稽核或稽核失敗不得回傳任何列。Query 執行及稽核後重新驗證所有權限與指紋，避免撤權／重綁時洩漏。

快照包含 Dashboard、Source ID、SourceKey、QueryId、BindingRevision、ACL revision、TokenVersion、`QUERY_ONLY_PREVIEW_V1` 模式版本及完整 binding fingerprint。fingerprint 同時含 Token 雜湊、帳號、目前 Dataset／參數定義／遮蔽政策，原始 Token 不保存。JWT 預覽用負的 userId 作 cache owner，與既有正 deviceId 隔離；不同來源、帳號、Token、模式或版本不能共用快照。仍是 process-local、有 TTL／數量／byte 上限的 cache，不持久化患者列。

來源 403／參數 400／執行 503 只清除該來源列並退避重試，其他來源刷新與分頁繼續。固定表頭保留，顯示本機固定安全錯誤文字；401 真正憑證失效仍觸發既有全體拒絕，不弱化裝置停用／工作站撤權流程。不顯示 driver 訊息、SQL、Bind 或原始患者識別。新 API 使用 no-store、安全錯誤代碼及 Request ID。

舊 Dashboard／快照格式保持相容。已管理的看板或已綁 Query 的來源不能經舊 PRIMARY／Dataset 分頁端點執行；即使有人以外部方式把其 IsActive 改為 true，舊端點仍回 `QUERY_SOURCE_MODE_NOT_ACTIVATED`，不降級至歷史 DatasetId。舊未管理 Dashboard 保留既有播放規則。

## 明確啟用流程設計（未實作，不能啟用）

現有 `QuerySourceMaxRows` 是管理隔離標記，不足以代表已通過裝置播放驗收。後續需要獨立、持久化模式及版本；不能單靠 IsActive、全域旗標或手動清除標記啟用。

1. 維持停用，安裝／驗證 Schema 的正式批准流程另行處理。新模式欄位若需 Migration，確認 918 是否可用；本次沒有建立新腳本。
2. 由受授權操作者提交預期管理版本，交易鎖 Dashboard／來源／所有版面／裝置。確認含 PRIMARY 最多 8 個、無 pending／key 衝突／孤兒元件引用；每一 Query 與 Dataset 有效，必要參數與後端敏感政策完整。
3. 同時驗證操作者及每個裝置委派者的 JWT／TokenVersion／Query ACL、工作站關聯與裝置安全設定。不能把操作者的 Query 權限自動轉授給裝置。
4. 完成裝置端 Query-only 分頁、PRIMARY、layout／mode 發現契約及前端切換整合與 Mock／隔離安全回歸後，才允許明確啟用。交易內寫入模式版本、設定啟用、必要憑證失效及安全稽核；任何失敗全數回滾。
5. 切換須使相關舊快照失效、阻擋所有舊執行／寫入者，不能讓已轉換設定被舊程式重新解讀。回退先停用及撤銷裝置 session，保留原資料與隔離標記，經批准流程處理模式，不自動 Dataset fallback。

## 範圍與待驗證

新增 `dashboardQuerySourceExecution.{ts,repository.ts,routes.ts,test.ts}`；修改 Dashboard route 掛載、舊 device page 防繞過檢查及測試、snapshot optional namespace 欄位、env 能力旗標；前端只改 sourcePlayback／Display 的局部錯誤與其單元／Chromium 測試，沒有改視覺編輯器、工作站、PIN 或 Query runtime。

仍待隔離 SQL Server 實際 Schema、查詢／撤權競爭、揭露稽核、負 cache owner 與多節點 session 一致性驗證；本次 Mock 不是真實環境驗收。裝置 Query-only 授權／PRIMARY 執行、模式切換、activation API 及新版播放路由整合尚未完成，能力旗標保持預設關閉。

驗證：受影響後端 98 項、前端來源播放單元 9 項、Chromium 播放回歸 7 項通過，0 失敗；前後端型別檢查及 build 通過。Chromium 使用 Mock API 與合成資料，不代表裝置 Query-only 真實環境驗收。前端 build 保留既有 chunk 大小警告。
