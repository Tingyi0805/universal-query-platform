import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api/client";
import { managementError } from "../dashboard/querySourceManagement";
import { forgetDashboardToken, prepareDashboardTokenHandoff } from "../security/dashboardToken";
type Mode = {mode:string;version:string;modeVersion:number};
type Check = {ok:boolean;code:string|null};
type Preflight = Mode & {ready:boolean;sourceCount:number;pendingCount:number;checks:(Check & {name:string})[];
  queries:(Check & {sourceKey:string})[];delegators:(Check & {deviceId:number})[]};
type Device = {id:number;deviceName:string;isActive:boolean;isArchived?:boolean;revokedAtUtc?:string|null};
const labels:Record<string,string>={inactive:"停用狀態",capacity:"含 PRIMARY 最多 8 個來源",bindings:"來源已轉換與識別有效",references:"元件來源引用",devices:"有效裝置綁定"};
export function DashboardQueryPlaybackManager({dashboardId,accessToken}:{dashboardId:number;accessToken:string|null}) {
  const [mode,setMode]=useState<Mode|null>(null),[preflight,setPreflight]=useState<Preflight|null>(null);
  const [devices,setDevices]=useState<Device[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [issued,setIssued]=useState<{deviceId:number;token:string}|null>(null),[reveal,setReveal]=useState(false);
  const cleanup=useRef<(()=>void)|null>(null),issuedDashboardId=useRef<number|null>(null);
  const epoch=useRef(0);
  const base=`/dashboards/${dashboardId}/query-mode/v1`;
  function clearCredential() { cleanup.current?.();cleanup.current=null;
    if(issuedDashboardId.current!==null) forgetDashboardToken(issuedDashboardId.current);issuedDashboardId.current=null;setIssued(null);setReveal(false); }
  async function refresh() {
    const requestEpoch=epoch.current;
    setBusy(true);
    try {
      const [current,list]=await Promise.all([apiRequest<Mode>(base,{},accessToken),apiRequest<{devices:Device[]}>(`/dashboards/${dashboardId}/devices`,{},accessToken)]);
      if(requestEpoch!==epoch.current)return;
      if(mode && (current.mode!==mode.mode || current.modeVersion!==mode.modeVersion))clearCredential();
      setMode(current);setDevices(list.devices);setPreflight(null);
    } catch(error) {if(requestEpoch!==epoch.current)return;clearCredential();setMode(null);setPreflight(null);setMessage(managementError(error));}
    finally {if(requestEpoch===epoch.current)setBusy(false);}
  }
  useEffect(()=>{++epoch.current;clearCredential();setMode(null);setPreflight(null);void refresh();return ()=>{++epoch.current;cleanup.current?.();if(issuedDashboardId.current!==null)forgetDashboardToken(issuedDashboardId.current);};},[dashboardId,accessToken]);
  useEffect(()=>{
    const changed=(event:Event)=>{const detail=(event as CustomEvent<{dashboardId:number;origin:string}>).detail;
      if(detail?.dashboardId===dashboardId && detail.origin!=="playback"){++epoch.current;clearCredential();void refresh();}};
    window.addEventListener("uqp.dashboard.configuration.changed",changed);
    return ()=>window.removeEventListener("uqp.dashboard.configuration.changed",changed);
  },[dashboardId,accessToken]);
  async function check() {
    const requestEpoch=epoch.current;
    setBusy(true);setMessage("");
    try {const result=await apiRequest<Preflight>(`${base}/preflight`,{},accessToken);if(requestEpoch!==epoch.current)return;if(mode && (result.mode!==mode.mode || result.modeVersion!==mode.modeVersion))clearCredential();setPreflight(result);setMode(result);}
    catch(error){if(requestEpoch!==epoch.current)return;clearCredential();setPreflight(null);setMessage(managementError(error));} finally{if(requestEpoch===epoch.current)setBusy(false);}
  }
  async function change(activate:boolean) {
    const requestEpoch=epoch.current;
    if(!mode || !window.confirm(activate?"啟用 Query-only？所有舊裝置憑證將失效，須重新核發。":"停用 Query-only 並撤銷所有相關裝置憑證？"))return;
    clearCredential();setBusy(true);setMessage("");
    try {const result=await apiRequest<Mode>(base,{method:"POST",body:JSON.stringify({expectedVersion:mode.version,activate})},accessToken);
      if(requestEpoch!==epoch.current)return;
      forgetDashboardToken(dashboardId);
      setMode(result);setPreflight(null);window.dispatchEvent(new CustomEvent("uqp.dashboard.configuration.changed",{detail:{dashboardId,origin:"playback"}}));setMessage(activate?"模式已啟用；請核發新裝置憑證後開始播放。":"已安全停用；原裝置憑證失效。");
    } catch(error){if(requestEpoch!==epoch.current)return;setMessage(managementError(error));} finally{if(requestEpoch===epoch.current)setBusy(false);}
  }
  async function credential(device:Device,revoke=false) {
    const requestEpoch=epoch.current;
    if(!mode || !window.confirm(revoke?`撤銷裝置「${device.deviceName}」？須另行授權才能恢復。`:`核發／重新核發裝置「${device.deviceName}」憑證？舊憑證立即失效。`))return;
    clearCredential();setBusy(true);setMessage("");
    try {
      const result=await apiRequest<{token?:string;device?:{id:number;dashboardId:number}}>(`${base}/devices/${device.id}/credential`,{method:revoke?"DELETE":"POST",body:JSON.stringify({expectedVersion:mode.version})},accessToken);
      if(requestEpoch!==epoch.current)return;
      forgetDashboardToken(dashboardId);
      if(revoke){setDevices(previous=>previous.map(item=>item.id===device.id?{...item,isActive:false}:item));setMessage("裝置已撤銷，請勿重用原憑證。");}
      else {
        if(result.device?.id!==device.id || result.device?.dashboardId!==dashboardId || !result.token || !/^[A-Za-z0-9_-]{43}$/.test(result.token))throw new Error("INVALID_CREDENTIAL_RESPONSE");
        issuedDashboardId.current=dashboardId;setIssued({deviceId:device.id,token:result.token});setMessage("核發成功；憑證僅保留於此頁記憶體。請透過可信流程交付給播放裝置。");
      }
      setPreflight(null);
    } catch(error){if(requestEpoch!==epoch.current)return;setMessage(managementError(error));} finally{if(requestEpoch===epoch.current)setBusy(false);}
  }
  function play() {
    if(!issued)return;
    const popup=window.open("about:blank","_blank");
    if(!popup){setMessage("瀏覽器封鎖播放視窗，請允許此網站開啟新視窗。");return;}
    cleanup.current?.();cleanup.current=prepareDashboardTokenHandoff(popup,dashboardId,issued.token);
    popup.location.replace(`/display/dashboards/${dashboardId}`);
  }
  const result=(value:Check)=>value.ok?"通過":`未通過：${value.code ?? "REQUEST_FAILED"}`;
  return <section className="dashboard-editor-card"><h2>Query-only 播放啟用與授權</h2>
    <p>請先儲存來源與版面，預檢只針對後端已儲存配置。重啟、關閉或重新整理後，播放器須等待管理者重新授權。沒有安全的自動授權機制，不會保存或自動重用長期憑證。</p>
    <button type="button" disabled={busy} onClick={()=>void refresh()}>重新載入播放狀態</button>
    {mode && <><p>目前模式：{mode.mode}（版本 {mode.modeVersion}）</p>
      <button type="button" disabled={busy} onClick={()=>void check()}>執行啟用前檢查</button>
      {preflight && <div role="status"><p>來源：{preflight.sourceCount}/8；待轉換：{preflight.pendingCount}。結果僅代表檢查當下，啟用時後端會重新驗證。</p>
        <ul>{preflight.checks.map(item=><li key={item.name}>{labels[item.name] ?? item.name}：{result(item)}</li>)}
          {preflight.queries.map(item=><li key={item.sourceKey}>{item.sourceKey} Query ACL／必要參數／遮蔽與稽核：{result(item)}</li>)}
          {preflight.delegators.map(item=><li key={item.deviceId}>裝置 {item.deviceId} 委派者／工作站／Query ACL：{result(item)}</li>)}</ul></div>}
      <button type="button" disabled={busy||!preflight?.ready||mode.mode==="QUERY_ONLY"} onClick={()=>void change(true)}>啟用 Query-only</button>
      <button type="button" disabled={busy||mode.mode!=="QUERY_ONLY"} onClick={()=>void change(false)}>停用 Query-only</button>
      <table className="preview-table"><thead><tr><th>装置</th><th>狀態</th><th>操作</th></tr></thead><tbody>{devices.map(device=><tr key={device.id}>
        <td>{device.deviceName}</td><td>{device.isActive&&!device.isArchived?"啟用設定（核發時驗證）":"停用／撤銷"}</td><td>
          <button type="button" disabled={busy||mode.mode!=="QUERY_ONLY"||!device.isActive||device.isArchived} onClick={()=>void credential(device)}>核發／重新核發 {device.deviceName}</button>
          <button type="button" disabled={busy||mode.mode==="LEGACY"||!device.isActive||device.isArchived} onClick={()=>void credential(device,true)}>撤銷 {device.deviceName}</button>
        </td></tr>)}</tbody></table></>}
    {issued && <div><label>本次核發憑證<input type={reveal?"text":"password"} readOnly autoComplete="off" value={issued.token}/></label>
      <button type="button" onClick={()=>setReveal(value=>!value)}>{reveal?"隱藏憑證":"顯示本次憑證"}</button>
      <button type="button" onClick={play}>在此裝置開啟安全播放</button><button type="button" onClick={clearCredential}>清除本頁憑證</button></div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
