import { useAuth } from "../auth/AuthContext";
import { lifecycleActions, lifecycleConfirmation, lifecycleLabels, lifecycleStatus, type LifecycleAction, type LifecycleDevice } from "../dashboard/deviceLifecycle";
import { deviceExpiry } from "../dashboard/deviceExpiry";
import "./DashboardDeviceMetadataManager.css";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api/client";
import { dashboardOperationError, deviceMayIssue, playbackPlacement, type ManagedDevice, type PlaybackPlacement } from "../dashboard/managementStatus";

type Metadata = { deviceName: string; enforceIpRestriction: boolean; allowedIp: string | null; allowedCidr: string | null; expiresAtUtc: string | null };
type Device = ManagedDevice & Metadata & { dashboardId: number; createdByUserId: number; sharedWorkstationId: number | null; placement: PlaybackPlacement | null };
type Snapshot = { dashboardId: number; version: string; canCreate: boolean; devices: Device[] };
const empty: Metadata = { deviceName: "", enforceIpRestriction: false, allowedIp: null, allowedCidr: null, expiresAtUtc: null };
const defaultPlacement: PlaybackPlacement = { browser: "edge", screenNumber: 2, fullscreen: true, windowX: 1920, windowY: 0, windowWidth: 1920, windowHeight: 1080 };
export function DashboardDeviceMetadataManager({ dashboardId, accessToken }: { dashboardId: number; accessToken: string | null }) {
  const { hasPermission } = useAuth();
  const design = hasPermission("DESIGN_QUERY"), execute = hasPermission("EXECUTE_QUERY");
  const [lifecycle, setLifecycle] = useState<Snapshot | null>(null), [lifecycleVersion, setLifecycleVersion] = useState<string | null>(null);
  const [lifecycleMessage, setLifecycleMessage] = useState("");
  const [issuedId, setIssuedId] = useState<number | null>(null), [copyMessage, setCopyMessage] = useState("");
  const secret = useRef<string | null>(null), tokenField = useRef<HTMLTextAreaElement>(null), tokenDialog = useRef<HTMLDialogElement>(null);
  const mutation = useRef(false);
  function clearToken() {
    secret.current = null;
    if (tokenField.current) { tokenField.current.value = ""; tokenField.current.defaultValue = ""; tokenField.current.textContent = ""; }
    if (tokenDialog.current?.open) tokenDialog.current.close();
    setIssuedId(null); setCopyMessage("");
  }
  async function copyToken() {
    const token = secret.current;
    if (!token || !tokenDialog.current?.open) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(token);
      else { tokenField.current?.select(); if (!document.execCommand("copy")) throw new Error(); }
      if (secret.current === token) setCopyMessage("已複製 Token。");
    } catch { if (secret.current === token) setCopyMessage("無法自動複製，請選取 Token 手動複製。"); }
  }
  useEffect(() => { if (issuedId !== null) tokenDialog.current?.showModal(); }, [issuedId]);
  useEffect(() => {
    const hide = () => { ++sequence.current; setVersion(null); setLifecycleVersion(null); setBusy(false); clearToken(); };
    window.addEventListener("pagehide", hide);
    return () => { window.removeEventListener("pagehide", hide); clearToken(); };
  }, [dashboardId, accessToken]);
  async function lifecycleWrite(device: Device, action: LifecycleAction) {
    if (mutation.current || busy || !lifecycleVersion || !lifecycleActions(device as LifecycleDevice, design, execute, now).includes(action) || !window.confirm(lifecycleConfirmation(action, device.deviceName))) return;
    mutation.current = true;
    const read = ++sequence.current, expectedVersion = lifecycleVersion;
    clearToken(); clearLinks(); setBusy(true); setLifecycleMessage(""); setVersion(null); setLifecycleVersion(null);
    try {
      const result = await apiRequest<Snapshot & { deviceId: number; token?: string; credentialIssued: boolean; reenrollmentRequired?: boolean; deviceCredentialsInvalidated?: boolean }>(`${base}/${device.id}/${action}`, { method: "POST", body: JSON.stringify({ expectedVersion, confirmed: true }) }, accessToken);
      if (read !== sequence.current) return;
      if (result.dashboardId !== dashboardId || result.deviceId !== device.id || !/^[a-f0-9]{64}$/.test(result.version)) throw new Error("DEVICE_RESULT_INVALID");
      if (action !== "credential") {
        const value = trustedLifecycle(result);
        if (result.credentialIssued !== false || result.deviceCredentialsInvalidated !== true) throw new Error("DEVICE_RESULT_INVALID");
        const updated = value.devices.find(d => d.id === device.id);
        if (!updated || (action === "restore" && (!updated.isActive || updated.suspendedAtUtc !== null || updated.reenrollmentRequired !== true))) throw new Error("DEVICE_RESULT_INVALID");
        setLifecycle(value);
      } else if (result.credentialIssued !== true || result.reenrollmentRequired !== true || typeof result.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(result.token)) throw new Error("CREDENTIAL_INVALID");
      window.dispatchEvent(new CustomEvent("uqp.dashboard.configuration.changed", { detail: { dashboardId, origin: "device-lifecycle" } }));
      if (action === "credential") { secret.current = result.token!; setIssuedId(device.id); }
      setLifecycleMessage(action === "restore" || action === "credential" ? "待重新授權：請在原 BAT 專用瀏覽器勾選「使用恢復後的新 Token 重新授權」並輸入新 Token，完成 Enrollment 後才可播放。請重新載入確認狀態。" : `${lifecycleLabels[action]}已完成；請重新載入後再操作。`);
    } catch (error) {
      if (read === sequence.current) { clearToken(); setLifecycleMessage(`${dashboardOperationError(error)} 請重新載入後再次確認，不會自動重送；若核發回應遺失，無法讀回該 Token。`); }
    } finally { mutation.current = false; if (read === sequence.current) setBusy(false); }
  }
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [version, setVersion] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ deviceId: number | null; operation: "metadata" | "placement" } | null>(null);
  const [metadata, setMetadata] = useState<Metadata>(empty), [placement, setPlacement] = useState(defaultPlacement);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [renewId,setRenewId]=useState<number|null>(null),[renewDays,setRenewDays]=useState(30);
  const [alerts,setAlerts]=useState<{due30:number;due7:number;expired:number}|null>(null),[alertMessage,setAlertMessage]=useState("");
  const [now,setNow]=useState(Date.now());const serverOffset=useRef(0);
  type PlaybackLink = {dashboardId:number;deviceId:number;url:string;bat:string};
  const [links,setLinks] = useState<Record<number,PlaybackLink>>({});
  const [linkStatus,setLinkStatus] = useState<Record<number,{busy:boolean;error:boolean;message:string}>>({});
  const linkRequests = useRef(new Map<number,AbortController>());
  function clearLinks() {
    for (const request of linkRequests.current.values()) request.abort();
    linkRequests.current.clear(); setLinks({}); setLinkStatus({});
  }
  function linkNotice(deviceId:number,message:string,error=false,busy=false) {
    setLinkStatus(previous=>({...previous,[deviceId]:{busy,error,message}}));
  }
  function linkError(error:unknown) {
    const code=(error as {code?:string})?.code;
    if(code==="PLAYBACK_ORIGIN_REQUIRED")return "尚未設定播放網址：請管理員在 Server 設定 DASHBOARD_PUBLIC_CLIENT_ORIGIN 為播放裝置可連線的 HTTP／HTTPS 來源（含必要連接埠），再重新啟動 Server。";
    if(code==="PLAYBACK_ORIGIN_INVALID")return "播放網址設定不正確：DASHBOARD_PUBLIC_CLIENT_ORIGIN 僅能包含 HTTP／HTTPS 協定、主機及必要連接埠，不得含結尾斜線、路徑、帳密或查詢參數；修正後重新啟動 Server。";
    if(code==="PLAYBACK_PLACEMENT_INVALID")return "播放位置設定無效，請重新載入並修正螢幕、座標及視窗尺寸後保存。";
    if(code==="DASHBOARD_DEVICE_NOT_FOUND"||code==="DASHBOARD_DEVICE_NOT_EDITABLE")return "裝置已失效、到期或不存在；請重新載入裝置設定確認，不會恢復舊授權。";
    if((error as {status?:number})?.status===403)return "無權限取得播放網址；請確認 Dashboard、Query 與裝置管理權限。";
    if(code==="KIOSK_LINK_INVALID")return "播放網址回應格式不正確，已拒絕顯示網址及 BAT；請管理員確認前後端版本與公開來源設定。";
    return "播放網址暫不可用：連線逾時或服務未完成要求，請確認網路與 Server 狀態後重試。";
  }
  async function playbackLink(deviceId:number) {
    if(linkRequests.current.has(deviceId))return;
    const current=sequence.current;
    const controller=new AbortController();linkRequests.current.set(deviceId,controller);
    const timer=setTimeout(()=>controller.abort(),15000);
    setLinks(previous=>{const next={...previous};delete next[deviceId];return next;});
    linkNotice(deviceId,"正在產生播放網址…",false,true);
    try {
      const value=await apiRequest<PlaybackLink>(`${base}/${deviceId}/playback-link`,{signal:controller.signal},accessToken);
      let url: URL;try {url=new URL(value.url);}catch{throw new Error("KIOSK_LINK_INVALID");}
      if (value.dashboardId!==dashboardId || value.deviceId!==deviceId || !["http:","https:"].includes(url.protocol) || url.username || url.password || url.hash || url.pathname!==`/display/dashboards/${dashboardId}` || url.search!==`?deviceId=${deviceId}` || typeof value.bat!=="string" || !value.bat.startsWith("@echo off")) throw new Error("KIOSK_LINK_INVALID");
      if(current===sequence.current && linkRequests.current.get(deviceId)===controller) {setLinks(previous=>({...previous,[deviceId]:value}));linkNotice(deviceId,"播放網址已產生；網址本身不授權，請在目標裝置的瀏覽器設定檔首次輸入 Token。");}
    } catch(error) {if(current===sequence.current && linkRequests.current.get(deviceId)===controller)linkNotice(deviceId,linkError(error instanceof Error && error.message==="KIOSK_LINK_INVALID"?{code:"KIOSK_LINK_INVALID"}:error),true);}
    finally {clearTimeout(timer);if(linkRequests.current.get(deviceId)===controller)linkRequests.current.delete(deviceId);}
  }
  async function copyLink(deviceId:number,value:string,field:HTMLInputElement|null) {try {
    let copied=false;try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(value);copied=true;}}catch{/* HTTP or denied clipboard: use the visible public URL field. */}
    if(!copied){if(!field)throw new Error("COPY_UNAVAILABLE");field.focus();field.select();if(!document.execCommand("copy"))throw new Error("COPY_UNAVAILABLE");}linkNotice(deviceId,"已複製播放網址。");}catch{linkNotice(deviceId,"無法自動複製，請選取播放網址手動複製。",true);}}
  function downloadLauncher(value:PlaybackLink) {
    try {
    const url=URL.createObjectURL(new Blob([value.bat],{type:"application/octet-stream"}));
    const a=document.createElement("a");a.href=url;a.download=`UQP-device-${value.deviceId}.bat`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    linkNotice(value.deviceId,"BAT 已交由瀏覽器下載；請確認下載清單。");
    } catch {linkNotice(value.deviceId,"無法下載 BAT，請確認瀏覽器下載權限後重試。",true);}
  }
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
  function trustedLifecycle(value: Snapshot) {
    trusted(value);
    for (const d of value.devices) {
      if (!(d.suspendedAtUtc === null || typeof d.suspendedAtUtc === "string" && Number.isFinite(Date.parse(d.suspendedAtUtc))) || ![null, true, false].includes(d.reenrollmentRequired as null | boolean)) throw new Error("LIFECYCLE_INVALID");
    }
    return value;
  }
  async function load(discard = false) {
    if (discard && draft && !window.confirm("重新載入會捨棄本區裝置草稿，確定繼續？")) return;
    const read = ++sequence.current; clearToken(); setLifecycleVersion(null); setLifecycle(null); setLifecycleMessage(""); clearLinks(); setBusy(true); setVersion(null); setMessage("");setAlerts(null);setAlertMessage("");
    try {
      const [metadata,reminders,safety]=await Promise.allSettled([apiRequest<Snapshot>(base,{},accessToken),apiRequest<{asOfUtc?:string;devices:{id:number;dashboardId:number;expiresAtUtc:string|null}[]}>("/dashboards/device-alerts?days=30",{},accessToken),apiRequest<Snapshot>(`${base}/lifecycle`,{},accessToken)]);
      if (read !== sequence.current) return;
      if (safety.status === "fulfilled") { try { const safe = trustedLifecycle(safety.value); setLifecycle(safe); if (design) setLifecycleVersion(safe.version); } catch { setLifecycleMessage("生命週期回應無效，管理操作已停用。"); } }
      else setLifecycleMessage(dashboardOperationError(safety.reason));
      if(metadata.status!=="fulfilled")throw metadata.reason;
      const value=trusted(metadata.value);
      if(read!==sequence.current)return;
      if(reminders.status==="fulfilled" && Array.isArray(reminders.value.devices)){
        const serverTime=Date.parse(reminders.value.asOfUtc??"");serverOffset.current=Number.isFinite(serverTime)?serverTime-Date.now():0;const current=Date.now()+serverOffset.current;setNow(current);
        const rows=reminders.value.devices.filter(d=>d.dashboardId===dashboardId && value.devices.some(v=>v.id===d.id && deviceMayIssue({...v,expiresAtUtc:null})));
        const bands=rows.map(d=>deviceExpiry(d.expiresAtUtc,current).band);
        setAlerts({due30:bands.filter(b=>b==="DUE30"||b==="DUE7").length,due7:bands.filter(b=>b==="DUE7").length,expired:bands.filter(b=>b==="EXPIRED").length});
      }else setAlertMessage("到期提醒暫時無法讀取；請確認每台裝置的到期日。");
      if (read !== sequence.current) return;
      setSnapshot(value); setVersion(value.version); setDraft(null);setRenewId(null);
    } catch (error) { if (read === sequence.current) setMessage(dashboardOperationError(error)); }
    finally { if (read === sequence.current) setBusy(false); }
  }
  useEffect(() => {
    if (issuedId !== null && lifecycle?.devices.some(d => d.id === issuedId && d.expiresAtUtc !== null && Date.parse(d.expiresAtUtc ?? "") <= now)) clearToken();
  }, [issuedId, lifecycle, now]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()+serverOffset.current),60000);return()=>clearInterval(timer);},[]);
  useEffect(() => { setSnapshot(null); setDraft(null); void load(); return () => { ++sequence.current;for(const request of linkRequests.current.values())request.abort();linkRequests.current.clear(); }; }, [dashboardId, accessToken]);
  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail?.dashboardId !== dashboardId) return;
      ++sequence.current; clearLinks(); clearToken(); setBusy(false); setVersion(null); setLifecycleVersion(null); setMessage("Dashboard 或裝置授權狀態已變更；草稿已保留，請明確重新載入。");
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
  async function renew() {
    if(busy||!design||!execute||!version||renewId===null||!Number.isInteger(renewDays)||renewDays<1||renewDays>365||!window.confirm(`確認延長裝置 ${renewId} 的到期日 ${renewDays} 天？最遠不得超過目前時間 365 天，不重新核發 Token；已失效授權不會恢復。`))return;
    const read=++sequence.current;setLifecycleVersion(null);clearToken();setBusy(true);setMessage("");
    try{
      const result=await apiRequest<Snapshot&{deviceId:number;credentialIssued:boolean;deviceCredentialsInvalidated:boolean}>(`${base}/${renewId}/renew`,{method:"POST",body:JSON.stringify({expectedVersion:version,confirmed:true,days:renewDays})},accessToken);
      if(read!==sequence.current)return;
      const value=trusted(result);
      if(result.deviceId!==renewId||result.credentialIssued!==false||result.deviceCredentialsInvalidated!==false)throw new Error("RENEWAL_INVALID");
      setSnapshot(value);setLifecycle(null);setVersion(null);setRenewId(null);setAlerts(null);
      window.dispatchEvent(new CustomEvent("uqp.dashboard.configuration.changed",{detail:{dashboardId,origin:"device-management"}}));
      setMessage("裝置已安全續期；未重新核發 Token。請重新載入確認到期提醒；HTTPS 既有持久授權仍受原登錄期限限制。");
    }catch(error){if(read===sequence.current){setVersion(null);setMessage(`${dashboardOperationError(error)} 續期未完成，請明確重新載入，不會自動重試。`);}}
    finally{if(read===sequence.current)setBusy(false);}
  }
  async function save() {
    if (busy || !design || !execute || !draft || !version || !window.confirm(draft.operation === "placement" ? "保存播放位置？此操作不改動患者資料權限。" : "保存裝置設定？不核發憑證；既有裝置的舊憑證將失效，須明確重新授權。")) return;
    const read = ++sequence.current; setLifecycleVersion(null); clearToken(); setBusy(true); setMessage("");
    try {
      const path = draft.deviceId === null ? base : `${base}/${draft.deviceId}/${draft.operation}`;
      const result = await apiRequest<Snapshot & { deviceId: number; credentialIssued?: boolean; deviceCredentialsInvalidated?: boolean }>(path, { method: draft.deviceId === null ? "POST" : "PUT", body: JSON.stringify({ expectedVersion: version, confirmed: true, ...(draft.operation === "metadata" ? { metadata } : { placement }) }) }, accessToken);
      if (read !== sequence.current) return;
      const value = trusted(result);
      if (!Number.isSafeInteger(result.deviceId) || (draft.deviceId !== null && result.deviceId !== draft.deviceId) ||
        (draft.deviceId === null ? result.credentialIssued !== false : result.deviceCredentialsInvalidated !== (draft.operation === "metadata"))) throw new Error("DEVICE_RESULT_INVALID");
      setSnapshot(value); setLifecycle(null); setDraft(null); setVersion(null);
      window.dispatchEvent(new CustomEvent("uqp.dashboard.configuration.changed", { detail: { dashboardId, origin: "device-management" } }));
      void playbackLink(result.deviceId);
      setMessage(draft.operation === "placement" ? "播放位置已保存；資料授權與遮蔽政策未變更。請重新載入後再編輯。" : "裝置設定已保存；未核發憑證，既有裝置須明確重新授權。請重新載入後再編輯。");
    } catch (error) { if (read === sequence.current) { setVersion(null); setMessage(`${dashboardOperationError(error)} 草稿已保留；請明確重新載入，不會自動覆寫。`); } }
    finally { if (read === sequence.current) setBusy(false); }
  }
  return <section className="uqp-device-manager" aria-label="版本化裝置基本管理">
    <h3>裝置建立與基本設定</h3>
    <p>新建僅保存 metadata，委派者固定為目前操作人員，不會取得播放權限。名稱／IP／到期修改會使舊憑證失效；已失效裝置不可在此恢復。工作站換綁仍為唯讀；生命週期操作以安全快照及後端重新驗證為準。</p>
    {alerts && <p role="status">到期提醒：30 天內 {alerts.due30} 台；7 天內 {alerts.due7} 台；已到期 {alerts.expired} 台。</p>}
    {alertMessage && <p role="status">{alertMessage}</p>}
    <button type="button" disabled={busy} onClick={() => void load(true)}>重新載入裝置設定</button>
    <button type="button" disabled={busy || !version || !design || !execute || !snapshot?.canCreate} onClick={() => edit(null, "metadata")}>建立未授權裝置</button>
    <p>啟用設定不代表正常播放；無法驗證表示管理快照未提供即時播放授權證據。恢復或核發後，須在原 BAT 專用瀏覽器勾選「使用恢復後的新 Token 重新授權」並輸入新 Token，完成 Enrollment 後才可播放。</p>
    {lifecycleMessage && <p role="status">{lifecycleMessage}</p>}
    <ul>{(lifecycle ?? snapshot)?.devices.map(device => <li key={device.id}>{device.deviceName}；委派者 {device.createdByUserId}；工作站 {device.sharedWorkstationId ?? "未綁定（新建不自動綁定）"}
      {lifecycle && <div aria-label={`裝置 ${device.id} 生命週期`}>
        <span>狀態：{lifecycleStatus(device as LifecycleDevice, now)}</span>
        {lifecycleActions(device as LifecycleDevice, design, execute, now).map(action => <button key={action} type="button" disabled={busy || !lifecycleVersion || !!draft || renewId !== null} onClick={() => void lifecycleWrite(device, action)}>{lifecycleLabels[action]} {device.deviceName}</button>)}
      </div>}
      <span>；到期：{device.expiresAtUtc??"未設定到期日"}{device.expiresAtUtc!==null && `；${deviceExpiry(device.expiresAtUtc,now).text}`}</span>
      <button type="button" disabled={busy||!design||!execute||!version||!!draft||!deviceMayIssue(device,now)||device.expiresAtUtc===null} onClick={()=>{setRenewId(device.id);setRenewDays(30);}}>續期 {device.deviceName}</button>
      <button type="button" disabled={busy || !design || !execute || !version || !deviceMayIssue(device)} onClick={() => edit(device, "metadata")}>編輯 {device.deviceName} 基本設定</button>
      <button type="button" disabled={busy || !design || !execute || !version || !deviceMayIssue(device)} onClick={() => edit(device, "placement")}>編輯 {device.deviceName} 播放位置</button>
      {deviceMayIssue(device,now) && <button type="button" disabled={busy||linkStatus[device.id]?.busy} aria-busy={linkStatus[device.id]?.busy??false} onClick={()=>void playbackLink(device.id)}>顯示 {device.deviceName} 播放網址</button>}
      {linkStatus[device.id] && <p role={linkStatus[device.id]!.error?"alert":"status"}>{linkStatus[device.id]!.message}</p>}
      {links[device.id] && deviceMayIssue(device,now) && <div aria-label={`裝置 ${device.id} 播放網址`}>
        <input aria-label={`裝置 ${device.id} 播放網址`} readOnly value={links[device.id]!.url} onFocus={e=>e.currentTarget.select()}/>
        <button type="button" onClick={e=>void copyLink(device.id,links[device.id]!.url,e.currentTarget.parentElement?.querySelector("input")??null)}>複製播放網址</button>
        <a href={links[device.id]!.url} target="_blank" rel="noopener noreferrer">開啟播放網址</a>
        <button type="button" onClick={()=>downloadLauncher(links[device.id]!)}>下載 Windows BAT</button>
        {links[device.id]!.url.startsWith("http:") && <p>HTTP 僅供手動播放；重整、關閉或重啟後須再次輸入 Token，不支援持久授權。HTTP 無法保護傳輸中的 Token。</p>}
        <p>BAT 使用獨立且固定的瀏覽器設定檔；首次請從 BAT 開啟並輸入 Token。指定螢幕依 Windows DeviceName 排序，非顯示設定編號；座標為桌面絕對座標。</p>
      </div>}
    </li>)}</ul>
    {renewId!==null && <fieldset disabled={busy} aria-label="安全續期"><legend>安全續期裝置 {renewId}</legend>
      <label>延長天數<input aria-label="延長天數" type="number" min={1} max={365} value={renewDays} onChange={e=>setRenewDays(Number(e.target.value))}/></label>
      <p>僅限尚未到期且授權有效的裝置；延長後的到期日最多為目前時間起 365 天。</p>
      <button type="button" disabled={!version||!Number.isInteger(renewDays)||renewDays<1||renewDays>365} onClick={()=>void renew()}>確認安全續期</button>
      <button type="button" onClick={()=>setRenewId(null)}>取消續期</button>
    </fieldset>}
    {draft && <fieldset className="uqp-device-fieldset" disabled={busy} aria-label="裝置設定草稿"><legend>{draft.deviceId === null ? "建立未授權裝置" : `裝置 ${draft.deviceId} 設定草稿`}</legend>
      {draft.operation === "metadata" ? <div className="uqp-device-fields">
        <label>裝置名稱<input aria-label="裝置名稱" maxLength={200} value={metadata.deviceName} onChange={e => setMetadata({ ...metadata, deviceName: e.target.value })}/></label>
        <label className="uqp-device-checkbox"><input type="checkbox" checked={metadata.enforceIpRestriction} onChange={e => setMetadata({ ...metadata, enforceIpRestriction: e.target.checked, allowedIp: null, allowedCidr: null })}/>限制來源 IP</label>
        <label>允許 IP<input aria-label="允許 IP" disabled={!metadata.enforceIpRestriction} value={metadata.allowedIp ?? ""} onChange={e => setMetadata({ ...metadata, allowedIp: e.target.value || null })}/></label>
        <label>允許 IPv4 CIDR<input aria-label="允許 IPv4 CIDR" disabled={!metadata.enforceIpRestriction} value={metadata.allowedCidr ?? ""} onChange={e => setMetadata({ ...metadata, allowedCidr: e.target.value || null })}/></label>
        <label>到期時間（UTC ISO，留空為無到期日）<input aria-label="裝置到期時間 UTC" placeholder="2030-01-01T00:00:00Z" value={metadata.expiresAtUtc ?? ""} onChange={e => setMetadata({ ...metadata, expiresAtUtc: e.target.value || null })}/></label>
      </div> : <div className="uqp-device-fields">
        <label>瀏覽器<select aria-label="播放瀏覽器" value={placement.browser} onChange={e => setPlacement({ ...placement, browser: e.target.value as "edge" | "chrome" })}><option value="edge">Edge</option><option value="chrome">Chrome</option></select></label>
        <label className="uqp-device-checkbox"><input type="checkbox" checked={placement.fullscreen} onChange={e => setPlacement({ ...placement, fullscreen: e.target.checked })}/>全螢幕</label>
        {([['screenNumber', '指定螢幕'], ['windowX', '視窗 X'], ['windowY', '視窗 Y'], ['windowWidth', '視窗寬度'], ['windowHeight', '視窗高度']] as const).map(([key, label]) => <label key={key}>{label}<input type="number" aria-label={label} value={placement[key]} onChange={e => setPlacement({ ...placement, [key]: Number(e.target.value) })}/></label>)}
      </div>}
      <div className="uqp-device-actions"><button type="button" disabled={!version || (draft.operation === "metadata" && !metadata.deviceName.trim())} onClick={() => void save()}>確認保存裝置設定</button></div>
    </fieldset>}
    {issuedId !== null && <dialog ref={tokenDialog} aria-label="一次性新 Token" onCancel={e => { e.preventDefault(); clearToken(); }} onClose={clearToken}>
      <h3>一次性新 Token</h3><p>裝置 {issuedId} 待重新授權。新 Token 只顯示一次；關閉後無法從歷史重新讀取。</p>
      <p>請使用原 BAT 專用瀏覽器勾選「使用恢復後的新 Token 重新授權」並輸入新 Token，完成 Enrollment 後才可播放。</p>
      <textarea aria-label="新 Token（僅顯示一次）" ref={tokenField} readOnly defaultValue={secret.current ?? ""}/>
      <button type="button" onClick={() => void copyToken()}>複製新 Token</button>
      <button type="button" onClick={clearToken}>關閉並清除新 Token</button>
      {copyMessage && <p role="status">{copyMessage}</p>}
    </dialog>}
    {message && <p role="status">{message}</p>}
  </section>;
}
