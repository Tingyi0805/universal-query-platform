import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api/client";

type CustomMask = { prefix: number; suffix: number; symbol: string; start?: number; end?: number };
type Rule = { columnName: string; sensitivityType: string; deviceMaskMode: string; customMask?: CustomMask | null };


export function DatasetSensitivityEditor({ datasetId, accessToken, onDirtyChanged, onSaved, canSyncColumns = false }: {
  datasetId: number; accessToken: string | null; canSyncColumns?: boolean; onSaved?: () => void; onDirtyChanged?: (dirty: boolean) => void;
}) {
  const scope = useRef(0);
  const fieldReadRevision = useRef(0);
  const safeError = (error: unknown) => {
    const code = (error as { code?: string } | null)?.code;
    return `${typeof code === "string" && /^[A-Z0-9_]{1,80}$/.test(code) ? `[${code}] ` : ""}${error instanceof Error ? error.message : "操作失敗，請重新載入。"}`;
  };
  const [rules, setRules] = useState<Rule[]>([]);
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [placement, setPlacement] = useState<"RETAIN" | "RANGE">("RETAIN");
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(1);
  const [column, setColumn] = useState("");
  const [action, setAction] = useState<"NONE" | "CUSTOM" | "FULL" | "OMIT">("CUSTOM");
  const [prefix, setPrefix] = useState(0);
  const [suffix, setSuffix] = useState(4);
  const [symbol, setSymbol] = useState("*");
  const [sample, setSample] = useState("00001234");
  const chars = Array.from(sample);
  const validSettings = Number.isInteger(prefix) && Number.isInteger(suffix)
    && prefix >= 0 && suffix >= 0 && prefix <= 100 && suffix <= 100
    && (placement === "RETAIN" || Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start && end <= 10000)
    && Array.from(symbol).length === 1 && !/[\r\n\t]/u.test(symbol);
  const customPreview = placement === "RANGE" && validSettings
    ? start > chars.length ? symbol.repeat(chars.length) : chars.map((char, index) => index + 1 >= start && index + 1 <= end ? symbol : char).join("")
    : !validSettings || prefix + suffix >= chars.length
    ? symbol.repeat(chars.length)
    : chars.slice(0, prefix).join("") + symbol.repeat(chars.length - prefix - suffix)
      + (suffix ? chars.slice(-suffix).join("") : "");
  const selectedRule = rules.find((rule) => rule.columnName.toUpperCase() === column.toUpperCase());
  const editRule = (name: string) => {
    setColumn(name);
    const rule = rules.find((item) => item.columnName.toUpperCase() === name.toUpperCase());
    if (!rule) { setAction("CUSTOM"); setPlacement("RETAIN"); return; }
    setAction(rule.deviceMaskMode === "NONE" ? "NONE" : rule.deviceMaskMode === "OMIT" ? "OMIT" : rule.deviceMaskMode === "FULL" ? "FULL" : "CUSTOM");
    if (rule.customMask) {
      setPlacement(rule.customMask.start === undefined ? "RETAIN" : "RANGE");
      setStart(rule.customMask.start ?? 1); setEnd(rule.customMask.end ?? 1);
      setPrefix(rule.customMask.prefix); setSuffix(rule.customMask.suffix); setSymbol(rule.customMask.symbol);
    }
    setMessage(rule.deviceMaskMode === "NONE" || rule.deviceMaskMode === "CUSTOM" || rule.deviceMaskMode === "OMIT" || rule.deviceMaskMode === "FULL"
      ? "" : "此欄位原本使用舊版遮蔽模式。儲存前請確認新的自訂規則。");
  };
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [emptyConfirmed, setEmptyConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [syncAttempted, setSyncAttempted] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => { onDirtyChanged?.(dirty); }, [dirty, onDirtyChanged]);
  useEffect(() => {
    scope.current++;
    let active = true;
    const fieldsRead = ++fieldReadRevision.current;
    setBusy(false);
    setRules([]); setAvailableColumns([]);
    setLoaded(false);
    setVersion(null);
    setDirty(false);
    setEmptyConfirmed(false);
    setMessage("");
    setSyncAttempted(false);
    setConflict(false);
    void apiRequest<{ columns: Rule[]; version: number; availableColumns?: { name: string }[] }>(`/datasets/${datasetId}/sensitive-columns`, {}, accessToken)
      .then((result) => { if (active) { setRules(result.columns); if (fieldsRead === fieldReadRevision.current) setAvailableColumns((result.availableColumns ?? []).map(c => c.name)); setVersion(result.version); setLoaded(true); } })
      .catch((error: unknown) => { if (active) setMessage(safeError(error)); });
    return () => { active = false; scope.current++; onDirtyChanged?.(false); };
  }, [datasetId, accessToken, reloadKey]);
  const reload = () => {
    if (dirty && !window.confirm("重新載入將捨棄目前尚未儲存的變更，確定繼續？")) return;
    setReloadKey((current) => current + 1);
  };
  const syncColumns = async () => {
    if (!canSyncColumns || busy || dirty || conflict) return;
    const sequence = scope.current;
    ++fieldReadRevision.current;
    setBusy(true); setMessage(""); setSyncAttempted(true);
    try {
      const result = await apiRequest<{ columns: { name: string }[]; trust: string; purpose: string; deliveryAllowed: boolean }>(
        `/datasets/${datasetId}/columns/sync`, { method: "POST", body: "{}" }, accessToken);
      if (sequence !== scope.current) return;
      if (result.trust !== "UNBOUND_CANDIDATE" || result.purpose !== "DISPLAY_COLUMN_OPTIONS_ONLY" || result.deliveryAllowed !== false
        || !Array.isArray(result.columns)) throw new Error("欄位同步回應不符合安全契約。");
      setAvailableColumns(result.columns.map(c => c.name));
      if (result.columns.length === 0) {
        setMessage("欄位同步 API 已成功回應，但未取得任何結果欄位。請確認已儲存的 SQL 具有明確的 SELECT 結果欄位；若確定有欄位，請檢查伺服器同步日誌。");
        return;
      }
      if (!loaded) {
        try {
          const policy = await apiRequest<{ columns: Rule[]; version: number }>(`/datasets/${datasetId}/sensitive-columns`, {}, accessToken);
          if (sequence !== scope.current) return;
          setRules(policy.columns); setVersion(policy.version); setLoaded(true);
        } catch (error) {
          if (sequence === scope.current) setMessage(`欄位已同步，但原政策仍無法載入，為避免覆蓋暫停儲存：${safeError(error)}`);
          return;
        }
      }
      setMessage("欄位清單已同步，請逐欄設定並儲存規則。未設定的欄位不傳送；本操作沒有啟用資料預覽或患者稽核。");
    } catch (error) {
      if (sequence === scope.current) setMessage(safeError(error));
    } finally { if (sequence === scope.current) setBusy(false); }
  };
  const add = () => {
    if (!column) { setMessage("請先選擇查詢欄位。"); return; }
    if (action === "CUSTOM" && !validSettings) {
      setMessage("保留碼數須為 0～100 的整數，遮蔽符號限單一字元。"); return;
    }
    // Only the explicit raw-display choice clears the historical sensitivity
    // label (required by the existing DB constraint); masks retain it.
    const sensitivityType = action === "NONE" ? "OTHER" : selectedRule?.sensitivityType ?? "OTHER";
    setRules((previous) => [...previous.filter((rule) => rule.columnName.toUpperCase() !== column.toUpperCase()), {
      columnName: column, sensitivityType,
      deviceMaskMode: action,
      customMask: action === "CUSTOM" ? placement === "RANGE" ? { prefix: 0, suffix: 0, symbol, start, end } : { prefix, suffix, symbol } : null,
    }]);
    setDirty(true);
    setMessage("已加入編輯清單，請按儲存規則。");
  };
  const save = async () => {
    if (version === 0 && rules.length === 0 && !emptyConfirmed) return;
    if (rules.some((rule) => rule.sensitivityType !== "OTHER" && rule.deviceMaskMode === "NONE")) {
      setMessage("敏感資料不可設定為原樣顯示。"); return;
    }
    if (!loaded || version === null) { setMessage("尚未成功載入原有規則，為避免覆蓋設定，請先重新載入頁面。"); return; }
    const sequence = scope.current;
    setBusy(true); setMessage("");
    try {
      const result = await apiRequest<{ columns: Rule[]; version: number }>(`/datasets/${datasetId}/sensitive-columns`, { method: "PUT", body: JSON.stringify({ columns: emptyConfirmed && rules.length === 0
        ? [...new Map(availableColumns.map(name => [name.toUpperCase(), name])).values()].map(columnName => ({ columnName, sensitivityType: "OTHER", deviceMaskMode: "NONE", customMask: null }))
        : rules, expectedVersion: version }) }, accessToken);
      if (sequence !== scope.current) return;
      setRules(result.columns);
      setVersion(result.version);
      setDirty(false);
      setEmptyConfirmed(false);
      setConflict(false);
      setMessage("敏感欄位規則已儲存，並記錄異動稽核。");
      onSaved?.();
    } catch (error) {
      if (sequence !== scope.current) return;
      const detail = safeError(error);
      const apiError = error as { code?: string; status?: number } | null;
      if (apiError?.code === "SENSITIVITY_VERSION_CONFLICT" && apiError.status === 409) {
        setConflict(true);
        setMessage("規則已由其他管理者更新。為避免覆蓋，已停止儲存；請重新載入並確認差異。");
      } else setMessage(detail);
    }
    finally { if (sequence === scope.current) setBusy(false); }
  };
  return <section className="preview-panel">
    <h2>Dataset 敏感資料欄位管理</h2>
    <p>此處使用獨立 API 儲存規則；「儲存 Dataset」不會儲存本區變更。移除只修改編輯清單，須按「儲存 Dataset 敏感欄位規則」才生效。啟用中的 Dashboard 安全限制仍適用。</p>
    <p>選擇欄位後設定遮蔽位置及符號，無需選擇英文模式或敏感資料分類。系統不會依 NAME、MRN、PHONE 等欄位名稱推定分類或遮蔽方式；原有使用者儲存的分類與規則會保留。</p>
    <p role="status">欄位來自已同步清單與既有規則；未設定的欄位不傳送。清單為空時，請先儲存 SQL，再按「取得並同步欄位清單」。這僅同步欄位選項，不建立可信型別或患者稽核證據，不解除資料預覽限制。</p>
    <button type="button" disabled={!canSyncColumns || busy || dirty || conflict} onClick={() => void syncColumns()}>取得並同步欄位清單</button>
    {!canSyncColumns && <p role="status">同步欄位目前不可用：請先儲存 SQL／資料來源，確認無未儲存修改，且帳號具備 DESIGN_QUERY 與 EXECUTE_QUERY 權限。</p>}
    {syncAttempted && availableColumns.length > 0 && <p role="status">目前可選擇 {availableColumns.length} 個已同步查詢欄位。</p>}}
    {dirty && <p role="status">請先儲存或重新載入規則，再同步欄位，避免遺失草稿。</p>}
    <label>查詢結果欄位 <select value={column} onChange={(event) => editRule(event.target.value)}>
      <option value="">請選擇欄位</option>
      {[...new Map([...availableColumns, ...rules.map(rule => rule.columnName)].map(name => [name.toUpperCase(), name])).values()].map((name) => <option key={name} value={name}>{name}</option>)}
    </select></label>
    <fieldset className="dataset-mask-options">
      <legend>Dataset 統一資料處理方式（Query／Dashboard 共用）</legend>
      <label className="dataset-mask-option"><input type="radio" name="maskAction" checked={action === "NONE"} onChange={() => setAction("NONE")}/> 顯示原始資料</label>
      <label className="dataset-mask-option"><input type="radio" name="maskAction" checked={action === "CUSTOM"} onChange={() => setAction("CUSTOM")}/> 自訂遮蔽</label>
      <label className="dataset-mask-option"><input type="radio" name="maskAction" checked={action === "FULL"} onChange={() => setAction("FULL")}/> 全部遮蔽</label>
      <label className="dataset-mask-option"><input type="radio" name="maskAction" checked={action === "OMIT"} onChange={() => setAction("OMIT")}/> 完全不傳送</label>
    </fieldset>
    {action === "CUSTOM" && <div className="preview-panel">
      <h3>自訂遮蔽設定</h3>
      <label>遮蔽位置 <select value={placement} onChange={e => setPlacement(e.target.value as "RETAIN" | "RANGE")}><option value="RETAIN">保留前後字數</option><option value="RANGE">指定遮蔽位置</option></select></label>
      {placement === "RANGE" && <><label>起始位置（從 1 起） <input type="number" min="1" max="10000" value={start} onChange={e => setStart(Number(e.target.value))}/></label><label>結束位置（含） <input type="number" min="1" max="10000" value={end} onChange={e => setEnd(Number(e.target.value))}/></label></>}
      {placement === "RETAIN" && <><label>保留前幾碼 <input type="number" min="0" max="100" step="1" value={prefix} onChange={(e) => setPrefix(Number(e.target.value))}/></label>
      <label>保留後幾碼 <input type="number" min="0" max="100" step="1" value={suffix} onChange={(e) => setSuffix(Number(e.target.value))}/></label></>}
      <label>遮蔽符號 <input type="text" maxLength={2} value={symbol} onChange={(e) => setSymbol(e.target.value)}/></label>
      <label>模擬資料（請勿輸入真實患者資料） <input type="text" value={sample} onChange={(e) => setSample(e.target.value)}/></label>
      <p role="status">預覽：{validSettings ? customPreview : "請輸入合法的遮蔽設定"}</p>
      <p>範例：病歷號 00001234 → ****1234（前 0、後 4）；電話 0912345678 → 091****678（前 3、後 3）。</p>
      <p>資料長度不足以保留指定碼數時，後端將全部遮蔽。</p>
    </div>}
    {action === "NONE" && <p role="status">您明確允許此欄位原始值送至前端（仍須通過既有授權及稽核）。儲存時此欄位的敏感標記設為 OTHER；患者稽核專用欄位限制仍適用。</p>}
    {action === "FULL" && <p role="status">全部遮蔽，例如：王小明 → ○○○○</p>}
    {action === "OMIT" && <p role="status">完全不傳送：Query 與 Dashboard 均不會收到此欄位。</p>}
    <button type="button" disabled={!loaded || conflict || !column || busy || (action === "CUSTOM" && !validSettings)} onClick={add}>加入／更新欄位規則</button>
    <table className="preview-table"><thead><tr><th>欄位</th><th>資料處理方式</th><th>操作</th></tr></thead>
      <tbody>{rules.map((rule) => <tr key={rule.columnName}><td>{rule.columnName}</td>
        <td>{rule.deviceMaskMode === "CUSTOM" && rule.customMask
          ? `自訂遮蔽（${rule.customMask.start === undefined ? `保留前 ${rule.customMask.prefix} 碼、後 ${rule.customMask.suffix} 碼` : `位置 ${rule.customMask.start}～${rule.customMask.end}`}，符號 ${rule.customMask.symbol}）`
          : rule.deviceMaskMode === "NONE" ? "顯示原始資料" : rule.deviceMaskMode === "OMIT" ? "完全不傳送"
          : rule.deviceMaskMode === "FULL" ? "全部遮蔽"
          : `舊版規則：${rule.deviceMaskMode}（仍有效，選取欄位可調整）`}</td>
        <td><button type="button" disabled={busy} onClick={() => editRule(rule.columnName)}>編輯</button>
          <button type="button" disabled={!loaded || conflict || busy} onClick={() => { setRules((previous) => previous.filter((item) => item.columnName !== rule.columnName)); setDirty(true); }}>移除</button></td></tr>)}</tbody></table>
    {loaded && rules.length === 0 && <label><input type="checkbox" checked={emptyConfirmed} disabled={busy || availableColumns.length === 0}
      onChange={e => setEmptyConfirmed(e.target.checked)} />我明確確認空政策（本清單無需遮蔽），允許目前已同步欄位原值顯示；新增欄位仍不傳送，患者稽核限制不變。</label>}
    {loaded && rules.length === 0 && availableColumns.length === 0 && <p role="status">請先同步欄位，再確認空敏感政策；同步不需要已確認政策。</p>}
    <button type="button" disabled={busy || (!dirty && !emptyConfirmed) || !loaded || version === null || conflict
      || (version === 0 && rules.length === 0 && !emptyConfirmed)} onClick={() => void save()}>儲存 Dataset 敏感欄位規則</button>
    {!loaded && <p role="status">原有規則尚未載入完成，暫停儲存以避免誤覆蓋。</p>}
    {dirty && <p role="status">尚有未儲存的敏感欄位規則變更。</p>}
    <button type="button" disabled={busy} onClick={reload}>重新載入伺服器規則</button>
    {conflict && <p role="alert">版本衝突：請重新載入規則後再次檢查。重新載入前不允許儲存。</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
