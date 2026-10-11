# Dataset 執行 API：患者清單曝光稽核接線

本次將 `POST /api/v1/datasets/:id/execute` 接到 `auditPatientListIfConfigured`。若 Dataset 啟用患者稽核，會在傳送 JSON 前，以該次真正回傳的 `result.rows` 寫入患者清單曝光紀錄；資料庫寫入、金鑰解析或患者識別欄位驗證失敗時，該路由不會送出結果。回應附帶 `disclosureId`（未啟用時為 null），並設置 `Cache-Control: no-store`。

注意：此路由目前是設計者用的 Dataset 執行 API（DESIGN_QUERY 權限），**並非所有一般使用者查詢入口**。其他查詢、報表匯出、儀表板、預覽及自動刷新尚未接入，不能宣稱已全面涵蓋患者清單。來源 scope 目前使用平台 DataSource ID，後續應評估跨環境識別穩定性。

正式上線前仍需完成：
- 以整合測試確認 SQL Server Migration 906–908 與 transaction 相容。
- 明確定義稽核事件與一般查詢執行紀錄的關聯、身分與裝置來源。
- 患者識別欄位的正確性檢查，且不讓一般使用者自行停用稽核。
- 覆蓋所有會回傳患者資料的正式查詢路由、匯出、儀表板與快取路徑。
- 驗證失敗回應絕不夾帶患者資料；注意伺服器 log 亦不可記錄 rows。
