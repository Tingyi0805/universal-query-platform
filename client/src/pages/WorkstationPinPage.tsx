import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiRequest } from "../api/client";
import { WorkstationIdentity } from "../security/workstationIdentity";
import "./WorkstationPinPage.css";
import { useAuth } from "../auth/AuthContext";

type Session = { user: { id: number; username: string; displayName: string } | null; sessionId: string | null; csrfToken: string; idleSeconds: number };
type Query = { id: number; code: string; name: string };
type Parameter = { name: string; label: string; dataType: string; isRequired: boolean; runtimeDefaultValue?: unknown; optionMode: string };
type Result = { columns: { name: string }[]; rows: Record<string, unknown>[]; truncated: boolean };
const base = "/workstations/current";

export function WorkstationPinPage() {
  const logout = useRef(useAuth().logout);
  const [session, setSession] = useState<Session | null>(null);
  const [username, setUsername] = useState(""), [pin, setPin] = useState(""), [credential, setCredential] = useState("");
  const [queries, setQueries] = useState<Query[]>([]), [queryId, setQueryId] = useState("");
  const [parameters, setParameters] = useState<Parameter[]>([]), [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null), [message, setMessage] = useState("正在確認工作站…"), [busy, setBusy] = useState(false);
  const current = useRef<Session | null>(null), fence = useRef(new WorkstationIdentity()), alive = useRef(true), operation = useRef(false);
  const queryFence = useRef(new WorkstationIdentity()), selection = useRef(0);
  const lastActivity = useRef(Date.now()), lastTouch = useRef(0), channel = useRef<BroadcastChannel | null>(null);
  const updateSession = (value: Session | null) => { current.current = value; setSession(value); };
  function clear() {
    fence.current.clear(); queryFence.current.clear(); selection.current++; updateSession(null); setUsername(""); setPin(""); setCredential("");
    setQueries([]); setQueryId(""); setParameters([]); setValues({}); setResult(null); setMessage("");
  }
  const call = <T,>(path: string, method = "GET", body?: unknown, csrf = current.current?.csrfToken, keepalive = false) =>
    apiRequest<T>(base + path, { method, credentials: "same-origin", cache: "no-store", keepalive,
      headers: { ...(csrf ? { "x-workstation-csrf": csrf } : {}), ...(path === "/pair" ? { "x-workstation-pair": "1" } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, null, () => false);
  async function bootstrap() {
    const state = await fence.current.run(signal => apiRequest<Session>(base + "/session", { signal, credentials: "same-origin" }, null, () => false));
    updateSession(state); lastActivity.current = Date.now();
    setMessage(state.user ? "" : "工作站已鎖定，請輸入帳號及 PIN。");
    if (state.user) await loadQueries();
  }
  async function loadQueries() {
    const data = await fence.current.run(signal => apiRequest<{ queries: Query[] }>(base + "/queries", { signal, credentials: "same-origin" }, null, () => false));
    setQueries(data.queries);
  }
  async function lock(silent = false) {
    const previous = current.current;
    clear(); channel.current?.postMessage("clear");
    if (!previous?.csrfToken) return;
    try {
      await call("/lock", "POST", {}, previous.csrfToken, silent);
      if (!silent && alive.current) { await bootstrap(); setMessage("工作站已鎖定。請重新登入或切換帳號。"); }
    } catch { if (!silent && alive.current) setMessage("已清除畫面；伺服器鎖定結果無法確認，請重新確認工作站。"); }
  }
  useEffect(() => {
    alive.current = true;
    // Clear existing JWT views/contexts without ever exchanging PIN for a JWT.
    logout.current();
    void bootstrap().catch(() => { if (alive.current) setMessage("工作站尚未配對、服務未啟用或連線失敗。"); });
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("uqp-workstation-identity");
      channel.current.onmessage = () => { clear(); setMessage("工作站身分已變更，請重新確認。"); };
    }
    const hide = () => { void lock(true); };
    const visibility = () => { if (document.hidden) hide(); };
    window.addEventListener("pagehide", hide); document.addEventListener("visibilitychange", visibility);
    window.addEventListener("uqp-interactive-clear", hide);
    const timer = window.setInterval(() => {
      const state = current.current;
      if (state?.user && Date.now() - lastActivity.current >= state.idleSeconds * 1000) { void lock(); return; }
      // No activity touch: this poll only detects remote revocation/idle expiry.
      if (state?.user) void fence.current.run(signal => apiRequest<Session>(base + "/session", { signal, credentials: "same-origin" }, null, () => false))
        .then(live => { if (live.sessionId !== state.sessionId) { clear(); setMessage("登入已失效，請重新登入。"); } })
        .catch(() => { if (current.current?.sessionId === state.sessionId) { clear(); setMessage("無法確認登入狀態，已清除畫面。"); } });
    }, 5000);
    return () => {
      alive.current = false; window.clearInterval(timer); window.removeEventListener("pagehide", hide); document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("uqp-interactive-clear", hide);
      void lock(true); channel.current?.close(); channel.current = null;
    };
  }, []);
  function activity() {
    const state = current.current;
    if (!state?.user) return;
    lastActivity.current = Date.now();
    if (Date.now() - lastTouch.current < 30000) return;
    lastTouch.current = Date.now();
    void fence.current.run(signal => apiRequest(base + "/activity", { method: "POST", signal, credentials: "same-origin",
      headers: { "x-workstation-csrf": state.csrfToken }, body: "{}" }, null, () => false))
      .catch(() => { if (current.current?.sessionId === state.sessionId) { clear(); setMessage("登入已失效，請重新確認。"); } });
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (operation.current) return;
    operation.current = true; setBusy(true); setMessage("");
    const submittedPin = pin, submittedUser = username, submittedCredential = credential, csrf = current.current?.csrfToken;
    clear(); channel.current?.postMessage("clear");
    try {
      if (submittedCredential) {
        await fence.current.run(() => call("/pair", "POST", { credential: submittedCredential }, undefined));
        await bootstrap();
      } else {
        const state = await fence.current.run(() => call<Session>("/login", "POST", { username: submittedUser, pin: submittedPin }, csrf));
        updateSession(state); lastActivity.current = Date.now(); await loadQueries();
      }
    } catch {
      if (alive.current) { clear(); setMessage("無法登入或配對。請重新確認工作站後再試；不會自動重送。"); }
    } finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  async function selectQuery(id: string) {
    queryFence.current.clear(); const selected = ++selection.current; setQueryId(id); setParameters([]); setValues({}); setResult(null); setMessage("");
    if (!id) return;
    try {
      const data = await fence.current.run(() => queryFence.current.run(signal => apiRequest<{ parameters: Parameter[] }>(`${base}/queries/${id}`, { signal, credentials: "same-origin" }, null, () => false)));
      setParameters(data.parameters); setValues(Object.fromEntries(data.parameters.map(p => [p.name, String(p.runtimeDefaultValue ?? "")])));
    } catch { if (selected === selection.current && current.current?.user) setMessage("無法讀取查詢設定，請重新選取。"); }
  }
  async function execute(event: FormEvent) {
    event.preventDefault(); if (operation.current || !current.current?.user) return;
    operation.current = true; setBusy(true); setResult(null); setMessage("");
    const state = current.current;
    try {
      const data = await fence.current.run(signal => apiRequest<{ result: Result }>(`${base}/queries/${queryId}/execute`, {
        method: "POST", signal, credentials: "same-origin", headers: { "x-workstation-csrf": state.csrfToken }, body: JSON.stringify({ values }),
      }, null, () => false));
      setResult(data.result);
    } catch { if (current.current?.sessionId === state.sessionId) setMessage("查詢未完成或授權已變更，沒有保留舊結果。"); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  return <main className="page-shell workstation-pin" onPointerDown={activity} onKeyDown={activity}>
    <h1>PIN 共用工作站</h1>
    <p role="status">{message}</p>
    {session?.user ? <>
      <header><strong>目前使用者：{session.user.displayName}</strong><button type="button" onClick={() => { void lock(); }}>鎖定／切換使用者</button></header>
      <p>只提供已授權的非敏感唯讀查詢；閒置後自動鎖定。</p>
      <label htmlFor="workstation-query">查詢</label><select id="workstation-query" value={queryId} disabled={busy} onChange={event => { void selectQuery(event.target.value); }}><option value="">請選擇</option>{queries.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}</select>
      {queryId && <form onSubmit={execute}>{parameters.map(p => <label key={p.name}>{p.label || p.name}<input value={values[p.name] ?? ""} required={p.isRequired} type={p.dataType === "DATE" ? "date" : p.dataType === "NUMBER" ? "number" : "text"} onChange={e => setValues(old => ({ ...old, [p.name]: e.target.value }))} /></label>)}<button disabled={busy} type="submit">{busy ? "查詢中…" : "執行查詢"}</button></form>}
      {result && <div className="workstation-results"><table><thead><tr>{result.columns.map(c => <th key={c.name}>{c.name}</th>)}</tr></thead><tbody>{result.rows.map((row, i) => <tr key={i}>{result.columns.map(c => <td key={c.name}>{row[c.name] == null ? "" : String(row[c.name])}</td>)}</tr>)}</tbody></table>{result.truncated && <p>結果已截斷，請縮小查詢範圍。</p>}</div>}
    </> : <>
      <form onSubmit={submit} autoComplete="off"><label>帳號<input autoComplete="off" value={username} maxLength={100} disabled={busy} onChange={e => setUsername(e.target.value)} /></label>
        <label>PIN<input type="password" inputMode="numeric" pattern="[0-9]{4,12}" minLength={4} maxLength={12} autoComplete="off" value={pin} disabled={busy} onChange={e => setPin(e.target.value.replace(/\D/g, ""))} /></label>
        <button disabled={busy || !session?.csrfToken || !username.trim() || !/^\d{4,12}$/.test(pin)} type="submit">{busy ? "處理中…" : "登入"}</button></form>
      <button type="button" disabled={busy} onClick={() => { clear(); void bootstrap().catch(() => setMessage("無法確認工作站，請檢查配對與服務設定。")); }}>重新確認工作站</button>
      <details><summary>配對此瀏覽器</summary><p>使用管理員核發的工作站憑證，僅需配對一次。</p><form onSubmit={submit}><label>工作站憑證<input type="password" autoComplete="off" value={credential} disabled={busy} onChange={e => setCredential(e.target.value)} /></label><button type="submit" disabled={busy || !credential}>配對</button></form></details>
    </>}
  </main>;
}
