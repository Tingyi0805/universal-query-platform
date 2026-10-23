# BUG-001：Dataset Designer 預覽

基準：PR #66 `1ac8bafe300114a9539703d704e3e6af62d5b13b`。僅用合成資料、Mock API／Repository 與瀏覽器攔截；未連使用者 DB，未讀取所提供 Request ID 的正式稽核紀錄。以下結論來自程式及測試。

## 根因

- 未儲存：patientAuditPreview 拒絕 candidate SQL，屬預期限制。
- 已儲存：前端漏傳 expectedDefinitionVersion，RAW_DESIGN 必定失敗。補版本後，新建 Dataset 仍缺確認的敏感政策與患者稽核。
- 初始空政策：沒有 dirty，無法儲存確認。
- 患者初始化循環：患者設定依賴可信 metadata，但目前 preview 不建立 metadata；描述 Adapter 僅提供 UNBOUND_CANDIDATE，不得自動升級。
- 後端所有檢查用同一句錯誤；save API trim SQL，前端卻保留未 trim SQL，也會精確比對失敗。

## 修正與界線

- 未儲存或 SQL／來源尚未儲存時，前端直接提示先儲存。save 後同步 trim SQL；每次從既有 context 取得精確定義版本並傳給 preview。執行中編輯內容變動則捨棄結果。
- 初始 version=0 的空政策，需人工勾選才可透過既有 sensitive-columns PUT 儲存；不自動儲存，不與基本 Dataset save 合併。CAS、稽核及 Dashboard 清空限制不變。
- 新增限 Designer 的 NON_PATIENT_DESIGN，必須明示 nonPatientConfirmed:true。具 DESIGN_QUERY + EXECUTE_QUERY 權限的人員須與資料負責人確認當次已儲存定義不含患者／敏感資料。這是人工業務聲明，**不是自動偵測或可信分類證明**；每次重新確認，不寫入患者稽核停用設定。
- 後端要求已確認空政策、完全無患者配置（停用也拒絕）、patientAuditVersion=0、無患者識別或 audit-only 欄位。沿用 STANDARD 政策輸出。原 SQL／來源 ID／版本、權限、參數、來源 fingerprint 與各階段重驗保留；變動即拒絕。
- Operation audit 記錄 purpose、人工聲明與 definition／sensitivity／patient 版本，不包含 SQL／參數值；audit 與最終重驗成功前不回傳資料。已有患者設定或敏感規則不能使用普通模式。
- RAW_DESIGN 的可信 metadata、識別欄位、HMAC、揭露稽核要求不變；既有已確認患者 Dataset 繼續走原路徑。固定去敏錯誤指引保留 code／Request ID。

## 最短重新測試

僅用已確認無患者／敏感資料的測試 SQL：

1. 儲存 Dataset。
2. 下方敏感欄位管理勾選「明確確認空政策」，按「儲存 Dataset 敏感欄位規則」。已有規則時先檢查，不可為了預覽刪除保護。
3. 勾選本次普通資料確認，按「執行預覽」；下一次需再確認。
4. 修改 SQL／來源未儲存、版本衝突、權限不足、未確認政策、稽核或來源失敗應拒絕。
5. 患者 Dataset 不勾普通確認；既有可信設定完成者使用原預覽。新患者 Dataset 缺 metadata 時停止，另案安排可信初始化。

## 驗證與阻擋

執行 Server 針對性／全量測試、Server／Client typecheck／build、Client 單元測試及完整 Playwright。前端 API 均攔截；Server 使用 Mock 與禁止資料庫外連的測試 guard。本機 Server 全量 1,453／1,453、針對性 78／78；Client 單元 37／37、完整 Playwright 116／116，雙端 typecheck／build 通過。GitHub CI 結果見交付回報。

**部分完成／BLOCKED**：新患者 Dataset 的可信 metadata 初始化，以及新增敏感欄位所需 DatasetColumn 安全初始化，尚無可證明安全的入口（目前不再 sync）。本次沒有以候選描述、普通聲明或停用稽核替代。未驗證真實 SQL Server 鎖、持久性或 source generation／lease；正式 Native Runtime 保持 BLOCKED。未修改 Migration、JWT_SECRET、患者稽核、遮蔽或 Dashboard guards；未連 DB、部署或 Merge。
