# BUG-002：自訂敏感欄位與初始化阻擋

基準 PR #66 / `ed4873778dd0db25151f8d19daa5009c7e330234`，起始 CI #886 Success；Draft、未 Merge。本文件取代 BUG-001 的普通資料聲明預覽步驟。

## 根因與三種情境

| 情境 | BUG-001 後 | 本次結果 |
|---|---|---|
| A：普通 Dataset | 人工聲明 + 已確認空政策可進 NON_PATIENT_DESIGN，但沒有可信非患者分類證據 | 撤回此分支；空政策可明確儲存，但不能授權預覽。新建初始化 BLOCKED |
| B：非患者敏感 Dataset | 普通分支拒絕敏感規則；RAW_DESIGN 又要求患者稽核，無正確非患者路徑 | 保持 BLOCKED；不得為了預覽假設它是患者 Dataset、啟用虛假識別設定或移除遮蔽 |
| C：患者及敏感 Dataset | 新建缺可信 metadata；既有設定走 RAW_DESIGN 及揭露稽核 | 新建初始化 BLOCKED；既有已確認設定仍須通過版本、RBAC、HMAC、揭露稽核及最終重驗，不重新發證 |

檢查證據：

- `datasetDataDelivery` 對缺患者設定的 RAW_DESIGN 拒絕；先前 NON_PATIENT_DESIGN 只以空政策及前端聲明區分，無法證明實際資料種類。本次移除該 purpose／請求旗標，舊客戶端攜帶旗標由 strict schema 拒絕。
- `column.repository` 的 DatasetColumn 僅保存名稱、型別、順序；沒有 DefinitionRowVersion／來源配置版本／參數 snapshot／來源 generation 綁定，不能當成新初始化可信證據。
- `describeQuery` 回傳 UNBOUND_CANDIDATE、requiresExecutionComparison=true。參數 native evidence、固定 list arity、正式執行結構比對與來源 drift 保護未接妥；不能僅改 trust 字串、靠 matching digest 或人工確認升級。
- patient metadata 目前依 SQL／DataSource hash 與 aliases 判定；不能據此宣稱已取得新的完整證據契約。既有 `recordPreview` 沒有安全初始化呼叫點；本次不接線、不做 execute 取樣替代。

## 最小修正

1. 撤回 BUG-001 普通聲明預覽 UI 與後端分支；保留版本傳遞、精確 SQL／來源比對、權限、政策及 audit 重驗。缺安全初始化回傳固定 `DATASET_PREVIEW_INITIALIZATION_REQUIRED`，不將 A/B 錯誤當作必須啟用患者稽核。
2. Designer 分列 A/B/C 的條件與 BLOCKED 原因；不提供會暗中執行資料 SQL 的初始化按鈕或聲明繞過選項。
3. 敏感編輯器僅選既有儲存規則的欄位；不把預覽欄名當作可信初始化證據。取得完整可信欄位後的新欄位選擇仍 BLOCKED。原有分類保留，由使用者選擇遮蔽，無 NAME/MRN/PHONE 名稱推論。
4. 修正使用者「全部遮蔽」：既有 API 可儲存 FULL，但交付驗證器卻拒絕。現在明確支援 FULL，保留既有固定四碼 ○○○○ 語意；不改成會暴露原值長度的 CUSTOM，不對欄位語意作推論。FULL 不得攜帶 customMask；其他不支援舊模式仍拒絕。患者 audit-only 識別欄位仍必須 OMIT，不能以 FULL 替代。
5. 患者識別欄位必須明選、identifierConfirmed=true、版本 CAS、可信既有 aliases、可用 HMAC 與 audit。因已儲存 NAME 分類而拒絕，與依欄位拼字推測不同：例如使用者將 OPAQUE_7 分為 NAME 仍拒絕其作識別碼。未移除任何既有分類保護。

## 缺少的必要前提

- 可由後端讀取且精確綁定 Dataset DefinitionRowVersion、DataSource ConfigurationRowVersion、完整參數 snapshot／native type／固定 list arity 的 metadata 收集與重驗流程。
- 來源身份、schema generation／lease 或等效可證明的 DDL drift 防護；描述與真實執行欄位名稱、順序、型別的交付前比對。
- 核准的非患者分類／審查證據、權限及撤銷／失效／同交易 audit 契約。空遮蔽清單、欄位名稱、布林旗標均不能替代。
- 綁定上述證據的儲存方案及真實隔離 SQL Server 驗收。現有 DatasetColumn／patient metadata schema 不足以證明完整綁定；是否需未來 schema 另案審查。本次不建立／執行 Migration。

在這些前提具備前，不新增 metadata endpoint／collector，不回傳原始資料列，不建立假的 CONFIRMED。不能宣稱已完成 BUG-002 的可信初始化功能。

## 回歸範圍與操作

Server：三種未初始化狀態（聲明與無聲明）、偽造候選／confirmed metadata、版本 context 不含 SQL／rows、候選描述仍不可信、任意識別 alias 的明確確認與既有分類拒絕、全部遮蔽相同語意；保留完整權限、版本及稽核測試。

瀏覽器：新建／儲存空政策後仍不解鎖、缺 metadata 時無欄位或識別欄位可自動選取、三種流程指引、無自動政策寫入；使用者修改 NAME/MRN/PHONE/OPAQUE_7 既有規則不改分類、全部遮蔽編碼；已設定者仍傳版本預覽；完整 Dashboard 回歸。全部用合成資料／攔截 API。本機 Server 針對性 169／169、全量 1,458／1,458；Client 單元 37／37、完整 Playwright 123／123；雙端 typecheck／build 通過。GitHub CI 見交付回報。

可重測：既有規則的使用者選擇及遮蔽、既有患者識別確認、版本／權限／稽核拒絕、新建 BLOCKED 指引。不可重測成功：任何新建 Dataset 的可信 metadata 初始化、新增任意敏感欄位、A/B 的新正式預覽路徑。請勿刪除現有規則或關閉稽核取得成功。

未連使用者 DB／Oracle，未修改 Migration、JWT_SECRET、Dashboard guards 或正式 Native Runtime；未部署或 Merge。下一步為先審查上述 metadata／分類證據契約與隔離驗收前提，不繼續擴張純合成模型或直接接 Runtime。
