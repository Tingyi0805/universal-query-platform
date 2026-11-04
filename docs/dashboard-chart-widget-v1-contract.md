# Dashboard 圖表 Widget V1：第一階段契約（尚未啟用）

## 1. 沿用原有 Dashboard，不建立第二套

Dashboard 仍使用原有四個分頁：資料設定、版面設計、播放設定、裝置管理。
沿用 DashboardDisplayProfile、DashboardWidget、Query Publisher、PRIMARY 與附加 Query 資料來源。
未來同一畫布可混合文字、TABLE、長條圖、折線圖及圓餅圖，既有全螢幕播放、輪播、裝置 Token 與安全機制不變。

本階段僅加入純函式 V1 設定契約與驗證測試，不開放在管理頁新增 CHART：
- server/src/modules/dashboard/dashboardChartWidget.contract.ts
- server/src/modules/dashboard/dashboardChartWidget.contract.test.ts

現階段 layoutSchema、SQL CK_DashboardWidget_Type、編輯器工具箱、正式播放頁均不包含 CHART。
沒有新增 Migration、管理 API、畫面元件或變更現行 Widget 資料。即使測試通過，也不代表圖表已能儲存或播放。

## 2. V1 設定契約

| 欄位 | 內容 |
| --- | --- |
| version | 固定 1 |
| chartType | BAR、LINE、PIE |
| dataSourceKey | PRIMARY 或合法附加來源代碼 |
| categoryColumn | 明確批准的分類欄位 |
| valueColumn | 明確批准的數值欄位，不得與分類欄位相同 |
| valueMode | 固定 QUERY_RESULT |
| maxPoints | 1–50 |
| showLegend | 布林值 |

V1 僅呈現已發佈、已授權 Query 產生的資料。例：各手術室當日件數必須由 Query 的安全彙總結果直接交付；圖表端禁止對原始患者資料自行 COUNT、SUM、GROUP BY 或推算額外統計。
每個類別只能出現一次，圖表不會自行合併類別。

## 3. 授權及資料一致性要求

1. 來源資料必須經既有 Query Delivery、欄位授權、遮蔽與 Audit 流程，再交由圖表投影。不能信任瀏覽器或 ConfigJson 聲稱的 authorized、complete、maskedBeforeDelivery 旗標。
2. 只有後端明確核准顯示的分類欄位與數值欄位，才能用於圖表；缺少欄位、權限撤銷、無法證明已遮蔽都必須拒絕。
3. 需要具可證明完整性的查詢結果：分頁、資料截斷、更新錯誤或資料不齊，均不得誤以「全日統計」顯示。不得藉圖表繞開原有來源最大筆數或患者披露稽核。
4. 單圖最多 50 個資料點，超出必須明確拒絕，不能靜默截斷。數值須有限、有界；PIE 不接受負值，類別不可重複。
5. 投影函式只產生 label、value，額外患者識別碼或查詢參數不進入圖表輸出。
6. 如來源是公共螢幕，必須使用既有公共披露、遮蔽、設備授權及審計流程，不能直接用登入者的原始查詢結果取代。
7. 服務端可信授權回應的連接邏輯尚未實作；目前的投影函式不會自己進行資料庫權限判斷，不能單獨視為安全交付器。

## 4. 後續正式開放 CHART 的必要工作

需單獨規劃向前相容的 Migration 更新 WidgetType CHECK Constraint，
並同步擴充後端 layoutSchema、資料來源引用驗證、版面設計器、
設計預覽與正式全螢幕播放。所有流量仍走既有 Query Delivery，延續授權、快照、遮蔽、裝置 IP/Token 與 Audit 檢查。

在 SQL Server 2019／2022、Server／Client 回歸、安全及人工驗收完成以前，
不啟用 CHART，不執行正式 Schema 變更，不影響 Migration 927 或 PIN Runtime。

## 5. 本階段驗收範圍

V1 單元測試驗證設定白名單、來源一致性、缺失欄位、
未授權或未遮蔽的拒絕、不完整資料拒絕、
上限、數值檢查，以及禁止多餘欄位洩漏。
這不是實際患者資料、完整儀表板、真實瀏覽器或正式設備的驗收。


## 6. 第二階段：伺服器內部已稽核 Page Bridge（尚未啟用）

新增純伺服器橋接器與測試：

- server/src/modules/dashboard/dashboardChartDeliveryBridge.ts
- server/src/modules/dashboard/dashboardChartDeliveryBridge.test.ts

Bridge 介面可接收既有 Query-only 來源執行器的 page() 回應，但不提供 HTTP Route。
其設計只接受由既有伺服器權限檢查、來源有效性、遮蔽、患者揭露 Audit
與最後版本重驗後成功交付的單一完整資料頁。

Bridge 再核對同處理程序的原始快照之來源、Query、Dataset、敏感政策版本、
安全模式、過期時間與資料數量；要求 totalPages=1、truncated 明確為 false
且原始／交付資料行數一致。分類及數值欄位不能被遮蔽；不符合時直接拒絕，
絕不拿單一分頁或截斷結果冒充完整統計。

**重要未完成條件：**目前仍缺一個真正的、伺服器核發的 Chart 欄位核准來源
(ServerChartApprovalReader)，必須檢查既有 Query 是否確實輸出可靠彙總，
並證明選取欄位符合 Dataset、公共螢幕遮蔽及欄位政策，核准版本可抵抗
A→B→A 異動。目前此 Reader **刻意未接上正式實作**；測試只用合成核准模擬，
不能把橋接器直接接成管理 API 或播放 API。

Bridge 的單元測試也不能取代真正的 Query-only 執行流程、SQL 2019／2022、
資料來源更新競爭、HTTPS 裝置授權或公共螢幕人工驗收。
CHART Widget、既有 SQL CHECK、版面設計器及正式全螢幕播放仍全部保持未啟用。


## 7. 2B：伺服器端欄位核准政策（僅純函式，尚未連接正式 SQL）

新增 dashboardChartApproval.policy.ts 與同名 .test.ts，作為日後可交由真實伺服器
Repository 使用的 ServerChartApprovalReader 驗證政策。

必要證據須同時成立：

- Query Publisher 項目仍已發布、啟用、未封存，且 Dataset 啟用、來源綁定一致。
- 即時使用者身分／TokenVersion、Query 權限、來源是否已啟用，以及可信的 Dashboard 核准版本均正確。
- 分類欄位在報表定義中明確為 GROUP 欄位，數值欄位明確為 COUNT／SUM 等統計欄位，數值資料型別允許；兩欄都必須唯一、可見。
- 兩欄在 Dataset 敏感欄位規則中均須明確標為 OTHER／NONE，不能經遮蔽、缺漏或重複別名導出。
- 公共／使用者播放必須核對已確認且符合敏感政策版本的公共顯示授權，兩欄均有明確許可。
- 除報表設定之外，**必須有另一份伺服器可信的 Query SQL 彙總語意驗證證據**，證明已發布的 Query 本身產生「每個分類一筆彙總結果」。僅有 ReportColumn.groupOrder 或 aggregateType **不是安全證明**。
- 彙總證據應綁定 Query 與 Dataset 的不可重用修訂序號；來源與權限證據同樣須由可信 SQL 取得，核准版本變更時禁止重用快照。

**本階段尚未實作可信的 SQL 彙總語意驗證器，也沒有把真實 SQL Repository 接進讀取器。**
若缺少 VerifiedQueryAggregate 證據，核准一律回傳 null。合成單元測試
可注入模擬證據檢驗安全政策，但這不代表實際 Dashboard 可以使用圖表。

以下仍禁止：增加 CHART 至 layoutSchema、WidgetType SQL CHECK、設計工具箱、
正式播放路由，以及任何繞過原有 Query Delivery 與揭露稽核的圖表 API。

### 2B 後續項目

1. 實作具足夠語意證明的 SQL Query 彙總檢查，對 Oracle／SQL Server 等來源
   分別提供可靠的來源驗證；無法解析時明確拒絕，不能只靠字串搜尋 GROUP BY。
2. 在一個可驗證的伺服器端讀取流程提供 Query、Dataset、來源綁定、公共顯示、
   欄位政策及不可重用的修訂證據；避免把管理 UI 或使用者送出的資料當成事實。
3. 經 Server／Browser／SQL 2019／2022 等隔離驗收及人工安全審查通過後，
   才進一步規劃圖表 Widget 的 Migration、設計器與全螢幕播放。


## 8. 2B-2：既有 SQL Repository 的唯讀候選證據（仍不核發圖表授權）

新增 server/src/modules/dashboard/dashboardChartEvidence.reader.ts 與相對應單元測試。

本階段的讀取器以既有 UQP Repository 讀取工作站來源綁定、即時 TokenVersion
與使用者權限、Query 定義與 ACL、Dataset 啟用狀態、欄位稽核政策、ReportColumn
和公共顯示核准。查詢版本候選讀取 QueryDefinitionVersion 目前最高 VersionNo，
Dataset 版本候選讀取 DefinitionRowVersion；兩者缺失或型別不符就拒絕，
不使用時間戳或純文字雜湊假裝不可重用的版本。

讀取過程至少在前後檢查 Dashboard 既有 919 核准證據與 Query ACL。
但目前各 Repository 的讀取並非在同一交易內整體鎖定，
因此這個唯讀讀取器**不是最終可核發的正式憑證**；
後續必須補強同一信任邊界內的版本競爭驗證。

最重要的是：預設 getVerifiedAggregate 永遠回傳 null，
**不會因 ReportColumn 的 GROUP／COUNT／SUM、數值型別或原始 SQL 含有
GROUP BY 字串而核准圖表**。合成單元測試只驗證候選讀取、權限失效拒絕、
裝置核驗、前後證據變動拒絕，不能證明實際 SQL 的彙總語意。

沒有註冊任何 CHART 路由、Widget 儲存、圖表渲染或播放功能。
正式資料庫、Migration 927、PIN Runtime 及現有 Dashboard 維持原樣。


## 9. 2B-3：SQL Server／Oracle 窄版 GROUP BY COUNT(*) 語意證明（未啟用）

新增 server/src/modules/dashboard/dashboardChartSqlAggregate.proof.ts 與同名 .test.ts。

本次是**封閉式、完整耗盡 token 的 SQL 子集解析器**，不是搜尋字串有沒有
GROUP BY。只接受下列兩種來源 SQL 的共同受限語法：

    SELECT <column> AS <category>, COUNT(*) AS <value>
    FROM [schema.]<single_table> GROUP BY <same_column> [;]

其中 <column>/<category>/<value> 與 table 是單一有效識別字（可依 SQL Server
方括號或 Oracle 雙引號明確引用）。分類欄位必須與 GROUP BY 指定的欄位一致，
輸出別名必須與目前圖表設定一致，Query、Dataset ID 及不可重用的修訂值須合法。

不可接受的語法一律拒絕，包括 WHERE、JOIN、HAVING、ORDER BY、子查詢、CTE、
DISTINCT、COUNT(DISTINCT)、SUM／AVG、第二個分類欄位、表達式、函數、
註解、字串、綁定參數、UNION、多敘述、ORACLE CONNECT BY、SQL Server TOP
及超過辨識上限的 SQL。

這個純函式只能證明「給定的 SQL 文本符合一個極小的單表分組計數語法」，
**不能證明**資料表或分類欄位沒有個人資料、資料來源 ACL 完整、SQL
實際執行結果未被截斷、編輯時版本與播放時版本一致、公共顯示已核准、
患者曝光稽核已完成；其他強制安全閘門不得因這個證明而略過。

本階段仍**未將證明器接進預設 SQL 證據讀取器**。目前
chartFactsDefaults.getVerifiedAggregate 依然回傳 null，
不能被管理畫面、Widget 儲存 API 或公共播放路由使用。
未來須先用可信 Repository 取得正在使用的已發布 Query 與 Dataset
SQL 本文、來源方言及其修訂證據，在前後一致性驗證成立後才可輸出證明。
尚需實際 SQL Server／Oracle 相容性測試及來源權限／版本競爭驗收。


## 10. 2B-4：已發布 Query 與 Dataset SQL 修訂綁定（停用中）

新增 dashboardChartSqlAggregate.reader.ts 及 .test.ts。

- 讀取器在單一 SQL Server SERIALIZABLE 唯讀交易中，從既有
  QueryDefinition、Dataset、DataSource、QueryDefinitionVersion 讀取
  目前已發布／啟用／未封存的 Query 與 Dataset、來源方言、Dataset SQL 本文、
  QueryVersionNo 與 DefinitionRowVersion，且不把 SQL、患者資料帶出為播放結果。
- 工廠函式 createVersionBoundCountProofReader 使用明確綁定的 Chart V1 設定，
  核對查詢 ID、Dataset ID、兩份修訂值及方言，全部符合後才呼叫
  proveSimpleGroupedCount 的窄版 SQL 語意解析器。
- 因更新發生的 SQL、來源狀態、修訂或 ID 差異，直接拒絕產生證明。
  不確定的 Query 仍不可顯示圖表。
- QueryVersionNo 是既有版本歷史讀取，並不代替即時權限與 Dashboard
  核准證據；Dataset DefinitionRowVersion 的讀取也不代替同一交易內的
  敏感資料與 Public Display 核准。這些跨 Repository 邊界需進一步驗證。
- 目前單元測試使用合成唯讀 Snapshot。CI 既有 SQL Server 2019／2022
  回歸不等於新讀取器已通過真實 SQL 端到端測試；Oracle 方言目前只驗證
  字法及語意子集，未實際執行 Oracle 查詢。
- **正式功能仍關閉**：沒有把這個可選的證明讀取器綁進
  chartFactsDefaults.getVerifiedAggregate；預設依然回傳 null。
  沒有增加 CHART Widget、寫入 API、Migration 或播放路由。

後續上線前另需評估小樣本計數是否可能揭露個別患者資訊，
例如單一手術室某時段只有 1 件時，不能單以「GROUP BY 已證明」當作公共
播放的完整隱私核准。


## 11. 2B-5：跨 Repository Revision Fence 與小樣本揭露阻擋（仍停用）

新增 dashboardChartRevisionFence.ts／.test.ts，以及
dashboardChartPublicCountPrivacy.ts／.test.ts。
本階段只新增**尚未串到 Chart Delivery／HTTP API 的安全原語**。

### Revision Fence

- 單一 UQP SQL Server SERIALIZABLE 唯讀交易，使用現有 Dashboard 與
  附加來源核准 RowVersion、Query 版本歷史、Dataset DefinitionRowVersion、
  DataSource ConfigurationRowVersion、敏感政策 VersionNumber 及
  Public Display RowVersion，讀取目前已發布、啟用且仍有查詢權限的來源。
- 同交易重驗帳號 TokenVersion、角色權限與有效 Query ACL，對公共播放
  另檢查公共顯示的 Dataset／DataSource／敏感政策版本是否相符。
- 結果僅返回作用範圍與不可直接還原資料的 SHA-256 指紋，
  不傳回 SQL、密碼或患者資料。外層驗證器可在現有 Query Delivery 前後
  比對指紋；不符拒絕圖表，不能回傳半成品。
- 這不代替原有裝置 Token／IP 限制、欄位白名單、患者曝光 Audit 或
  Query Delivery 內部逐步重驗；目前尚未接到這些實際執行鏈中。
- **目前 CI 的 SQL Server 2019／2022 隔離回歸並未直接呼叫本次
  Revision Fence SQL**。要讓這套 SQL 成為可靠的上線安全證據，
  仍須在一次性 SQL 測試環境補上真實 Schema、交易競爭及 ABA 回歸。

### 小樣本／差異推算保護

- 新的 PublicCountPrivacy 原語要求獨立、伺服器可信且與來源
  Query、Dataset、欄位、敏感政策版本完全對應的人工隱私核准。
- 需明確評估分類欄位與重複播放時間窗的差異推算風險；
  缺少核准一律拒絕。
- 目前保守的每分類最低件數為 5（僅是**開發階段的最低技術護欄，
  不是院內正式隱私門檻**）；小於門檻、零值、不完整或不合法數字，
  一律拒絕整張圖，不自動隱藏單筆後仍顯示可能推得個資的其他筆數。
- 即使大於門檻，仍可能因唯一手術／單日事件／跨時段比對而重識別。
  將來必須另外建立真實的審查結果 Repository、時間窗及再識別
  風險控管，才可能讓公共看板使用統計圖。

### 與 CI #1283 的關係

CI #1283 的 Server、Windows 與 SQL Server 2019／2022 既有回歸已 PASS，
但 Client Browser E2E 因 D6-3 窄螢幕測試在裝置重新載入後，按鈕尚未
恢復 Enabled 就執行焦點檢查而有兩筆失敗。本階段同步在原測試加上
「確認按鈕恢復 Enabled」的等待，再保留既有鍵盤焦點與 CSS 斷言。
不放寬正式產品行為或移除測試。

### 正式啟用界線

PR 仍為 Draft。chartFactsDefaults.getVerifiedAggregate 仍回傳 null；
任何 CHART SQL CHECK、Layout Schema、API、UI、全螢幕播放、Migration 927
及 PIN Runtime 均不變。必須先完成**可信證據接線與真實 SQL 競爭測試**，
再討論圖表 Widget 的正式啟用及人工驗收。


## 12. 2B-6：Revision Fence SQL Server 2019／2022 真實引擎隔離驗證

本階段為 Revision Fence 新增**可注入同一個受信任 SQL 連線池的工廠**，
正式預設仍使用原有 UQP Pool，不改變任何路由或圖表授權。
同時新增專用驗收腳本：server/src/scripts/chartRevisionFenceSqlAcceptance.ts。
沿用既有 device-lifecycle-d1-sql CI 的 SQL Server 2019／2022 一次性容器；
為避免影響 D1 測試的 Dashboard／Dataset 物件，另建 UQP_CF_ 隨機名稱的
**獨立合成資料庫**，完成後強制刪除。環境守衛驗證一次性 Scope、
容器 MachineName、master 及禁止平台 DB 設定，拒絕外部正式資料庫。

驗收腳本建立極小的、與 Production Reader 相同必要欄位型別的合成 Schema，
實際執行版本讀取器、現有 getTokenSessionState、getEffectiveQueryAccess
及 getQueryAccessRevision：

- PRIMARY 與附加來源的識別、授權及版本指紋。
- Dataset SQL A→B→A 後實際 RowVersion 前進；QueryDefinitionVersion
  增版及敏感政策版本異動必須令指紋改變。
- 現有 Query ACL 撤銷、TokenVersion 改變、帳號停用及附加來源停用時
  必須拒絕。ACL 恢復時模擬 919 Writer 同步推進 Dashboard ApprovalRowVersion。
- 公共播放須 Query-only 啟用，且 925 顯示核准所綁的 Dataset／DataSource
  修訂版本相符；DataSource 更新後原核准即失效。
- 在資料交付前後故意修改 Dashboard RowVersion，確認版本欄柵會拒絕結果；
  Query 取消發布與 DataSource 停用也不得通過。

**驗收限制：**此測試使用合成的最小 SQL Schema 而不是完整正式 925
Catalog 與所有 Trigger／Writer；其通過只能證明新 Reader 在 SQL 引擎上
使用既有必要欄位及真實權限查詢可正常拒絕指定風險，不能宣稱
已驗證任意跨節點交易競爭、所有資料庫 Writer、完整 925 安全契約，
或正式患者資料揭露稽核。Chart Revision Fence 和 PublicCountPrivacy
目前仍未串接 Query Delivery；圖表、版型、Migration 927、PIN Runtime、
現有全螢幕播放及正式 C:\UQP 不受影響。

### 附帶 CI 修正

CI #1283 的 Browser E2E 有兩個 D6-3 焦點斷言失敗，原因是重新載入後按鈕
尚未可用就測試 Tab 焦點。本次延續 2B-5 加入等候 Enabled 的修正，不刪減
原本的焦點／樣式／窄螢幕驗證。完整結果以新 HEAD 的 CI 為準。


## 13. 2B-7：純伺服器圖表安全交付整合層（仍未啟用）

新增：
- server/src/modules/dashboard/dashboardChartDelivery.coordinator.ts
- server/src/modules/dashboard/dashboardChartDelivery.coordinator.test.ts

這不是新的 Chart HTTP API。**既有 Dashboard 路由、儲存 Widget 的型別與資料庫
CHECK Constraint、正式全螢幕播放器都沒有增加 CHART**。
目前只提供一個依賴注入的內部整合層；沒有註冊任何正式工廠或 singleton。

### 安全交付順序

1. 明確 runtime gate 為關閉時，不讀取 Widget、不執行 Query。
2. 由可信的未來 Widget Repository 讀取已儲存 CHART 設定與 ROWVERSION；
   不採信外部傳入的 config、授權結果、版型 ID 或隱私核准。
3. 使用目前已發布 Query、Dataset、欄位白名單、敏感政策、公共顯示
   核准以及 SQL Server/Oracle 受限 COUNT(*) 語意證據評估圖表欄位。
4. 在現有已稽核 Query-only Page Delivery 前後比對 SQL Server Revision Fence
   及圖表核准結果；原有 Delivery 必須完成 Device Token/IP/session、
   敏感欄位遮蔽、快照完整性、患者揭露 Audit 及最後重驗。
5. 一般使用者、裝置播放及管理員公開預覽，都必須**先**取得獨立的
   小樣本／跨時段差異推算隱私核准；完成稽核後再次驗證同一核准修訂。
   內部 staged designer 預覽不代表公共播放已通過隱私審查。
6. 投影只交付 chartType、showLegend 及 label/value；
   除分類和核准數值外的患者欄位不得被傳遞。
7. 傳回前再次比對可信 Widget ROWVERSION／設定內容與所有已核准證據；
   任一資料異動、核准撤銷、頁面截斷、稽核失敗、掩碼差異或
   隱私複查失敗時，整張圖拒絕，不轉用原始資料或舊版 Legacy 播放。

### 尚未具備正式接線條件

- **現有 Dashboard 無 CHART Widget 儲存契約**，因此沒有可用的
  readSavedWidget 實作。測試使用合成且可撤回的可信 Widget。
- **沒有正式 PublicCountReview Repository**。人工核准、審查修訂、
  最低組別門檻及跨時段防差異推算政策尚未完成。測試只用合成核准。
- **既有 Query-only 執行器尚未正式掛接本 coordinator**；測試模擬其
  授權結果與稽核頁面，用隔離快照驗證串接順序，不等於實際患者
  曝光稽核 HTTP 端到端驗收。
- createDormantSqlChartFactsReader 是明確可呼叫的
  Query/SQL 語意證據組合工廠，**不是**啟用正式
  chartFactsDefaults.getVerifiedAggregate 的行為。
- 需要完整 925 Catalog、真實 Widget storage CAS、跨節點快照、
  Device Session／IP、Query-only 資料交付與醫院隱私政策的實際驗收後，
  才可進入規劃 CHART Widget Type Migration／前端編輯與全螢幕播放。

本階段不修改 Migration 927、PIN Runtime、Dashboard Token、既有表格
或正式 C:\UQP；PR #83 仍為 Draft，不授權正式覆蓋。


## 14. 2B-8：CHART Widget 版本封印與公共統計獨立隱私審查（尚未啟用）

新增：
- server/src/modules/dashboard/dashboardChartTrust.repository.ts
- server/src/modules/dashboard/dashboardChartTrust.repository.test.ts
- server/src/scripts/chartTrustSqlAcceptance.ts（由既有 D1 2019／2022 一次性驗收呼叫）

### 尚不存在正式資料庫的側表契約

**現有 uqp.DashboardWidget 的 CHECK Constraint 不允許 CHART，且尚未具備
足以讓 CHART 使用的獨立封印 RowVersion。** 本階段不改原有 SQL、既有
Migration 或正式 Schema，也不創建正式的 CHART Widget。為了安全地評估未來
啟用所需的兩個信任邊界，實作了僅有 SELECT 的 dormant readers：

- uqp.DashboardChartWidgetSeal（預計新側表）：
  每筆須綁定真實 DashboardWidget.Id、ProfileId→DashboardId、ConfigJson、
  SourceKey、伺服器 SHA-256 ConfigDigest、封印狀態、獨立封印者及
  SealRowVersion。讀取時逐欄核對 WidgetType=CHART、Dashboard 所屬、
  ConfigJson 全文摘要與嚴格的 Chart V1 Schema。不得由瀏覽器傳入可信版本。
  未來版型寫入器必須**同交易**更新封印與 ConfigDigest，連 A→B→A
  也要推進 RowVersion；這份 Writer／Trigger 合約尚未建立。

- uqp.DashboardChartPrivacyReview（預計新側表）：
  統計核准須在伺服器持久化記錄 Dashboard、Query、Dataset、SourceKey、
  分類／數值欄位、QueryRevision、DatasetRevision、PolicyRevision、
  狀態、最低分組件數、分類風險／跨時段推算審查、ReviewerUserId、
  AuditLogId、ReviewedAtUtc、ValidUntilUtc 及不可重用的 ReviewRowVersion。
  僅接受有效的 APPROVED，且審查者與目前執行者不同；審查有效期
  不得長於 90 天。任何撤銷、過期、欄位不符、政策改版或相同範圍
  重複批准紀錄都不回傳有效核准。reviewRevision 由可信資料列、
  ROWVERSION、稽核識別與作用範圍產生 SHA-256。

### 一次性 SQL Server 引擎隔離驗收

僅在既有 D1 一次性容器內的獨立 UQP_CF_ 隨機資料庫，建立與讀取器
一致的最小合成 DashboardWidget／封印／Review 結構，測試 Widget 校驗、
ConfigDigest 不符拒絕、A→B→A 版本推進、撤銷封印、公共審查
審查人／範圍／版本核對、取消核准／復原／過期拒絕。結束後會隨
UQP_CF_ 測試資料庫一同清理。這不是正式 Schema migration，
也沒有使用真正患者資料或正式 AuditLog。

**驗收限制：**本次並未建立正式的 Sidecar Migration、Writer CAS、
觸發器、稽核審查申請／核定 API 或帳號權責流程，也沒有把這兩個
Reader 註冊到正式 Chart Coordinator。側表讀取對既有正式資料庫
會因缺少側表或 CHART 類型而 fail closed。完整 925 Catalog、發布版本、
權限變更競爭、跨節點資料交付、病人揭露稽核及公開隱私審查仍須另案驗證。

原有 Dashboard、Query Publisher、已啟用播放器、裝置 Token、
Migration 927、PIN Runtime 及正式 C:\UQP 維持原樣。


## 15. 2B-9：版本封印 CAS／隱私申請核定撤銷的原子寫入器（仍未啟用）

新增：
- server/src/modules/dashboard/dashboardChartTrust.writer.ts
- server/src/scripts/chartTrustWriterSqlAcceptance.ts

**此程式沒有預設實例、沒有正式 API／路由、沒有正式 Migration，
且預設部署中的 DashboardWidget SQL CHECK 仍禁止 CHART。**

### 執行邊界與交易流程

createDormantChartTrustWriters 需要呼叫者明確注入：
(1) SQL Server connection pool；
(2) 明確的啟用閘門；
(3) **同一 SQL 交易內**重驗操作者 TokenVersion、權限與功能職責的授權器；
(4) 在同一交易內重新計算 Query／Dataset／Dashboard／敏感政策／公開顯示
修訂與來源綁定的可信作用範圍讀取器。預設並沒有掛接正式授權器。

寫入交易採 SERIALIZABLE、XACT_ABORT ON、固定範圍的
UPDLOCK/HOLDLOCK、CAS 比對與交易內 AuditLog。
新側表 uqp.DashboardChartTrustRequest 用唯一 RequestId 持久保存每次
寫入決策及稽核關聯，以免在資料 A→B→A 後重送同一請求。若帳號失效、
版本不符、Audit 失敗、重複 RequestId、來源無法核對，整筆交易回滾。

### CHART Widget 版本封印

sealWidget 只處理**可信來源已存在**的 CHART Widget：
需檢查 Profile 所屬 Dashboard、WidgetType、SourceKey、受限 Chart V1
Config，以及前次 SealRowVersion。將 Widget.ConfigJson、
封印 ConfigDigest、封印者與 AuditLogId **同交易**更新，並以
SealRowVersion CAS 取得下一版本。即使內容還原為相同 JSON，
版本依然前進。舊版本不可覆蓋新版本。

**尚缺**正式 CHART Widget 新建流程，以及與既有會刪除／重建 Widget 的
版型設計器的完整 Writer／Trigger 同交易接合。正式 Schema 不變。

### 公共統計隱私審查生命週期

- requestReview：只由已通過授權的申請人提出，
  以伺服器可信的 Query／Dataset／公開政策版本檢查作用範圍，
  不得存在同範圍 REQUESTED／APPROVED 的有效決策。
- approveReview：需不同於申請人的獨立核准者，核對 ReviewRowVersion、
  再確認作用範圍仍是最新，並明確確認分類隱私及差異推算已審查；
  最低組別件數至少 5（非院內正式標準），有效期不逾 90 天。
- revokeReview：需有獨立撤銷權限，透過 CAS 將 APPROVED 改成 REVOKED，
  任何舊版核准不能再用；重新申請要建立新 Review 決策。
- 三種操作均同交易寫入 AuditLog、不可重送 RequestId 與 ReviewRowVersion，
  不提供靜默回復或舊核准重用。

### 一次性 SQL Server 引擎測試與限制

延用 D1 2019／2022 一次性容器的隔離 UQP_CF_ 資料庫，
新增合成 AuditLog、RequestId ledger、Widget Seal AuditLogId
及 Review 申請欄位。測試採合成申請人／核准者、真實 UQP Token／權限
Repository 驗證 TokenVersion，並覆蓋 CAS、A→B→A、身分分離、
版本異動、撤銷、請求重送與交易稽核筆數。

**仍非完整正式驗收**：目前只有合成的最小 Sidecar Schema、
注入式授權器及測試專用 readLiveScope。未提供核准申請 UI、
審查人員管理、正式 SQL Migration、所有 Writer 的統一鎖順序、
跨節點權限競爭、完整患者揭露 Audit／公共螢幕端到端驗收，
不應以測試通過推論可以在正式 UQP 啟用 CHART。
正式 C:\UQP、Migration 927、PIN Runtime、既有 Dashboard
與播放設定保持原樣。


## 16. 2B-10：共用版型刪除重建寫入器的 CHART 封印防護（仍未啟用）

實際追查兩條既有路徑：

- 舊版 `replaceDashboardLayout` → 共用 `writeDashboardLayout`。
- Query Source 管理 `createQuerySourceStore.writeLayout` → 同一共用 `writeDashboardLayout`。

現行寫入器會先整批 DELETE `DashboardWidget`／`DashboardDisplayProfile`，再 INSERT 重建；
原始 Widget Id 及版型身分不會保留，因此不能讓已封印 CHART 隨此路徑寫入。

2B-10 在共用 DELETE **之前**增加 `assertChartLayoutReplacementSafe`：

1. 同一既有 SQL transaction、Dashboard parent UPDLOCK／HOLDLOCK，明確拒絕由舊版型輸入新建 CHART 或未知 WidgetType。
2. 即使尚無 sidecar，先查既有 WidgetType='CHART'，任何該 Dashboard 下已存在 CHART 均拒絕整批版型重建。
3. 僅在 sidecar 真正存在時查 `DashboardChartWidgetSeal`；任何附屬封印，包括殘留在非 CHART Widget 的異常封印，都拒絕整批替換。缺 Catalog 的正式舊版仍可使用普通 Widget，不要求執行 Migration。
4. 此守衛在共同函式內，因此同時覆蓋 Legacy 與 Query Source 版型儲存；原本權限、模式、Audit 與現有 Widget schema 完全不放寬。

新增 `dashboardChartLayoutReplacement.guard.test.ts` 純單元拒絕測試，及 `chartLayoutReplacementSqlAcceptance.ts`。
SQL Server 2019／2022 使用既有 D1 隔離 `UQP_CF_` 合成資料庫，測試：
封印 CHART、未封印 CHART、掛在 TEXT 上的殘留 Seal 都不能被共用 DELETE 移除；
無 CHART 或 Seal 的其他舊版版型仍可刪除重建。只驗證安全守衛與清除路徑，未測正式圖表建置。

**正式啟用前仍須補齊**：未來 CHART 建立、版型編輯、封印、停用或刪除應統一 Dashboard → Profile → Widget → Seal 鎖順序，並提供真正的封印 epoch／CAS 與原子 Audit；資料庫 Trigger／完整 FK、直接 SQL 更新、跨進程並行與完整 925 實際 Schema 仍未驗收。此次守衛不能代替上述完整寫入者契約，尤其不能由側表不存在推論可以開放圖表。

CHART 型別、正式 SQL CHECK、管理 API、設計器、播放器、Migration 927、PIN Runtime 均保持不變；PR 維持 Draft，正式 `C:\\UQP` 不變。
