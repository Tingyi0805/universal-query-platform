# Dataset 集中遮蔽、公共顯示與範本（C7～C10）

## 操作與權威邊界

- Dataset 仍是逐欄 NONE／CUSTOM／FULL／OMIT 的唯一設定位置。敏感分類由設計者明示；名稱及內容不自動分類。原規則、CUSTOM、患者識別／HMAC 與 Query／Excel 政策不移除。
- 新「公共顯示政策」獨立於遮蔽規則。逐欄或批次勾選只是草稿，必須明確確認並保存。新欄、未確認、OMIT、敏感分類搭配 NONE、重複別名均不能取得公共授權。所有否決可明確儲存，沒有 raw wildcard；全數否決的公共播放在查詢前停止，不揭露筆數。
- `GET/PUT /api/datasets/:id/public-display-policy`：即時 JWT／TokenVersion、DESIGN_QUERY＋EXECUTE_QUERY、有效 Dataset、所有已發布／啟用相關 Query 的現有 ACL。未發布 Dataset 沿用既有 DESIGN_QUERY 設計能力，不建立新的 Owner 流程。
- owned SERIALIZABLE／XACT_ABORT 交易鎖住 Dataset、來源、參數政策版本及公開確認；ROWVERSION CAS、唯一 RequestId、actor-bound request digest、同交易精確字串 AuditLogId。相同當前 request 可重放，異內容／歷史版本衝突拒絕。Commit unknown 不回報成功。確認不是 Native Type／SOURCE_BOUND 證據。
- D/S rowversion、來源 ID、敏感政策版本任何變動，讀取狀態為 STALE。規則及歷史不自動刪除；須明確重新確認。Digest 只做完整性／重放比對，不能取代 mutation version。

## Dashboard

- 設計器及大螢幕版型移除重複逐欄遮蔽／授權，只顯示 Dataset 政策入口。TABLE／FIELD 僅顯示後端已處理值並套用顯示格式，不再解讀歷史 widget maskMode／columnMasks 或二次遮蔽；歷史 JSON 保留。播放管理亦不再讀取第二套 column-approvals，啟用及核發依後端 Dataset 公共政策預檢／交易重驗。PRIMARY／額外 Query、參數、版型、裝置及啟停仍使用原本 managed endpoints／CAS，不走被停用的 Legacy writer。
- Designer Preview 使用 Dataset 預覽遮蔽與現有權限／必要患者稽核，不要求 Device Token 或公共核准。舊 JSON 不能提高揭露權限。
- 公共 user/device Query-only 執行每次載入最新 Dataset 遮蔽與公開確認，納入完整 fingerprint；執行後、頁面傳送前、必要稽核後重驗。實際列鍵亦須屬於結果 metadata，防止未宣告欄位外洩。政策修改（含 ABA）、ACL、TokenVersion、綁定及來源變動使舊快照拒絕。只交付正向核准欄位，先在後端遮蔽。明確設定的患者稽核專用鍵沿用 Query／Excel 的同一驗證器，必須 OMIT，不能用公共核准揭露。
- Device 保留 Token／有效期／IP／delegator／裝置檢查；Legacy mode 不能透過舊 device page 繞過 Query-only。歷史 JSON 原樣保留但不轉成 Dataset 授權。保留即時 ACL、SERIALIZABLE/CAS、active/source-in-use、pending 同 Dataset 轉換及交易內 binding-change abort。僅在 managed API 移除「歷史 JSON 非空就禁止換綁」的過時條件；JSON 原樣保留且不授權新來源，啟用與交付必須重驗所選 Dataset 公共政策。舊 whole-form writer／鎖簽章保護不變，明確清理歷史核准仍可使用既有稽核程序。
- 普通 Dataset 未啟用患者稽核時不要求患者 receipt；明確啟用者仍需完整確認、HMAC 及持久化，失敗拒絕。沒有 SOURCE_BOUND、SQL_LOCK_VERIFIED 或 Native Runtime 的新增能力。

## 可維護範本

`/admin/mask-templates` 使用即時 MANAGE_SETTINGS 管理；DESIGN_QUERY 可讀建議。API `/api/dataset-mask-templates` 僅提供 GET／POST／PUT，沒有 DELETE。925 初始八種範本都不授予公開權限。

名稱完全符合優先，其次明示 alias；大小寫／NFKC 正規化後多重匹配不挑任一。模糊名稱只提示人工檢查。管理者可編輯別名、模式、Unicode CUSTOM 前後碼／位置／符號、啟用及公共顯示「建議」。示例只用固定合成字串。

Dataset 必須明確套用至草稿並另按保存；保存時同交易驗證範本仍啟用、revision 及模式／CUSTOM 一致，記錄 TemplateUse 與原本敏感政策稽核。修改全域範本不回寫任何 Dataset／公共確認。引用清單區分 CURRENT／NEEDS_RECONFIRMATION／HISTORICAL／DELETED_DATASET；停用／修訂只提示重審，不自動刪舊規則。TemplateUse 無 Dataset FK，保留刪除後歷史且不改既有 Dataset 刪除契約；Template FK 阻止移除被引用範本。無 UI／API 可刪範本。

## 925 與既有 Schema

獨立 SQL：`tools/sqlserver-acceptance/drafts/925/925_dataset_display_policy.sql`，不在 `database/migrations`，一般 db:migrate 不會安裝。001～924 不修改，不建立假 922，不寫 SchemaMigration。925 不依賴 922；最低依賴既有 Dataset／DataSource 920/921、910/912、AuditLog。

三表：DatasetPublicDisplayPolicy（版本綁定、確認及精確 Audit reference）、DatasetMaskTemplate（唯一名、JSON、CHECK、ROWVERSION）、DatasetMaskTemplateUse（append application history、查詢索引）。Catalog 預檢核對欄位型別／nullable／identity／BIN2、PK／UQ／索引順序／方向／INCLUDE／叢集型態、FK 行為／trust／NFR、CHECK／DEFAULT（含綁定欄位）、額外欄位／索引／trigger。缺乏可見性、部分安裝或同名異形皆拒絕；完整一致可重入，不重 seed 或核准歷史 Dataset。

舊 Schema：Dataset／Query／Excel 遮蔽及 Designer Preview 可沿用；新增管理不可用、公開播放缺有效 925 確認即拒絕，不能 fallback 舊 JSON。這是部署前必須處理的相容性門檻，不得把程式直接覆蓋到仍在公共播放的共用環境。

## 驗證邊界

Server／HTTP 測試含 CAS、重放／碰撞、精確 Audit、權限撤銷、未確認／負向授權、四模式、參數、稽核與 commit 失敗。舊 JSON 測試用新版「不能取代 Dataset 政策」斷言取代，保留資料遮蔽、ACL、快照及稽核測試，沒有刪除失敗測試。E2E 覆蓋 Dataset 公共政策、衝突保留、範本手動建議／保存、停用及 Dashboard 不重複設定。

隔離 SQL2019 CI 使用完整正式 001～921＋923/924，新增 925 空業務基底 round-trip／rollback、升級、重入、部分／異形拒絕、Catalog 變異、受限帳號、雙連線 CAS、精確 Audit >2^53、稽核拒絕 rollback、政策／來源／Token 失效及範本歷史不改 Dataset。Windows 僅語法／離線 guard 驗證。實際 CI 結果以提交的 workflow 為準；Mock 不是 DB rollback 證明。

OR_001／EXAM_DATE 以合成設定測試既有 saved parameter 型別／日期格式傳遞，不硬編碼民國或西元。真實 OR_001、Oracle11g Thick client、中文欄位及共用 SQL Server 資料列結果仍待最後由使用者在授權環境驗收；本次沒有 HIS 連線或修改。
