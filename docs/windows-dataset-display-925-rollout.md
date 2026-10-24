# Windows ZIP 更新、925 及回復

**不是現在對線上共用資料庫執行的指示。** PR #66 保持 Draft。下載來源 ZIP 可由該 commit 的 GitHub archive 取得；包含 Server／Client 原始碼、專用工具與文件，不含 node_modules、實際 `.env`、帳密或患者資料。先在獨立 SQL Server2019／Windows11 副本完成全流程，不能用共享正式 DB 當測試庫。

## 管理者簽核與前置

1. 固定 commit／ZIP SHA-256；備份目前 `C:\UQP`、Windows 服務／排程設定及網站靜態輸出。`.env`／JWT_SECRET／資料來源加密 key／HMAC keyring／Oracle client 設定在核准位置另外保存，禁止提交 GitHub 或以範例覆蓋。
2. DBA 做完整 DB 備份、驗證備份及獨立還原演練；核對目標 Instance／DB／登入與實際 Catalog、925 前置，確認 923/924 是否由原專用程序安裝。不要重跑 001、通用 db:migrate 或清理 ledger。
3. 簽核維護時段、925 安裝及各 Dataset 公開核准責任。新公共播放不沿用舊 JSON；未完成核准前保留停用，絕不批次自動公開。
4. Windows Node22／npm、Oracle11g 需要的 Thick client 位元／路徑、TLS／來源只讀權限經人工核對。不得改 HIS 資料，也不因初始化失敗放寬 TLS。

## 專用預檢、安裝與驗證

在獨立副本先解壓 ZIP 到新目錄，不在現有在線服務中覆蓋。Server／Client 各自 `npm install`、`npm run typecheck`、`npm run build`，再部署已建置 Client 靜態檔及 Server；Server 仍用既有 port3200／反向代理設定。

經 DBA 確認與核准後，才可在核准維護連線執行 `tools/install-uqp-925.ps1 -Mode Preflight`，獨立 installer login 需目標 DB effective dbo。工具要求 @@SERVERNAME、DB、login 三項精確匹配、Engine15／compat150；不是只看 DB 名。Preflight 不寫資料。

需額外明示核准才能 `-Mode Apply`；安裝鎖與 DDL 同交易，最後 Catalog EXACT_MATCH 才提交。`-Mode Verify` 再確認。部分／異形或結果不明立即停止，先唯讀檢查；不自動 drop／修復／重建。工具不授 Runtime dbo、不保存安裝密碼、不改 `.env`，925 不寫 SchemaMigration。不得以返回碼假定 connection-loss 時一定 rollback。

Runtime 維持非 dbo，925 最小新增權限：三表 SELECT／VIEW DEFINITION；PublicDisplayPolicy INSERT／UPDATE、MaskTemplate INSERT／UPDATE、MaskTemplateUse INSERT；既有 AuditLog INSERT 及現有身份／ACL／DatasetColumn／DatasetSensitivePolicyVersion／DatasetSensitiveColumn／DatasetPatientAuditConfig 讀取權限。**不授 DELETE、ALTER、CONTROL、db_owner、sa、VIEW SERVER STATE**。權限由 DBA 在核准環境配置；若既有 Runtime 已過度授權，需先完成最小權限切換驗收，不沿用高權限作為成功證據。

功能預設關閉：`DATASET_PUBLIC_DISPLAY_MANAGEMENT=false`、`DATASET_MASK_TEMPLATE_MANAGEMENT=false`。925 驗證與權限驗收後，經核准才在新部署的服務設定啟用所需管理功能；既有 Dashboard management／execution／playback flags 不自動更動。可先只開範本管理。公共播放要等 Dataset 規則及公共確認、Query ACL、Query-only mode、必要患者確認與裝置核發都完成，再由管理者明示啟用。

## 副本驗收與切換

- 同 Dataset NAME 自訂、PHONE raw、MRN FULL、SECRET OMIT；Query、Dashboard 設計預覽、Excel 同規則，公共播放另只含公開核准欄位。兩個 Dashboard 共用 Dataset 後修改政策，兩者舊快照都拒絕。
- 新欄、取消核准、OMIT、版本衝突、SQL／來源異動、Token／ACL 撤銷與患者稽核故障均拒絕；普通非患者資料不要求患者 receipt。
- 新增／修改／停用範本，確認既有 Dataset 不被靜默覆寫，手動套用保存才生效。
- OR_001 PRIMARY／EXAM_DATE 透過現有參數 JSON 管理，確認實際 Dataset 日期模式／calendar／format、中文欄位、Thick driver 與遮蔽；真實 Oracle 結果待使用者驗收，不屬 CI 已通過項目。
- 全部成功且備份可還原後才安排共享正式維護：停止 Server／背景 worker 與公共播放，保留設定，解壓新版本到 staging、建置並原子切換服務路徑，檢查健康／登入／既有 Query／稽核，再依核准順序啟用。不要直接覆蓋使用中的 node_modules 或 `.env`。

## 回復

異常先停公共播放與新管理功能，收集去敏 RequestId／錯誤碼及 Catalog 狀態；不清理 Audit／TemplateUse 或重新授權。925 為新增表，可先保留 Schema 並退回已備份程式／靜態檔與設定；舊版僅能在確認不會繞過新公開限制時恢復服務，否則保持公共播放停用。不要自動 DROP 925。

需要 DB 還原時由 DBA 核准：停止所有 Writer，評估備份後交易及必須保存的 Audit／PatientDisclosure／TemplateUse，還原於副本先驗證，再決定正式回復；不能覆寫或丟失應保存的稽核歷史。密碼／JWT/HMAC key 不因回復重設。

**發布判定：程式與 CI 通過不等於共享正式升級授權；925 未安裝、Runtime 權限未驗證或 Oracle／Windows 實測未完成，正式切換仍 BLOCKED。不要求使用者逐階段下載覆蓋。**

## D0 驗收紀錄

獨立 Windows／SQL Server 副本及真實 OR_001／Oracle 11g Thick 實機驗收，請依 [D0 驗收清單](d0-or001-windows-isolated-acceptance.md) 留存 PASS／FAIL／BLOCKED 證據。CI Success 或來源 ZIP 不構成共用正式環境升級核准。
