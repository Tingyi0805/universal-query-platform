# 患者稽核 HMAC 金鑰輪替

使用受控部署秘密設定（非資料庫）提供：

- `PATIENT_AUDIT_ACTIVE_KEY_VERSION=2`
- `PATIENT_AUDIT_HMAC_KEYRING_JSON={"1":"<base64 32+ bytes>","2":"<base64 32+ bytes>"}`

上述為格式範例，實際金鑰不可寫入 Git、log、前端或資料庫。新增稽核記錄僅使用 active version；歷史患者查詢需針對所有保留版本分別計算摘要，搭配 KeyVersion 搜尋。

輪替順序：先部署包含新舊版本的 keyring，確認可讀取舊資料，再切換 active version；依資料保存期限與稽核政策，決定何時退役舊金鑰。遺失舊金鑰將無法以病歷號重新計算舊紀錄的 HMAC。

Migration 908 增加 KeyVersion，舊紀錄預設版本 1；正式環境必須確認歷史資料原本的金鑰版本確實為 1。現階段仍未接入患者查詢結果、也沒有自動記錄曝光。上線前必須實作金鑰安全儲存、欄位驗證、fail-closed 稽核寫入及整合測試。
