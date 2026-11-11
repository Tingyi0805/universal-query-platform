# 一般使用者 Query 執行：患者清單曝光稽核

本 PR 在 `POST /api/queries/:id/execute` 接入 `auditPatientListIfConfigured`，維持原有 JWT、EXECUTE_QUERY 及 query.canExecute 檢查。

啟用患者稽核的 Dataset：
1. 執行查詢，取得實際 `result.rows`。
2. 依資料來源 ID 設定 HMAC source scope，從 JWT 取得使用者身分。
3. 在回傳 JSON 前 await 曝光稽核交易成功；缺少患者欄位、金鑰或資料庫失敗時，不提供患者結果。
4. 成功回傳時附上 `disclosureId`，並標記 `Cache-Control: no-store`。

此事件只表示清單資料已提供，不等於使用者逐筆閱讀或開啟詳細病歷。

**尚未完成**：CSV/Excel 匯出需另外記錄匯出行為與患者關聯，Dashboard 及自動刷新仍需接入；查詢參數目前原有 QUERY_EXECUTE Audit 會寫入參數，應另行審查是否含患者敏感資訊；需在 SQL Server 實測 Migration 906–908、交易 rollback、重複患者、空值、權限與效能。患者識別欄位與金鑰必須由管理員正確設定。
