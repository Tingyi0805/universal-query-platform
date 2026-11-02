# D6-3 / Issue #84 — 集中驗收修正與再驗收表

基準 PR #83 Draft / `7a38a49870d6455667c74fa2c78f326a1da15a11`。[Issue #84](https://github.com/Tingyi0805/universal-query-platform/issues/84) 全文及留言已讀，沒有留言。正式926 Schema/Ledger已ADOPTED、現行正式程式為舊交付版本，採信既有驗收事實；本次不連正式DB、不讀.env、不操作C:\UQP、不重新安裝／採認926、不改JWT/Token格式、IP解析或Migration。

交付source、CI、Windows Node v24.22.1/ABI137、逐檔SHA256、Manifest SHA與ZIP SHA以此次CI artifact/manifest為準。CI沿用既有安全門檻，不新增無關重構或新歷史系統。

| Issue 項目 | 判定 | 修改及回歸 |
|---|---|---|
| FUNC-01 首次Token | DONE | 沿用版本化credential service/writer；只額外接受active、未暫停/撤銷/封存、NULL marker且兩個grant版本皆NULL的未授權裝置。完整管理snapshot/CAS、確認、Query-only啟用、操作者/委派者token version/Query ACL、公共政策、Audit與提交後一次性Token回傳均保留。舊端點對926未核發裝置明確拒絕（pre-926/已有grant的Legacy相容保留），核發後pending=true，Enrollment仍只接受pending、正確新Token/IP與完整授權。前端從完整lifecycle snapshot判斷首次核發，絕不從分頁清單猜測grant。單元測create→未啟用拒絕→首次issue→錯IP拒絕→Enroll；10項拒絕/rollback；E2E單次呈現/清除/完整CAS；兩版disposable SQL使用真實writer與926 Trigger驗證NULL首次核發。 |
| FUNC-02 預覽換頁 | DONE | admin-preview允許帶同一snapshot的續頁，page>1無snapshot仍拒絕。後端沿用使用者/session/來源/context/fingerprint/ACL/遮蔽及每頁揭露Audit檢查。刷新先取新snapshot、再取得所需頁，換頁時鐘不因10秒刷新重設；20秒換頁、5筆/每頁2筆、手動換頁、資料縮減clamp、權限失敗清除、關閉後舊回應防護均有E2E。續頁不讀全量資料到Client。 |
| UI-01 裝置管理溢出 | DONE | 裝置操作表與來源設定表使用局部水平捲動；文字/按鈕換行、max-width與min-width保護。360/768px觸控情境檢查document不溢出、鍵盤focus及局部scroll，保留控制項操作。 |
| UI-02 終止裝置期限 | DONE | 主清單及操作表改顯示「不適用（已撤銷／已封存）」，不再呈現剩餘有效天數；原到期值、DB與Audit均保留。單元與兩種終止狀態E2E驗證。 |
| UI-03 設定按鈕 | DONE | 共用管理設定CSS統一間距/換行/44px觸控高度；disabled有明確色彩與虛線，focus-visible保留鍵盤識別。Dashboard/Dataset/System settings套用，觸控/鍵盤E2E驗證，未變更disabled條件或權限。 |
| UI-04 預覽統計 | DONE | totalRows使用真實snapshot筆數；本頁為實際回傳rows.length；elapsedMs來自query執行結果並保存在短期snapshot，快取續頁標為同次「查詢」時間。未提供時間/總數顯示明確placeholder，truncated保留真實旗標。單元驗證快照與續頁統計；E2E驗證5/2/37ms及缺值，不拿網路耗時冒充SQL時間。 |
| AUDIT-01 OR_001 | BLOCKED_BY_DATA_OWNER | 已補UI引導與fail-closed回歸；正式OR_001尚無可信患者ID，不能判定患者揭露功能完成。姓名、手術室、動向、床號均不得自動推為patient key。另有下述可信metadata初始化介面缺口，不能假稱欄位同步即可解鎖。 |

## 首次核發再驗收

1. 授權管理員於停用草稿建立裝置，明確核准IP及到期設定。既有NULL期限政策不改；核發確認框顯示實際期限，NULL明確顯示未設定期限，不代填期限或默認核准。
2. 明確完成Query-only預檢/啟用，重新載入取得最新完整管理版本。建立時isActive只是設定，沒有Token/grant，狀態維持未驗證，不代表可播放。
3. 在上方版本化區點「首次核發新 Token」，只顯示一次。關閉、pagehide、切換、過期回應不保留Token；沒有歷史讀回、不存URL/localStorage/sessionStorage。
4. 使用該裝置原BAT專用瀏覽器及原播放網址，依既有「使用恢復後的新 Token 重新授權」選項輸入新Token完成Enrollment。這個選項也適用首次版本化核發，不改BAT/Cookie/HTTPS協定或原有Token handoff ACK。未Enrollment、錯IP、舊Token、過期、撤銷/封存一律不可播放。
5. 409重新載入，不自動重送核發。撤銷裝置不可藉首次核發復活；已Enrolled裝置重新授權仍使用既有暫停/恢復流程。已核發Legacy裝置的ACK協定不改；926下NULL marker且NULL grants的新裝置，舊核發writer也會拒絕，避免繞過完整CAS及Enrollment。前端同時停用該裝置的重複舊入口，首次核發只能使用本次版本化入口。

## OR_001 患者稽核：必要前置及目前缺口

- 請資料負責人確認來源真正穩定、非空且在所需業務範圍唯一的患者識別欄位及精確SQL alias（例如PATIENT_ID僅為名稱示例，不是已確認欄位）。不得捏造病歷號或以姓名/床號替代，也不自行修改正式Oracle SQL。
- 經資料/安全負責人核准後，使用既有Dataset保存/版本化權限流程更新來源。候選SQL描述、DatasetColumn選項同步、F3 COLLECT_METADATA的DESCRIBED snapshot均**不等於**DatasetPatientAuditMetadata的可信患者證據。
- Repository現有patientAuditService.recordPreview要求實際執行定義與儲存SQL/dataSource精確相同、alias無歧義，並對metadata變化推進設定版本；本次必要範圍內未找到可供一般UI使用的正式初始化入口。現有columns/sync明確禁止建立患者metadata；F3 field initialization也沒有這個橋接。因此除了來源欄位，仍需獨立核准、可審計且遵守資料交付權限的可信初始化接線；不能指示操作者手動INSERT metadata、呼叫內部service或暫時停用稽核/遮蔽來繞過。
- 完成可信初始化及HMAC金鑰可用性核准後，具DESIGN_QUERY權限的管理員在稽核設定選擇已確認的精確alias，以expectedVersion和identifierConfirmed儲存。既有服務仍拒絕NAME分類欄位，沒有別名自動推定。
- 患者ID在Dataset公共顯示政策及Dashboard欄位核准使用OMIT；姓名依既有遮蔽策略，REPORT_USER不得取得原始患者ID。只有有權限且需要的患者稽核流程可於後端以HMAC/版本化key處理識別碼，不回傳明文ID、金鑰或原始ParametersJson。
- 之後驗收：同一來源/metadata版本下預覽與播放交付的PatientListDisclosure可歸屬正確患者、操作者及Dashboard/device；無權限/鍵不可用/無可信metadata/欄位錯誤/Audit失敗均拒絕交付，不能用0筆歷史推論已啟用或可略過稽核。這不是本次已PASS事項。

## 再部署邊界

可下載新CI staging ZIP到隔離目錄核對manifest/hash並人工驗收上述六項；不可直接將整包盲目解壓覆蓋C:\UQP。沿用既有備份/停寫/檔案保留及回復計畫，server/client/dist/Windows native dependencies使用同一manifest，保留.env、業務檔案、資料及Audit；不執行Migration/Installer/db:migrate:status或再採認926。正式覆蓋仍需維護核准及既有部署驗收；OR_001患者稽核須維持BLOCKED，不能將本包宣稱為七項全部正式PASS。回復程式僅使用既有926相容版本，保留不可逆撤銷/封存及新增Audit。

CI另發現既有dashboardKiosk單元測試以固定`AA`覆蓋隨機密文，偶爾替換前後相同而沒有真正竄改。本次只將該測試改為必定翻轉中段一個有效base64url字元並確認值不同；加密/Cookie/Token Runtime完全未改，原拒絕竄改的斷言保留。該檔47項本地回歸通過。
