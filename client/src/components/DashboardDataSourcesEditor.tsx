import { useEffect, useState } from "react";
import { apiRequest } from "../api/client";

type Source = { sourceKey: string; datasetId: number; refreshSeconds: number; parameters: Record<string, unknown>; isEnabled: boolean };
type Dataset = { id: number; code: string; name: string; isActive: boolean; isArchived: boolean };
type Draft = { sourceKey: string; datasetId: string; refreshSeconds: string; parametersJson: string; isEnabled: boolean };
const initial: Draft = { sourceKey: "", datasetId: "", refreshSeconds: "30", parametersJson: "{}", isEnabled: true };

export function DashboardDataSourcesEditor({ dashboardId, accessToken }: { dashboardId: number; accessToken: string | null }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<{ sourceKey: string; result: { columns: { name: string }[]; rows: Record<string, unknown>[] } } | null>(null);
  useEffect(() => {
    let active = true;
    setSources([]); setLoaded(false); setDirty(false); setMessage(""); setPreview(null); setDraft(initial);
    void Promise.all([
      apiRequest<{ sources: Source[] }>(`/dashboards/${dashboardId}/data-sources`, {}, accessToken),
      apiRequest<{ datasets: Dataset[] }>("/datasets", {}, accessToken),
    ]).then(([sourceResult, datasetResult]) => {
      if (!active) return;
      setSources(sourceResult.sources); setDatasets(datasetResult.datasets); setLoaded(true);
    }).catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : "載入資料來源失敗"); });
    return () => { active = false; };
  }, [dashboardId, accessToken]);
  function add() {
    const key = draft.sourceKey.trim();
    const datasetId = Number(draft.datasetId);
    const seconds = Number(draft.refreshSeconds);
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || !Number.isSafeInteger(datasetId) || datasetId <= 0
      || !Number.isInteger(seconds) || seconds < 5 || seconds > 3600) {
      setMessage("來源代碼須以英文字母開頭；請選擇 Dataset，更新秒數須為 5～3600。"); return;
    }
    let parameters: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(draft.parametersJson);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      parameters = parsed as Record<string, unknown>;
    } catch { setMessage("參數必須是 JSON 物件，例如 {}。"); return; }
    if (!datasets.some((dataset) => dataset.id === datasetId && dataset.isActive && !dataset.isArchived)) {
      setMessage("請選擇可用的 Dataset。"); return;
    }
    const item: Source = { sourceKey: key, datasetId, refreshSeconds: seconds, parameters, isEnabled: draft.isEnabled };
    setSources((previous) => [...previous.filter((source) => source.sourceKey.toUpperCase() !== key.toUpperCase()), item]);
    setDirty(true); setMessage("已加入清單，請按儲存資料來源。");
  }
  async function save() {
    if (!loaded || !dirty) return;
    setBusy(true); setMessage("");
    try {
      const result = await apiRequest<{ sources: Source[] }>(`/dashboards/${dashboardId}/data-sources`, {
        method: "PUT", body: JSON.stringify({ sources }),
      }, accessToken);
      setSources(result.sources); setDirty(false); setMessage("資料來源設定已儲存。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "儲存失敗"); }
    finally { setBusy(false); }
  }
  async function showPreview(sourceKey: string) {
    setBusy(true); setMessage(""); setPreview(null);
    try {
      const result = await apiRequest<typeof preview & { sourceKey: string; result: { columns: { name: string }[]; rows: Record<string, unknown>[] } }>(
        `/dashboards/${dashboardId}/data-sources/${encodeURIComponent(sourceKey)}/preview`, { method: "POST" }, accessToken);
      setPreview(result);
    } catch (error) { setMessage(error instanceof Error ? error.message : "預覽失敗"); }
    finally { setBusy(false); }
  }
  return <section className="dashboard-editor-card">
    <h2>額外 SQL／Dataset 資料來源</h2>
    <p>主要查詢維持原設定。此處可加入最多 8 個額外 Dataset，各自設定更新頻率與參數。預覽僅回傳後端允許且已遮蔽的欄位。</p>
    <div className="dashboard-editor-form">
      <label>來源代碼 <input value={draft.sourceKey} placeholder="例如 CLINIC_INFO" onChange={(e) => setDraft({ ...draft, sourceKey: e.target.value })}/></label>
      <label>Dataset <select value={draft.datasetId} onChange={(e) => setDraft({ ...draft, datasetId: e.target.value })}>
        <option value="">請選擇</option>
        {datasets.filter((item) => item.isActive && !item.isArchived).map((item) => <option key={item.id} value={item.id}>{item.name}（{item.code}）</option>)}
      </select></label>
      <label>更新秒數 <input type="number" min="5" max="3600" step="1" value={draft.refreshSeconds} onChange={(e) => setDraft({ ...draft, refreshSeconds: e.target.value })}/></label>
      <label>查詢參數 JSON <textarea rows={2} value={draft.parametersJson} onChange={(e) => setDraft({ ...draft, parametersJson: e.target.value })}/></label>
      <label><input type="checkbox" checked={draft.isEnabled} onChange={(e) => setDraft({ ...draft, isEnabled: e.target.checked })}/> 啟用來源</label>
      <button type="button" disabled={busy || !loaded || sources.length >= 8 && !sources.some((item) => item.sourceKey.toUpperCase() === draft.sourceKey.toUpperCase())} onClick={add}>加入／更新來源</button>
    </div>
    <table className="preview-table"><thead><tr><th>來源</th><th>Dataset</th><th>更新秒數</th><th>狀態</th><th>操作</th></tr></thead>
      <tbody>{sources.map((source) => <tr key={source.sourceKey}>
        <td>{source.sourceKey}</td><td>{datasets.find((item) => item.id === source.datasetId)?.name ?? source.datasetId}</td>
        <td>{source.refreshSeconds}</td><td>{source.isEnabled ? "啟用" : "停用"}</td>
        <td><button type="button" disabled={busy} onClick={() => setDraft({ sourceKey: source.sourceKey, datasetId: String(source.datasetId), refreshSeconds: String(source.refreshSeconds), parametersJson: JSON.stringify(source.parameters, null, 2), isEnabled: source.isEnabled })}>編輯</button>
          <button type="button" disabled={busy || dirty || !source.isEnabled} onClick={() => void showPreview(source.sourceKey)}>遮蔽預覽</button>
          <button type="button" disabled={busy} onClick={() => { setSources((previous) => previous.filter((item) => item.sourceKey !== source.sourceKey)); setDirty(true); }}>移除</button></td>
      </tr>)}</tbody></table>
    <button type="button" disabled={busy || !loaded || !dirty} onClick={() => void save()}>儲存資料來源</button>
    {dirty && <p role="status">有尚未儲存的變更。儲存前無法預覽。</p>}
    {message && <p role="status">{message}</p>}
    {preview && <div className="preview-panel"><h3>遮蔽預覽：{preview.sourceKey}</h3>
      <table className="preview-table"><thead><tr>{preview.result.columns.map((column) => <th key={column.name}>{column.name}</th>)}</tr></thead>
        <tbody>{preview.result.rows.slice(0, 10).map((row, index) => <tr key={index}>{preview.result.columns.map((column) => <td key={column.name}>{String(row[column.name] ?? "")}</td>)}</tr>)}</tbody>
      </table><p>預覽僅顯示前 10 筆；請勿使用真實患者資料截圖分享。</p>
    </div>}
  </section>;
}
