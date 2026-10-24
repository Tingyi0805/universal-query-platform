import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiRequest } from "../api/client";
import { managementError, trustedConfiguration, type DashboardPresentation, type QuerySourceConfiguration } from "../dashboard/querySourceManagement";

const defaults: DashboardPresentation = { name: "", description: null, displayMode: "BIG_SCREEN", displayTitle: null, showClock: true, showPageNumber: true, showCountdown: true };
export function DashboardBasicSettingsEditor({ dashboardId, code, accessToken, onCreated }: {
  dashboardId: number | null; code: string; accessToken: string | null; onCreated: (id: number, code: string) => void;
}) {
  const [draft, setDraft] = useState(defaults);
  const [draftCode, setDraftCode] = useState("");
  const [queryId, setQueryId] = useState("");
  const [queries, setQueries] = useState<Array<{ id: number; name: string; code: string; canExecute: boolean }>>([]);
  const [configuration, setConfiguration] = useState<QuerySourceConfiguration | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const epoch = useRef(0), read = useRef(0);
  const base = `/dashboards/${dashboardId}/query-sources/v1`;
  async function reload() {
    const current = epoch.current, request = ++read.current;
    setConfiguration(null); setBusy(true);
    try {
      const value = trustedConfiguration(await apiRequest<QuerySourceConfiguration>(`${base}/configuration`, {}, accessToken));
      const p = value.presentation;
      if (!/^[a-f0-9]{64}$/.test(value.version) || !p || typeof p.name !== "string"
        || !(p.description === null || typeof p.description === "string")
        || !(p.displayTitle === null || typeof p.displayTitle === "string")
        || !["TABLE", "BIG_SCREEN"].includes(p.displayMode)
        || [p.showClock, p.showPageNumber, p.showCountdown, value.editable, value.isActive].some(v => typeof v !== "boolean")) throw new Error("CONFIGURATION_INVALID");
      if (current !== epoch.current || request !== read.current) return;
      setConfiguration(value); setDraft(p); setMessage(""); return true;
    } catch (error) { if (current === epoch.current && request === read.current) setMessage(managementError(error)); }
    finally { if (current === epoch.current && request === read.current) setBusy(false); }
  }
  useEffect(() => {
    ++epoch.current; setDraft(defaults); setConfiguration(null); setMessage(""); setDraftCode(""); setQueryId(""); setQueries([]);
    if (dashboardId) void reload();
    else {
      const current = epoch.current;
      setBusy(true);
      void apiRequest<{ queries: typeof queries }>("/queries", {}, accessToken).then(value => {
        if (current === epoch.current) setQueries(value.queries.filter(q => q.canExecute));
      }).catch(error => { if (current === epoch.current) setMessage(managementError(error)); })
        .finally(() => { if (current === epoch.current) setBusy(false); });
    }
    return () => { ++epoch.current; ++read.current; };
  }, [dashboardId, accessToken]);
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.dashboardId === dashboardId && detail.origin !== "basic") {
        ++read.current; setConfiguration(null);
        setMessage("Dashboard 設定已變更；請先保存草稿，再重新載入基本設定並確認。未自動覆寫。");
      }
    };
    window.addEventListener("uqp.dashboard.configuration.changed", changed);
    return () => window.removeEventListener("uqp.dashboard.configuration.changed", changed);
  }, [dashboardId]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || (dashboardId && !configuration?.editable)) return;
    if (!dashboardId && !queries.some(q => q.id === Number(queryId))) return;
    const current = epoch.current;
    setBusy(true); setMessage("");
    const presentation = { ...draft, name: draft.name.trim(), description: draft.description?.trim() || null, displayTitle: draft.displayTitle?.trim() || null };
    try {
      if (dashboardId) {
        await apiRequest(`${base}/presentation`, { method: "PATCH", body: JSON.stringify({ expectedVersion: configuration!.version, ...presentation }) }, accessToken);
        if (current !== epoch.current) return;
        const reloaded = await reload();
        if (current !== epoch.current || !reloaded) return;
        window.dispatchEvent(new CustomEvent("uqp.dashboard.configuration.changed", { detail: { dashboardId, origin: "basic" } }));
        setMessage("一般顯示設定已儲存。Query、參數、版型及核准由各分區管理。");
      } else {
        // Existing creation contract requires an explicit seed Query. All subsequent source edits use v1.
        const result = await apiRequest<{ id: number }>("/dashboards", { method: "POST", body: JSON.stringify({ code: draftCode.trim().toUpperCase(), ...presentation, queryDefinitionId: Number(queryId), isActive: false }) }, accessToken);
        if (current !== epoch.current) return;
        if (!Number.isSafeInteger(result.id) || result.id < 1) throw new Error("RESPONSE_INVALID");
        onCreated(result.id, draftCode.trim().toUpperCase());
      }
    } catch (error) { if (current === epoch.current) { setConfiguration(null); setMessage(managementError(error)); } }
    finally { if (current === epoch.current) setBusy(false); }
  }
  return <section className="dashboard-editor-card">
    <h2>{dashboardId ? "Dashboard 基本與顯示設定" : "新增停用草稿"}</h2>
    {dashboardId && <button type="button" disabled={busy} onClick={() => {
      if (window.confirm("重新載入會取代本區未儲存內容，是否繼續？")) void reload();
    }}>重新載入基本設定</button>}
    <form onSubmit={save} className="dashboard-editor-form">
      <label className="dashboard-draft-code">代碼<input value={dashboardId ? code : draftCode} disabled={!!dashboardId || busy} required onChange={e => setDraftCode(e.target.value.toUpperCase())}/></label>
      <fieldset className="dashboard-draft-fields" disabled={busy || (!!dashboardId && !configuration?.editable)}>
        <label>名稱<input required value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label>
        <label>說明<input value={draft.description ?? ""} onChange={e => setDraft({ ...draft, description: e.target.value })}/></label>
        {!dashboardId && <label>草稿初始 Query<select aria-label="草稿初始 Query" required value={queryId} onChange={e => setQueryId(e.target.value)}><option value="">請明確選取已發布且有權限的 Query</option>{queries.map(q => <option key={q.id} value={q.id}>{q.name}（{q.code}）</option>)}</select></label>}
        <label>顯示模式<select aria-label="顯示模式" value={draft.displayMode} onChange={e => setDraft({ ...draft, displayMode: e.target.value as DashboardPresentation["displayMode"] })}><option value="BIG_SCREEN">大螢幕看板</option><option value="TABLE">一般表格</option></select></label>
        <label>播放標題<input value={draft.displayTitle ?? ""} onChange={e => setDraft({ ...draft, displayTitle: e.target.value })}/></label>
        {([["showClock", "顯示系統時間"], ["showPageNumber", "顯示頁碼"], ["showCountdown", "顯示換頁倒數"]] as const).map(([key, label]) => <label className="dashboard-draft-check" key={key}><input type="checkbox" checked={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.checked })}/><span>{label}</span></label>)}
        <button className="dashboard-draft-submit" type="submit" disabled={busy || (!dashboardId && !queryId)}>{dashboardId ? "儲存一般顯示設定（新版）" : "建立 Dashboard"}</button>
      </fieldset>
    </form>
    {!dashboardId && <p>新建一律停用、沒有敏感欄位核准。建立後須在 PRIMARY 明確設定參數、更新／換頁秒數、每頁筆數及 maxRows，再重新核准。此處不啟用播放。</p>}
    {dashboardId && <p>目前狀態：{configuration ? configuration.isActive ? "啟用" : "停用" : "尚未確認，禁止寫入"}。PRIMARY 與額外來源的參數、更新／換頁秒數、每頁筆數及 maxRows 統一在資料來源區儲存。既有版型保留；舊 snapshotKind／snapshotSeconds 不在新版編輯契約內，保留原值，不提供假儲存。</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
