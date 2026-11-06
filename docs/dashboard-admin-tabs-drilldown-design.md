# Dashboard 管理介面整合與多層查詢：開發前設計

基準：`cb73828defbb0aff86f8e6366c75b2fbe8584b24`；PR #83 已確認為 Draft、未合併。以下為 Repository 靜態盤點與**待核准方案**，不是正式環境驗收；本次不改功能、不執行 SQL／Migration、不製作更新包。

本報告保留開發前基準；已核准的第一階段實作另見[四頁籤整合報告](dashboard-admin-tabs-phase1.md)。

## 1. 現有功能

| 功能 | 現況 | 程式依據／界線 |
|---|---|---|
| 一般使用者 Dashboard 入口 | DONE | [App](../client/src/App.tsx)、[DashboardPortalPage](../client/src/pages/DashboardPortalPage.tsx)；保留 `/dashboards` 與 `/dashboards/:id/display`，不另建入口。 |
| 管理基本設定、Query／參數／來源 | DONE／PARTIAL | [DashboardDesignerPage](../client/src/pages/DashboardDesignerPage.tsx)、[DashboardDataSourcesEditor](../client/src/components/DashboardDataSourcesEditor.tsx)。PRIMARY＋最多7個額外來源；以 Query 綁定其 Dataset，不是可任意直接執行 Dataset 的介面。四頁籤尚未整合。 |
| 遮蔽、公共顯示、患者揭露 | PARTIAL | 已有 Dataset 政策、逐次交付檢查及 Audit；應連至現有 Dataset 管理，不另建遮蔽政策。OR_001 缺可信患者ID及受控metadata初始化仍 BLOCKED，不能用姓名／床號替代。 |
| 表格／文字／固定資訊／位置大小 | DONE | [版型設計](../client/src/pages/DashboardLayoutDesignerPage.tsx)及[layout schema](../server/src/modules/dashboard/dashboardLayout.schema.ts)：TEXT、PARAMETER、FIELD、CLOCK、PAGE_INFO、COUNTDOWN、TABLE、CONTAINER。 |
| 圖表 | NOT_IMPLEMENTED | Widget schema、設計及播放 renderer 均無 CHART；Query Publisher 的 BarChart3 是分類圖示，不是圖表功能。 |
| 更新／換頁／每頁筆數／成功時間 | DONE | 來源設定保存前三者；成功時間格式／位置目前在版型設定。D6-3 已有交付時間、硬到期、真零筆／錯誤區分；不重寫播放時鐘。 |
| 裝置設定與生命週期 | DONE | [DashboardQueryPlaybackManager](../client/src/components/DashboardQueryPlaybackManager.tsx)、[DashboardDeviceMetadataManager](../client/src/components/DashboardDeviceMetadataManager.tsx)：預檢、啟用、一次性Token、BAT、Enrollment指引、證據、搜尋分頁及歷史。UNVERIFIED與持久Enrollment不得合併為有效播放。 |

DONE 表示本基準已有實作及既有回歸，不代表本次重新做過實機或正式DB驗收。

## 2. 四頁籤：整合現有模組

管理選定 Dashboard 後提供 `data / layout / playback / devices` 四頁籤；保留原清單、建立流程與深連結。舊 `/designer/dashboards/:id/layout` 沿用相同版型核心或轉至對應頁籤，不使用 iframe，也不複製一套 Editor。

| 頁籤 | 重用／最小調整 |
|---|---|
| 資料設定 | 重用 BasicSettings／DataSources Editor；Dataset 作為既有 Query 的關聯／篩選及管理入口，Dashboard仍只綁已發布且有權限的Query。來源參數、maxRows、轉換狀態、Dataset政策摘要及原管理連結集中呈現。 |
| 版面設計 | 抽出現有 LayoutDesigner 的可嵌入核心，保留表格／文字／固定資訊及拖曳縮放；下鑽設定在此新增，圖表列獨立階段，不先做假按鈕。 |
| 播放設定 | 同一來源草稿中的 refreshSeconds／pageSeconds／pageSize 移至此編輯；成功時間位置／格式仍寫原 profile.ConfigJson。保留原兩種保存契約，禁止宣稱「全部儲存」具跨API交易。 |
| 裝置管理 | 嵌入原 Query-only／Device Manager；保留獨立確認、完整管理 expectedVersion、一次性Token及Legacy相容區；不以清單snapshot替代寫入版本。 |

**共用狀態界線**：建立小型版本化 draft coordinator，共享同一份來源草稿與原API完整payload，避免「資料」及「播放」各存一份舊參數互相覆蓋；Presentation、來源、Layout、Device仍分別使用原契約。保存後通知其他區版本失效；409要求重載，不偷偷合併或重送。換Dashboard／身份時清空草稿及資料；跨頁籤保留一般未保存草稿並提示，但離開裝置頁籤必須清除Token記憶體、DOM及對話框，不能靠 hidden 保留秘密。加入鍵盤頁籤、44px觸控及窄螢幕回歸。

## 3. 下鑽逐項盤點

| 需求 | 判定 | 實際具備／缺口 |
|---|---|---|
| 點整列或指定欄位進下一層 | NOT_IMPLEMENTED | [QueryRuntimePage](../client/src/pages/QueryRuntimePage.tsx)資料列只有格式化顯示；Dashboard TABLE也沒有下鑽 action。 |
| 每層指定不同已發布Query | PARTIAL | 已有多來源Query及Publisher，但多來源不是階層節點／邊。 |
| 上層欄位→下層參數 | PARTIAL | [dataset.service](../server/src/modules/dataset/dataset.service.ts)、[queryCompiler](../server/src/query/queryCompiler.ts)已有型別校驗與driver bind；沒有父列來源證明或mapping契約。 |
| 多層導覽／返回 | NOT_IMPLEMENTED | 現有表格分組、小計、排序、換頁不是跨Query下鑽，也沒有breadcrumb/context stack。 |
| 整頁／側邊／彈窗明細 | NOT_IMPLEMENTED | 現有Token／設定對話框不算互動明細容器。 |
| 每層權限、遮蔽、Audit | PARTIAL | [queryDelivery](../server/src/modules/queryDefinition/queryDelivery.ts)及[runtime routes](../server/src/modules/queryDefinition/queryRuntime.routes.ts)已有JWT／TokenVersion、發布／ACL、政策及交付Audit；尚未串接下鑽來源、返回及context撤銷。 |
| PIN切換／閒置鎖定清明細與導覽 | BLOCKED | 有PIN設定／撤銷與902工作站/session/policy基礎，但沒有已啟用的PIN登入／切換／鎖定API及端到端UI。見[既有規劃](shared-workstation-and-interactive-query-plan.md)、[PIN驗收界線](workstation-authorization-pin-acceptance.md)。AuthContext一般登出不等同工作站session撤銷；不能宣稱此需求已完成。 |
| 公共Device Token不能取得互動明細 | PARTIAL | 現有Query API要求個人JWT，Device只走播放API；新下鑽API／layout過濾及負向測試尚未建立，不能把播放端的委派身份拿來當職員登入。 |

### 最小安全設計（尚未實作）

- **先做個人JWT模式**：新互動API使用既有JWT簽章／到期／live TokenVersion驗證，逐層要求VIEW_QUERY、EXECUTE_QUERY及目標Query的有效發布、ACL、Dataset／來源版本、遮蔽及患者稽核；設計權限不自動取得執行或匯出權限。公共播放保持被動，Device Token／Cookie不能建立或兌換互動context，公開layout不輸出互動graph、rowRef或隱藏綁定資訊。
- **Graph保存**：沿用 profile.ConfigJson 的獨立 `interactiveDrilldown` namespace，記錄版本、節點Query、邊、ROW／COLUMN觸發、呈現方式與參數mapping；Widget只引用穩定的root key。以既有版本化Layout API保存，新增後端嚴格schema／Query與參數驗證。不得把目前可存任意JSON誤認為已支援下鑽。建議首版上限5層、32節點，拒絕循環及失效引用；具體上限待確認。
- **可信參數來源**：後端對「確實已授權交付的父頁列」產生隨機 opaque rowRef，綁定個人身份／JWT指紋、context、Dashboard、graph版本、節點及snapshot期限。請求只送context／action／rowRef；目標Query與父欄位值由後端已保存graph及父列取出，不接受瀏覽器指定SQL、任意Query或偽造患者ID。必要使用者輸入／固定參數須在graph明列、沿用既有coercion，不得覆蓋父列綁定。
- **遮蔽鍵邊界**：首版預設拒絕遮蔽／OMIT欄位直接作綁定鍵；若必須使用不可回傳的患者識別鍵，須先核准獨立的server-only可信鍵契約，不能把公共顯示核准當成此核准，不能用姓名／床號或遮蔽後的值反查患者。OR_001條件未齊就保持BLOCKED。
- **重用交付、安全地擴充**：重用queryDelivery、已保存Dataset、typed binds及Audit finalizer；其內部需增設受控rowRef建立點，原始列只在後端短期使用，不能為了下鑽把raw rows加進公用回應。每層成功／失敗使用既有AuditLog及PatientListDisclosure，返回或快取再交付也須重新記錄必要的交付Audit，不另建歷史系統；一般Audit維持不存原始bind值。Audit失敗不交付資料／rowRef。
- **導覽與失效**：三種呈現共用一個navigation stack；返回必須重驗父層權限及期限，不能直接恢復舊患者快取。AbortController＋generation guard拒絕晚到回應；登出、身份變更、隱藏／鎖定、撤權或資料版本變更清除所有層、參數與rowRef，不放患者資料於URL、storage或跨視窗訊息。整頁模式仍留在同一受控SPA，不以患者值拼網址。
- **短期context**：重用既有[snapshot](../server/src/modules/dashboard/dashboardPageSnapshot.ts)的有界／TTL設計，另行隔離互動JWT用途，不直接兌換device snapshot。期限不得超過JWT及已核准session／idle限制；重啟／遺失context安全回覆過期，要求重新進入。多worker需共享短期context或路由一致性，不能宣稱程序內Map天然跨實例有效。
- **PIN不偷跑**：JWT版本可先驗收，但完整PIN需求必須另外完成工作站身份／最低認證強度、原子撤銷舊session、登入／切換／lock、CSRF、限速及端到端清除測試。只加前端閒置遮罩不算完成，也不得啟用敏感患者的PIN-only登入。

## 4. 預計檔案與API（提案，不是現有功能）

| 範圍 | 最小預計變更 |
|---|---|
| 四頁籤 | `client/src/pages/DashboardDesignerPage.tsx`、`DashboardLayoutDesignerPage.tsx`、`App.tsx`及各自CSS；原BasicSettings／DataSources／Device元件薄層整合，新增共用draft hook。 |
| 下鑽設定 | `dashboardLayout.schema.ts`、`dashboardQuerySources.service.ts`；必要時擴充版型讀取的私有／公開投影。Layout repository原JSON保存可重用。 |
| 下鑽交付 | 新增 `server/src/modules/dashboard/dashboardDrilldown.{routes,service,schema}.ts`與有界context store；必要時擴充`queryDelivery.ts`內部協調點，沿用queryCompiler、Dataset service及現有Audit repository，避免複製安全引擎。 |
| 互動畫面 | 新增`DashboardDrilldownHost`／navigation hook；從QueryRuntime抽取純結果renderer供重用，不直接沿用其含結果的整頁狀態。`AuthContext.tsx`僅做必要清理接線；真正PINsession另案。 |
| 回歸 | 既有dashboard-management／layout／playback／device及queryDelivery測試；新增drilldown服務、參數來源、跨身份、三呈現容器與鎖定回歸，範圍隨階段縮小。 |

既有API沿用：`query-sources/v1/configuration`、PATCH `primary`／根sources／`presentation`、PUT `layout`、`query-mode/v1/preflight`及裝置管理API。資料與播放欄位重排不新增同義API。**建議新增**JWT-only的 `POST /api/dashboards/:id/interactive/v1/contexts`、`POST .../contexts/:contextId/navigate`、`POST .../contexts/:contextId/back`、`DELETE .../contexts/:contextId`；請求／回應均no-store，嚴格限定已保存action、當前身份及期限。匯出首版不新增，若日後提供須獨立EXPORT_QUERY及交付Audit。

## 5. 資料表與Migration

- **四頁籤＋JWT下鑽首版：預期不需要新表／Migration。** 使用022／024既有`DashboardDisplayProfile.ConfigJson`、`DashboardWidget.ConfigJson`，有界互動context先為短期伺服器狀態；需補後端驗證及公開回應過濾，不能修改歷史Migration或926。舊版仍可顯示既有Widget；不認識graph時不得執行互動，也不能在編輯時抹去未知namespace。
- **圖表：需要獨立評估forward Migration。** [022](../database/migrations/022_dashboard_layout_designer.sql)與[024](../database/migrations/024_dashboard_visual_styling.sql)的`CK_DashboardWidget_Type`只有八種既有值。若新增真正`WidgetType='CHART'`，SQL設計為以交易替換該CHECK，保留全部舊值並加入CHART，使用WITH CHECK且維持enabled/trusted；資料表／欄位不必新增，系列／類型等仍用ConfigJson。Migration編號另排，不改022／024／926，本次不建立或執行SQL檔。舊Server不支援CHART，故回復程式前需相容reader或停用新圖表，不能聲稱直接退版完全相容。
- **PIN／工作站**：先沿用902–905的基礎；需另案核對session／assurance／revocation實作及Schema是否足夠，不能由本次靜態盤點保證不需後續Migration。若未來要持久graph版本／跨實例context，也須先提Schema設計再核准，不在首版預建資料表。

## 6. 開發作業與驗收建議

| 建議作業 | 可交付／必要驗收 |
|---|---|
| 1. 四頁籤整合 | 原路由／一般使用者入口保留；同一份來源草稿；跨頁籤dirty／CAS／Token清除；裝置流程、20秒換頁、成功時間及觸控回歸不退步。 |
| 2. JWT下鑽後端 | Graph／mapping嚴格驗證及opaque rowRef；假父列、跨user／Dashboard、改Query、SQL注入、過期、撤權、政策／發布變更、Audit失敗均拒絕；無Device換互動權限，原始識別碼不出現在回應／一般Audit。 |
| 3. 多層互動UI | ROW／COLUMN觸發、各層不同Query、breadcrumb返回、整頁／側邊／彈窗；晚回應、錯誤、換身份／隱藏清空所有層，不能由browser參數偽造下一層來源。 |
| 4. 整合收斂 | JWT模式端到端、RBAC／遮蔽／患者Audit、原播放／裝置回歸；受影響Server／Client測試、Typecheck、Build及完整CI。未完成PIN不得標示全需求PASS。是否交付Windows包由後續實作任務授權，本次不產包。 |
| 另加1次：圖表 | 僅在Migration設計核准後做小範圍圖表；來源仍是授權／遮蔽後資料，禁用任意JS／HTML／SQL。驗證既有Widget、公共播放政策及舊版讀取／退版限制。 |
| 另加1–2次：PIN工作站 | 先安全契約及session後端，再切換／idle UI；A→B原子撤銷、並行舊請求、逾期、工作站撤銷、鎖定及明細／導覽全清除均通過，必要審查未完成則BLOCKED。 |

**估算**：JWT核心約4次Codex開發作業；完整含圖表及真正PIN切換約6–7次，外部資料／安全核准不計入且不保證能以程式修改解除BLOCKED。先完成作業1即可改善管理體驗，不需等待新資料功能。

## 7. 節省Token及本次結束界線

每次沿用本報告與指定HEAD，只讀該階段列出的檔案／契約差異；固定可重用的安全fixture，避免重查D1–D6歷史。先跑改動相關測試，穩定後跑一次最終完整CI，純文件不重跑Server／Client／Browser。不做無關重構、不另建Publisher／Dataset／遮蔽／Audit系統、不為每個小項目要求重新下載包。PIN、圖表Migration、可信患者鍵是明確gate，不能以UI或假資料解鎖。

本次只新增此設計文件；未修改功能／SQL／Migration、未連正式DB、未操作C:\UQP、未製作更新包、未提交／push。完成後停止，等待設計確認再實作。
