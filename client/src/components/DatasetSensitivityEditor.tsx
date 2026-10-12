import { useEffect, useState } from "react";
import { apiRequest } from "../api/client";

type CustomMask = { prefix: number; suffix: number; symbol: string };
type Rule = { columnName: string; sensitivityType: string; deviceMaskMode: string; customMask?: CustomMask | null };
const categories = ["OTHER", "NAME", "NATIONAL_ID", "MRN", "PHONE", "BIRTH_DATE", "ADDRESS", "DIAGNOSIS", "HEALTH", "LAB"];
const modes = ["OMIT", "FULL", "NAME", "MRN", "PHONE", "GENERIC", "NONE", "CUSTOM"];

export function DatasetSensitivityEditor({ datasetId, accessToken, previewColumns }: {
  datasetId: number; accessToken: string | null; previewColumns: string[];
}) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [column, setColumn] = useState("");
  const [category, setCategory] = useState("OTHER");
  const [mode, setMode] = useState("OMIT");
  const [prefix, setPrefix] = useState(0);
  const [suffix, setSuffix] = useState(4);
  const [symbol, setSymbol] = useState("*");
  const [sample, setSample] = useState("00001234");
  const example: Record<string, [string, string]> = {
    FULL: ["王小明", "○○○○"], NAME: ["王小明", "王○明"],
    MRN: ["00001234", "0000○○34"], PHONE: ["0912345678", "0912○○○678"],
    GENERIC: ["ABCD123456", "A○○○○○○○○6"], OMIT: ["王小明", "不回傳此欄位"],
    NONE: ["015", "015"],
  };
  const chars = Array.from(sample);
  const customPreview = prefix + suffix >= chars.length
    ? symbol.repeat(chars.length)
    : chars.slice(0, prefix).join("") + symbol.repeat(chars.length - prefix - suffix)
      + (suffix ? chars.slice(-suffix).join("") : "");
  const invalidCustom = mode === "CUSTOM" && (prefix + suffix >= chars.length || Array.from(symbol).length !== 1);
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
    if (!column || (category !== "OTHER" && mode === "NONE")) {
      setMessage("敏感資料不可設定為原樣顯示。"); return;
    }
    if (mode === "CUSTOM" && (Array.from(symbol).length !== 1 || /[\\r\\n\\t]/u.test(symbol) || prefix < 0 || suffix < 0 || prefix > 100 || suffix > 100)) {
      setMessage("自訂遮蔽設定無效，請確認保留碼數與遮蔽符號。"); return;
    }
    setRules((previous) => [...previous.filter((rule) => rule.columnName !== column), {
      columnName: column, sensitivityType: category, deviceMaskMode: mode,
      customMask: mode === "CUSTOM" ? { prefix, suffix, symbol } : null,
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
    <p>規則適用於使用此 Dataset 的固定播放裝置。先預覽查詢取得欄位名稱；未列入規則的欄位仍需在 Dashboard 明確核准才能顯示。</p>
    <label>查詢結果欄位 <select value={column} onChange={(event) => setColumn(event.target.value)}>
      <option value="">請選擇欄位</option>
      {[...new Set([...previewColumns, ...rules.map((rule) => rule.columnName)])].map((name) => <option key={name} value={name}>{name}</option>)}
    </select></label>
    <label>敏感資料分類 <select value={category} onChange={(event) => { const next = event.target.value; setCategory(next); if (next !== "OTHER" && mode === "NONE") setMode("OMIT"); }}>
      {categories.map((name) => <option key={name} value={name}>{name}</option>)}
    </select></label>
    <label>播放遮蔽方式 <select value={mode} onChange={(event) => setMode(event.target.value)}>
      {modes.map((name) => <option key={name} value={name} disabled={name === "NONE" && category !== "OTHER"}>{name}</option>)}
    </select></label>
    {mode === "CUSTOM" && <div className="preview-panel">
      <h3>自訂遮蔽位置與符號</h3>
      <label>保留前幾碼 <input type="number" min="0" max="100" value={prefix} onChange={(e) => setPrefix(Number(e.target.value))}/></label>
      <label>保留後幾碼 <input type="number" min="0" max="100" value={suffix} onChange={(e) => setSuffix(Number(e.target.value))}/></label>
      <label>遮蔽符號 <input type="text" maxLength={2} value={symbol} onChange={(e) => setSymbol(e.target.value)}/></label>
      <label>預覽用模擬資料 <input type="text" value={sample} onChange={(e) => setSample(e.target.value)}/></label>
      <p>遮蔽預覽：<strong>{invalidCustom ? "保留碼數過多，實際播放將全部遮蔽" : customPreview}</strong></p>
      <p>範例：病歷號 00001234 → ****1234（前 0／後 4）；電話 0912345678 → 091****678（前 3／後 3）。</p>
    </div>}
    {mode !== "CUSTOM" && <p role="status">範例：{example[mode]?.[0]} → <strong>{example[mode]?.[1]}</strong></p>}
    <button type="button" disabled={!column || busy} onClick={add}>加入／更新</button>
    <table className="preview-table"><thead><tr><th>欄位</th><th>分類</th><th>遮蔽</th><th>操作</th></tr></thead>
      <tbody>{rules.map((rule) => <tr key={rule.columnName}><td>{rule.columnName}</td><td>{rule.sensitivityType}</td><td>{rule.deviceMaskMode === "CUSTOM" && rule.customMask
          ? `CUSTOM（前 ${rule.customMask.prefix}／後 ${rule.customMask.suffix}，符號 ${rule.customMask.symbol}）`
          : rule.deviceMaskMode}</td>
        <td><button type="button" disabled={busy} onClick={() => { setRules((previous) => previous.filter((item) => item.columnName !== rule.columnName)); setDirty(true); }}>移除</button></td></tr>)}</tbody></table>
    <button type="button" disabled={busy || !dirty || !loaded || version === null || conflict} onClick={() => void save()}>儲存 Dataset 敏感欄位規則</button>
    {!loaded && <p role="status">原有規則尚未載入完成，暫停儲存以避免誤覆蓋。</p>}
    {dirty && <p role="status">尚有未儲存的敏感欄位規則變更。</p>}
    <button type="button" disabled={busy} onClick={reload}>重新載入伺服器規則</button>
    {conflict && <p role="alert">版本衝突：請重新載入規則後再次檢查。重新載入前不允許儲存。</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
