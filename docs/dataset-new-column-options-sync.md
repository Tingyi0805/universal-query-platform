# 新 Dataset 欄位選項同步

## 根因與最小修正

Dataset 儲存只寫定義；`syncDatasetColumns()` 原先沒有呼叫端。規則 PUT 又要求欄名存在於 `DatasetColumn`，因此新 Dataset 雖能取得候選描述，卻無法選欄保存規則。

現在在既有規則編輯器提供「取得並同步欄位清單」：呼叫 `POST /datasets/:id/columns/sync`，以**伺服器已儲存 SQL**取得 metadata，沿用 `syncDatasetColumns()` 寫入既有 `DatasetColumn`。不接受 caller 提供 SQL、欄位或可信狀態，不新增 Schema、分類或簽核。

`DatasetColumn` 在本流程只代表可編輯的欄位選項。實際使用點為規則欄名檢查及 ReportColumn 顯示欄位；患者稽核使用獨立的 `DatasetPatientAuditMetadata`。本流程不寫該表、923 Snapshot／Decision／Confirmation，也不建立任何遮蔽規則。不能將這個清單當作來源 DDL 未漂移、Native Type 確認或患者識別證據。

## 支援及安全邊界

- 已儲存、啟用、未封存 Dataset；支援單一唯讀 SELECT／WITH、已同步的標量參數。MULTISELECT 缺少固定 arity 契約時明確拒絕，不猜測展開長度。
- SQL Server 先以 `sp_describe_undeclared_parameters` 取得標量宣告，僅接受封閉的內建型別，再呼叫 `sp_describe_first_result_set`；不傳實際值／預設值。Oracle 以 `getStatementInfo()` 驗證命名 bind 集合，保留既有 6.8+ driver、thin／thick、client／server 相容性檢查。這是欄位選項描述；可信 Typed Bind 的 Oracle 參數拒絕規則不變。其他來源明確拒絕，不以 executeQuery／零筆查詢補救。
- 檢查欄名、順序、重複別名、型別與儲存長度。輸出不含資料列、SQL、憑證；維持 `UNBOUND_CANDIDATE`、`DISPLAY_COLUMN_OPTIONS_ONLY`、`deliveryAllowed=false`。
- 保留 JWT、DESIGN_QUERY＋EXECUTE_QUERY、即時 TokenVersion／權限重驗。描述嘗試先寫必要稽核，稽核無法完成即不進行同步。
- 同步使用 owned SERIALIZABLE、XACT_ABORT，交易內檢查 DefinitionRowVersion、DataSource ConfigurationRowVersion／綁定、啟用狀態、完整已儲存參數 fingerprint，並再次驗證授權；欄位與成功異動稽核同交易提交。欄位、版本或稽核失敗均拒絕／rollback；commit 結果不明不回報成功，應重載確認。
- 既有規則所用別名若將消失，整筆拒絕，不刪規則。同步不改既有遮蔽、Query、Dashboard、Excel 設定。未明確設定的結果欄位仍不傳送。
- 平台 rowversion／鎖只能保護平台定義，不能證明外部來源 DDL 穩定；未新增 Fence 或 SOURCE_BOUND／SQL_LOCK_VERIFIED 能力。

## 操作

1. 建立 Dataset，選擇 SQL Server／Oracle 來源，儲存 SELECT SQL；有標量參數時先同步及儲存參數定義。
2. 到「Dataset 敏感資料欄位管理」按「取得並同步欄位清單」。不會自動執行資料列預覽，也不會自動判定敏感性。
3. 逐欄選擇原始值／自訂／全遮蔽／不傳送，按既有「儲存 Dataset 敏感欄位規則」。未儲存規則時禁用同步，避免丟失草稿。
4. 重新開啟 Dataset，欄位來自已保存 DatasetColumn，規則來自 DatasetSensitiveColumn，無須再次描述。SQL／來源尚未儲存或缺權限時禁用同步；不相容參數、別名或版本衝突顯示具體原因。

已授權且必要稽核已就緒的 Query／Dashboard／Excel 繼續使用同一份 Dataset 政策；Dashboard 現有傳送授權仍保留，不需複製遮蔽設定。

普通 Dataset 在明確儲存政策、通過權限及版本重驗後可預覽。未確認政策仍拒絕資料交付；已啟用患者稽核時仍須完整識別／HMAC／揭露稽核；`patientAuditOnlyColumns` 的 OMIT 限制與 Dashboard 必要保護不變。修正循環及空政策的細節見 [循環阻擋修復](dataset-column-policy-cycle-fix.md)。

## 驗證範圍

離線測試涵蓋 SQL Server／Oracle 描述契約、錯誤別名／順序、首次同步與重複同步、版本／參數漂移、既有規則保留、權限撤銷、插入／稽核／commit／rollback 失敗。API 測試驗證不接受偽造欄位、不執行資料列 SQL。瀏覽器以新建立的 SQL Server／Oracle 合成 Dataset 驗證儲存 SQL → 同步 → 四模式 → 重開，以及同步失敗時保留規則。

既有隔離 SQL Server 2019 full-schema CI 額外驗證受限帳號寫入 DatasetColumn、順序、Audit INSERT 被拒時真正 rollback、DefinitionRowVersion 衝突，並確認未新增政策、患者或 Native 證據。新增案例使用真正 metadata RPC 描述帶標量參數、零資料列的合成 SELECT，並測試參數漂移；並非 Oracle 實機驗收或 Source Fence 驗收。現有統一遮蔽整合測試繼續驗證同 Dataset 的 Query／Dashboard 一致結果；既有 CSV／Excel 回歸保留。

不操作使用者資料庫、不改 `.env`／JWT，不新增 Migration。
