# H0 — 單一使用者撤權 Writer（隔離實作）

基準：9312d63；PR #67。`authority=NONE`、`runtimeEnabled=false`、`productionReady=false`、`SQL_ACCEPTANCE=NOT_RUN`。
本次不註冊路由、不變更 JWT、登入、Dashboard、Query、Export、患者稽核或 Client 授權；不執行 Migration、不使用平台 pool、不操作 Docker、使用者 SQL Server 或 C:\UQP，不製作更新包。

## 影響範圍與可保留項目

| 物件／路徑 | 撤權要求／本次處理 | 狀態 |
|---|---|---|
| AppUser / JWT | 精確 UserId，TokenVersion INT CAS +1；停用同交易設 IsActive=0；既有 middleware 每次讀取即時啟用狀態／TokenVersion／permissions | 隔離 Writer 已實作；JWT middleware 未改 |
| 單人 UserRole | 固定 REPLACE_ROLES，鎖定並驗證新 RoleId、保留 SYSTEM_ADMIN 保護；同交易替換 membership 與推進 TokenVersion | 已實作非 SYSTEM_ADMIN 目標；不允許藉此新增 SYSTEM_ADMIN |
| Role / RolePermission | 共享角色會影響多位使用者，不能逐人開交易而宣稱全員原子失效 | BLOCKED：尚需多使用者範圍、共同 owner 與批次決策契約 |
| 密碼 | CHANGE_PASSWORD 只接受 LOCAL 與合法 bcrypt hash 結構；值僅以參數送入 SQL，不入 Request digest、Audit、Decision、錯誤或結果 | 管理員重設的隔離 Writer 已實作；一般使用者改密碼仍走原服務／密碼政策，未改成此入口 |
| Credential / Device Session | 裝置身分不是人員身分；停用一個使用者不應停用整個工作站 | 全部保留，沒有對這兩表的 UPDATE；不改變 renewal counter／proof |
| Legacy Session | Migration 902 有明確 UserId，但沒有 CredentialId | 只撤銷目標 UserId 的所有未撤銷列，包括過期及沒有目前 Operator link 的歷史列；不推論 Credential 關聯 |
| Operator State | 查詢完整 OperatorUserId 範圍；與 caller 的有限 expected CAS 集合精確比對 | 只鎖定目標操作員，CAS RowVersion / Generation / Incarnation；轉 OPERATOR_LOCKED、generation +1、server 產生新 incarnation、清空個人 binding |
| PIN | 新 TokenVersion 與既有 UserQuickPinSecurityBinding.BoundTokenVersion 不再相符 | 保留 hash、attempt window、鎖定及版本；不 reset 嘗試次數、不重新綁定、不發行 PIN 權限；H0-3／SQL Operator 既有即時檢查保留 |
| Dashboard 固定播放 / Device Token | 不得以人員撤權替代裝置範圍撤銷 | 不修改；公開 Device Token 仍不能成為個人 Query 身分 |
| Query / Excel / 患者揭露 | 後續 JWT 驗權拒絕舊 token，不放寬任何 ACL／遮蔽／必要稽核 | 原流程未改；正在執行的查詢、下載、瀏覽器既有結果並非此 DB Writer 可撤回，正式 response fence 接線仍待完成 |
| 帳號刪除 | Audit、患者披露、版本、926 PIN binding／attempt／operator 等有跨表歷史或 FK；不可清除歷史來讓 DELETE 成功 | DELETE_USER 不支援，任何 SQL 前拒絕；不得假裝「先停用」等於刪除 |

使用者撤權與 Credential 撤銷的證據不同：UserId 足以界定 Legacy Session 的**人員範圍**，不需要猜測 Credential；先前 Credential Writer 對無法證明歷史 Credential 關聯的拒絕保持不變。其他使用者即使在相同工作站也不是本次 revokeLegacy 的匹配條件；從未執行 Workstation 全域撤銷。

## 交易與證據

`createIsolatedUserRevocationWriter` 預設 pool 為 null，只接受明確注入的隔離 pool。命令僅允許 REVOKE_AUTHORIZATION、DISABLE、CHANGE_PASSWORD、REPLACE_ROLES；禁止任意 callback/DML。UUID、UserId／RoleId／WorkstationId、Generation 嚴格驗證；BIGINT 全程十進位字串，INT TokenVersion 與版本上限分開處理。getter、Proxy、稀疏／額外欄位、資源超限、溢位在連線前拒絕；輸入在 await 前複製。

單一 owner 執行：

1. SERIALIZABLE → XACT_ABORT、有限 lock timeout → transaction-owned `UQP:WORKSTATION_SESSION_SECURITY:V1` Exclusive Gate。
2. Metadata visibility、6 張 926 表、policy revisions、必要 PK／UQ／CHECK／DEFAULT／FK 名稱與父表、15組 FK 欄位順序／引用／NO ACTION／trust、CHECK enabled／trusted、append-only triggers 及既有 R2 的 70 個 column 定義見證（FULL OUTER JOIN 拒絕多餘 sidecar 欄位）。缺欄、部分安裝、同名欄位異形、未知可見性或 SQL 錯誤拒絕；不修復 Schema。這是必要 admission witness，**不是完整 installer EXACT_MATCH**；多餘 constraint／index／trigger、物理範圍仍需隔離 Catalog 驗收。
3. 依精確 BIGINT 排序鎖定 actor / target；重驗 actor 啟用狀態、TokenVersion、有效 SYSTEM_ADMIN 與其 MANAGE_USERS 能力。呼叫者角色字串不構成權限。
4. 鎖定目標 user membership／新角色、完整 OperatorUserId predicate、device/credential/workstation 關聯、RequestId 空 predicate、UserId Legacy predicate；核對完整 CAS 集合（至多32個工作站／64角色／256未撤銷 Legacy）。不以 caller scopes 為完整性證明。
5. 每個實際受影響 device 一組唯一 RequestId／correlation，先 reservation，再 AppUser TokenVersion CAS／業務異動、目標 Legacy 精確 OUTPUT 集合、Operator CAS；舊 Legacy link 在清空前驗證。允許沒有 Legacy link 的 PIN Operator，不允許一個非空 link 指向未包含的 Legacy 列。
6. 每個 Operator 寫入精確 BIGINT 字串 AuditLogId、不可變 DecisionId；核對 RequestId、AuditLogId、receipt 不重複、前後 RV/generation/incarnation。Decision 使用 AUTHORIZATION_REVOKE / OPERATOR_STATE，ActorUserId、TargetUserId 都明確綁定。核心證據在 Decision，Audit ParametersJson 僅記去敏固定欄位，不含密碼 hash、PIN、秘密或 SQL。
7. 獨立查詢目標仍有效 Legacy／Operator 數為0，重驗 target token／停用結果及 actor token／權限，才 commit。自我 TokenVersion 撤銷允許預期的新版本；不能透過本入口移除自身 SYSTEM_ADMIN。

任何 precommit 錯誤均嘗試一次 rollback，回傳固定代碼，不重試。rollback acknowledgment 失敗為 ROLLBACK_UNKNOWN；commit acknowledgment 失敗為 COMMIT_UNKNOWN，不做假定 rollback 或盲目重試，不交付部分 receipts。COMMIT_ACKNOWLEDGED 僅是注入 driver 的確認，Mock 也可產生，不能宣稱持久性或 SQL 驗收已通過。

Gate 是合作式序列化。不同已取得 Gate 的 writer 不會同時進入業務區段，但這不證明 SQL optimizer／FK／range／escalation lock 順序。新 Writer 依完整 operator predicate 發現範圍，再驗證 device 關聯；這與既有 per-device discovery 存在不同邏輯讀取順序，所有合作 writer 必須先持同一 Gate。未合作 writer 的循環與 phantom 風險仍 BLOCKED，不能宣稱 deadlock-free。

## 926 相容性與不能上線的原因

| 安裝狀態 | 既有正式 identity Writer | 新隔離 Writer |
|---|---|---|
| 未安裝 | 保留 9312d63 的原業務 SQL／last-admin／歷史保護及共同 owner；沒有新增 blanket deny | Schema admission 拒絕 |
| 完整安裝 | 既有 `legacyWorkstationWriterFenceSql` 仍拒絕未轉換的 identity Writer，避免 sidecar 留下有效權限 | 只支援有完整 persisted Operator CAS／Device Decision 範圍的4類命令；不是正式 API fallback |
| 部分安裝／不可見／不符 | 維持原本 fail-closed | metadata／欄位／關聯／CAS 檢查拒絕或 SQL 失敗 rollback；不補建、不退回 legacy |

**完整安裝926後的帳號管理可用性尚未解決，不能宣稱已完成正式整合。** 新 Writer 未註冊，因此不會令目前未安裝926的正式系統新增全面拒寫。不能將草稿926部署至正在使用的 UQP，再要求使用者接受全面拒寫；也不能移除既有 fence 來恢復功能。

具體 Schema 缺口：SessionRequest.WorkstationId／DeviceSessionId 及 Decision 的 device FK／NextRevision 必填，使「沒有任何 device/operator 的帳號撤權、帳號刪除、單純一般登入者改密碼」無法產生合約一致的決策。scopes=[] 明確 NO_DEVICE_DECISION_SCHEMA_BLOCKED；不可挑一個無關 device 填數、虛造 RV 或只記 Audit 取代 Decision。

下一個最小設計決策：獨立 account-level Request／Decision，或經審查的 nullable device + USER_AUTHORIZATION domain（必要的互斥 CHECK、request uniqueness、actor/target精確ID、TokenVersion revision、歷史保存／刪除語意）；另行審查版本，不改已安裝926、不在本次新增 DDL。其後先接單人停用／TokenVersion；共享角色批次與刪除最後處理。

## 驗證與隔離 SQL 待辦

- 本次專項：80項；實際單一／多工作站 command、無 Legacy、有明確 UserId 的未連結歷史 Legacy、PIN 無 Legacy、角色／LOCAL限制、即時 actor、TokenVersion／RV／generation／incarnation、replay、精確 BIGINT排序／Audit、二個device的後段故障、1205／1222／229、rollback、commit unknown、getter／Proxy／敏感輸入均有 test-local SQL driver 測試。來源 inventory 納入新的 SQL 模組，原 Credential/Legacy 限制回歸不放寬。
- 本機驗證：Server 2,110／2,110、此 Writer 專項80／80（包含於全量）；Client unit 59／59、Browser141／141；Server／Client typecheck／build通過。Browser首次缺少Playwright專用binary無法啟動，改用既有 `/usr/bin/chromium` 重跑141項通過；沒有略過案例。CI URL與Job結論以本次commit回報為準。固定 tsx 4.20.6 使測試環境可重現；本機受限 runner 可能只列檔案數，採有實際案例輸出的執行紀錄與 GitHub CI，不能把檔案成功數當案例數。
- 既有 VM 套件的21項 SQL 案例仍 NOT_RUN。新使用者 Writer 尚未加入該21項的自動 SQL 執行器，不可把舊套件通過當作此 Writer SQL 驗收。
- 下一步在既有 VM 隔離 harness 增加此 Writer 專用 fixture：兩個不同使用者、同/不同工作站、未連結但UserId明確的歷史列、無個人Session的device、PIN binding；受限非dbo帳號另需 AppUser／UserRole／Role／RolePermission／Permission 的最小 SELECT、AppUser UPDATE、UserRole INSERT/DELETE 及 schema VIEW DEFINITION，禁止給 db_owner／sa。
- 真實SQL至少要驗證4類命令、其他使用者/device/public token逐欄不變、兩連線switch/revoke／renew/revoke、UserId predicate phantom、每步SQL故障及Audit/Decision trigger rollback、RequestId重放、commit已持久化/未持久化兩種ack丟失、926 absent/full/partial。記錄真正15.x Build、Compatibility150與去敏證據。沒有獨立 VM 授權前不連線、不啟動容器。

DBA/sysadmin、直接SQL、舊 Worker／混合部署、平台備份還原 incarnation、完整Catalog及資料庫 rollback／持久性／物理鎖測試仍 BLOCKED。正式使用者改密碼的當下密碼重驗、多使用者 RolePermission Writer、帳號刪除歷史保存、前後端 response fence 接線同樣未完成。第五關與正式 Runtime 均未通過。
