import { useEffect, useState } from "react";
import { apiRequest } from "../api/client";

type Rule = { columnName: string; sensitivityType: string; deviceMaskMode: string };
const categories = ["OTHER", "NAME", "NATIONAL_ID", "MRN", "PHONE", "BIRTH_DATE", "ADDRESS", "DIAGNOSIS", "HEALTH", "LAB"];
const modes = ["OMIT", "FULL", "NAME", "MRN", "PHONE", "GENERIC", "NONE"];

export function DatasetSensitivityEditor({ datasetId, accessToken, previewColumns }: {
  datasetId: number; accessToken: string | null; previewColumns: string[];
}) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [column, setColumn] = useState("");
  const [category, setCategory] = useState("OTHER");
  const [mode, setMode] = useState("OMIT");
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
    setRules((previous) => [...previous.filter((rule) => rule.columnName !== column), { columnName: column, sensitivityType: category, deviceMaskMode: mode }]);
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
      if (/SENSITIVITY_VERSION_CONFLICT|409|其他管理者已更新/.test(detail)) {
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
    <button type="button" disabled={!column || busy} onClick={add}>加入／更新</button>
    <table className="preview-table"><thead><tr><th>欄位</th><th>分類</th><th>遮蔽</th><th>操作</th></tr></thead>
      <tbody>{rules.map((rule) => <tr key={rule.columnName}><td>{rule.columnName}</td><td>{rule.sensitivityType}</td><td>{rule.deviceMaskMode}</td>
        <td><button type="button" disabled={busy} onClick={() => { setRules((previous) => previous.filter((item) => item.columnName !== rule.columnName)); setDirty(true); }}>移除</button></td></tr>)}</tbody></table>
    <button type="button" disabled={busy || !dirty || !loaded || version === null || conflict} onClick={() => void save()}>儲存 Dataset 敏感欄位規則</button>
    {!loaded && <p role="status">原有規則尚未載入完成，暫停儲存以避免誤覆蓋。</p>}
    {dirty && <p role="status">尚有未儲存的敏感欄位規則變更。</p>}
    <button type="button" disabled={busy} onClick={reload}>重新載入伺服器規則</button>
    {conflict && <p role="alert">版本衝突：請重新載入規則後再次檢查。重新載入前不允許儲存。</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
