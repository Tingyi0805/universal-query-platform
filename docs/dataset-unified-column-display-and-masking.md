# Dataset 統一欄位顯示與遮蔽

本次沿用 `DatasetSensitiveColumn`、`CustomMaskJson`、政策版本、既有 DESIGN_QUERY 與交付授權。沒有新增 Migration、分類、Owner／Reviewer 流程、Source Fence 或 Runtime 功能，沒有操作使用者資料庫。

## 使用及儲存

已儲存 Dataset 的「敏感資料欄位管理」可從現有 `DatasetColumn` 清單或既有規則選欄。清單僅為編輯選項；PUT 仍於原有 SERIALIZABLE 交易內驗證已儲存欄位、政策版本並寫入異動稽核。GET 的 `availableColumns` 不執行來源 SQL、不含資料列，不構成新的可信 metadata 發證。

| 使用者選擇 | 既有儲存格式 | 傳送結果 |
| --- | --- | --- |
| 顯示原始資料 | `DeviceMaskMode=NONE`、`SensitivityType=OTHER` | 通過既有授權及必要稽核後傳原值 |
| 自訂遮蔽 | `CUSTOM`、`CustomMaskJson` | 只傳遮蔽結果 |
| 全部遮蔽 | `FULL` | 非 null 值固定 `○○○○` |
| 完全不傳送 | `OMIT` | 不傳欄位名稱、值及相關交付 metadata |
| 未明確設定／移除規則 | 無規則 | 不傳送；空政策也不授予原值 |

選擇「原始資料」是使用者明示的變更：依 910 既有 CHECK，該列敏感標記改為 OTHER；介面事先說明，原交易稽核保留前後差異。其他模式保留既有標記。不依名稱或內容推定分類。既有 NAME／MRN／PHONE／GENERIC 規則僅按已儲存的明示模式相容執行，沒有自動選取這些模式。

自訂設定原格式 `{prefix,suffix,symbol}` 不變，前後字數 0～100。指定位置額外使用 `{prefix:0,suffix:0,symbol,start,end}`；位置按 Unicode code point 從 1 起，含結束位置，1～10000，不與前後保留混用。結束超出資料長度僅遮至字尾；起點超出長度時全遮。符號限單一 Unicode 字元、拒絕換行／tab，拒絕未知設定；原有 NVARCHAR(256) 與 912 CHECK 可容納此格式，未修改 Schema。

「儲存 Dataset 敏感欄位規則」獨立儲存本區，基本 Dataset 儲存不代替政策儲存。版本衝突保留草稿，須重新載入；清空啟用 Dashboard 的既有限制仍保留。

## Query／Dashboard／預覽共用

- Query 執行、CSV／Excel 交付及 Dataset 設計器預覽使用 `applyDatasetDeliveryPolicy()`；移除設計器 `RAW_DESIGN` 的遮蔽豁免，原版本、授權及患者稽核前提不變。
- Dashboard 所有既有預覽／Legacy 裝置／managed Query-only 路徑經 `resolveDashboardDisclosureMasks()`、`maskDeviceRows()`，與 Query 使用相同 Dataset 模式及 `maskDeviceValue()`／`maskCustomValue()`。沒有把 raw rows 交給前端再遮蔽。
- Dashboard **既有每來源欄位傳送授權**仍是必要 Gate；不是 Dataset 規則自動授權裝置。新介面只提供「沿用 Dataset」與「不傳送」，兩個寫入 API 也拒絕新增獨立遮蔽。完整替換時可原樣保留未修改的歷史列。
- 已核准 INHERIT 的欄位會隨 Dataset 政策更新，不需複製規則或自訂設定。快照 fingerprint 包含政策版本；既有頁面快照在政策變動後拒絕使用，重新取頁才套用新規則。
- 歷史獨立 Dashboard 遮蔽若與當前 Dataset 結果不相容，停止傳送該欄位，不默默放寬舊保護。管理者可經既有停用、CAS、ACL 及稽核流程明確改為 INHERIT；不自動修改歷史 JSON。

## 保留的具體阻擋及最小處理

| Gate／程式 | 原因與處理 |
| --- | --- |
| `datasetSensitiveColumn.repository.ts:replaceDatasetSensitiveColumns` | 新 Dataset 現可使用 metadata-only 欄位選項同步後設定規則，詳見 [欄位同步](dataset-new-column-options-sync.md)。這不升級為患者／Native 可信證據。 |
| `datasetDataDelivery.ts:open` 的 RAW_DESIGN | 未設定或未確認患者稽核仍拒絕 Designer 預覽。普通 Dataset 的新初始化途徑本次未解除；不以空政策取代證據，不擴充分類流程。 |
| `dashboardQuerySourceExecution.ts:page`／`dashboardDevicePage.routes.ts`／`dashboardPreview.routes.ts` | 有資料列但必要揭露稽核未回傳有效紀錄時，仍停止交付；顯示規則不代替稽核設定，普通資料也不以使用者聲明跳過這些既有 Gate。 |
| `datasetDeliveryPolicy.ts:validatePolicy` 的 patientAuditOnlyColumns | 既有稽核專用鍵仍必須 OMIT；不能藉四模式將它傳到前端。驗收用 MRN 與內部 AUDIT_ID 分欄。若需將同一稽核專用鍵改為 FULL，最小提案須另審原 audit-only 契約，而非本次刪掉檢查。 |
| `dashboardDeviceMasking.ts:resolveDashboardDisclosureMasks`／`enforceClassifiedDeviceMasks` | 不自動授權未核准來源／欄位、不清除舊分類限制。歷史分類拒絕 raw 或歷史更強保護時，無法保證該欄位立即與 Query 同時顯示。最小方案是既有管理者明確重新核准／審查歷史分類；本次不批次清除。 |

可驗收欄位規則設定及「有效政策、Dashboard 已具 INHERIT 授權、必要稽核已就緒」的交付；新 Dataset 欄位選項已可同步，但患者稽核專用鍵揭露及來源可信發證並未解鎖。

## 回歸驗證及重測

新增合成整合測試以**同一份可變 Dataset 政策**驅動真正 Query 與 Dashboard delivery service：NAME 自訂、PHONE raw、MRN FULL、HIDDEN OMIT、AUDIT_ID 僅後端、未知新欄位拒絕；更新政策無須修改兩者設定。另驗證未授權、稽核失敗、Unicode 位置、非法範圍、既有快照失效、API 不接受新獨立 Dashboard mask。HTTP 既有套件繼續測 JWT／TokenVersion／ACL／版本／稽核失敗；瀏覽器測四模式保存、重載、明示 raw、指定位置與 Dashboard 授權保留。

操作：選擇已有已同步欄位的 Dataset → 分別設定四模式 → 儲存本區 → 使用既有授權 Query 與已核准 INHERIT 的 Dashboard 重取資料 → 再改 Dataset 規則並重新取頁。用無權限帳號確認拒絕。全部範例使用合成資料；Mock／瀏覽器結果不代表實際 SQL Server 驗收。

正式 Native Runtime、SOURCE_BOUND、SQL_LOCK_VERIFIED 與新 Dataset 初始化的既有阻擋保持不變。
