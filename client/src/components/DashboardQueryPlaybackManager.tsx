import { DashboardDeviceMetadataManager } from "./DashboardDeviceMetadataManager";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { trustedConfiguration, type QuerySourceConfiguration } from "../dashboard/querySourceManagement";
import { columnApprovals, type ColumnApprovals } from "../security/securityContracts";
import { playbackPlacement, type PlaybackPlacement, dashboardMode, dashboardPreflight, dashboardOperationError, deviceArchived, deviceMayIssue, deviceStatus, type DashboardMode, type Preflight, type Check, type ManagedDevice } from "../dashboard/managementStatus";
import { forgetDashboardToken, prepareDashboardTokenHandoff } from "../security/dashboardToken";
import { DashboardLegacyDisable } from "./DashboardLegacyDisable";
const labels: Record<string, string> = { inactive: "停用狀態", capacity: "含 PRIMARY 最多 8 個來源", primaryConversion: "PRIMARY 資料來源已完成轉換", bindings: "來源已轉換與識別有效", references: "元件來源引用", devices: "有效裝置綁定" };
export function DashboardQueryPlaybackManager({ dashboardId, accessToken }: { dashboardId: number; accessToken: string | null }) {
  const [mode, setMode] = useState<DashboardMode | null>(null), [configuration, setConfiguration] = useState<QuerySourceConfiguration | null>(null);
  const [preflight, setPreflight] = useState<Preflight | null>(null), [approvals, setApprovals] = useState<ColumnApprovals | null>(null);
  const [devices, setDevices] = useState<ManagedDevice[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [readMessages, setReadMessages] = useState<string[]>([]), [issuedDeviceId, setIssuedDeviceId] = useState<number | null>(null);
  const [placement, setPlacement] = useState<{ deviceId: number; settings: PlaybackPlacement } | null>(null);
  const [now, setNow] = useState(Date.now());
  const issued = useRef<{ deviceId: number; token: string } | null>(null), cleanup = useRef<(() => void) | null>(null);
  const epoch = useRef(0), readSequence = useRef(0);
  const base = `/dashboards/${dashboardId}/query-mode/v1`;
  function clearCredential() { cleanup.current?.(); cleanup.current = null; issued.current = null; setIssuedDeviceId(null); forgetDashboardToken(dashboardId); }
  async function refresh() {
    const current = epoch.current, read = ++readSequence.current;
    clearCredential(); setPlacement(null); setBusy(true); setMode(null); setPreflight(null); setConfiguration(null); setApprovals(null); setDevices([]); setReadMessages([]);
    const configRead = apiRequest<QuerySourceConfiguration>(`/dashboards/${dashboardId}/query-sources/v1/configuration`, {}, accessToken).then(trustedConfiguration);
    const results = await Promise.allSettled([
      apiRequest<DashboardMode>(base, {}, accessToken).then(dashboardMode),
      configRead,
      apiRequest<{ devices: ManagedDevice[] }>(`/dashboards/${dashboardId}/devices`, {}, accessToken).then(value => {
        if (!Array.isArray(value.devices) || value.devices.some(d => !Number.isSafeInteger(d.id) || d.id < 1 || typeof d.deviceName !== "string" || typeof d.isActive !== "boolean")) throw new Error("DEVICES_INVALID");
        return value.devices;
      }),
      configRead.then(() => apiRequest(`/dashboards/${dashboardId}/column-approvals`, {}, accessToken)).then(columnApprovals).then(value => { if (value.dashboardId !== dashboardId) throw new Error("APPROVAL_INVALID"); return value; }),
    ]);
    if (current !== epoch.current || read !== readSequence.current) return;
    const [m, c, d, a] = results;
    if (c.status === "fulfilled" && a.status === "fulfilled") {
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
    if (a.status === "fulfilled") setApprovals(a.value);
    setReadMessages([...new Set(results.flatMap(r => r.status === "rejected" ? [dashboardOperationError(r.reason)] : []))]); setBusy(false);
  }
  useEffect(() => {
    ++epoch.current; setMessage(""); void refresh();
    return () => { ++epoch.current; ++readSequence.current; cleanup.current?.(); issued.current = null; forgetDashboardToken(dashboardId); };
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
  const approvalSources = configuration ? [configuration.primary, ...configuration.sources.filter(s => s.isEnabled)] : [];
  const missingApprovals = approvalSources.filter(source => !Object.keys(source.sourceKey === "PRIMARY" ? approvals?.deviceColumnMasks ?? {} : approvals?.deviceSourceColumnMasks[source.sourceKey] ?? {}).length).map(s => s.sourceKey);
  const approvalRecorded = !!approvals && approvalSources.length > 0 && missingApprovals.length === 0;
  const canActivate = readMessages.length === 0 && !!mode && !!configuration?.editable && approvalRecorded && !!preflight?.ready && preflight.version === mode.version && preflight.version === configuration.version;
  const canIssue = (device: ManagedDevice, time = Date.now()) => readMessages.length === 0 && mode?.mode === "QUERY_ONLY" && configuration?.dashboardMode === "QUERY_ONLY" && configuration.isActive === true && configuration.version === mode.version && approvalRecorded && deviceMayIssue(device, time);
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
  async function credential(device: ManagedDevice, revoke = false) {
    if (busy || !mode || (!revoke && !canIssue(device)) || !window.confirm(revoke ? `撤銷裝置「${device.deviceName}」？不能透過重新整理恢復原憑證。` : `明確重新授權「${device.deviceName}」？舊憑證立即失效；不顯示原始 Token。`)) return;
    const current = epoch.current; clearCredential(); setBusy(true); setMessage("");
    try {
      const result = await apiRequest<{ token?: string; device?: { id: number; dashboardId: number }; deviceId?: number; revoked?: boolean }>(`${base}/devices/${device.id}/credential`, { method: revoke ? "DELETE" : "POST", body: JSON.stringify({ expectedVersion: mode.version }) }, accessToken);
      if (current !== epoch.current) return;
      if (revoke) {
        if (result.deviceId !== device.id || result.revoked !== true) throw new Error("REVOKE_INVALID");
        setDevices(previous => previous.map(d => d.id === device.id ? { ...d, isActive: false } : d)); setMessage("裝置已撤銷，請勿重用原憑證。");
      } else {
        if (result.device?.id !== device.id || result.device.dashboardId !== dashboardId || typeof result.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(result.token)) throw new Error("CREDENTIAL_INVALID");
        issued.current = { deviceId: device.id, token: result.token }; setIssuedDeviceId(device.id);
        setMessage("核發成功；憑證僅在本頁記憶體，不顯示、複製或寫入 URL／儲存區。重新載入即清除。");
      }
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
    const credential = issued.current;
    if (!credential || !devices.some(d => d.id === credential.deviceId && deviceMayIssue(d))) { clearCredential(); return; }
    const popup = window.open("about:blank", "_blank");
    if (!popup) { setMessage("瀏覽器封鎖授權交付視窗；請允許後重新操作。"); return; }
    cleanup.current?.(); cleanup.current = prepareDashboardTokenHandoff(popup, dashboardId, credential.token);
    popup.location.replace(`/display/dashboards/${dashboardId}`);
  }
  const result = (value: Check) => value.ok ? "通過" : `未通過：${value.code ?? "REQUEST_FAILED"}`;
  return <section className="dashboard-editor-card" id="dashboard-device-management">
    <h2>Dashboard 狀態、裝置與播放授權</h2>
    <DashboardLegacyDisable dashboardId={dashboardId} accessToken={accessToken}/>
    <p>目前模式：{mode?.mode ?? configuration?.dashboardMode ?? "尚未取得可信狀態"}{mode ? `（版本 ${mode.modeVersion}）` : ""}</p>
    {configuration && <p role="status">{configuration.primary.requiresConversion || configuration.sources.some(s => s.queryDefinitionId === null) ? "尚有 Legacy／pending 來源，須先明確轉換。" : "來源已完成 Query 綁定。"} {configuration.editable ? "停用草稿可進行版型設計；設計預覽仍須通過執行安全驗證。" : "目前僅供查看；修改前須安全停用。"}</p>}
    {approvals && <p role="status">{approvalRecorded ? "已讀取各啟用來源的明確核准紀錄；完整政策仍由預檢與逐頁執行重驗。" : `尚未確認敏感核准：${missingApprovals.join("、") || "來源版本未知"}。請至敏感核准區明確處理，不會自動批准。`}</p>}
    <p>建立停用草稿 → 來源 → 核准 → <Link to={`/designer/dashboards/${dashboardId}/layout`}>版型設計／預覽</Link> → 預檢 → 啟用 → 裝置授權。順序不代表授權證據，預檢只代表檢查當下。</p>
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
      <td>{device.deviceName}（ID {device.id}）</td><td>{deviceStatus(device, now)}</td><td>委派者 {device.createdByUserId ?? "尚未提供"}；IP：{device.enforceIpRestriction === true ? device.allowedIp ?? device.allowedCidr ?? "限制證據不完整，核發由後端拒絕" : device.enforceIpRestriction === false ? "未設定 IP 限制" : "尚未提供"}</td><td>{device.expiresAtUtc === null ? "無到期日設定" : device.expiresAtUtc ?? "尚未提供"}</td>
      <td><button type="button" disabled={busy} onClick={() => void readPlacement(device.id)}>檢視 {device.deviceName} 播放位置（唯讀）</button><button type="button" disabled={busy || !canIssue(device, now)} onClick={() => void credential(device)}>核發／重新核發 {device.deviceName}</button>
      <button type="button" disabled={busy || !mode || mode.mode === "LEGACY" || !device.isActive || deviceArchived(device)} onClick={() => void credential(device, true)}>撤銷 {device.deviceName}</button></td>
    </tr>)}</tbody></table>
    {placement && <p role="status">裝置 {placement.deviceId} 已保存播放位置（唯讀）：{placement.settings.browser}，螢幕 {placement.settings.screenNumber}，{placement.settings.fullscreen ? "全螢幕" : "視窗"}，位置 {placement.settings.windowX}／{placement.settings.windowY}，尺寸 {placement.settings.windowWidth}×{placement.settings.windowHeight}。修改須先補齊版本化安全 API。</p>}
    {issuedDeviceId !== null && <div role="status">已取得裝置 {issuedDeviceId} 的本次憑證，原始值不放入 DOM。<button type="button" onClick={handoff}>在此裝置開啟安全播放</button><button type="button" onClick={clearCredential}>清除本頁憑證</button></div>}
    {readMessages.map(text => <p role="status" key={text}>{text}</p>)}{message && <p role="status">{message}</p>}
  </section>;
}
