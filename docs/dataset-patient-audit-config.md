# 患者稽核識別欄位設定（Migration 907）

設計者以 DESIGN_QUERY 權限管理每個 Dataset 的患者識別欄位，不自動猜測欄位名稱。

- GET /api/v1/datasets/:id/patient-audit-config：讀取設定。
- PUT /api/v1/datasets/:id/patient-audit-config：送出 `{ "isEnabled": true, "patientKeyColumn": "PATIENT_ID" }`。

**重要**：目前這是設定資料表與 API 基礎，尚未連結實際患者查詢回應，且尚未驗證欄位是否真實存在於資料集結果。啟用設定不代表已開始追蹤患者清單。

正式整合前，需檢查資料集實際回傳欄位、統一病患識別碼來源、提供 HMAC 金鑰輪替策略、對稽核寫入失敗採 fail-closed，並在查詢分頁實際回傳時記錄清單曝光。

患者識別欄位請使用內部穩定識別碼，避免以姓名作為唯一識別。
