# PIN 共用工作站切換：最小開發及阻斷紀錄

本頁以下為先前停止點與歷史測試。使用者已授權沿用既定方案補必要接線，本輪進度與現行限制以 [PIN Runtime 開發契約](workstation-pin-runtime.md) 為準；舊文要求重新討論的項目不再作為繼續寫程式的前置條件。正式 SQL、備份與啟用核准仍獨立保留，不以程式開發完成代替。

基準 `cad30674f02a92d681758c89e52da2cef54bd0c3`。PR83維持Draft；**PIN登入／切換與整合驗收BLOCKED**。沒有新增可登入的PIN API、假Session、前端閒置遮罩或姓名切換。本次只完成現有PIN設定流程的安全修正，沒有修改Server、SQL、Migration、JWT、Dataset、Query、Dashboard、Device或CI。

## 現有契約與可重用內容

| 來源 | 實際具備 | 未具備／不能推論 |
|---|---|---|
| 902 foundation | SharedWorkstation、UserQuickPin、SharedWorkstationSession、DashboardAuthenticationPolicy；Session已有TokenVersion、PinVersion、AuthMethod、AuthenticatedAtUtc、LastActivityAtUtc、ExpiresAtUtc及單一active唯一索引 | Schema定義不代表已有Session runtime、閒置鎖定或正式安裝驗收；未查正式DB |
| 903／QuickPinPolicy repository | 全部整數4–12碼、長度改變停用PIN並增加PinVersion／撤銷Session；不只6／7／8碼 | 不擅自擴大既有資料庫政策長度 |
| 904／workstationCredential.service | 隨機256-bit工作站secret、hash比對、CredentialVersion、停用／退役／撤銷檢查 | 尚無已配對瀏覽器的獨立Secure/HttpOnly/SameSite工作站cookie及CSRF流程；不能拿BAT／Device Token代替 |
| 916／workstationManagement | 個人／部門／群組聯集授權與停用排除、有效授權管理、交易與版本控制、憑證／Session／播放Token撤銷 | MANAGE_USERS管理API不是可供未登入員工任意查詢的Operator目錄 |
| quickPin.service | LOCAL帳號正式密碼再驗證；bcrypt cost12、PinVersion、政策／使用者鎖、更新／撤銷；既有PIN記錄密碼失敗5次鎖15分鐘 | 這是PIN設定管理，不是錯誤PIN登入計數或PIN驗證登入服務；沒有memory-hard＋pepper登入契約 |
| pinRateLimit | 有界的個人管理操作10次／15分鐘程序內Map | 不是跨實例帳號＋工作站＋網路限速；首次設定無PIN記錄時沒有共享失敗計數 |
| auth.middleware／queryDelivery | 個人JWT簽章、live TokenVersion、Query ACL、Dataset政策、患者Audit及交付重驗 | 身份沒有工作站Session／PinVersion／認證強度；Query無已核准最低assurance映射，不能把PIN兌成一般JWT後沿用所有權限 |
| Drill-down phase2／3 | JWT-only Context、rowRef、前後端清除／晚回應防護 | 不能以既有JWT登出／DELETE替代伺服器PIN Session撤銷；PIN不可直接進入敏感患者互動 |

Repository沒有找到可用的Operator登入模組；員工個人身份應沿用AppUser及既有有效授權，不能虛構另一套Operator帳號。上述結論來自實際程式及DDL，不把文件的proposed API當成已實作。

## 已完成的獨立修正

- Client PIN政策讀取僅接受既有4–12整數；缺少、字串、越界或小數皆禁止設定／政策覆寫，不使用預設6碼冒充讀取成功。
- PIN設定頁政策重新讀取清空舊敏感輸入；舊讀取回應不能覆蓋新政策。登入身份生命週期改變或卸載後，舊政策／寫入回應不得恢復通知、秘密或覆蓋目前狀態；HTTP錯誤仍一律拒絕，使用既有API Client身份判斷。
- pagehide／hidden／既有身份清除事件清空PIN、確認PIN與正式密碼；在途寫入結果不明時不顯示成功、不重送。請求尚未結束時保持操作鎖，晚到回應不復原秘密。重新讀政策只確認長度，**不宣稱能確認先前PIN寫入是否成功**。
- 管理員政策頁重新驗證讀取、拒絕無效政策並忽略舊身份通知，維持原政策交易及Session撤銷語意。
- 原numeric inputMode、數字鍵盤、4–12碼政策、正式密碼再驗證與登入未啟用提示保留。

修改：`client/src/pages/QuickPinEnrollmentPage.tsx`、`QuickPinPolicyPage.tsx`、新增`client/src/security/pinPolicy.ts`及`client/e2e/pin-policy-safety.spec.ts`，加本報告。沒有重畫Dashboard或修改下鑽設計。

## 停止受阻部分與最小方案

依[既定安全計畫](shared-workstation-and-interactive-query-plan.md)第2–6及9項，尚無核准跨重啟PIN-only與敏感資料最低保證等級的證據。依使用者「需要安全核准、Schema或不可替代外部依賴則停止受阻部分」指示，沒有啟用登入或新增模擬Session接線。

1. **安全核准**：先確認LOCAL適用帳號、可用於PIN的低敏唯讀Query範圍／最低assurance、跨重啟政策、idle／absolute上限、失敗漸進延遲及解除鎖定政策。預設禁止PIN-only敏感患者、匯出、管理及密碼／PIN變更；現有DashboardAuthenticationPolicy不能單獨證明每個Query安全。
2. **Verifier**：沿用UserQuickPin.PinHash，不必另建PIN表；審查memory-hard格式（例如Node scrypt或核准Argon2id）、salt、伺服器外置pepper與key-id／輪替、bcrypt既有資料重新設定／遷移。不能把原bcrypt管理流程冒充已符合新PIN登入防暴力破解要求；不讀取或產生正式pepper。
3. **共享失敗保護**：最小建議選SQL共享bucket或已核准共享限速服務，涵蓋帳號、工作站、網路及首次無PIN記錄。現有Map不可替代；若選SQL，需要另行審查forward Migration，不能現在新增／執行。不得把AuditLog全量掃描當作可靠的原子限速。
4. **Session／切換**：重用902 Session表與單active索引，不新建第二套Session／RBAC／JWT。以工作站鎖、憑證綁定與切換generation建立受控狀態機；先提交A撤銷與必要Audit，再驗證B，最終以generation CAS建立B並寫Audit。驗證B失敗或第二階段回滾不能復活A；撤銷未提交不得交付B。同時進行B／C切換須拒絕過期意圖，不能只靠UI取消請求。
5. **每次交付**：同一現有QueryDelivery／Audit協調器重驗工作站有效性、憑證、有效名單、live TokenVersion／PinVersion、Session idle／absolute與authMethod、Query ACL及最低assurance。最終Audit交易與回應前都重驗，拒絕A的在途晚結果。現有JWT行為不變，不向PIN發出不受限個人JWT；Device Token不被接受。
6. **Client接線**：只有上述正式後端契約通過後才做工作站登入／切換及idle鎖定，先清A的所有Query、患者與Context，再顯示B。需要伺服器lock/logout與Cookie-CSRF，前端遮罩或只呼叫JWT Context DELETE都不算伺服器撤銷。

### 待審查SQL設計（不是Migration，不執行）

| 建議 | 最小結構與目的 | 相容性 |
|---|---|---|
| SharedWorkstation.SwitchVersion | BIGINT NOT NULL，DEFAULT 0、非負CHECK；每個switch/lock/logout意圖原子增加，避免重用CredentialVersion而意外輪替全部裝置憑證 | 新增欄位需forward Migration審查；舊writer保持保守撤銷，新Session reader另驗CredentialVersion；不可改歷史902／916 |
| WorkstationPinAttemptBucket（名稱待審） | scope（ACCOUNT／WORKSTATION／NETWORK）、不可逆key digest、window起點、attempts、blockedUntilUtc、更新時間；scope＋digest唯一鍵、expiry索引、非負CHECK；同一交易鎖定並更新所有相關bucket | 新表需forward Migration；key不含原始PIN／帳號／IP或患者值；pepper/鍵策略及保留清理先核准。若已有可核准共享服務，可不建此表 |
| 既有SharedWorkstationSession | 保留SessionSecretHash、AuthMethod、TokenVersion、PinVersion及時間欄位；憑證ID／版本與session hash的綁定格式須審查 | 不主張必須重建表；若選額外FK欄位，先另案提出，不把未保存的憑證版本當可靠證據 |

這是可審查的最小建議，不代表已證明「只能用這個Schema」；採用共享服務或經核准的其他generation／綁定設計可調整。未核准前沒有提交新DDL、Migration或外部服務依賴。不能宣稱目前正式DB缺表，因本次未連線驗證。

## 驗收對照

| 項目 | 本次結論 |
|---|---|
| 合法／錯誤PIN登入、登入鎖定 | BLOCKED；只回歸既有PIN設定與正式密碼再驗證鎖定，不冒充登入測試 |
| 長度／變更PIN | 既有4–12政策與後端撤銷測試沿用；本次補無效政策拒絕及額外長度Browser案例 |
| A→B、並行切換、server idle lock | BLOCKED，沒有可用的正式Session runtime或切換generation契約 |
| PIN Session患者資料／Query／Context清除 | BLOCKED；原JWT清除仍保留，新增的是PIN設定輸入清除，非患者Session驗收 |
| 停用／撤權／TokenVersion／PinVersion | 現有管理撤銷與PIN管理競爭條件可測；新Session逐次讀取／交付仍待實作 |
| Windows／Android／iOS觸控 | 原PIN設定數字鍵盤與尺寸旋轉案例可回歸；mock Chromium尺寸不是實機或PIN登入驗收 |
| Dataset／Query／Dashboard／Device | Runtime零變更，執行相關既有安全回歸；不重做Migration或正式環境檢查 |

## 本機測試結果

- PIN／工作站Browser 28／28：新增18項政策、長度、清除與晚回應案例，加原工作站授權／觸控設定回歸10項。
- 患者稽核／裝置Enrollment／遮蔽／JWT Drill-down Browser 44／44；兩組Browser合計72個不同案例，全部使用合成資料與mock API，不代表PIN Session整合驗收。
- Server既有PIN、政策、限速、工作站憑證／管理、QueryDelivery及Drill-down專項146／146；不把管理用密碼失敗計數當成PIN登入計數驗收。
- Client unit79／79，Client Typecheck及Build通過；Server無程式變更，沒有重跑無關全套Build。
- 文件連結與git diff --check通過。Node v24.19.0／Chromium；未執行Windows原生交付、Android或iOS實機驗收。

CI保持既有BLOCKED，不修改規則／跳過條件。提交Draft分支後取消自動CI以避免未核准SQL／Staging封裝；不產生更新包。本次無正式SQL、C:\UQP或秘密操作。整合驗收條件尚不具備，完成獨立修正後停止等待上述審查。
