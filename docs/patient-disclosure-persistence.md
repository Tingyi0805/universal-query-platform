# 患者清單曝光稽核持久化服務

`auditPatientListIfConfigured` 依 DatasetPatientAuditConfig 判斷是否啟用患者曝光稽核；啟用時解析受保護的 HMAC keyring，再透過單一 SQL Server transaction 寫入清單主事件及每位患者的雜湊識別碼。寫入失敗會拋出例外，**呼叫端必須在傳送資料給瀏覽器之前 await**，不可 catch 後忽略。

此 PR **僅完成可供查詢端呼叫的後端服務**，尚未修改實際查詢路由，因此目前仍不能宣稱每次患者清單已被自動記錄。

下一階段必須：
1. 在正式查詢回應路徑上確認 Dataset 與 DataSource scope，傳入實際回傳分頁的 rows。
2. 從已驗證的 JWT/Session 取得使用者與工作站 ID，不接受前端任意宣稱身分。
3. 檢查管理員設定的患者欄位是否在查詢結果中；缺少或空值應阻擋該次資料提供。
4. 稽核交易提交成功後才能回傳患者資料，並測試資料庫斷線、HMAC 金鑰遺失、同一清單多位患者、分頁、遮蔽與自動更新。
5. 對大量患者清單需考慮 SQL TVP/bulk insert，避免逐筆 SQL 造成延遲。
6. 曝光紀錄只代表資料已回傳，並不證明使用者實際閱讀每位患者。
