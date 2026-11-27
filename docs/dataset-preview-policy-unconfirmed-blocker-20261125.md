# Dataset PR101：預覽政策未確認／欄位候選描述阻斷

## 實機驗收紀錄（2026-11-25）
- 「Dataset 使用與播放核准」GET 已正常；使用核准／停止使用均已實測顯示成功。
- 新增 Dataset 的欄位候選探索曾回傳 `DATASET_COLUMN_DESCRIPTION_FAILED`，Request ID: `78261022-9e94-421d-8d47-829f435616f2`（在新 Dataset 使用核准前的操作，尚無伺服器日誌歸因）。
- 「執行預覽」回傳 `DATASET_DELIVERY_POLICY_UNCONFIRMED`，Request ID: `2443e06e-f45d-4ccf-9b84-14ef9a907424`。
- 目前 UI 已移除「Dataset 敏感資料欄位管理」表單，但資料預覽依舊要求一份由 Server 可信儲存的 `uqp.DatasetSensitivePolicyVersion` 確認版本。這屬於未完成的整合流程，不是登入／權限錯誤，也不代表 Migration 929 未安裝。

## 現有規則／不得弱化
- `readConfirmedDatasetDeliverySnapshot` 在沒有確認版本時必須拒絕資料預覽及實際資料交付；單純管理者核准使用、Query Published 或 UI 對話框都不可代替敏感欄位確認。
- 已確認的空政策 **不代表** SQL 一定沒有敏感或患者資料；無可信分類證據時不能自動建立空政策來放行。
- 欄位候選描述是 `UNBOUND_CANDIDATE`，不能當作可信敏感分類、患者 HMAC/揭露稽核或 SOURCE_BOUND 證據。
- 停用的測試 Dataset 不應取得任何資料列。公共播放政策需要獨立審核，不能從使用核准推導。

## 針對現況的最少修正（待實作）
1. 提供與「Dataset 使用與播放核准」同頁的**精簡安全審查入口**，明確顯示可信欄位是否已初始化、遮蔽/患者稽核條件是否完成；若系統尚無安全證據，顯示不可預覽／播放與具體阻斷原因。
2. 欄位安全初始化需基於來源與 SQL 版本綁定的可驗證 metadata、完整分類審查、管理者確認與不可變稽核；患者資料另須可靠識別、遮蔽、揭露稽核及版本失效檢查。不得透過空政策／預設 `NONE`／僅勾選「非患者」來繞過。
3. 修正欄位候選描述的實機 `DATASET_COLUMN_DESCRIPTION_FAILED`：利用 Request ID 對照 Server 安全日誌／稽核錯誤碼，分辨 metadata describe、Source 和 Audit 失敗；避免擅自增加 DB Migration。
4. 補上管理者核准、未完成安全初始化、患者欄位、來源異動、撤銷和 Audit 失敗的最少受影響案例，再交付修正版測試包。復用已通過的 PR99/PR100 基礎 CI，不新增部署環境。

## 這次已完成而非放行
已更新前後端錯誤說明與 Regression，避免再指向已刪除的「敏感資料欄位管理」表單，並明確區分**使用授權**與**可預覽資料的安全審查**。**這次不包含安全初始化 API；資料預覽仍會拒絕未確認政策，尚未通過此項實機驗收。**
