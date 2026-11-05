# Dataset 儲存、參數差異與 Oracle 安全診斷

## 根因及修正

- SQL 成功儲存未通知 Parameter Designer，差異停留在原 SQL。現在只在寫入成功後刷新已儲存差異，保留未儲存參數設定；新 Dataset 的參數讀取使用建立結果的 ID。編輯中 SQL／來源與已儲存狀態分開顯示，失敗保留草稿。
- 敏感規則使用獨立、具 expectedVersion 的 API，基本 Dataset 儲存不提交規則。現在明示兩區儲存範圍；規則未儲存時基本儲存成功訊息也提醒。切換／登出後的遲到規則回應不更新新範圍；版本衝突及失敗保留草稿，成功才更新版本和規則。
- 原診斷只辨識 SQL Server，Oracle errorNum／ORA／NJS／DPI 被歸為 UNEXPECTED。現在僅擷取範圍受限的數字及固定格式代碼，不複製原始訊息、stack、SQL、Bind 或連線資訊。安全稽核使用相同分類。
- Oracle Bind 在建立連線前驗證：文字、有限數字、有效 Date、null、Buffer；陣列由既有 compiler 展開。拒絕 undefined、無效日期、非有限數字、布林及物件（避免被驅動當成 Bind descriptor）。Oracle SQL BOOLEAN 支援依版本不同，不自動轉換；數值布林條件需依 SQL 定義明確使用 NUMBER 0／1。
- 已知 Bind 錯誤提供固定提示及 Request ID。只有本地型別驗證明確失敗回 400；NJS／ORA Bind 契約錯誤可能源自 SQL／程式，維持 500 並提示檢查。ORA-01722、連線及其他錯誤不一律視為參數問題。

## 敏感 SQL 變更審查：繼續 fail-closed

現有契約沒有可信任的欄位 lineage／語意驗證或可原子提交的審查批准。已同步欄位名稱或預覽別名不證明新 SQL 的資料來源和敏感性相同。因此此次不新增「勾選即放行」或 review bypass；存在敏感規則時改 SQL／資料來源仍回 DATASET_SENSITIVITY_REVIEW_REQUIRED，現有規則不變。修正訊息及註解，不指示清空規則來解鎖。

具 DESIGN_QUERY 的管理者應核對資料來源、投影欄位的實際語意、敏感分類與遮蔽、患者稽核欄位及相關 Dashboard。未取得可靠證據即停止，不得刪除／停用規則作為批准手段。啟用 Dashboard 的規則限制與既有版本衝突檢查保持不變。

若未來要允許原 Dataset 的受保護 SQL 變更，需要另行設計可信任審查契約：批准綁定 Dataset 現行版本、候選 SQL／來源及完整政策版本；驗證所有來源欄位（不能只比別名）、再次驗證權限、到期／一次性使用；批准、政策與 SQL 同交易提交且強制稽核。此次未實作解除機制。

## 驗證與限制

合成資料／Mock，無資料庫連線、Migration 或功能旗標變更。

- Dataset、Oracle、安全診斷相關單元／Mock：44 通過。
- 既有後端 Dashboard 遮蔽回歸：19 通過。
- Chromium：8 通過（既有 parameter 3、新增儲存及敏感規則 5）。
- Client／Server typecheck、build 通過；Client 保留既有 bundle 大小提示。
- CI 必須檢查交付 commit 的 run，不能用先前 commit 成功替代。

本機待驗證：實際 Oracle 版本／驅動模式與 NUMBER、DATE、MULTISELECT、Bind 定義；既有那次 HTTP 500 的 Request ID 及安全代碼；實際資料庫的規則持久化、版本競爭、稽核失敗回滾與啟用 Dashboard 保護。診斷不得輸出患者資料、SQL 或 Bind 值。未連接共用 SQL Server／Oracle，不宣稱真實環境驗收。
