# Dashboard Device D2-B — 新 Token 與受限 Enrollment Proof

基準 HEAD：`fa163291a1ae8fd4f8216ecdd50f6bd3c7105b49`。沿用 [D1](dashboard-device-lifecycle-d1.md)、[D2-A](dashboard-device-lifecycle-d2-a.md)、Migration 926 與既有 Cookie codec。沒有 UI、Cookie 格式／加密／key 變更、IIS、BAT 或 IP resolver 變更，也沒有執行正式 SQL／C:\UQP。

## API 與狀態

兩個新流程都需要既有 `DASHBOARD_QUERY_SOURCE_MANAGEMENT` 與 `DASHBOARD_QUERY_DEVICE_PLAYBACK` 開關及完整 schema readiness（包含唯讀 926 catalog／trigger 檢查）。缺少 926 不啟用新操作；不自動 migration 或修復資料。

- `POST /api/dashboards/:id/device-management/v1/:deviceId/credential`：既有 JWT middleware 與 live TokenVersion、DESIGN_QUERY／EXECUTE_QUERY；嚴格接受 `{ expectedVersion, confirmed:true }`。使用 D2-A 共用的完整版本。只接受 active、未暫停／到期／撤銷／封存、`ReenrollmentRequired=true` 裝置。
- `POST /api/dashboards/device/:id/kiosk/enrollment-proof`：嚴格接受 `{ deviceId, token }`。沿用既有 HTTPS、固定 Host／Origin、同源 JSON／kiosk marker／CSRF 邊界，不能用 Cookie 或傳入 pending=false 代替 Token proof。IP 使用既有 `getClientIp`／matching helper，沒有新的 resolver。

核發以 Node CSPRNG `randomBytes(32)` 產生 43 字元 base64url Token，只將 SHA-256 Hash 存入 Device。明文只於該次成功提交後的核發回應出現；沒有讀回或冪等重播明文的介面，不進入 Audit。回應 no-store，包含更新後完整版本、`credentialIssued:true`、`reenrollmentRequired:true`，不含 Cookie、Dashboard、Query 或患者資料。

新 Hash 綁定目前 QueryModeVersion 與原委派者 TokenVersion，核發仍保持 pending=true。以新版本再次核發會旋轉 Token；舊版本重送衝突，前一輪 Token 不可再 proof。若已完成 enrollment，須先暫停／恢復或經憑證失效操作進入 pending，不能利用舊核發 API 繞過此流程。

Proof 要求目前 Hash 的固定長度 timing-safe matching evidence、完整本輪 grant pair、目前 mode／委派者 revision，以及有效的裝置 IP／期限。不能拿恢復 tombstone（grant 空白）、舊 Token、舊 Cookie 或舊 BAT profile 完成本輪授權。NULL／absent marker 不推測為 pending，也不由這支 API 清理；既有未進入生命週期管理的普通 enrollment 保持原行為。

## 原子授權與零資料交付

沿用 D2-A SERIALIZABLE store：先鎖 Dashboard／配置，再依序鎖全部 Device／placement，使用相同完整版本與 approval evidence。核發時重驗管理者及原委派者的全部來源 Query ACL、權限及 session；Proof 由 Token possession 證明裝置，以原委派者 live 權限作為授權主體，不把未帶 JWT 的請求猜成管理者。

兩者都檢查 active Query-only、正數 modeVersion、managed 容量與完整來源 binding、layout references、Query／Dataset／參數與委派者工作站。公共政策使用既有 `getInTransaction`：同交易確認 DataSource／Dataset 可用、definition/configuration/sensitivity 版本與有效公共授權；有啟用患者 Audit 時要求 key column 與 keyring readiness。這些都是設定讀取，不呼叫 execute／page／inspect，不查患者資料列。

寫入使用 OUTPUT INTO 相容 926 trigger，WHERE 再檢查 Device／Dashboard／模式／期限／pending；Proof 另外要求本輪 Hash 與兩個 grant，僅改 pending=false。DB 回傳 DATETIME2(0) UTC，依 D1 validator 驗證 ISSUE／ENROLL 前後轉移，再重驗 live 權限與公共政策。最後 touch Dashboard 與寫入有效 ID 的原子 Audit：

- `DASHBOARD_DEVICE_TOKEN_ISSUED_PENDING`：操作者、Device／Dashboard、credentialIssued=true，不含 Token／Hash。
- `DASHBOARD_DEVICE_ENROLLED`：委派者、Device／Dashboard、來源 IP／UA、`authorizationMethod=DEVICE_TOKEN_PROOF`，不含 Token／Hash。

Audit 例外、無有效 ID、後續重驗或 commit 失敗均回滾。交易 wrapper 完成 commit 後 Proof 才以既有 codec、名稱、Secure／HttpOnly／SameSite=Strict、期限上限建立 persistent enrollment 與 short session Cookie。成功 HTTP 只回傳 Device／Dashboard ID 與授權到期時間；不交付配置或資料。失敗不建立任何正向授權 Cookie。

同時 Proof 只允許一次 pending→false 提交。撤銷先提交則 Proof 拒絕；Proof 先提交也不妨礙隨後永久撤銷。即使撤銷發生於 commit 後、Cookie 送達前，既有每次資料交付的 live verifier 仍拒絕該 Cookie；Cookie 從來不是獨立授權來源。提交成功但 HTTP／Cookie 寫入失敗不回滾已完成的授權；持有本輪 Token 可走既有普通 enrollment，重送 Proof 本身會拒絕。

## 憑證 writer 盤點

| Writer | D2-B 行為／邊界 |
| --- | --- |
| 新版本化 credential／Proof | 唯一新增 ISSUE／ENROLL 路徑；核發保持 pending，只有匹配本輪 proof 可解除。 |
| D2-A 暫停／恢復／永久撤銷 | 保留兩次 tombstone、grant 清除與 terminal 不可逆；Proof 共用鎖序及版本，未放寬原授權。 |
| Query-mode 舊 credential | service 與 SQL writer 皆拒絕任何明確生命週期標記（true／false／suspended）；NULL／absent 保持舊契約。 |
| Legacy reissue | 同交易鎖定讀取，拒絕明確生命週期／terminal 標記；仍保留 Legacy mode guard。 |
| 版本化 metadata | 已管理裝置旋轉 tombstone、清 grant 時重新設定 pending=true；舊 NULL 列不回填。 |
| Query-mode 切換／Legacy transition 失效 | 旋轉 Hash、清 grant；所有非 NULL marker 變成／維持 true，NULL 保持 NULL。不能藉模式切換清 pending。 |
| Workstation 停用／退役／重新綁定等失效 | 永久撤銷時清 suspended／pending 與 grant，使用 CSPRNG tombstone；不重寫既有撤銷／封存時間。無 926 保留舊欄位相容。 |
| Legacy settings／create | 路由保留 legacyDeviceWriteGuard；create 是新 Device，settings 不寫 Hash／grant／pending，不能清 pending。 |
| renewal／placement／LastUsed | 不核發憑證、不清 pending；續期仍受原有版本化入口保護。 |
| 手動／自動 archive | 沒有新增還原入口，926 仍拒絕未永久撤銷的封存；其版本化管理後續屬 D3。 |

模式／transition／工作站共用的 optional lifecycle clause 先檢查 schema；缺少兩欄時不引用不存在欄位，partial／損壞 926 則 fail-closed。Legacy 永久撤銷未修改為新的管理 API；其原 guard 與 926 約束仍存在。

## 驗證與 D3

本機只執行受影響專項測試（319/319 PASS）、Server Typecheck／Build；完整 Server／Client／Windows 與既有 D1 disposable SQL 由提交後 CI 執行。專項測試使用合成 SQL transaction store 與實際 JWT／HTTP／Cookie router，涵蓋核發／重發、重複操作、錯誤／舊 Token、IP、期限、RBAC／ACL、公共政策前後重驗、患者 Audit readiness、原子 Audit／commit 回滾、Proof／撤銷兩種鎖序、舊 Cookie／BAT Token 不復活、legacy NULL 相容、metadata／工作站 writer。

這不等於已在 SQL Server 執行新增 API SQL 或完成實機驗收。D3 接續：

1. 在明確隔離的 SQL Server 驗收實際 D2-A／D2-B writer、926 trigger、權限、競爭、rollback 與所有欄位相容分支；不使用正式連線或 C:\UQP。
2. 後續管理／enrollment 操作介面、封存版本化契約與實機 HTTPS 冷啟／舊 profile／瀏覽器多實例驗收；保留逐次 live 資料授權及患者 Audit。
3. 正式 926 備份、唯讀盤點、鎖定與權限評估、核准部署及精確 SQL／ledger 程序。此階段未執行正式部署。
