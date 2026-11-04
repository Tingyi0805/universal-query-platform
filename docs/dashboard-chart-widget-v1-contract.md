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


## 17. 2B-11：共用 CHART Writer 鎖定順序及跨連線競爭（仍未啟用）

新增 `dashboardChartMutationLocks.ts`，所有參與的 Application Writer 在
同一個 `SERIALIZABLE` SQL transaction 內依序取得
**Dashboard → DashboardDisplayProfile → DashboardWidget →（若存在）DashboardChartWidgetSeal**
的 `UPDLOCK/HOLDLOCK`。不得以一個多表 JOIN 推定 SQL Optimizer 一定會使用
指定的鎖定順序。2B-10 的兩條既有版型儲存路徑及 2B-9 dormant Chart Seal
寫入器共享此明確鎖序，已有封印仍拒絕被原有整批刪除重建流程覆蓋。

隱私審查 requestReview 在讀取即時 scope 以前先鎖 Dashboard。
approveReview 與 revokeReview 必填 `dashboardId`，**僅為選擇先鎖哪個父層**；
之後再以 SQL 儲存的 Review.DashboardId 核對，不信任呼叫端 ID 宣稱。
RequestId 不可重送、交易內 AuditLog、TokenVersion、RBAC、來源修訂
重驗、Seal／Review RowVersion CAS 均保留。

SQL Server 2019／2022 的既有 D1 `UQP_CF_` 隔離合成資料庫新增
「兩條不同 SQL 連線，一方持有 Dashboard parent 更新鎖，另一方
嘗試執行版型刪除重建」競爭案例；必須以 SQL Server 鎖定逾時拒絕，
原 Widget 仍存在，釋放鎖後普通版型可照舊儲存。

**限制：**應用程式鎖契約不能防護直接使用 SQL DML、未遵守鎖序的其他
Writer 或持久化資料庫權限錯誤。正式 FK／Trigger／封印不可繞過保護、
跨程序節點的完整競爭驗證，需留給 2B-12 migration 與進一步驗收；
不能因兩交易測試通過即宣告所有並行或資料完整性風險皆已解決。
沒有啟用 CHART、沒有新 API／Migration、沒有改正式 `C:\\UQP`、
PIN／927 或現有 Dashboard 播放器。


## 18. 2B-12：CHART 獨立 Schema 草案（928，不啟用）
 
### 為何 928 僅置於 database/drafts
現有 `server/src/scripts/migrate.ts` 自動掃描 `database/migrations/^\\d+_.*\\.sql$/`；
直接加入數字命名的 CHART SQL，會使既有 ZIP 覆蓋更新流程在呼叫一般
`db:migrate` 時執行尚未授權的安全結構。故保留 `927_workstation_pin_runtime.sql`
原始內容、Ledger、PIN Runtime 設定不變；2B-12 僅在
`database/drafts/928_dashboard_chart_trust_schema.sql.draft` 存放非掃描、
**未經批准不得對正式或一般測試 C:\\UQP 資料庫執行**的 DDL 草案。

### 草案包含
- 新增 Seal、Review、RequestId Ledger 三張 sidecar 表，以 FK／CHECK／ROWVERSION／
  範圍唯一索引阻止孤兒資料、重複有效審查與無效期限。
- DashboardWidget 的 `CK_DashboardWidget_Type` 草案增加 `CHART`，
  但後置 Trigger 拒絕 CHART 的 INSERT／UPDATE／DELETE；這是「保留型別」
  而非圖表功能上線。未來需用明確受授權的原子 Writer 替換 Freeze Gate，
  才能啟用 CHART，絕不可單獨停用 Trigger。
- 封印不能刪除、Review 決策不得逆轉／變更範圍、已消耗 RequestId
  Ledger 只能做一次 AuditLogId NULL→非 NULL 更新；這些控制不能取代
  權限最小化及完整跨節點驗收。
- `CHART` 欄位 ConfigJson 本身仍以 SHA-256 Digest 與 SealRowVersion
  由受信任 Reader 檢查，不允許 browser 提供 approval flag。

### 驗證與階段界線
草案由 2B-12 的 SQL Server 2019／2022 **獨立一次性合成資料庫**載入並
驗證：首次安裝、重跑、部分結構拒絕、原有 TEXT 正常運作、直接 CHART
DML／Seal DELETE／Review 回復／Request Ledger 改寫失敗、
受限 FK、90 天有效期與交易完整性。

**重要**：SQL Server sysadmin、具有 ALTER／DISABLE TRIGGER 權限的主體
仍可繞過這些 DML 規則；正式部署需另驗證帳號最小權限、Schema 漂移、
正式 925 狀態及 Writer 可在封印門檻內原子寫入。本階段無 CHART API、
版型編輯器、播放器、PIN 或正式 migration 安裝。

### 2B-12 Audit 保存期需獨立審查
目前草案將 Seal／Review／RequestId Ledger 的 AuditLogId 設為 live
`uqp.AuditLog` FK；原 016 歷程具有 AuditLogArchive 與線上保留期。
在沒有驗證自動移轉、排除規則或不可刪 Audit receipt 的設計之前，
**此 FK 可能阻止既有 Audit 清理，故 928 不得核准直接安裝**。
2B-13 須與既有 Audit 保留／封存工作一起驗收，不可為了通過測試而
刪除 Audit 關聯或允許靜默清除已核准決策。


## 19. 2B-13：Chart 線上／封存 Audit Receipt 相容性（仍不啟用）

既有 `archiveOldAuditLogs()` 將 `uqp.AuditLog` 複製至
`uqp.AuditLogArchive`，再刪除線上紀錄。928 非掃描草案移除三個
單純指向**線上** AuditLog 的外鍵，保留 `AuditLogId` 及不可逆
RequestId/Review 身分。新增 Seal／Review／Request Ledger 的
**寫入時** SQL Trigger：必須由同一交易內真實的線上 AuditLog
驗證 `EventType=CHART_*`、`Status=SUCCESS`、`IsImportant=1`
及正確操作者，不能提交缺稽核證據的封印或核定。

受信任 **讀取時**，需由 `AuditLog` 或 `AuditLogArchive` 的
相同 Id、EventType、Status、Actor、IsImportant 確認；兩處都不存在
或任一欄不相符均拒絕輸出。保留既有 Audit 保留政策，不新增
永久保留例外、不使用瀏覽器來源的核准旗標。

此變更不會開放 CHART Type、API、圖表設計器或播放器，
928 仍為 `.sql.draft`，沒有加入一般 `db:migrate`。

**待部署核准前**：Schema 漂移精確驗證（含 Trigger 定義）、正式
帳號最小權限、AuditArchive 歷史資料保全、925 相容、
跨節點多 Writer 並行驗證與獨立人工核准均尚待完成。


## 20. 2B-14：隔離式 Dashboard CHART 設計草稿 UI（不存檔）

在原有 `DashboardLayoutDesignerPage` 的 Widget 工具箱下新增可展開
`DashboardChartDraftEditor`，包含 BAR／LINE／PIE 類型、已啟用的
Query Source 鍵、分類與彙總數值欄位、最大點數、圖例、X/Y／寬高
等設定，並依目前 Profile 畫布尺寸顯示位置比例。圖型為 **3 筆固定
合成資料**，絕不使用患者或院內 SQL 執行結果，亦不利用
`Query Source/page` 預覽輸出來宣稱 CHART 已授權。

安全邊界：這是獨立 React 本機 state；不加入 LayoutWidget Union、
後端 Schema、JSON 儲存、播放頁、預覽頁或版型 dirty/save 路徑；
不提供 API、LocalStorage、跨頁復原或啟用旗標。正式使用者登入及
原有 Widget 功能均不變。設計草稿的 `chartDraftPersistenceEnabled=false`
僅是測試用表態；真正保護仍由 Server Widget CK/Trigger／正式圖表
路由未註冊共同保證。請勿將其誤認為已具備資料介接、保存或公共播放。

新增 `client/src/dashboard/chartDraft.test.ts` 驗證 V1 合法性、
來源欄位拒絕、畫布界限、假資料無患者資訊及不具儲存能力。

**後續 2B-15**：取得單獨審核的 CHART Writer／Schema 安裝授權後，
再實作可持久化版型 Widget、經授權查詢／封印與公共隱私審查、
真正的圖表預覽及全螢幕播放。928 仍為不自動掃描之 .sql.draft，
正式 C:\\UQP、PIN、既有 Dashboard 播放未變。


## 21. 2B-15A：全螢幕 CHART 渲染契約（尚未啟用正式播放）

引入可縮放 SVG `DashboardChartProjection`，提供 BAR／LINE／PIE、
0 基準正負數、單一圓餅分區、圖例與可及性隱藏表格。採固定 viewBox，
不使用新的第三方套件。現階段由 2B-14 合成資料草稿使用同一渲染器，
讓設計器可先驗證圖型與不同視窗尺寸，**不讀取或傳送實際 SQL 資料**。

`parseChartProjection` 的嚴格三欄 DTO（chartType/showLegend/points）
不接受其他欄位、患者資料列、ConfigJson、approved/authorized 等旗標、
數字字串、無限值、重複分類或超過 50 點。**這只是前端格式檢查，
不能代表後端授權或稽核；真正授權只能由 dormant coordinator 完成。**
正式播放器目前仍未 import 渲染元件，也沒有 CHART GET API。

不能把一般 Dashboard `/page` 的 rows 在瀏覽器做 SUM/COUNT 或改成
CHART。尚待處理的正式阻斷：928 Draft 的 `TR_DashboardWidget_ChartFreeze`
禁止 CHART INSERT/UPDATE/DELETE；必須設計經資料庫強制保護的專屬
原子 Writer（含無法任意 SET SESSION_CONTEXT 偽造的最小權限或
簽章程序）、Widget Seal 初始化及終止、Schema drift 驗證與發佈核准。
只有在受信任 route 認證、Query／Dataset 版本、設備/IP、完整快照、
患者 Audit、公開統計 Review 全數驗證後，才可將投影 DTO 傳給播放器。
本提交不修改 928、927、正式 DB、C:\\UQP 或現有播放行為。

 
## 22. 2B-15B：不可信 SQL 身分與受控 CHART Writer 啟用契約

從現有 `928_dashboard_chart_trust_schema.sql.draft` 可確認：
`TR_DashboardWidget_ChartFreeze` 拒絕所有 CHART INSERT/UPDATE/DELETE，
不因使用者聲稱的 `SESSION_CONTEXT` 旗標改變。**不能靠客戶端旗標、
API Header、Session Context 或自行停用 Trigger 來放行 CHART。**

新增 SQL Server 2019／2022 一次性 `UQP_CH_` DB 驗收：
`CREATE USER ... WITHOUT LOGIN` 模擬低權限身分；對現有
DashboardWidget 只授予普通 DML；對 Seal／Review／Request Ledger
明確 DENY DML。透過 `EXECUTE AS USER` 與自行設定
`UQP_CHART_WRITER_AUTHORIZED=1`，實際嘗試新增 CHART、變更
TEXT→CHART、修改或刪除封印 Widget、刪 Seal、改 Review、清 Ledger
及停用 Trigger，**必須分別回報 SQL 51928 或 229**，
並查核原有資料未改動；驗收批次內執行 REVERT。
這是負面測試，不賦予正式 DB Principal 新權限。

**後續正式啟用必須滿足**：專屬受信任的存放程序或等價
不可被應用程式連線偽造的 SQL 權限隔離機制；僅授權該受控程式
以同一交易執行 CHART Widget + Seal + Audit + CAS，
並保留舊版 Layout Writer 的封鎖、Token/RBAC/Query/Device/IP
及公共隱私核定。須驗證資料庫實際登入主體**不是** db_owner、
db_ddladmin、db_datawriter 等過廣角色，也不可持有
ALTER/DISABLE TRIGGER、CONTROL 或直接修改 CHART sidecar 的能力。
簽章程序應有正式部署輪替、撤銷及審核流程。

目前尚無專屬受控 Writer 程序、正式圖表 API 或播放路由；928
仍為不可自動掃描草案，CHART Freeze、正式 C:\\UQP、PIN 927
及既有 Dashboard 播放行為維持不變。


## 23. 2B-15C-1：928 實際 Trigger 定義防竄改驗收（不開啟 CHART）

新增 `chart928TriggerAttestation.ts`：從**不會被 migration 掃描**的
928 草案擷取七個 Trigger 的原始 SQL 定義；比較 SQL Server
`sys.sql_modules.definition` 內的實際原始定義 SHA-256，
並核對 Trigger 名稱、Schema、父層資料表、啟用狀態及類別。
若缺少 VIEW DEFINITION 等權限而無法看到定義，必須拒絕，不能
改以名稱或存在數量當成成功證據。

隔離 SQL 2019／2022 加入：初次安裝與重跑後精確比對；
在合成資料庫的交易內 `ALTER TRIGGER` 為不做任何拒絕的空程序，
即使 Trigger **仍啟用**也必須被阻擋；回滾 DDL 後再次比對必須 PASS。
這補足了僅檢查 `is_disabled=0` 的缺口。現有低權限直接 DML、
Session Context 冒充及 928 回滾案例保持原驗證。

**未完成項目**：同樣精確的全部欄位／FK／索引／CHECK／權限清冊，
以及真正只透過受控、不可偽造 SQL 模組執行的 CHART 原子 Writer
（需包含 Widget、Seal、Audit、Token/RBAC、RequestId replay、
CAS 與舊版儲存路徑隔離），目前仍屬阻斷條件。
本次沒有修改 928、PIN 927、現有正式 Schema、Route、
設計器存檔或播放器，不授權正式環境執行 `.sql.draft`。


## 24. 2B-15C-2：928 合成 Schema 與正式 IDENTITY 結構對齊

`022_dashboard_layout_designer.sql` 的
`uqp.DashboardWidget.Id` 及 `006_audit_log.sql` 的
`uqp.AuditLog.Id` 均為 SQL Server `BIGINT IDENTITY`。
早期一次性 `UQP_CH_` 測試表使用普通主鍵，無法充分證明
新建 CHART 的自動 WidgetId/AuditLogId 語意。

2B-15C 測試 Schema 改為 IDENTITY：僅舊測試種子資料用
`SET IDENTITY_INSERT ... ON/OFF` 指定固定 ID；所有未授權
CHART 新增均改為**不提供 ID 的正式 INSERT**，
同時驗證 `COLUMNPROPERTY(...,'IsIdentity')=1`，
保留既有 Seal FK、稽核封存與 Freeze Trigger 拒絕檢查。

這是正式 Writer 前的結構一致性修補，**不是專屬 CHART
原子 Writer 或正式啟用的完成宣告**。Runtime、API、928
安裝權限、原版型與 PIN 均未改動。


## 25. 2B-15C-3：CHART 新增與 Seal CAS 共用正規化契約

新增 `dashboardChartAtomicCreate.contract.ts`，共用
`chartWidgetConfigSchema`、UTF-8 SHA-256、固定 JSON 欄位順序與
8192 字元限制。現有 dormant `sealWidget` 已改用相同函式；
未來新增 Widget 時，不得以不同序列化方式產生 Seal Digest。
新增 `planDormantChartCreate` 僅驗證 Dashboard、Profile、Actor、
TokenVersion、RequestId、分類與彙總欄位及畫布位置尺寸，
**刻意不接收 WidgetId**；正式 `DashboardWidget.Id` 必須由
SQL Server IDENTITY 配合 `OUTPUT INSERTED.Id` 取得，
且與 Seal、Audit、Replay Ledger 同一交易提交。

此計畫函式不會連線資料庫、不提供權限、不儲存或執行，
`CHART_ATOMIC_CREATE_RUNTIME_ENABLED=false` 只是防誤用宣告；
實際安全限制由 928 Freeze 和未註冊 Route 保持。
下一個正式 Writer 核准條件仍是不可由 SQL Service
Connection 偽造的受控模組權限、完整資料庫驗收與人工簽核。


## 26. 2B-15C-4：僅隔離執行的原子新增 SQL 原型

新增 `database/drafts/928_chart_atomic_create_prototype.sql.draft`：
原型使用專屬 `DashboardChartCreatePermit`，在**同一 SQL Session、
同一交易 ID** 內暫時授權一筆 CHART INSERT；Freeze Trigger
仍拒絕所有不具備此資料庫持久化許可的新增、修改與刪除，
不信任 `SESSION_CONTEXT`。許可列只在交易內存在，建立
Widget 與 Seal 後先刪除，才容許 COMMIT。

`usp_ChartCreate_IsolatedDraft` 依序重驗 Dashboard/Profile、
AppUser TokenVersion 與 DESIGN_QUERY RBAC；同交易寫入
RequestId Ledger、AuditLog、IDENTITY Widget（OUTPUT Id）
及 Seal Digest，任何例外整筆 ROLLBACK。SQL 使用 UTF-8
SHA-256，須與 Node 既有 canonical JSON digest 經兩版 SQL
驗證一致。存放程序僅以 OWNER 執行且**不授予任何應用帳號
EXECUTE**，本身也驗證資料庫名稱必須是一次性 `UQP_CH_`。
不支援正式或一般 UQP DB、不註冊 API、未改正式 928。

**此為不可部署原型**：受信任 Actor 身分目前來自 SQL 引數，
單純驗證 DB 使用者的 TokenVersion/RBAC 不足以證明 API 呼叫者
就是該使用者；須先完成不可偽造的應用連線授權及受控模組簽章／
權限隔離審查、實際 Schema 完整欄位差異與正式 925 驗收，
才可能設計正式版。任何人不得因測試成功而直接授予
`EXECUTE`、搬入 migrations 或停用 Freeze。


## 27. 2B-15C-5：測試專用雙資料庫主體的權限邊界

原型存放程序目前接受 `ActorId` 引數，必須區分兩個主體：
一般平台資料庫連線（無 CHART EXECUTE 權限），以及
獨立的、只執行經授權 CHART 寫入程序的後端憑證。
**SQL Principal 可執行程序並不代表使用者本人已獲認證。**
不得將任意客戶端傳入的 ActorId 直接當成可信身分。

在 `UQP_CH_` 一次性合成資料庫新增權限隔離測試：
臨時 `UQP_Chart_DraftExecutor` 角色只包含模擬
`UQP_Chart_Writer` 主體；一般 `UQP_Chart_Untrusted`
明確 DENY EXECUTE，兩個主體都不能直接 INSERT Permit；
模擬 Writer 也不能直接 INSERT Seal／Ledger。
使用 `HAS_PERMS_BY_NAME`、`sys.database_role_members` 實際
查核 EXECUTE、ALTER、IMPERSONATE 與直接表格寫入權限。
角色及授權僅在 CI 建立並銷毀的資料庫存在，
**不將 GRANT/ROLE 放入正式 Migration 或 Runtime。**

此驗證不能取代真正獨立的 SQL 登入、憑證隔離、
Node request authenticated actor 綁定、審核的 API 授權、
TokenVersion／RBAC 最後重驗及跨節點競爭驗收。
正式帳號如果具有 `db_owner`、`db_ddladmin` 或
廣泛 `IMPERSONATE` 權限，則不得通過交付審查。


## 28. 2B-15C-6：已驗證 JWT 之 ActorId 綁定（不註冊圖表 API）

`auth.middleware.ts` 在 `jwt.verify()`、`getTokenSessionState()`
確認仍有效及 TokenVersion 一致後，才寫入僅在伺服器模組內可
設定的 `WeakMap<Request,{userId,tokenVersion}>`。
`readVerifiedJwtActor()` 只接受已通過 Middleware 的同一
Request 且仍具 `DESIGN_QUERY` 權限；獨立建造
`req.authUser`、瀏覽器送出 `ActorId` 或
`SESSION_CONTEXT` 都無法建立該證據。

`planVerifiedChartCreateRequest()` 從 verified Actor 產生
`actorId/tokenVersion`，請求本體僅接受
`profileId/requestId/config/placement` 四項，明確拒絕
使用者傳入的 ActorId、TokenVersion、WidgetId、
approved、deviceToken 等欄位。
`recheckChartActorInTransaction()` 會在最終受信任 Writer
的**同一個 SQL 交易**中，使用原本 `getTokenSessionState`
再次確認帳號啟用、TokenVersion 和 RBAC；失敗一律拒絕。

測試以真正 Express Middleware + JWT 和合成 Session 驗證
錯誤簽章、權限撤銷、TokenVersion 更新、無效帳號、
以及偽造 req.authUser，都不能取得 Writer 計畫。
上述只是**尚未註冊的身份與授權前置契約**；
未接正式路由／真正 SQL 執行／專用獨立登入池，
因此仍不得開放 CHART 儲存或給予 SQL EXECUTE。


## 29. 2B-15C-7：專用 Writer SQL 登入主體隔離驗證（停用狀態）

新增 `dashboardChartWriterBoundary.ts` 唯讀連線驗證器，
正式環境未新增任何帳密、SQL Pool、授權或 CHART 路由。
規劃中的正式程序 `uqp.usp_DashboardChartCreate` 目前**尚不存在**；
驗證器會因此拒絕，而不是將現有隔離原型誤認為正式 Writer。

當正式程序與兩組獨立連線均經核准後，須由驗證器確認：
同一 Server／Database，但不同 `ORIGINAL_LOGIN()` SQL SID；
平台連線不得執行 CHART 程序；專用連線只能 EXECUTE，不得
ALTER 或直接修改 Permit、Seal、Request Ledger／Review；
兩者均不能有 sysadmin、db_owner、db_ddladmin、
db_securityadmin、db_datawriter、Schema ALTER／CONTROL
或冒用 Writer 的權限。對看不到的權限或模組一律拒絕。
**原有 Dashboard Widget CRUD 必須保持可用**，
因此本驗證器不要求平台連線失去原本 Widget 寫入權，
CHART Freeze／受控程序必須繼續保護圖表。

在 SQL Server 2019／2022 的一次性資料庫加上
`EXECUTE AS USER` 的反例：雖然 `USER_NAME()` 變成
臨時 Writer，`ORIGINAL_LOGIN()` SID 必須仍是原登入，
不得把角色切換當成另一組 SQL 登入憑證。
驗證器只執行唯讀查詢、拒絕過廣權限，並不證明正式
Schema、JWT-Actor／DB 所有步驟與程序版本已整合。


## 30. 2B-15C-8：正式 Writer 模組指紋與交易身分驗證（仍禁止正式啟用）

不能僅以 `OBJECT_ID` 存在或 `HAS_PERMS_BY_NAME(...,EXECUTE)=1`
判定 CHART Writer 可信：被修改後的同名程序仍可能滿足這兩項。
`dashboardChartWriterBoundary.ts` 已加入唯讀查詢
`sys.sql_modules.definition`，用 SQL Server `HASHBYTES('SHA2_256')`
計算 NVARCHAR 定義的 UTF-16LE SHA-256（轉成小寫），並要求
Platform 與專用 Writer 兩條獨立 SQL 登入連線均回報**同一份**
核准雜湊。程序不存在、定義不可見、定義被改動、權限過大、
SQL Server／Database 不一致或實際 `ORIGINAL_LOGIN()` SID
重複，均應拒絕。

`CHART_WRITER_APPROVED_PROCEDURE_SHA256` 目前**固定為 null**：
不可透過瀏覽器、HTTP 標頭、JWT、SessionContext 或未經審核的
環境變數解除。由使用者端傳入預期雜湊也不能視為核准。
未來須以審核完成的 SQL 程序原始碼、版本、部署簽核為依據，
先在 SQL Server 2019／2022 完成模組雜湊驗證，再於獨立 PR
明確釘選。核准前任何「建立圖表」前置檢查一律拒絕。

驗收案例從 CI 的一次性 `UQP_CH_` 資料庫讀取真實
`sys.sql_modules`，與 Node.js 依 `utf16le` 計算的
SHA-256 比對；並確認正式程序 `uqp.usp_DashboardChartCreate`
不存在時不能取得有效證據。此案例不使用真實資料、帳密，
亦不安裝 928 正式 Migration。

**交易邊界不可混淆：** Node 的
`recheckChartActorInTransaction()` 只適用於與實際 DML
共用同一 SQL Transaction 的 Writer。現有隔離原型
`usp_ChartCreate_IsolatedDraft` 會自行開啟交易，拒絕外部
交易；因此不能先在獨立的 Node Transaction 重驗使用者，
再呼叫此程序，就聲稱同筆交易安全。最終正式程序必須自行
在同一交易持鎖重驗 Account／TokenVersion／RBAC 與
Dashboard／Query／Dataset 範圍，並完成 RequestId、Widget、
Seal、Audit 原子寫入與完整權限隔離。

此階段沒有安裝正式 CHART Writer、沒有新增正式帳密與
API、沒有開放公共全螢幕播放、沒有修改正式 `C:\UQP`。
仍須完成 928 精確 Schema 驗證、正式憑證隔離、API 身分橋接、
實際資料交付以及人工部署核准。


## 31. 2B-15C-9：雙 SQL Login 連線池骨架（仍不啟用）

新增 `server/src/config/chartWriterDatabase.ts`，
並在環境契約新增 `CHART_WRITER_DB_*` 欄位。
`server/.env.example` 僅提供註解範例，現有 `C:\UQP\.env`
完全不必修改。連線池要求 Writer 與一般平台使用相同的
SQL Server／埠／資料庫，卻不能共用 SQL 使用者名稱或密碼；
Writer 強制啟用 TLS 且禁止 `trustServerCertificate=true`。

這份程式不會在未核准的狀態下建立連線：
`CHART_ATOMIC_CREATE_RUNTIME_ENABLED=false` 與
`CHART_WRITER_APPROVED_PROCEDURE_SHA256=null` 均維持原值，
無 API 會使用新池。未來即使設定了帳密，還必須以兩個真正
獨立的 SQL 登入執行 `ORIGINAL_LOGIN()`、權限及受審程序
定義 Digest 比對；不通過即關閉候選連線，不可退回
原 `PLATFORM_DB_USER`。測試已加入既有
`dashboardChartWriterBoundary.test.ts`。

**本項只是專用連線生命週期實作與離線契約驗證，不代表
正式程序、SQL Schema、JWT/DB 同交易身分核定、圖表
資料交付、全螢幕播放或 ZIP 更新已核准。**


## 32. 2B-15C-10：SQL 伺服器高權限不可只檢查固定角色

`dashboardChartWriterBoundary.ts` 的雙連線唯讀驗證新增
`HAS_PERMS_BY_NAME(NULL,NULL,...)` 伺服器層有效權限：
`CONTROL SERVER`、`IMPERSONATE ANY LOGIN`、
`ALTER ANY LOGIN`、`ALTER ANY SERVER ROLE`、
`SELECT ALL USER SECURABLES`；另查詢資料庫
`db_accessadmin`、`ALTER ANY USER`、`ALTER ANY ROLE`、
`ALTER ANY SCHEMA`。
這些權限不能僅從 `IS_SRVROLEMEMBER('sysadmin')`
或 `IS_MEMBER('db_owner')` 推斷不存在。

Platform 與 Writer 兩個 SQL Login 只要任何高權限值為 1、
NULL 或無法證實為 0，則 fail closed；保留原本
`ORIGINAL_LOGIN()` SID、核准程序 SHA-256、專用
EXECUTE、Permit／Seal／Ledger 直接 DML 等既有拒絕。
Server 單元測試增加正、負面案例，及 SQL 2019／2022
一次性 `UQP_CH_` 資料庫對實際權限查詢欄位的 SQL 引擎測試。

現階段最新 Commit 未取得對應 CI 結論時，
上述內容只能稱為**已提交待驗證**。不應手動安裝 928、
授予 SQL EXECUTE 或部署到正式 `C:\UQP`。
SQL 參考：Microsoft Learn「HAS_PERMS_BY_NAME (Transact-SQL)」
及「GRANT Server Permissions (Transact-SQL)」。


## 33. 2B-15C-11：Chart Writer 基礎 Schema 精確欄位驗收

新增 `server/src/scripts/chart928WriterBaseSchema.ts`，從
`sys.tables`／`sys.columns`／`sys.types` 執行唯讀檢查，
對照既有正式 Migration 001、006、016、019、022、024 的
25 個 Writer 必需欄位，逐項比對 SQL 型別、NVARCHAR 實際
位元組長度、NULL 允許與 IDENTITY 自動編號。
缺表、少欄、重複欄位、欄位型別被改動、NULL／IDENTITY
不符或資料庫中繼資料不可讀，均固定拒絕。

SQL Server 2019／2022 一次性 `UQP_CH_` 測試資料表已加上
真實 `AppUser.Id`／`DashboardDisplayProfile.Id` IDENTITY、
Widget `FontSize`／`Alignment`／`SortOrder`，
並將 `AuditLog.EventType` 設為 `NVARCHAR(50)`、
`UserId` 調整為 NULL 可選；測試種子需明確
`SET IDENTITY_INSERT ... ON/OFF`。在 928 草案驗收前後各
執行一次基礎欄位比對，避免用過度簡化的表格誤認
正式圖表新增必然相容。

**此驗證尚未涵蓋所有正式 Schema 細節**：
925 完整欄位及可信約束採認、全部 FK／Index／CHECK、
Default Constraint、SQL Module 版本核准、正式受控寫入
程序、身分授權與交易邊界仍須另外驗證。
不能因這 25 個欄位 PASS 就解除 CHART Freeze；
也不能直接在正式 DB 執行 `.sql.draft`。


## 34. 2B-15C-12：基礎資料表 FK 與 SQL 信任狀態精確採認

為避免只有欄位型別匹配卻無法保證刪除／稽核關聯，
`chart928WriterBaseSchema.ts` 新增三個正式 Migration 所擁有的
外鍵驗證：`FK_DashboardDisplayProfile_Dashboard`（CASCADE）、
`FK_DashboardWidget_Profile`（CASCADE）及
`FK_AuditLog_User`（NO_ACTION）。

從 `sys.foreign_keys` 唯讀比對實際 Schema、父／參照表、
外鍵名稱、`is_disabled=0`、`is_not_trusted=0` 及
`delete_referential_action_desc`。任一缺失、名稱錯誤、
失去信任、停用、指向錯誤表、刪除規則不同或無權讀取，
都 fail closed。

`chart928DraftSqlAcceptance.ts` 的一次性 SQL 2019／2022
測試 Schema 已改用正式 FK 名稱。新增交易內
`ALTER TABLE ... NOCHECK CONSTRAINT FK_DashboardWidget_Profile`
的負面案例：驗證器必須拒絕，交易回滾後須再次 PASS。
保留先前 25 個基礎欄位、928 Freeze 與 SQL 身分安全測試。
欄位中繼資料的 SQL 識別別名統一為 `IsIdentity`。

**本項只是實作／測試案例已提交。** 必須等同一 HEAD 的
GitHub CI Server Build、SQL Server 2019／2022、Client
E2E 與 Release jobs 成功後才可將本項標記為驗收通過。
目前 PR #83 保持 Draft、不執行 928、不開放 CHART。
本項亦不能取代 925 完整 Schema 採認與正式 Writer 核准。
