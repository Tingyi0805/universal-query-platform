import {Link} from "react-router-dom";
import {useEffect,useRef,useState,type ReactNode} from "react";
import {DashboardBasicSettingsEditor} from "./DashboardBasicSettingsEditor";
import {DashboardDataSourcesEditor} from "./DashboardDataSourcesEditor";
import {DashboardQueryPlaybackManager} from "./DashboardQueryPlaybackManager";
import {DashboardLayoutDesignerPage} from "../pages/DashboardLayoutDesignerPage";
import "./DashboardAdminWorkspace.css";
export const dashboardAdminTabs={data:"資料設定",layout:"版面設計",playback:"播放設定",devices:"裝置管理"} as const;
export type DashboardAdminTab=keyof typeof dashboardAdminTabs;
export function DashboardAdminWorkspace({dashboardId,code,accessToken,tab,onTabChange,onCreated,onDirtyChange,preview,onPreview}:{
 dashboardId:number|null;code:string;accessToken:string|null;tab:DashboardAdminTab;onTabChange:(tab:DashboardAdminTab)=>void;
 onCreated:(id:number,code:string)=>void;onDirtyChange:(dirty:boolean)=>void;preview:ReactNode;onPreview:()=>void;
}){
 const [sourceTarget,setSourceTarget]=useState<HTMLDivElement|null>(null),[layoutTarget,setLayoutTarget]=useState<HTMLDivElement|null>(null);
 const [layoutVisited,setLayoutVisited]=useState(false),[devicesVisited,setDevicesVisited]=useState(false);
 const [basicDirty,setBasicDirty]=useState(false),[sourceDirty,setSourceDirty]=useState(false),[layoutDirty,setLayoutDirty]=useState(false),[deviceDirty,setDeviceDirty]=useState(false);
 const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(tab==="layout"||tab==="playback")setLayoutVisited(true);if(tab==="devices")setDevicesVisited(true);},[tab]);
 const dirty=basicDirty||sourceDirty||layoutDirty||deviceDirty;
 useEffect(()=>{onDirtyChange(dirty);},[dirty,onDirtyChange]);
 useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue="";}};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[dirty]);
 function select(next:DashboardAdminTab){if(next===tab)return;if(tab==="devices")window.dispatchEvent(new CustomEvent("uqp.dashboard.management.leaving",{detail:{dashboardId}}));onTabChange(next);}
 return <div className="uqp-admin-workspace" ref={root}>
  {dashboardId&&<p className="uqp-admin-context">正在編輯：{code}（Dashboard #{dashboardId}）</p>}
  <div role="tablist" aria-label="Dashboard 管理設定" className="uqp-admin-tabs">{Object.entries(dashboardAdminTabs).map(([key,label])=><button key={key} id={`dashboard-tab-${key}`} role="tab" type="button" aria-controls={`dashboard-panel-${key}`} aria-selected={tab===key} tabIndex={tab===key?0:-1} disabled={!dashboardId&&key!=="data"} onClick={()=>select(key as DashboardAdminTab)} onKeyDown={event=>{
    if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;event.preventDefault();const keys=Object.keys(dashboardAdminTabs) as DashboardAdminTab[];
    const index=event.key==="Home"?0:event.key==="End"?keys.length-1:(keys.indexOf(key as DashboardAdminTab)+(event.key==="ArrowRight"?1:keys.length-1))%keys.length;
    if(dashboardId||keys[index]==="data"){select(keys[index]!);root.current?.querySelector<HTMLButtonElement>(`#dashboard-tab-${keys[index]}`)?.focus();}
  }}>{label}</button>)}</div>
  {dirty&&<p role="status">有未儲存內容；切換頁籤會保留草稿，保存仍使用各區原有版本及確認。</p>}
  {!dashboardId&&<p>先建立停用草稿，再設定版面、播放及裝置。</p>}
  <div role="tabpanel" id="dashboard-panel-data" aria-labelledby="dashboard-tab-data" hidden={tab!=="data"}>
    <DashboardBasicSettingsEditor dashboardId={dashboardId} code={code} accessToken={accessToken} onCreated={onCreated} onDirtyChange={setBasicDirty}/>
    {dashboardId&&<p>Query 發布與遮蔽政策沿用既有介面：<Link to="/designer/queries" onClick={event=>{if(dirty&&!window.confirm("離開會捨棄未儲存草稿，確定前往 Query 管理？"))event.preventDefault();}}>Query 管理</Link> · <Link to="/designer/datasets" onClick={event=>{if(dirty&&!window.confirm("離開會捨棄未儲存草稿，確定前往 Dataset 政策管理？"))event.preventDefault();}}>Dataset 遮蔽／公共顯示政策</Link></p>}
    {dashboardId&&<DashboardDataSourcesEditor dashboardId={dashboardId} accessToken={accessToken} playbackTarget={sourceTarget} playbackActive={tab==="playback"} onDirtyChange={setSourceDirty}/>}
  </div>
  <div role="tabpanel" id="dashboard-panel-layout" aria-labelledby="dashboard-tab-layout" hidden={tab!=="layout"}>
    {dashboardId&&layoutVisited&&<DashboardLayoutDesignerPage dashboardId={dashboardId} embedded active={tab==="layout"} playbackTarget={layoutTarget} onDirtyChange={setLayoutDirty}/>}
  </div>
  <div role="tabpanel" id="dashboard-panel-playback" aria-labelledby="dashboard-tab-playback" hidden={tab!=="playback"}>
    <div ref={setSourceTarget}/><div ref={setLayoutTarget}/>
    {dashboardId&&<section className="dashboard-editor-card"><h2>LIVE PREVIEW</h2><p>預覽已保存設定；草稿不會自動保存或啟用播放。</p><button type="button" onClick={onPreview}>預覽已保存 Dashboard</button>{preview}</section>}
  </div>
  <div role="tabpanel" id="dashboard-panel-devices" aria-labelledby="dashboard-tab-devices" hidden={tab!=="devices"}>
    {dashboardId&&<p>預檢與啟用只使用已保存設定；其他頁籤草稿不會自動儲存。</p>}
    {dashboardId&&devicesVisited&&<DashboardQueryPlaybackManager dashboardId={dashboardId} accessToken={accessToken} active={tab==="devices"} onDirtyChange={setDeviceDirty}/>}
  </div>
 </div>;
}
