# Dashboard Slice 3A-1（設計，尚未啟用）

基準 e566998；917 僅建立，未執行。未改 API、Query 執行、前端、916 或播放流程。

## 模型與相容性

| 來源 | 穩定識別 | Query 與參數 | 設定 |
| --- | --- | --- | --- |
| 主來源 | `(Dashboard.Id, PRIMARY)`，虛擬、不新增來源列 | 原 `Dashboard.QueryDefinitionId`、`ParametersJson` | 原設定保留；新增 nullable `QuerySourceMaxRows` |
| 額外來源 | 原 `(DashboardId, SourceKey)` 與 `Id` | 新增 nullable `QueryDefinitionId`；原 `ParametersJson` | 原設定不變；新增 nullable `MaxRows`、`QueryBindingRevision`（初值 0） |

`QueryBindingState` 是非持久化計算欄位：未綁定為 `PENDING_CONVERSION`，已綁定為 `QUERY_BOUND`。後者只表示 FK 綁定，**不表示已發布、已授權或可執行**。每次使用仍須驗證 Query 發布／啟用／封存狀態、既有 Query ACL、使用者或裝置委派者有效性、必要參數、Dataset／實體來源有效性、遮蔽與稽核。不得由前端決定遮蔽。

917 不更新或刪除任何既有列，不寫入 Query／RBAC／稽核資料，不猜測映射。所有額外來源原始 `DatasetId`、SourceKey、Id、參數、時間戳與元件 JSON 均保留，初始全部待轉換；即使只有一個候選 Query，也不自動授權。後續明確轉換操作須由有權限的操作者確認已發布且可執行的 Query；候選檢查必須基於原 DatasetId，歧義或無有效候選時維持待轉換。改用其他 Query 應作為獨立、可稽核的重新綁定，而非自動遷移。

Query-only 模式執行資料集由 `QueryDefinition.DatasetId` 推導，原來源 `DatasetId` 保留作歷史欄位，絕不作執行 fallback。新來源仍須填入當時 Query 的 DatasetId 以相容既有 NOT NULL FK。Query 之後換 Dataset 時，執行端須重新驗證參數、遮蔽與快照，不能沿用歷史 DatasetId。不得新增 SQL 欄位或直接 Dataset 選擇介面。

## 容量、交易與 SourceKey（下一階段實作規格）

新配置最多 **8 個，含 PRIMARY；即最多 7 個額外來源**，停用與待轉換來源也計數。既有 8 個額外來源的 Dashboard 保留全部資料，標示 `OVER_CAPACITY`，禁止新增／進入 Query-only 模式；由管理者先重配元件並明確移除來源，不自動選擇保留對象。PRIMARY 衝突、大小寫碰撞或無效舊 SourceKey 同樣只讀待人工處理，不改名。

修改來源需 SERIALIZABLE 交易，先以 UPDLOCK/HOLDLOCK 鎖 Dashboard 列（版面儲存也必須採相同鎖順序），再鎖來源及全部 profile/widget。差異更新：同 key 保留 Id，只 UPDATE 被修改的設定；新增只 INSERT 新列；移除只 DELETE 明確列，且任何 profile 的 FIELD/TABLE `ConfigJson.dataSourceKey` 仍引用該 key 時拒絕。未指定 key 視為 PRIMARY；比較採大小寫一致規則，但不改寫保存字串。SourceKey 不提供重新命名操作。不得整批 DELETE／INSERT，也不得默默把元件改指向其他來源。

交易內重查容量、發布／權限／必要參數與預期 revision，額外來源更新時 revision +1；失敗整筆回滾。主來源使用原 Dashboard 的 UpdatedAtUtc 作併發版本，快照繼續包含完整主設定。版面寫入必須拒絕未知 SourceKey。主來源暫保留原儲存欄位，統一 API 以虛擬來源投影 PRIMARY，避免兩份可變主設定。主來源 MaxRows 對應新 `Dashboard.QuerySourceMaxRows`，1–10000；NULL 在後續新模式採伺服器預設 1000，不能借用 pageSize 作總量上限。額外 Query 綁定要求 MaxRows 為 1–10000；NULL 僅代表舊來源尚未轉換。

## API、快照與上線順序

917 本身不改既有 SELECT 列表或 JSON 映射，舊 API／播放器繼續原行為；**這個相容階段尚非 Query-only 安全完成版**。後續須加入版本化契約或能力旗標：舊來源可讀、待轉換不可經新 Query-only 端點執行；保留既有主來源 API，舊 Dataset-only 寫入在啟用新模式時明確拒絕。禁止新舊寫入者混用；舊整批替換 API 在切換前必須關閉，否則會丟失新欄位與 Id。

Snapshot 是 process-local Map，不是 SQL 表；917 不接觸快照、fingerprint 或裝置 Token。無應用重啟的純 DDL 不改目前快照；應用部署／重啟會自然失去快照，無法保證跨重啟保留患者列，也不應把列持久化來解決。舊主 snapshot.queryId 是 Query Id，額外目前卻是來源 Id：新契約需明確分開 Query Id／Source Id／SourceKey，fingerprint 加 binding revision、Query ACL revision 與模式版本。切換時只使相關來源舊快照安全過期，不能把舊 queryId 猜成新 Query Id，亦不能返回其他來源資料。

1. 操作者於隔離 SQL Server 2019 測試副本檢查 005/020/913/914 等既有物件、916 狀態、SchemaMigration 紀錄、權限、鎖定與維護時間；不可重跑 001–916。此階段不要求執行 916。
2. 只讀盤點：總來源數（+PRIMARY）、key 衝突／元件孤兒引用、候選 Query 有效性與 ACL、待轉換數。不要輸出 SQL、參數值、患者列或憑證。
3. 保留備份與 Schema 定義，在正式批准的維護流程單獨套用 917；DDL 需要 schema modification lock，設定外部 lock timeout，錯誤停止，不自動重試。腳本單交易、XACT_ABORT，無 GO 分批提交。
4. 部署後續具新契約但預設關閉的 API；完成隔離／安全回歸，停止舊寫入者後逐看板明確轉換。確認所有來源有效且容量合規才啟用 Query-only；單一 Query 撤權必須只阻止該來源，裝置憑證失效仍整體拒絕。

## 回滾與不相容情況

DDL 任一錯誤整個 transaction 回滾。腳本拒絕既有／部分新欄位，不自動修復或覆寫；現有 runner 有外層 transaction，917 的內層 COMMIT 不會提前提交，DDL 與 SchemaMigration 紀錄一起提交或回滾。若有人在 runner 外單獨執行 DDL，須由操作者驗證全部欄位、計算式、FK/check 的 enabled/trusted 狀態與 default，再依批准流程處理紀錄，不重跑或盲目 adopt。應用回退時保留 additive 欄位、停用新模式並禁止舊來源寫入；不自動刪欄位或回退已轉換 Query 到歷史 Dataset。若需移除 Schema，另行備份新綁定／revision／limits，確認無依賴後走批准流程，本次不提供自動破壞性 down migration。

尚待隔離 SQL Server 真實編譯、交易故障、鎖競爭及 runner 記錄驗證；靜態／Mock 測試不構成 SQL Server 驗收。來源 CRUD、8 個限制、RBAC、Query 執行、錯誤隔離與 UI 都是下一階段工作，本次沒有啟用。
