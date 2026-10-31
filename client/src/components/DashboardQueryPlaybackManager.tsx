import { useAuth } from "../auth/AuthContext";
import { deviceExpiry } from "../dashboard/deviceExpiry";
import { DashboardDeviceMetadataManager } from "./DashboardDeviceMetadataManager";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { trustedConfiguration, type QuerySourceConfiguration } from "../dashboard/querySourceManagement";
import { playbackPlacement, type PlaybackPlacement, dashboardMode, dashboardPreflight, dashboardOperationError, deviceMayIssue, deviceStatus, type DashboardMode, type Preflight, type Check, type ManagedDevice } from "../dashboard/managementStatus";
import { forgetDashboardToken, prepareDashboardTokenHandoff } from "../security/dashboardToken";
import { DashboardLegacyDisable } from "./DashboardLegacyDisable";
const labels: Record<string, string> = { inactive: "停用狀態", capacity: "含 PRIMARY 最多 8 個來源", primaryConversion: "PRIMARY 資料來源已完成轉換", bindings: "來源已轉換與識別有效", references: "元件來源引用", devices: "有效裝置綁定" };
export function DashboardQueryPlaybackManager({ dashboardId, accessToken }: { dashboardId: number; accessToken: string | null }) {
  const { hasPermission } = useAuth();
  const [mode, setMode] = useState<DashboardMode | null>(null), [configuration, setConfiguration] = useState<QuerySourceConfiguration | null>(null);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [devices, setDevices] = useState<ManagedDevice[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [readMessages, setReadMessages] = useState<string[]>([]), [issuedDeviceId, setIssuedDeviceId] = useState<number | null>(null);
  const [placement, setPlacement] = useState<{ deviceId: number; settings: PlaybackPlacement } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [handoffBusy, setHandoffBusy] = useState(false), [handoffUsed, setHandoffUsed] = useState(false);
  const [copying, setCopying] = useState(false), [copyMessage, setCopyMessage] = useState("");
  const tokenDialog = useRef<HTMLDialogElement>(null), tokenText = useRef<HTMLTextAreaElement>(null);
  const issued = useRef<{ deviceId: number; token: string } | null>(null), cleanup = useRef<(() => void) | null>(null);
  const epoch = useRef(0), readSequence = useRef(0);
  const base = `/dashboards/${dashboardId}/query-mode/v1`;
  function clearCredential() {
    cleanup.current?.(); cleanup.current = null;
    if (issued.current) issued.current.token = "";
    issued.current = null;
    // Clear the live DOM synchronously as pagehide may freeze a page in bfcache
    // before React can commit its state updates.
    if (tokenText.current) { tokenText.current.value = ""; tokenText.current.defaultValue = ""; tokenText.current.textContent = ""; }
    if (tokenDialog.current?.open) tokenDialog.current.close();
    setIssuedDeviceId(null); setHandoffBusy(false); setHandoffUsed(false); setCopying(false); setCopyMessage(""); setMessage("");
    forgetDashboardToken(dashboardId);
  }
  useEffect(() => {
    if (issuedDeviceId !== null && tokenDialog.current && !tokenDialog.current.open) tokenDialog.current.showModal();
  }, [issuedDeviceId]);
  async function copyToken() {
    const credential = issued.current;
    if (!credential || copying || !tokenDialog.current?.open) return;
    setCopying(true); setCopyMessage("");
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(credential.token);
      else {
        // HTTP intranets may not expose Clipboard API. Copy only from the
        // already-visible, user-authorized field; never create hidden secrets.
        const field = tokenText.current;
        if (!field) throw new Error("COPY_UNAVAILABLE");
        field.focus(); field.select(); field.setSelectionRange(0, field.value.length);
        if (!document.execCommand("copy")) throw new Error("COPY_UNAVAILABLE");
      }
      if (issued.current === credential) setCopyMessage("已複製 Token，可貼至播放裝置的 Device Token 欄位。");
    } catch {
      if (issued.current === credential) setCopyMessage("無法自動複製，請選取上方 Token 手動複製。");
    } finally { if (issued.current === credential) setCopying(false); }
  }
  async function refresh() {
    const current = epoch.current, read = ++readSequence.current;
    clearCredential(); setPlacement(null); setBusy(true); setMode(null); setPreflight(null); setConfiguration(null); setDevices([]); setReadMessages([]);
    const configRead = apiRequest<QuerySourceConfiguration>(`/dashboards/${dashboardId}/query-sources/v1/configuration`, {}, accessToken).then(trustedConfiguration);
    const results = await Promise.allSettled([
      apiRequest<DashboardMode>(base, {}, accessToken).then(dashboardMode),
      configRead,
      apiRequest<{ devices: ManagedDevice[] }>(`/dashboards/${dashboardId}/devices`, {}, accessToken).then(value => {
        if (!Array.isArray(value.devices) || value.devices.some(d => !Number.isSafeInteger(d.id) || d.id < 1 || typeof d.deviceName !== "string" || typeof d.isActive !== "boolean")) throw new Error("DEVICES_INVALID");
        return value.devices;
      }),
    ]);
    if (current !== epoch.current || read !== readSequence.current) return;
    const [m, c, d] = results;
    if (c.status === "fulfilled") {
      try {
        const after = trustedConfiguration(await apiRequest<QuerySourceConfiguration>(`/dashboards/${dashboardId}/query-sources/v1/configuration`, {}, accessToken));
        if (after.version !== c.value.version) throw Object.assign(new Error(), { code: "QUERY_SOURCE_VERSION_CONFLICT" });
      } catch (error) {
        if (current === epoch.current && read === readSequence.current) { setReadMessages([dashboardOperationError(error)]); setBusy(false); }
        return;
      }
    }
    if (current !== epoch.current || read !== readSequence.current) return;
    if (m.status === "fulfilled") setMode(m.value);
    if (c.status === "fulfilled") setConfiguration(c.value);
    if (d.status === "fulfilled") setDevices(d.value);
    setReadMessages([...new Set(results.flatMap(r => r.status === "rejected" ? [dashboardOperationError(r.reason)] : []))]); setBusy(false);
  }
  useEffect(() => {
    ++epoch.current; setMessage(""); void refresh();
    const leave = () => { ++epoch.current; ++readSequence.current; clearCredential(); setBusy(false); };
    window.addEventListener("pagehide", leave); window.addEventListener("beforeunload", leave);
    return () => { window.removeEventListener("pagehide", leave); window.removeEventListener("beforeunload", leave); leave(); };
  }, [dashboardId, accessToken]);
  useEffect(() => {
    const changed = (event: Event) => { const detail = (event as CustomEvent).detail;
      if (detail?.dashboardId === dashboardId && detail.origin !== "playback") { ++epoch.current; void refresh(); }
    };
    window.addEventListener("uqp.dashboard.configuration.changed", changed);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.removeEventListener("uqp.dashboard.configuration.changed", changed); window.clearInterval(timer); };
  }, [dashboardId, accessToken]);
  useEffect(() => {
    if (issued.current && !devices.some(device => device.id === issued.current!.deviceId && deviceMayIssue(device, now))) clearCredential();
  }, [devices, now]);
  const canActivate = readMessages.length === 0 && !!mode && !!configuration?.editable && !!preflight?.ready && preflight.version === mode.version && preflight.version === configuration.version;
  const canIssue = (device: ManagedDevice, time = Date.now()) => hasPermission("DESIGN_QUERY") && hasPermission("EXECUTE_QUERY") && readMessages.length === 0 && mode?.mode === "QUERY_ONLY" && configuration?.dashboardMode === "QUERY_ONLY" && configuration.isActive === true && configuration.version === mode.version && device.suspendedAtUtc == null && device.reenrollmentRequired == null && deviceMayIssue(device, time);
  function failed(error: unknown) { clearCredential(); setPreflight(null); setMode(null); setMessage(dashboardOperationError(error)); }
  async function check() {
    if (busy || !mode) return;
    const current = epoch.current; clearCredential(); setBusy(true); setMessage(""); setPreflight(null);
    try { const value = dashboardPreflight(await apiRequest<Preflight>(`${base}/preflight`, {}, accessToken));
      if (current !== epoch.current) return;
      setPreflight(value); setMode(value);
    } catch (error) { if (current === epoch.current) failed(error); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  async function change(activate: boolean) {
    if (busy || !mode || (activate && !canActivate) || !window.confirm(activate ? "啟用 Query-only？後端會重新驗證，所有原裝置憑證失效，須重新授權。" : "停用 Query-only 並撤銷相關裝置憑證？")) return;
    const current = epoch.current; clearCredential(); setBusy(true); setMessage("");
    try {
      dashboardMode(await apiRequest<DashboardMode>(base, { method: "POST", body: JSON.stringify({ expectedVersion: mode.version, activate }) }, accessToken));
      if (current !== epoch.current) return;
      await refresh(); if (current !== epoch.current) return;
      window.dispatchEvent(new CustomEvent("uqp.dashboard.configuration.changed", { detail: { dashboardId, origin: "playback" } }));
      setMessage(activate ? "模式已啟用；裝置仍須明確重新授權，不能視為已可播放。" : "已安全停用；原裝置憑證失效。");
    } catch (error) { if (current === epoch.current) failed(error); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  async function credential(device: ManagedDevice) {
    if (busy || !mode || !canIssue(device) || !window.confirm(`明確重新授權「${device.deviceName}」？舊憑證立即失效；新 Token 僅顯示一次，請於關閉前複製。`)) return;
    const current = epoch.current; clearCredential(); setBusy(true); setMessage("");
    try {
      const result = await apiRequest<{ token?: string; device?: { id: number; dashboardId: number }; deviceId?: number; revoked?: boolean }>(`${base}/devices/${device.id}/credential`, { method: "POST", body: JSON.stringify({ expectedVersion: mode.version }) }, accessToken);
      if (current !== epoch.current) return;
      if (result.device?.id !== device.id || result.device.dashboardId !== dashboardId || typeof result.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(result.token)) throw new Error("CREDENTIAL_INVALID");
      issued.current = { deviceId: device.id, token: result.token }; setIssuedDeviceId(device.id);
      setMessage("核發成功；請在此一次性視窗複製 Token，於播放裝置手動輸入。");
      setPreflight(null);
    } catch (error) { if (current === epoch.current) failed(error); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  async function readPlacement(deviceId: number) {
    if (busy) return;
    const current = epoch.current; setBusy(true); setPlacement(null);
    try {
      const settings = playbackPlacement(await apiRequest<PlaybackPlacement>(`/dashboards/${dashboardId}/devices/${deviceId}/playback-settings`, {}, accessToken));
      if (current === epoch.current) setPlacement({ deviceId, settings });
    } catch (error) { if (current === epoch.current) failed(error); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  function handoff() {
    if (cleanup.current || handoffUsed) return;
    const credential = issued.current;
    if (!credential || !devices.some(d => d.id === credential.deviceId && deviceMayIssue(d))) { clearCredential(); return; }
    const popup = window.open(`/display/dashboards/${dashboardId}?handoff=1`, "_blank");
    if (!popup) { setMessage("瀏覽器封鎖授權交付視窗；請允許後重新操作。"); return; }
    setHandoffBusy(true); setMessage("正在向指定播放視窗交付授權，請保持本頁開啟。");
    cleanup.current = prepareDashboardTokenHandoff(popup, dashboardId, credential.token, result => {
      cleanup.current = null; setHandoffBusy(false); setHandoffUsed(true);
      setMessage(result === "delivered" ? "裝置憑證已單次交付至指定播放視窗。" : result === "expired"
        ? "裝置交接逾時，未完成授權交付；可複製此 Token 到播放裝置手動啟用。" : "播放視窗已關閉或交接中斷；可複製此 Token 到播放裝置手動啟用。");
    });
  }
  const result = (value: Check) => value.ok ? "通過" : `未通過：${value.code ?? "REQUEST_FAILED"}`;
  return <section className="dashboard-editor-card" id="dashboard-device-management">
    <h2>Dashboard 狀態、裝置與播放授權</h2>
    <DashboardLegacyDisable dashboardId={dashboardId} accessToken={accessToken}/>
    <p>目前模式：{mode?.mode ?? configuration?.dashboardMode ?? "尚未取得可信狀態"}{mode ? `（版本 ${mode.modeVersion}）` : ""}</p>
    {configuration && <p role="status">{configuration.primary.requiresConversion || configuration.sources.some(s => s.queryDefinitionId === null) ? "尚有 Legacy／pending 來源，須先明確轉換。" : "來源已完成 Query 綁定。"} {configuration.editable ? "停用草稿可進行版型設計；設計預覽仍須通過執行安全驗證。" : "目前僅供查看；修改前須安全停用。"}</p>}
    <p role="status">公共顯示政策統一於 Dataset 確認；後端預檢、啟用、裝置核發與逐頁交付都會驗證目前政策，不讀取 Dashboard 的第二套欄位核准。</p>
    <p>建立停用草稿 → 來源 → Dataset 公共政策 → <Link to={`/designer/dashboards/${dashboardId}/layout`}>版型設計／預覽</Link> → 預檢 → 啟用 → 裝置授權。順序不代表授權證據，預檢只代表檢查當下。</p>
    <button type="button" disabled={busy} onClick={() => { setMessage(""); void refresh(); }}>重新載入播放狀態</button>
    <button type="button" disabled={busy || !mode} onClick={() => void check()}>執行啟用前檢查</button>
    {preflight && <div role="status"><p>來源：{preflight.sourceCount}/8；待轉換：{preflight.pendingCount}。{preflight.ready ? "後端預檢通過，啟用與核發仍會重新驗證。" : "後端預檢未通過，禁止啟用。"}</p>
      <ul>{preflight.checks.map(item => <li key={item.name}>{labels[item.name] ?? "安全檢查"}：{result(item)}</li>)}{preflight.queries.map(item => <li key={item.sourceKey}>{item.sourceKey} Query ACL／必要參數／遮蔽與稽核：{result(item)}</li>)}{preflight.delegators.map(item => <li key={item.deviceId}>裝置 {item.deviceId} 委派者／工作站／Query ACL：{result(item)}</li>)}</ul></div>}
    <button type="button" disabled={busy || !canActivate || mode?.mode === "QUERY_ONLY"} onClick={() => void change(true)}>啟用 Query-only</button>
    <button type="button" disabled={busy || mode?.mode !== "QUERY_ONLY"} onClick={() => void change(false)}>停用 Query-only</button>
    <p>裝置名稱、IP 限制與到期時間為後端已儲存設定。下方版本化管理區顯示已儲存工作站關聯；即時有效性仍以預檢與核發時的後端委派驗證為準。</p>
    <DashboardDeviceMetadataManager dashboardId={dashboardId} accessToken={accessToken}/>
    <p>裝置封存只標記裝置歷史，與 Dashboard 停用／退役不同；不提供實體刪除。</p>
    <table className="preview-table"><thead><tr><th>裝置</th><th>狀態</th><th>委派者／IP</th><th>到期時間</th><th>操作</th></tr></thead><tbody>{devices.map(device => <tr key={device.id}>
      <td>{device.deviceName}（ID {device.id}）</td><td>{deviceStatus(device, now)}</td><td>委派者 {device.createdByUserId ?? "尚未提供"}；IP：{device.enforceIpRestriction === true ? device.allowedIp ?? device.allowedCidr ?? "限制證據不完整，核發由後端拒絕" : device.enforceIpRestriction === false ? "未設定 IP 限制" : "尚未提供"}</td><td>{device.expiresAtUtc===null?"未設定到期日":device.expiresAtUtc??"尚未提供"}{device.expiresAtUtc!==null && `；${deviceExpiry(device.expiresAtUtc,now).text}`}</td>
      <td><button type="button" disabled={busy} onClick={() => void readPlacement(device.id)}>檢視 {device.deviceName} 播放位置（唯讀）</button><button type="button" disabled={busy || !canIssue(device, now)} onClick={() => void credential(device)}>核發／重新核發 {device.deviceName}</button>
      <span>暫停、永久撤銷與封存請使用上方版本化裝置管理區。</span></td>
    </tr>)}</tbody></table>
    {placement && <p role="status">裝置 {placement.deviceId} 已保存播放位置（唯讀）：{placement.settings.browser}，螢幕 {placement.settings.screenNumber}，{placement.settings.fullscreen ? "全螢幕" : "視窗"}，位置 {placement.settings.windowX}／{placement.settings.windowY}，尺寸 {placement.settings.windowWidth}×{placement.settings.windowHeight}。修改須先補齊版本化安全 API。</p>}
    {issuedDeviceId !== null && issued.current && <dialog ref={tokenDialog} aria-labelledby="issued-device-token-title"
      onCancel={event => { event.preventDefault(); clearCredential(); }}
      onClose={event => { if (event.currentTarget === tokenDialog.current) clearCredential(); }}
      style={{ width: "min(560px, calc(100vw - 32px))", maxHeight: "calc(100dvh - 32px)", overflow: "auto", borderRadius: 12, padding: 24 }}>
      <h2 id="issued-device-token-title">一次性 Device Token</h2>
      <p>裝置 {issuedDeviceId} 的 Token 僅在此視窗顯示。關閉、離開頁面或重新整理後無法找回，需要時請重新核發。</p>
      <label htmlFor="issued-device-token">Device Token（僅顯示一次）</label>
      <textarea id="issued-device-token" ref={tokenText} readOnly value={issued.current.token} rows={2}
        autoComplete="off" spellCheck={false} onFocus={event => event.currentTarget.select()}
        style={{ width: "100%", boxSizing: "border-box", fontFamily: "monospace", fontSize: 16 }} />
      <div><button type="button" onClick={() => void copyToken()} disabled={copying}>複製 Token</button>
        <button type="button" onClick={clearCredential}>關閉並清除 Token</button></div>
      {!handoffUsed && <button type="button" onClick={handoff} disabled={handoffBusy}>在此裝置開啟安全播放</button>}
      {copyMessage && <p role="status">{copyMessage}</p>}{message && <p role="status">{message}</p>}
    </dialog>}
    {readMessages.map(text => <p role="status" key={text}>{text}</p>)}{message && issuedDeviceId === null && <p role="status">{message}</p>}

  </section>;
}
