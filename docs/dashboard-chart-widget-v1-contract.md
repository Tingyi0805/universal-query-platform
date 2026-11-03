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
