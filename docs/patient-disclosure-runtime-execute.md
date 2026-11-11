# 一般使用者查詢患者清單曝光稽核

本次將 `POST /api/v1/queries/:id/execute`（實際路由掛載位置以主路由為準）接到 `auditPatientListIfConfigured`，使用 JWT 使用者身分、已授權 QueryDefinition、Dataset 和平台 DataSource ID。僅在 DatasetPatientAuditConfig.IsEnabled=1 時，才寫入實際回傳 rows 的患者識別碼 HMAC；稽核寫入失敗將阻擋患者資料正常回傳。查詢原本的 QUERY_EXECUTE audit event 仍保留。

目前此 PR **只涵蓋一般使用者執行查詢的 JSON 回應**。CSV/Excel 匯出、其他預覽路徑、儀表板及自動更新仍須另外整合。未啟用患者稽核的 Dataset 不會寫入患者曝光事件。若要強制所有患者資料集啟用稽核，還需要明確的資料分類與政策控制。

待辦：補充 SQL Server 真實交易整合測試、資料集患者欄位驗證、稽核紀錄和 QUERY_EXECUTE AuditLogId 關聯、遮蔽狀態判定，以及金鑰管理實際部署。現有功能不代表已可正式上線處理敏感醫療資料。
