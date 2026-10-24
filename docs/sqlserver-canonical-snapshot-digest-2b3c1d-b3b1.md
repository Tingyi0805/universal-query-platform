# Canonical Snapshot Digest（2B-3C-1D-B3-B1）

基準：`4785442edb8c4d908ed48ba5ff220b5a7029e1e8`。僅新增 [純函式](../server/src/modules/dataset/canonicalSnapshotDigest.ts) 與 [合成測試](../server/src/modules/dataset/canonicalSnapshotDigest.test.ts)，補齊 [B2](sqlserver-native-type-review-contract-2b3c1d-b2.md) 完整性編碼契約；[B3-A 阻擋](sqlserver-native-type-b3a-feasibility-review.md) 未解除。沒有 SnapshotReader、DB I/O、Migration、發證、API 或 Runtime 接線。

## 輸入、輸出與信任邊界

兩個函式只接受明示 `scope=SYNTHETIC_TEST_ONLY` 的 plain own-data 投影；此標記不證明來源可信。SQL 輸入欄位恰為 scope/sql；參數輸入恰為 scope/datasetId/parameters。`SyntheticStoredParameter` 涵蓋目前 DatasetParameterRecord 全部 19 欄，但 id/datasetId/lookupDatasetId 改為精確字串；type-only import 不執行 Repository，亦不呼叫／修改現有 Number mapper。必須由將來受審的 raw reader 直接取得精確投影，不能 String() 修復已失真的 ID。

輸出為 frozen `ISOLATED_CANONICAL_DIGEST`，僅有 frozen `integrity={format,digest}` 與 `authority=NONE`、`runtimeBindVerified=false`、`deliveryAllowed=false`。B2 測試明確取出 integrity 作合成輸入；完整結果不是 evidence／plan／確認授權。錯誤只有 `CANONICAL_SNAPSHOT_INPUT_INVALID`，不含 raw cause、欄位值或原輸入。函式不記錄／回傳 SQL、canonical text、parameter rows 或 runtime 值；摘要仍應限權處理，不作公開日誌內容。

## SQL_UTF8_EXACT_V1

`computeSqlSnapshotDigest`＝SHA-256（完整原始 SQL string 的 UTF-8 bytes），輸出 64 位 lowercase hex。**不加 domain prefix**；不 trim、改換行／大小寫、去註解、改 SQL Token、Unicode normalization 或序列化成 JSON。BOM、CR/LF、空白與 NUL 都保留。空字串可有 digest，不代表可執行 SQL。

只接受 well-formed Unicode string；拒絕 Buffer／物件及未配對 surrogate，避免 UTF-8 encoder 的 replacement 將不同輸入合併。不負責 SELECT-only／Token 合法性／注入防護；既有 parser 及編譯保護不變。SQL 上限為 1,048,576 UTF-8 bytes。

## SAVED_PARAMETER_SNAPSHOT_V1

1. 每一列必須明示下列 **19 個欄位、順序固定**，不接受其他欄位：

   `id, datasetId, name, label, dataType, controlType, isRequired, defaultValue, dateOutputMode, dateCalendar, dateFormat, displayOrder, placeholder, helpText, optionMode, fixedOptionsJson, lookupDatasetId, lookupValueField, lookupLabelField`。

2. 以 name 的 ASCII／code-unit 升序排序資料列，不用 locale、不依 DB 回傳順序或 DisplayOrder 排序；name 僅允許 uppercase SQL Token 名稱，長度 1–100。duplicate name 或 physical id 拒絕，不做 silent dedup。每列 datasetId 必須與輸入 datasetId 完全一致。
3. canonical bytes 為 UTF-8 編碼的無額外空白 `JSON.stringify(["SAVED_PARAMETER_SNAPSHOT_V1", datasetId, [tuple1, tuple2, ...]])`；每個 tuple 按上述固定欄位順序取值。無 object key order、無 BOM／結尾換行；SHA-256 輸出 lowercase hex。format prefix 與 Dataset 身份也在 hash 中；空清單仍綁定 DatasetId。
4. IDs 只接受 canonical 正 SQL BIGINT 十進位字串（1–9223372036854775807），lookupDatasetId 另允許 null；所有 Number／bigint 物件值、前導零、指數、空白或溢位均拒絕。只用 BigInt 檢查字串範圍，不經 Number。physical id 被納入，所以重建列的新 id 也會改 digest。
5. isRequired 僅 boolean；DisplayOrder 僅 0–10000 的安全整數 Number，拒絕 -0／非整數／非有限值。DataType、ControlType、DateOutputMode、DateCalendar、OptionMode 使用現有明確 enum。nullable 欄位只允許 null 或指定型別，**缺欄／undefined 一律拒絕**；null 與空字串不同，空 ID 不合法。絕不套用 default、trim、日期解析或推論型別。
6. 所有字串保留原始 Unicode code points、空白、控制字元與日期格式文字，不做 NFC/NFD。JSON 外層使用標準 JSON string escaping（quote／backslash／控制字元），再編為 UTF-8；拒絕 lone surrogate。FixedOptionsJson 是**不透明的已儲存文字**，不 JSON.parse／排序／重排 inner JSON；連空字串或 malformed JSON text 也只是完整性內容，不代表可用 options。inner JSON 的空白／key order、數字字面值（含 BIGINT）改變就改 digest，不經浮點轉換；consumer 的 JSON／option 語意驗證仍另行需要。

文字長度上限（UTF-16 units）：label 200、defaultValue 1000、dateFormat 100、placeholder 200、helpText 500、lookup field 128。FixedOptionsJson 上限 262,144 UTF-8 bytes；最多 2000 列；合計原始文字及最終 canonical bytes 各上限 4 MiB。這是隔離契約資源限制，不修改正式 DB／UI 限制。

拒絕未知／隱藏／symbol 欄位、缺欄、型別錯誤、custom prototype、Proxy、getter／setter、hook、sparse／附加屬性的 array；先讀 data descriptors，不執行 caller getter／toJSON。缺省值不補 null，沒有以序列化刪除 undefined 的 fallback。digest 只證明輸入內容的指紋，不驗證 Dataset 存在、SQL／lookup 是否可執行或來源權威；大小限制失敗亦不回傳部分摘要。

## 驗證與尚未解除的阻擋

測試使用獨立 Python hashlib／compact UTF-8 JSON golden vectors，涵蓋 SQL 單 byte 修改、順序穩定、每欄異動、null／empty／missing、Unicode／JSON 原文、BIGINT、unsafe inputs、資源界線與錯誤去敏；B2 合成 envelope 可使用 integrity，但仍需完整 observations 且不取得任何權限。

A→B→A 恢復相同完整內容（含 IDs）時，digest 可完全相同；不是 mutation epoch、防 ABA、授權或可信證據。測試確認即使 digest 恢復，B2 仍因 AuthorizationEpoch 或 lease 失效拒絕。真實 snapshot reader、DB 外 incarnation、writer 覆蓋、review scope、來源 generation／lease、精確 Audit receipt 與真實 SQL rollback／locking／driver 驗收仍缺，CONFIRMED／VERIFIED 與正式交付保持阻擋。

B3-B2 最小建議：先定案精確 Audit receipt 與 Decision 關聯的限域契約／合成驗證，以及 raw SQL／parameter projection reader 的版本／交易邊界；不要把既有 Number ID 包成字串，也不要由這組 digest 建立 issuer。任何 SQL adapter、922 或正式確認仍須另行授權並先滿足 B3-A 前置條件。
