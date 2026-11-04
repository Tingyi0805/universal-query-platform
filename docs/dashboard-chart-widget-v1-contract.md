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
