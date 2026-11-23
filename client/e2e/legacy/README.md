# Dataset 簡化改版：舊 UI 瀏覽器測試存檔

2026-11-23，針對 PR #101 Dataset「使用／播放管理者核准」UI 改版。

原先患者揭露設定、敏感欄位儲存與逐欄公共播放政策等 UI 已依需求自 Dataset 設計頁移除。原來在 Playwright 中操作這些按鈕的測試不再適用，但保留完整原始內容供追蹤；不會修改後端安全驗證。

舊表單 E2E 已原封不動存於 `client/e2e/legacy/*.legacy.ts`（非 Playwright `*.spec.ts`），供日後對照。
管理者遮蔽範本原測試仍透過 `dataset-mask-template.spec.ts` 執行。
`dataset-preview-safety.spec.ts` 持續驗證預覽必須有已確認政策、錯誤拒絕、版本與候選欄位不可交付。
`dataset-management-approval.spec.ts` 新增 9 項合成互動案例：未核准預設、使用／播放核准撤銷、權限不足、SQL 未儲存、版本衝突、政策不安全。

新 UI 測試採合成 API mock，不取代 Server 原有 masking/patient-audit/disclosure/CAS/版本與真實 SQL 權限驗證。PR99 CHART Gate 不解除、PR100 分層查詢安全測試照舊。SQL2019 CHART928 分開核對，不藉刪除測試處理。
此修改尚未部署 `C:\UQP`，且不含額外 SQL migration。