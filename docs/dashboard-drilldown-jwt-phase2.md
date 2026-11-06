# Dashboard JWT Drill-down：第二階段後端契約

基準 f4307d9682d1ca286e09b9f7bb5af9af36643799。只新增後端；四頁籤、一般 Dashboard、Device／BAT、Migration 與正式環境不變。不產生交付包。

## 保存與 Graph

使用既有版本化 `PUT /api/dashboards/:id/query-sources/v1/layout`、完整 expectedVersion 及 Audit。profile.config.interactiveDrilldown 格式如下；舊版非版本化 layout 寫入遇到此 namespace 明確拒絕 VERSIONED_API_REQUIRED。

```json
{"version":1,"root":"root","nodes":[{"id":"root","queryId":1},{"id":"detail","queryId":2}],"edges":[{"id":"open","from":"root","to":"detail","trigger":"COLUMN","column":"CASE_ID","display":"PANEL","bindings":[{"field":"CASE_ID","parameter":"CASE_ID","type":"NUMBER"}]}]}
```

上限32節點、64條邊、5層；節點必須全部從root可達，不得循環、重複識別或失效引用。ROW不帶column，COLUMN必須帶column。display為PAGE／PANEL／MODAL。每條邊必須完整且唯一綁定下一層 SQL 的既有參數；型別須與runtimeParameterDefinitions一致，不建立新Compiler。父欄位及指定觸發欄位必須具確認政策且mode=NONE；遮蔽、OMIT及audit-only鍵不可綁定。實際父列缺欄位或型別不符拒絕，不轉型、不允許null／多選陣列。字串仍交原有driver bind，沒有SQL串接。

保存前逐Query執行原QueryDelivery.open授權驗證；Runtime再次驗證且root必須是Dashboard已綁定Query。Root參數只取Dashboard已保存的dashboardQueryParameters；不接受瀏覽器額外輸入。需與Dashboard不同root的Graph或server-only隱藏患者鍵另案設計。公共版型讀取（包含Device）預設移除interactiveDrilldown／interactiveRoot；只有DESIGN_QUERY的私人版型讀取及後端Runtime可讀Graph。

## API

全部路徑前綴 `/api/dashboards/:id/interactive/v1`；只接受個人Bearer JWT，Cache-Control:no-store；不接受Device Token或Cookie代換登入。

| 方法／路徑 | Body | 行為 |
|---|---|---|
| POST /contexts | {profileId} | 從已保存Graph執行root，建立Context |
| POST /contexts/:contextId/navigate | {edge,rowRef} | 只可選當前節點已保存edge；參數取後端父列 |
| POST /contexts/:contextId/back | {} | 回上一層重新執行、重新遮蔽及稽核，不重放舊資料 |
| DELETE /contexts/:contextId | {} 或無body | 銷毀Context；並行請求也不能使其復活 |

回應包含contextId、expiresAtUtc、depth、node、原有安全result／reportColumns／disclosureId、與rows等長的rowRefs、可用actions（僅id／trigger／column／display）。不返回Graph、目標Query ID、SQL、參數mapping或raw rows。無匯出API。未知Body屬性直接400，錯誤不回傳driver訊息或患者值。

## 失效與交付安全

Context綁定完整JWT SHA256、Dashboard、profile、已保存Dashboard／layout revision及每個節點的QueryDelivery fingerprint與參數定義。rowRef是256-bit隨機值，只在當前Context當前頁有效；切層／Back旋轉，偽造或前頁ref拒絕。只保留綁定所需且已交付的未遮蔽父欄位，不保留raw rows。

每次導航、Back及交付前後重驗JWT／live TokenVersion、全部節點ACL／發布、Dataset確認政策、患者稽核契約、版本及參數定義；變更即拒絕並清Context。沿用QueryDelivery.execute的患者Audit與遮蔽，沿用startAudit／finalizeDeliveryAudit交易，普通Audit只記QUERY_EXECUTE且parameters=null。患者或一般Audit失敗不交付result或rowRefs；最終交易使用原revalidate及交易參數。不自動重試。單Context同時只允許一次Navigate／Back，並行DELETE可撤銷在途結果。

### 啟用條件（必須人工確認）

預設關閉。只有明確設定 `DASHBOARD_DRILLDOWN_CONTEXT_MODE=SINGLE_PROCESS` 才啟用；WEB_CONCURRENCY非1、NODE_UNIQUE_ID或pm_id存在時拒絕。部署者必須確認僅一個Node程序／一個副本，沒有IIS web garden、cluster、PM2或負載平衡多副本。環境變數無法偵測外部副本，設定不是自動拓撲證明。不能滿足時維持關閉；sticky routing不等於跨節點一致性，不能當作本階段核准方案。

有界記憶體儲存：最多100個Context、單Context2MB、總20MB、每結果最多1000列、固定120秒TTL不滑動；每10秒清理過期Context。JWT先過期時會先拒絕。程序重啟／遺失Context安全回覆404／410，重新進入，不持久保存患者資料。不需要新增表或Migration；共享Context儲存須另案核准，不在本次建立。

### 登出界線

JWT失效／TokenVersion撤銷後不能再用Context。原系統沒有伺服器logout端點，僅在瀏覽器刪Token無法通知後端；第三階段必須在登出／身份切換／隱藏／鎖定時呼叫DELETE並清除各層資料及晚回應，網路失敗則由固定TTL清理。不可把本階段後端API當成已完成登出UI清理或PIN session撤銷。

## 驗證及第三階段條件

新增Graph／服務與HTTP／真QueryDelivery整合測試：循環、深度、失效引用、重複參數、型別及日期、SQL payload、跨user／Dashboard、偽ref、前頁重放、政策／版本／撤權／JWT撤銷／到期、Device拒絕、必要Audit失敗、並行與DELETE、公共Graph投影、記憶體容量與缺欄位拒絕。既有QueryDelivery／Dashboard／Enrollment／Token／患者稽核回歸沿用原測試。

第三階段可依此契約開發JWT互動UI，但尚無互動設定Editor、row／column事件、breadcrumb與三種呈現容器、登出／hidden清理接線；不能在正式端直接啟用。PIN／真正圖表不在範圍。OR_001缺可信患者識別欄位仍BLOCKED_BY_DATA_OWNER，不以姓名／床號解鎖。

## 本次實際驗收與 CI BLOCKED

- 最終本機 Server 全套：2,257／2,257（含新增38個Graph、服務、HTTP與真QueryDelivery安全案例）；Server Typecheck及Build通過。
- Client unit 75／75；未修改Client，未重建Client交付包。
- Browser專項54／54：dashboard-admin-tabs、dashboard-query-mode、dashboard-lifecycle-enrollment、dashboard-masking、dataset-patient-audit。只使用合成資料及mock API；不是正式端或真Drill-down UI端到端驗收。
- 本機Node v24.19.0；本階段不重建Windows依賴，不將本機結果稱為Node24.22.1 Windows交付驗收。
- CI：BLOCKED。使用者明確選擇保持CI不變，不擴大跳過條件；原PR工作流程會執行隔離SQL Migration並產生Staging包。本次推送後停止自動工作流程，避免執行本階段未核准的SQL／封裝，不把取消當成CI PASS。沒有修改workflow、SQL或Client。
- 自動審核曾拒絕擴充CI跳過範圍及移除Graph hash檢查的組合操作，理由為可能弱化安全驗證；該操作完全未執行。Graph hash檢查保留，使用canonical JSON穩定鍵序，且測試證明真正Graph變更仍失效。使用者後續明確要求不改CI，故未再嘗試擴大。

### 待解除阻斷的審核

1. 決定是否另行授權原隔離SQL工作與Staging封裝，或審查一份獨立且不降低安全驗收的CI執行方案。本次不實施其中任何方案；未取得成功完整CI前不得核准部署。
2. 審查單程序啟用限制、120秒TTL、記憶體容量、Graph mapping來源，以及正式部署拓撲；多副本不啟用，不能用sticky routing代替共享Context設計。
3. 第三階段補UI端到端row／column導航、三種容器、Back、晚回應防護與DELETE登出／hidden清理。未完成前保持預設關閉，不宣稱完整登出／PIN驗收完成。
4. OR_001可信患者識別及metadata仍由資料擁有者確認；本階段不解除BLOCKED_BY_DATA_OWNER。

沒有正式SQL連線、Migration執行或C:\UQP操作；沒有正式／Staging更新包。完成開發提交後停止，等待上述審核。
