import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api/client";
import { managementError, sourceSettings, trustedConfiguration, type QuerySourceConfiguration, type QuerySourceSettings } from "../dashboard/querySourceManagement";
type Query = { id: number; name: string; code: string; canExecute: boolean };
const initial: QuerySourceSettings = { sourceKey: "", queryDefinitionId: null, refreshSeconds: 30, pageSize: 10, pageSeconds: 15, maxRows: 1000, isEnabled: true };
export function DashboardDataSourcesEditor({ dashboardId, accessToken }: { dashboardId: number; accessToken: string | null }) {
  const [configuration, setConfiguration] = useState<QuerySourceConfiguration | null>(null);
  const [queries, setQueries] = useState<Query[]>([]);
  const [draftVersion, setDraftVersion] = useState<string | null>(null);
  const [draft, setDraft] = useState<QuerySourceSettings>(initial);
  const [parametersJson, setParametersJson] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [remove, setRemove] = useState<QuerySourceSettings | null>(null);
  const epoch=useRef(0), configurationRead=useRef(0);
  const base = `/dashboards/${dashboardId}/query-sources/v1`;
  async function reload() {
    const requestEpoch=epoch.current,requestRead=++configurationRead.current;
    setBusy(true); setDraftVersion(null);
    try { const result=trustedConfiguration(await apiRequest<QuerySourceConfiguration>(`${base}/configuration`, {}, accessToken));if(requestEpoch===epoch.current && requestRead===configurationRead.current)setConfiguration(result); }
    catch (error) { if(requestEpoch===epoch.current && requestRead===configurationRead.current){setConfiguration(null);setMessage(managementError(error));} }
    finally { if(requestEpoch===epoch.current && requestRead===configurationRead.current)setBusy(false); }
  }
  useEffect(() => {
    ++epoch.current;
    const readVersion=++configurationRead.current;
    let cancelled = false;
    setQueries([]); setConfiguration(null); setDraft(initial); setParametersJson("{}"); setMessage(""); setRemove(null);
    void apiRequest<QuerySourceConfiguration>(`${base}/configuration`, {}, accessToken).then(response => {
      const value = trustedConfiguration(response);
      if (!cancelled && readVersion===configurationRead.current) { setConfiguration(value); setDraftVersion(value.version); }
    }).catch(error => { if (!cancelled) {setConfiguration(null);setMessage(managementError(error));} });
    void apiRequest<{ queries: Query[] }>("/queries", {}, accessToken).then(value => {
      if (!cancelled) setQueries(value.queries.filter(query => query.canExecute));
    }).catch(error => { if (!cancelled) {setConfiguration(null);setMessage(managementError(error));} });
    return () => { cancelled = true;++epoch.current; };
  }, [base, accessToken]);
  useEffect(() => {
    const changed=(event:Event)=>{if((event as CustomEvent<{dashboardId:number;origin:string}>).detail?.dashboardId===dashboardId && (event as CustomEvent<{origin:string}>).detail.origin!=="sources")void reload();};
    window.addEventListener("uqp.dashboard.configuration.changed",changed);
    return ()=>window.removeEventListener("uqp.dashboard.configuration.changed",changed);
  },[dashboardId,accessToken]);
  function edit(source: QuerySourceSettings) {
    setDraftVersion(configuration?.version ?? null);
    setDraft({ ...source, maxRows: source.maxRows ?? 1000 }); setParametersJson(JSON.stringify(source.parameters ?? {}, null, 2));
    setMessage(source.parameters === undefined ? "此來源參數無法安全讀取；儲存將明確替換參數，請填寫完整設定。" : "");
  }
  async function save(removal?: QuerySourceSettings) {
    const requestEpoch=epoch.current;
    if (!configuration?.editable || busy || (!removal && draftVersion !== configuration.version)) return;
    let settings: ReturnType<typeof sourceSettings> | undefined;
    try {
      if (!removal) {
        settings = sourceSettings(draft, parametersJson);
        if (!queries.some(query => query.id === settings!.queryDefinitionId)) throw new Error("QUERY_REQUIRED");
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
    const pendingConversion = !removal && configuration.sources.some(source => source.id === draft.id && source.queryDefinitionId === null);
    if (pendingConversion && !window.confirm(`確認將來源 ${draft.sourceKey} 轉換為所選 Query？不推測 Dataset 對應；既有引用及 Source ID 保留，公共顯示依所選 Dataset 的已確認政策。`)) return;
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
      const converted = !removal && draft.sourceKey !== "PRIMARY" && configuration.sources.some(source => source.id === draft.id && source.queryDefinitionId === null);
      setRemove(null); setDraft(initial); setParametersJson("{}"); setMessage(converted ? "來源已轉換；請確認所選 Dataset 的公共顯示政策。未啟用播放。" : "設定已儲存。");
      await reload();
      if (requestEpoch !== epoch.current) return;
      window.dispatchEvent(new CustomEvent("uqp.dashboard.configuration.changed",{detail:{dashboardId,origin:"sources"}}));
    } catch (error) { if(requestEpoch===epoch.current){setDraftVersion(null);setConfiguration(previous => previous ? { ...previous, editable: false } : null);setMessage(managementError(error));} }
    finally { if(requestEpoch===epoch.current)setBusy(false); }
  }
  async function revokePending(source: QuerySourceSettings) {
    if (!configuration?.editable || busy || !source.id || source.queryDefinitionId !== null) return;
    const requestEpoch = epoch.current;
    const path = `${base}/${encodeURIComponent(source.sourceKey)}/pending-approvals`;
    setBusy(true); setMessage("");
    try {
      const value = await apiRequest<{ dashboardId: number; sourceId: number; sourceKey: string; hasApprovals: boolean; version: string; reapprovalRequired: boolean }>(path, {}, accessToken);
      if (requestEpoch !== epoch.current) return;
      if (value.dashboardId !== dashboardId || value.sourceId !== source.id || value.sourceKey !== source.sourceKey || !/^[a-f0-9]{64}$/.test(value.version) || typeof value.hasApprovals !== "boolean" || value.reapprovalRequired !== true) throw new Error("RESPONSE_INVALID");
      if (!value.hasApprovals) { setMessage("此 pending 來源沒有待撤銷核准；請明確選擇 Query 轉換。"); return; }
      if (!window.confirm(`確認撤銷 pending 來源 ${source.sourceKey}（ID ${source.id}）的既有核准？只清理此來源核准，保留 Source ID、歷史 Dataset 與引用。之後須明確選 Query 轉換並確認 Dataset 公共政策；不會自動恢復舊授權。`)) return;
      await apiRequest(path, { method: "POST", body: JSON.stringify({ sourceId: source.id, expectedVersion: value.version, confirmed: true }) }, accessToken);
      if (requestEpoch !== epoch.current) return;
      await reload(); if (requestEpoch !== epoch.current) return; setDraft(initial); setParametersJson("{}");
      setMessage("此來源舊核准已撤銷；請重新選取來源，明確選擇 Query 轉換。轉換後請確認所選 Dataset 的公共顯示政策。撤銷與轉換為獨立交易，不會自動恢復核准。");
      window.dispatchEvent(new CustomEvent("uqp.dashboard.configuration.changed", { detail: { dashboardId, origin: "sources" } }));
    } catch (error) { if (requestEpoch === epoch.current) { setConfiguration(previous => previous ? { ...previous, editable: false } : null); setMessage(managementError(error)); } }
    finally { if (requestEpoch === epoch.current) setBusy(false); }
  }
  return <section className="dashboard-editor-card">
    <h2>Query-only 資料來源</h2>
    <p>含 PRIMARY 最多 8 個來源。僅能選擇已發布且有執行權限的 Query；須先安全停用看板。遮蔽由後端執行。轉換後仍須重新核准敏感欄位；不會自動啟用播放。pending 來源須由管理員明確選擇與歷史 Dataset 相符的 Query。</p>
    <button type="button" disabled={busy} onClick={() => void reload()}>重新載入來源版本</button>
    {configuration && <>
      {configuration.primary.requiresConversion && (
        <p role="status">PRIMARY 尚未完成新版資料來源轉換。請在 Dashboard 停用時，選取 PRIMARY 並確認 Query、參數及資料量上限；首次儲存前會再次要求確認。未完成轉換前，資料揭露更新可能會被安全機制阻擋。</p>
      )}
      {!configuration.editable && <p role="status">目前不可編輯，請透過既有安全流程停用看板。</p>}
      <table className="preview-table"><thead><tr><th>來源</th><th>Query</th><th>更新／換頁秒數</th><th>狀態</th><th>操作</th></tr></thead>
        <tbody>{[configuration.primary, ...configuration.sources].map(source => <tr key={source.sourceKey}>
          <td>{source.sourceKey}</td><td>{queries.find(query => query.id === source.queryDefinitionId)?.name ?? source.queryDefinitionId ?? "待明確選取 Query"}</td>
          <td>{source.refreshSeconds}／{source.pageSeconds}</td><td>{source.errorCode ?? source.bindingState ?? "PRIMARY"}</td>
          <td><button type="button" disabled={busy || !configuration.editable} onClick={() => edit(source)}>編輯 {source.sourceKey}</button>
            {source.id && source.queryDefinitionId === null && <button type="button" disabled={busy || !configuration.editable} onClick={() => void revokePending(source)}>撤銷 {source.sourceKey} 舊核准</button>}
            {source.id && <button type="button" disabled={busy || !configuration.editable} onClick={() => setRemove(source)}>移除 {source.sourceKey}</button>}</td>
        </tr>)}</tbody></table>
      <fieldset disabled={busy || !configuration.editable} className="dashboard-editor-form"><legend>{draft.sourceKey === "PRIMARY" ? "PRIMARY 設定" : "來源設定"}</legend>
        <label>來源代碼<input value={draft.sourceKey} disabled={Boolean(draft.id) || draft.sourceKey === "PRIMARY"} onChange={event => setDraft({ ...draft, sourceKey: event.target.value })}/></label>
        <label>已發布 Query<select aria-label="已發布 Query" value={draft.queryDefinitionId ?? ""} onChange={event => setDraft({ ...draft, queryDefinitionId: Number(event.target.value) || null })}>
          <option value="">請明確選取</option>{queries.map(query => <option key={query.id} value={query.id}>{query.name}（{query.code}）</option>)}
        </select></label>
        {([['refreshSeconds','更新秒數',5,3600],['pageSize','每頁筆數',1,100],['pageSeconds','換頁秒數',5,3600],['maxRows','資料量上限',1,10000]] as const).map(([key,label,min,max]) =>
          <label key={key}>{label}<input type="number" min={min} max={max} value={draft[key] ?? ""} onChange={event => setDraft({ ...draft, [key]: Number(event.target.value) })}/></label>)}
        <label>查詢參數 JSON<textarea rows={4} value={parametersJson} onChange={event => setParametersJson(event.target.value)}/></label>
        {draft.sourceKey !== "PRIMARY" && <label><input type="checkbox" checked={draft.isEnabled ?? true} onChange={event => setDraft({ ...draft, isEnabled: event.target.checked })}/>啟用來源</label>}
        <button type="button" disabled={draftVersion !== configuration.version} onClick={() => void save()}>儲存目前來源</button>
        <button type="button" onClick={() => { setDraft(initial); setDraftVersion(configuration.version); setParametersJson("{}"); }}>新增來源／取消編輯</button>
      </fieldset>
      {draftVersion !== configuration.version && <p role="status">來源版本已重新載入；原草稿保留，請重新選取來源或新增來源並確認後再儲存。</p>}
      {remove && <div role="alert">確認移除 {remove.sourceKey}？已引用來源會由後端拒絕。
        <button type="button" disabled={busy} onClick={() => void save(remove)}>確認移除來源</button>
        <button type="button" onClick={() => setRemove(null)}>取消移除</button></div>}
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
