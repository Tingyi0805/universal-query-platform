import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api/client";
import { managementError, sourceSettings, type QuerySourceConfiguration, type QuerySourceSettings } from "../dashboard/querySourceManagement";
type Query = { id: number; name: string; code: string; canExecute: boolean };
const initial: QuerySourceSettings = { sourceKey: "", queryDefinitionId: null, refreshSeconds: 30, pageSize: 10, pageSeconds: 15, maxRows: 1000, isEnabled: true };
export function DashboardDataSourcesEditor({ dashboardId, accessToken }: { dashboardId: number; accessToken: string | null }) {
  const [configuration, setConfiguration] = useState<QuerySourceConfiguration | null>(null);
  const [queries, setQueries] = useState<Query[]>([]);
  const [draft, setDraft] = useState<QuerySourceSettings>(initial);
  const [parametersJson, setParametersJson] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [remove, setRemove] = useState<QuerySourceSettings | null>(null);
  const epoch=useRef(0), configurationRead=useRef(0);
  const base = `/dashboards/${dashboardId}/query-sources/v1`;
  async function reload() {
    const requestEpoch=epoch.current,requestRead=++configurationRead.current;
    setBusy(true);
    try { const result=await apiRequest<QuerySourceConfiguration>(`${base}/configuration`, {}, accessToken);if(requestEpoch===epoch.current && requestRead===configurationRead.current)setConfiguration(result); }
    catch (error) { if(requestEpoch===epoch.current && requestRead===configurationRead.current)setMessage(managementError(error)); }
    finally { if(requestEpoch===epoch.current && requestRead===configurationRead.current)setBusy(false); }
  }
  useEffect(() => {
    ++epoch.current;
    const readVersion=++configurationRead.current;
    let cancelled = false;
    setConfiguration(null); setDraft(initial); setParametersJson("{}"); setMessage(""); setRemove(null);
    void apiRequest<QuerySourceConfiguration>(`${base}/configuration`, {}, accessToken).then(value => {
      if (!cancelled && readVersion===configurationRead.current) setConfiguration(value);
    }).catch(error => { if (!cancelled) setMessage(managementError(error)); });
    void apiRequest<{ queries: Query[] }>("/queries", {}, accessToken).then(value => {
      if (!cancelled) setQueries(value.queries.filter(query => query.canExecute));
    }).catch(error => { if (!cancelled) setMessage(managementError(error)); });
    return () => { cancelled = true;++epoch.current; };
  }, [base, accessToken]);
  async function disableQueryMode() {
    if (!configuration || busy) return;
    const requestEpoch=epoch.current;
    setBusy(true);
    try {
      await apiRequest(`/dashboards/${dashboardId}/query-mode/v1`, { method: "POST",
        body: JSON.stringify({ expectedVersion: configuration.version, activate: false }) }, accessToken);
      if(requestEpoch!==epoch.current)return;
      setMessage("Query-only 已安全停用；原裝置憑證已失效。重新啟用須依完整安全流程簽發新憑證。");
      await reload();
      window.dispatchEvent(new CustomEvent("uqp.dashboard.configuration.changed",{detail:{dashboardId,origin:"sources"}}));
    } catch (error) { if(requestEpoch===epoch.current)setMessage(managementError(error)); }
    finally { if(requestEpoch===epoch.current)setBusy(false); }
  }
  useEffect(() => {
    const changed=(event:Event)=>{if((event as CustomEvent<{dashboardId:number;origin:string}>).detail?.dashboardId===dashboardId && (event as CustomEvent<{origin:string}>).detail.origin!=="sources")void reload();};
    window.addEventListener("uqp.dashboard.configuration.changed",changed);
    return ()=>window.removeEventListener("uqp.dashboard.configuration.changed",changed);
  },[dashboardId,accessToken]);
  function edit(source: QuerySourceSettings) {
    setDraft({ ...source, maxRows: source.maxRows ?? 1000 }); setParametersJson(JSON.stringify(source.parameters ?? {}, null, 2));
    setMessage(source.parameters === undefined ? "此來源參數無法安全讀取；儲存將明確替換參數，請填寫完整設定。" : "");
  }
  async function save(removal?: QuerySourceSettings) {
    const requestEpoch=epoch.current;
    if (!configuration?.editable || busy) return;
    let settings: ReturnType<typeof sourceSettings> | undefined;
    try {
      if (!removal) {
        settings = sourceSettings(draft, parametersJson);
        if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(draft.sourceKey)
          || (draft.sourceKey.toUpperCase() === "PRIMARY" && draft.sourceKey !== "PRIMARY")) throw new Error();
        if (!draft.id && draft.sourceKey !== "PRIMARY" && (configuration.sources.length >= 7
          || configuration.sources.some(source => source.sourceKey.toUpperCase() === draft.sourceKey.toUpperCase()))) throw new Error();
      }
    } catch { setMessage("請確認 Query、來源代碼、數值範圍及 JSON 物件；含 PRIMARY 最多 8 個來源。"); return; }
    const firstPrimaryConversion = !removal && draft.sourceKey === "PRIMARY" && configuration.primary.requiresConversion;
    if (firstPrimaryConversion && !window.confirm(
      "此 Dashboard 尚未完成 PRIMARY 資料來源轉換。此操作會設定資料量上限，並啟用新版資料來源管理狀態。原有遮蔽及核准規則會保留；請確認 Dashboard 已停用，且已檢查 Query 與參數。是否繼續？"
    )) return;
    setBusy(true); setMessage("");
    try {
      const primary = !removal && draft.sourceKey === "PRIMARY";
      const body = primary ? { expectedVersion: configuration.version, ...settings } : {
        expectedVersion: configuration.version,
        upserts: removal ? [] : [{ id: draft.id ?? null, sourceKey: draft.sourceKey, ...settings, isEnabled: draft.isEnabled ?? true }],
        removals: removal ? [{ id: removal.id, sourceKey: removal.sourceKey }] : [],
      };
      // One explicit mutation; omitted sources are never removed.
      await apiRequest(base + (primary ? "/primary" : ""), { method: "PATCH", body: JSON.stringify(body) }, accessToken);
      if(requestEpoch!==epoch.current)return;
      setRemove(null); setDraft(initial); setParametersJson("{}"); setMessage("設定已儲存。");
      await reload();
      window.dispatchEvent(new CustomEvent("uqp.dashboard.configuration.changed",{detail:{dashboardId,origin:"sources"}}));
    } catch (error) { if(requestEpoch===epoch.current)setMessage(managementError(error)); }
    finally { if(requestEpoch===epoch.current)setBusy(false); }
  }
  return <section className="dashboard-editor-card">
    <h2>Query-only 資料來源</h2>
    <p>含 PRIMARY 最多 8 個來源。僅能選擇已發布且有執行權限的 Query；須先安全停用看板。遮蔽由後端執行。轉換後請使用本區與版面編輯器；舊主設定儲存仍受保護。</p>
    <button type="button" disabled={busy} onClick={() => void reload()}>重新載入來源版本</button>
    {configuration && <>
      {configuration.primary.requiresConversion && (
        <p role="status">PRIMARY 尚未完成新版資料來源轉換。請在 Dashboard 停用時，選取 PRIMARY 並確認 Query、參數及資料量上限；首次儲存前會再次要求確認。未完成轉換前，資料揭露更新可能會被安全機制阻擋。</p>
      )}
      {configuration.dashboardMode === "QUERY_ONLY" && <button type="button" disabled={busy} onClick={() => {
        if (window.confirm("停用 Query-only 並使所有相關装置憑證失效？")) void disableQueryMode();
      }}>安全停用 Query-only（撤銷裝置憑證）</button>}
      {!configuration.editable && <p role="status">目前不可編輯，請透過既有安全流程停用看板。</p>}
      <table className="preview-table"><thead><tr><th>來源</th><th>Query</th><th>更新／換頁秒數</th><th>狀態</th><th>操作</th></tr></thead>
        <tbody>{[configuration.primary, ...configuration.sources].map(source => <tr key={source.sourceKey}>
          <td>{source.sourceKey}</td><td>{queries.find(query => query.id === source.queryDefinitionId)?.name ?? source.queryDefinitionId ?? "待明確選取 Query"}</td>
          <td>{source.refreshSeconds}／{source.pageSeconds}</td><td>{source.errorCode ?? source.bindingState ?? "PRIMARY"}</td>
          <td><button type="button" disabled={busy || !configuration.editable} onClick={() => edit(source)}>編輯 {source.sourceKey}</button>
            {source.id && <button type="button" disabled={busy || !configuration.editable} onClick={() => setRemove(source)}>移除 {source.sourceKey}</button>}</td>
        </tr>)}</tbody></table>
      <fieldset disabled={busy || !configuration.editable} className="dashboard-editor-form"><legend>{draft.sourceKey === "PRIMARY" ? "PRIMARY 設定" : "來源設定"}</legend>
        <label>來源代碼<input value={draft.sourceKey} disabled={Boolean(draft.id) || draft.sourceKey === "PRIMARY"} onChange={event => setDraft({ ...draft, sourceKey: event.target.value })}/></label>
        <label>已發布 Query<select value={draft.queryDefinitionId ?? ""} onChange={event => setDraft({ ...draft, queryDefinitionId: Number(event.target.value) || null })}>
          <option value="">請明確選取</option>{queries.map(query => <option key={query.id} value={query.id}>{query.name}（{query.code}）</option>)}
        </select></label>
        {([['refreshSeconds','更新秒數',5,3600],['pageSize','每頁筆數',1,100],['pageSeconds','換頁秒數',5,3600],['maxRows','資料量上限',1,10000]] as const).map(([key,label,min,max]) =>
          <label key={key}>{label}<input type="number" min={min} max={max} value={draft[key] ?? ""} onChange={event => setDraft({ ...draft, [key]: Number(event.target.value) })}/></label>)}
        <label>查詢參數 JSON<textarea rows={4} value={parametersJson} onChange={event => setParametersJson(event.target.value)}/></label>
        {draft.sourceKey !== "PRIMARY" && <label><input type="checkbox" checked={draft.isEnabled ?? true} onChange={event => setDraft({ ...draft, isEnabled: event.target.checked })}/>啟用來源</label>}
        <button type="button" onClick={() => void save()}>儲存目前來源</button>
        <button type="button" onClick={() => { setDraft(initial); setParametersJson("{}"); }}>新增來源／取消編輯</button>
      </fieldset>
      {remove && <div role="alert">確認移除 {remove.sourceKey}？已引用來源會由後端拒絕。
        <button type="button" disabled={busy} onClick={() => void save(remove)}>確認移除來源</button>
        <button type="button" onClick={() => setRemove(null)}>取消移除</button></div>}
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
