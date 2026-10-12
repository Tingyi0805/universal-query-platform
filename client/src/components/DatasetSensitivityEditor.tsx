import { useEffect, useState } from "react";
import { apiRequest } from "../api/client";

type CustomMask = { prefix: number; suffix: number; symbol: string };
type Rule = { columnName: string; sensitivityType: string; deviceMaskMode: string; customMask?: CustomMask | null };


export function DatasetSensitivityEditor({ datasetId, accessToken, previewColumns }: {
  datasetId: number; accessToken: string | null; previewColumns: string[];
}) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [column, setColumn] = useState("");
  const [action, setAction] = useState<"CUSTOM" | "FULL" | "OMIT">("CUSTOM");
  const [prefix, setPrefix] = useState(0);
  const [suffix, setSuffix] = useState(4);
  const [symbol, setSymbol] = useState("*");
  const [sample, setSample] = useState("00001234");
  const chars = Array.from(sample);
  const validSettings = Number.isInteger(prefix) && Number.isInteger(suffix)
    && prefix >= 0 && suffix >= 0 && prefix <= 100 && suffix <= 100
    && Array.from(symbol).length === 1 && !/[\\r\\n\\t]/u.test(symbol);
  const customPreview = !validSettings || prefix + suffix >= chars.length
    ? symbol.repeat(chars.length)
    : chars.slice(0, prefix).join("") + symbol.repeat(chars.length - prefix - suffix)
      + (suffix ? chars.slice(-suffix).join("") : "");
  const selectedRule = rules.find((rule) => rule.columnName === column);
  const editRule = (name: string) => {
    setColumn(name);
    const rule = rules.find((item) => item.columnName === name);
    if (!rule) { setAction("CUSTOM"); return; }
    setAction(rule.deviceMaskMode === "OMIT" ? "OMIT" : rule.deviceMaskMode === "FULL" ? "FULL" : "CUSTOM");
    if (rule.customMask) {
      setPrefix(rule.customMask.prefix); setSuffix(rule.customMask.suffix); setSymbol(rule.customMask.symbol);
    }
    setMessage(rule.deviceMaskMode === "CUSTOM" || rule.deviceMaskMode === "OMIT" || rule.deviceMaskMode === "FULL"
      ? "" : "此欄位原本使用舊版遮蔽模式。儲存前請確認新的自訂規則。");
  };
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let active = true;
    setRules([]);
    setLoaded(false);
    setVersion(null);
    setDirty(false);
    setMessage("");
    setConflict(false);
    void apiRequest<{ columns: Rule[]; version: number }>(`/datasets/${datasetId}/sensitive-columns`, {}, accessToken)
      .then((result) => { if (active) { setRules(result.columns); setVersion(result.version); setLoaded(true); } })
      .catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : "無法載入敏感欄位設定"); });
    return () => { active = false; };
  }, [datasetId, accessToken, reloadKey]);
  const reload = () => {
    if (dirty && !window.confirm("重新載入將捨棄目前尚未儲存的變更，確定繼續？")) return;
    setReloadKey((current) => current + 1);
  };
  const add = () => {
    if (!column) { setMessage("請先選擇查詢欄位。"); return; }
    if (action === "CUSTOM" && !validSettings) {
      setMessage("保留碼數須為 0～100 的整數，遮蔽符號限單一字元。"); return;
    }
    // Preserve the classification of existing rules; new fields default to sensitive.
    // Classification is not editable in the simplified UI.
    const sensitivityType = selectedRule?.sensitivityType ?? "OTHER";
    setRules((previous) => [...previous.filter((rule) => rule.columnName !== column), {
      columnName: column, sensitivityType,
      deviceMaskMode: action,
      customMask: action === "CUSTOM" ? { prefix, suffix, symbol } : null,
    }]);
    setDirty(true);
    setMessage("已加入編輯清單，請按儲存規則。");
  };
  const save = async () => {
    if (rules.some((rule) => rule.sensitivityType !== "OTHER" && rule.deviceMaskMode === "NONE")) {
      setMessage("敏感資料不可設定為原樣顯示。"); return;
    }
    if (!loaded || version === null) { setMessage("尚未成功載入原有規則，為避免覆蓋設定，請先重新載入頁面。"); return; }
    setBusy(true); setMessage("");
    try {
      const result = await apiRequest<{ columns: Rule[]; version: number }>(`/datasets/${datasetId}/sensitive-columns`, { method: "PUT", body: JSON.stringify({ columns: rules, expectedVersion: version }) }, accessToken);
      setRules(result.columns);
      setVersion(result.version);
      setDirty(false);
      setConflict(false);
      setMessage("敏感欄位規則已儲存，並記錄異動稽核。");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "儲存失敗";
      const apiError = error as { code?: string; status?: number } | null;
      if (apiError?.code === "SENSITIVITY_VERSION_CONFLICT" && apiError.status === 409) {
        setConflict(true);
        setMessage("規則已由其他管理者更新。為避免覆蓋，已停止儲存；請重新載入並確認差異。");
      } else setMessage(detail);
    }
    finally { setBusy(false); }
  };
  return <section className="preview-panel">
    <h2>Dataset 敏感資料欄位管理</h2>
    <p>選擇欄位後設定遮蔽位置及符號，無需選擇英文模式或敏感資料分類。原有敏感分類與既有規則會保留；未核准欄位不會傳送到播放裝置。</p>
    <label>查詢結果欄位 <select value={column} onChange={(event) => editRule(event.target.value)}>
      <option value="">請選擇欄位</option>
      {[...new Set([...previewColumns, ...rules.map((rule) => rule.columnName)])].map((name) => <option key={name} value={name}>{name}</option>)}
    </select></label>
    <fieldset>
      <legend>播放裝置資料處理方式</legend>
      <label><input type="radio" name="maskAction" checked={action === "CUSTOM"} onChange={() => setAction("CUSTOM")}/> 自訂遮蔽</label>
      <label><input type="radio" name="maskAction" checked={action === "FULL"} onChange={() => setAction("FULL")}/> 全部遮蔽</label>
      <label><input type="radio" name="maskAction" checked={action === "OMIT"} onChange={() => setAction("OMIT")}/> 完全不傳送</label>
    </fieldset>
    {action === "CUSTOM" && <div className="preview-panel">
      <h3>自訂遮蔽設定</h3>
      <label>保留前幾碼 <input type="number" min="0" max="100" step="1" value={prefix} onChange={(e) => setPrefix(Number(e.target.value))}/></label>
      <label>保留後幾碼 <input type="number" min="0" max="100" step="1" value={suffix} onChange={(e) => setSuffix(Number(e.target.value))}/></label>
      <label>遮蔽符號 <input type="text" maxLength={2} value={symbol} onChange={(e) => setSymbol(e.target.value)}/></label>
      <label>模擬資料（請勿輸入真實患者資料） <input type="text" value={sample} onChange={(e) => setSample(e.target.value)}/></label>
      <p role="status">預覽：{validSettings ? customPreview : "請輸入合法的遮蔽設定"}</p>
      <p>範例：病歷號 00001234 → ****1234（前 0、後 4）；電話 0912345678 → 091****678（前 3、後 3）。</p>
      <p>資料長度不足以保留指定碼數時，後端將全部遮蔽。</p>
    </div>}
    {action === "FULL" && <p role="status">全部遮蔽，例如：王小明 → ○○○○</p>}
    {action === "OMIT" && <p role="status">完全不傳送：此欄位不會出現在播放裝置的資料中。</p>}
    <button type="button" disabled={!column || busy || (action === "CUSTOM" && !validSettings)} onClick={add}>加入／更新欄位規則</button>
    <table className="preview-table"><thead><tr><th>欄位</th><th>資料處理方式</th><th>操作</th></tr></thead>
      <tbody>{rules.map((rule) => <tr key={rule.columnName}><td>{rule.columnName}</td>
        <td>{rule.deviceMaskMode === "CUSTOM" && rule.customMask
          ? `自訂遮蔽（保留前 ${rule.customMask.prefix} 碼、後 ${rule.customMask.suffix} 碼，符號 ${rule.customMask.symbol}）`
          : rule.deviceMaskMode === "OMIT" ? "完全不傳送"
          : rule.deviceMaskMode === "FULL" ? "全部遮蔽"
          : `舊版規則：${rule.deviceMaskMode}（仍有效，選取欄位可調整）`}</td>
        <td><button type="button" disabled={busy} onClick={() => editRule(rule.columnName)}>編輯</button>
          <button type="button" disabled={busy} onClick={() => { setRules((previous) => previous.filter((item) => item.columnName !== rule.columnName)); setDirty(true); }}>移除</button></td></tr>)}</tbody></table>
    <button type="button" disabled={busy || !dirty || !loaded || version === null || conflict} onClick={() => void save()}>儲存 Dataset 敏感欄位規則</button>
    {!loaded && <p role="status">原有規則尚未載入完成，暫停儲存以避免誤覆蓋。</p>}
    {dirty && <p role="status">尚有未儲存的敏感欄位規則變更。</p>}
    <button type="button" disabled={busy} onClick={reload}>重新載入伺服器規則</button>
    {conflict && <p role="alert">版本衝突：請重新載入規則後再次檢查。重新載入前不允許儲存。</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
