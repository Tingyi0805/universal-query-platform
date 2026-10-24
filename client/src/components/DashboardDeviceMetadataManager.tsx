import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api/client";
import { dashboardOperationError, deviceMayIssue, playbackPlacement, type ManagedDevice, type PlaybackPlacement } from "../dashboard/managementStatus";

type Metadata = { deviceName: string; enforceIpRestriction: boolean; allowedIp: string | null; allowedCidr: string | null; expiresAtUtc: string | null };
type Device = ManagedDevice & Metadata & { dashboardId: number; createdByUserId: number; sharedWorkstationId: number | null; placement: PlaybackPlacement | null };
type Snapshot = { dashboardId: number; version: string; canCreate: boolean; devices: Device[] };
const empty: Metadata = { deviceName: "", enforceIpRestriction: false, allowedIp: null, allowedCidr: null, expiresAtUtc: null };
const defaultPlacement: PlaybackPlacement = { browser: "edge", screenNumber: 2, fullscreen: true, windowX: 1920, windowY: 0, windowWidth: 1920, windowHeight: 1080 };
export function DashboardDeviceMetadataManager({ dashboardId, accessToken }: { dashboardId: number; accessToken: string | null }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [version, setVersion] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ deviceId: number | null; operation: "metadata" | "placement" } | null>(null);
  const [metadata, setMetadata] = useState<Metadata>(empty), [placement, setPlacement] = useState(defaultPlacement);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const sequence = useRef(0), base = `/dashboards/${dashboardId}/device-management/v1`;
  function trusted(value: Snapshot) {
    if (!value || value.dashboardId !== dashboardId || typeof value.version !== "string" || !/^[a-f0-9]{64}$/.test(value.version) || typeof value.canCreate !== "boolean" || !Array.isArray(value.devices)) throw new Error("DEVICE_MANAGEMENT_INVALID");
    for (const d of value.devices) {
      if (!Number.isSafeInteger(d.id) || d.id < 1 || d.dashboardId !== dashboardId || typeof d.deviceName !== "string" || typeof d.isActive !== "boolean" ||
        !Number.isSafeInteger(d.createdByUserId) || d.createdByUserId < 1 || typeof d.enforceIpRestriction !== "boolean" ||
        ![d.allowedIp, d.allowedCidr, d.expiresAtUtc, d.archivedAtUtc, d.revokedAtUtc].every(v => v === null || typeof v === "string") ||
        (d.sharedWorkstationId !== null && (!Number.isSafeInteger(d.sharedWorkstationId) || d.sharedWorkstationId < 1))) throw new Error("DEVICE_MANAGEMENT_INVALID");
      if (d.placement !== null) playbackPlacement(d.placement);
    }
    return value;
  }
  async function load(discard = false) {
    if (discard && draft && !window.confirm("重新載入會捨棄本區裝置草稿，確定繼續？")) return;
    const read = ++sequence.current; setBusy(true); setVersion(null); setMessage("");
    try {
      const value = trusted(await apiRequest<Snapshot>(base, {}, accessToken));
      if (read !== sequence.current) return;
      setSnapshot(value); setVersion(value.version); setDraft(null);
    } catch (error) { if (read === sequence.current) setMessage(dashboardOperationError(error)); }
    finally { if (read === sequence.current) setBusy(false); }
  }
  useEffect(() => { setSnapshot(null); setDraft(null); void load(); return () => { ++sequence.current; }; }, [dashboardId, accessToken]);
  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail?.dashboardId !== dashboardId) return;
      ++sequence.current; setBusy(false); setVersion(null); setMessage("Dashboard 或裝置授權狀態已變更；草稿已保留，請明確重新載入。");
    };
    window.addEventListener("uqp.dashboard.configuration.changed", changed);
    return () => window.removeEventListener("uqp.dashboard.configuration.changed", changed);
  }, [dashboardId]);
  function edit(device: Device | null, operation: "metadata" | "placement") {
    if (draft && !window.confirm("捨棄目前裝置草稿並編輯另一項設定？")) return;
    setDraft({ deviceId: device?.id ?? null, operation });
    setMetadata(device ? { deviceName: device.deviceName, enforceIpRestriction: device.enforceIpRestriction, allowedIp: device.allowedIp, allowedCidr: device.allowedCidr, expiresAtUtc: device.expiresAtUtc } : empty);
    setPlacement(device?.placement ?? defaultPlacement); setMessage("");
  }
  async function save() {
    if (busy || !draft || !version || !window.confirm(draft.operation === "placement" ? "保存播放位置？此操作不改動患者資料權限。" : "保存裝置設定？不核發憑證；既有裝置的舊憑證將失效，須明確重新授權。")) return;
    const read = ++sequence.current; setBusy(true); setMessage("");
    try {
      const path = draft.deviceId === null ? base : `${base}/${draft.deviceId}/${draft.operation}`;
      const result = await apiRequest<Snapshot & { deviceId: number; credentialIssued?: boolean; deviceCredentialsInvalidated?: boolean }>(path, { method: draft.deviceId === null ? "POST" : "PUT", body: JSON.stringify({ expectedVersion: version, confirmed: true, ...(draft.operation === "metadata" ? { metadata } : { placement }) }) }, accessToken);
      if (read !== sequence.current) return;
      const value = trusted(result);
      if (!Number.isSafeInteger(result.deviceId) || (draft.deviceId !== null && result.deviceId !== draft.deviceId) ||
        (draft.deviceId === null ? result.credentialIssued !== false : result.deviceCredentialsInvalidated !== (draft.operation === "metadata"))) throw new Error("DEVICE_RESULT_INVALID");
      setSnapshot(value); setDraft(null); setVersion(null);
      window.dispatchEvent(new CustomEvent("uqp.dashboard.configuration.changed", { detail: { dashboardId, origin: "device-management" } }));
      setMessage(draft.operation === "placement" ? "播放位置已保存；資料授權與遮蔽政策未變更。請重新載入後再編輯。" : "裝置設定已保存；未核發憑證，既有裝置須明確重新授權。請重新載入後再編輯。");
    } catch (error) { if (read === sequence.current) { setVersion(null); setMessage(`${dashboardOperationError(error)} 草稿已保留；請明確重新載入，不會自動覆寫。`); } }
    finally { if (read === sequence.current) setBusy(false); }
  }
  return <section aria-label="版本化裝置基本管理">
    <h3>裝置建立與基本設定</h3>
    <p>新建僅保存 metadata，委派者固定為目前操作人員，不會取得播放權限。名稱／IP／到期修改會使舊憑證失效；已失效裝置不可在此恢復。工作站換綁與封存仍為唯讀。</p>
    <button type="button" disabled={busy} onClick={() => void load(true)}>重新載入裝置設定</button>
    <button type="button" disabled={busy || !version || !snapshot?.canCreate} onClick={() => edit(null, "metadata")}>建立未授權裝置</button>
    <ul>{snapshot?.devices.map(device => <li key={device.id}>{device.deviceName}；委派者 {device.createdByUserId}；工作站 {device.sharedWorkstationId ?? "未綁定（新建不自動綁定）"}
      <button type="button" disabled={busy || !version || !deviceMayIssue(device)} onClick={() => edit(device, "metadata")}>編輯 {device.deviceName} 基本設定</button>
      <button type="button" disabled={busy || !version || !deviceMayIssue(device)} onClick={() => edit(device, "placement")}>編輯 {device.deviceName} 播放位置</button>
    </li>)}</ul>
    {draft && <fieldset disabled={busy} aria-label="裝置設定草稿"><legend>{draft.deviceId === null ? "建立未授權裝置" : `裝置 ${draft.deviceId} 設定草稿`}</legend>
      {draft.operation === "metadata" ? <>
        <label>裝置名稱<input aria-label="裝置名稱" maxLength={200} value={metadata.deviceName} onChange={e => setMetadata({ ...metadata, deviceName: e.target.value })}/></label>
        <label><input type="checkbox" checked={metadata.enforceIpRestriction} onChange={e => setMetadata({ ...metadata, enforceIpRestriction: e.target.checked, allowedIp: null, allowedCidr: null })}/>限制來源 IP</label>
        <label>允許 IP<input aria-label="允許 IP" disabled={!metadata.enforceIpRestriction} value={metadata.allowedIp ?? ""} onChange={e => setMetadata({ ...metadata, allowedIp: e.target.value || null })}/></label>
        <label>允許 IPv4 CIDR<input aria-label="允許 IPv4 CIDR" disabled={!metadata.enforceIpRestriction} value={metadata.allowedCidr ?? ""} onChange={e => setMetadata({ ...metadata, allowedCidr: e.target.value || null })}/></label>
        <label>到期時間（UTC ISO，留空為無到期日）<input aria-label="裝置到期時間 UTC" placeholder="2030-01-01T00:00:00Z" value={metadata.expiresAtUtc ?? ""} onChange={e => setMetadata({ ...metadata, expiresAtUtc: e.target.value || null })}/></label>
      </> : <>
        <label>瀏覽器<select aria-label="播放瀏覽器" value={placement.browser} onChange={e => setPlacement({ ...placement, browser: e.target.value as "edge" | "chrome" })}><option value="edge">Edge</option><option value="chrome">Chrome</option></select></label>
        <label><input type="checkbox" checked={placement.fullscreen} onChange={e => setPlacement({ ...placement, fullscreen: e.target.checked })}/>全螢幕</label>
        {([['screenNumber', '指定螢幕'], ['windowX', '視窗 X'], ['windowY', '視窗 Y'], ['windowWidth', '視窗寬度'], ['windowHeight', '視窗高度']] as const).map(([key, label]) => <label key={key}>{label}<input type="number" aria-label={label} value={placement[key]} onChange={e => setPlacement({ ...placement, [key]: Number(e.target.value) })}/></label>)}
      </>}
      <button type="button" disabled={!version || (draft.operation === "metadata" && !metadata.deviceName.trim())} onClick={() => void save()}>確認保存裝置設定</button>
    </fieldset>}
    {message && <p role="status">{message}</p>}
  </section>;
}
