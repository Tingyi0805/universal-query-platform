# Dataset 舊版畫面 E2E 歷史資料

因 Dataset 原有的「患者揭露稽核設定」、「敏感資料欄位管理」表單已由管理者核准 UI 替換，此目錄以 `.spec.ts.txt` 逐字保留舊 Playwright 案例，不再編譯或執行舊 UI 操作。

新畫面由 `client/e2e/dataset-management-approval.spec.ts`、`dataset-preview-safety.spec.ts` 與 `dataset-mask-template.spec.ts` 驗證。舊 Server 安全及資料交付測試未移除。