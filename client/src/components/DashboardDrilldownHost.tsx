import { useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { apiRequest } from "../api/client";
import { jwtDeadline, validDrillPage, type DrillPage } from "../dashboard/drilldown";
import "./DashboardDrilldown.css";
type Mode="PAGE"|"PANEL"|"MODAL";
/** Mounted only on the personal-JWT display route. Playback rows are never converted to rowRefs. */
export function DashboardDrilldownHost({dashboardId,profileId,token,onLogout}:{dashboardId:number;profileId:number;token:string;onLogout:()=>void}) {
  const [page,setPage]=useState<DrillPage|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [trail,setTrail]=useState<{node:string;mode:Mode}[]>([]);
  const generation=useRef(0),context=useRef<string|null>(null),pending=useRef(false),alive=useRef(true);
  const depth=useRef(0),identityEpoch=useRef(0);
  const expiry=useRef<ReturnType<typeof setTimeout>|null>(null);
  const base=`/dashboards/${dashboardId}/interactive/v1/contexts`;
  const dialog=useRef<HTMLDialogElement>(null),entry=useRef<HTMLButtonElement>(null);
  function dispose(id:string) { if(!/^[A-Za-z0-9_-]{43}$/.test(id))return; const epoch=identityEpoch.current;
    void apiRequest(`${base}/${id}`,{method:"DELETE",keepalive:true},token,()=>alive.current&&identityEpoch.current===epoch).catch(()=>undefined); }
  function clear(message="") {
    ++generation.current;pending.current=false;depth.current=0;
    if(expiry.current)clearTimeout(expiry.current);
    const id=context.current;context.current=null;if(id)dispose(id);
    setPage(null);setTrail([]);setBusy(false);setError(message);
  }
  useEffect(()=>{
    alive.current=true;++identityEpoch.current;
    const leave=()=>flushSync(()=>clear("互動資料已清除；請重新開啟。"));
    const hidden=()=>{if(document.visibilityState!=="visible")leave();};
    const escape=(e:KeyboardEvent)=>{if(e.key==="Escape"&&(context.current||pending.current)){leave();entry.current?.focus();}};
    window.addEventListener("uqp-interactive-clear",leave);window.addEventListener("uqp-auth-invalid",leave);
    window.addEventListener("pagehide",leave);window.addEventListener("keydown",escape);document.addEventListener("visibilitychange",hidden);
    const deadline=jwtDeadline(token),timer=deadline?setTimeout(()=>{leave();},Math.max(0,Math.min(2147483647,deadline-Date.now()))):null;
    return ()=>{alive.current=false;++identityEpoch.current;clear();if(timer)clearTimeout(timer);window.removeEventListener("uqp-interactive-clear",leave);window.removeEventListener("uqp-auth-invalid",leave);window.removeEventListener("pagehide",leave);window.removeEventListener("keydown",escape);document.removeEventListener("visibilitychange",hidden);};
  },[dashboardId,profileId,token]);
  const mode=trail.at(-1)?.mode??"PAGE";
  useEffect(()=>{if(page&&dialog.current&&!dialog.current.open)dialog.current.showModal();},[page,mode]);
  async function run(kind:"CREATE"|"NAVIGATE"|"BACK"|"ROOT",action?:DrillPage["actions"][number],rowRef?:string) {
    if(pending.current||document.visibilityState!=="visible")return;
    if(jwtDeadline(token)&&jwtDeadline(token)<=Date.now()){clear("登入已到期，已清除互動資料。");return;}
    pending.current=true;setBusy(true);setError("");
    const identity=identityEpoch.current;
    const currentIdentity=()=>alive.current&&identityEpoch.current===identity;
    const seq=++generation.current,oldDepth=depth.current,previous=trail;setPage(null); // Never display old patient rows while authority is being rechecked.
    let returned:string|null=null;
    try {
      const id=context.current;
      let result:DrillPage;
      if(kind==="CREATE")result=await apiRequest(base,{method:"POST",body:JSON.stringify({profileId})},token,currentIdentity);
      else {
        if(!id||!oldDepth)throw Error();
        result=await apiRequest(`${base}/${id}/${kind==="NAVIGATE"?"navigate":"back"}`,{method:"POST",body:JSON.stringify(kind==="NAVIGATE"?{edge:action!.id,rowRef}: {})},token,currentIdentity);
      }
      returned=result?.contextId;
      if(!alive.current||seq!==generation.current||document.visibilityState!=="visible"){if(returned)dispose(returned);return;}
      if(!validDrillPage(result))throw Error();
      if(kind==="ROOT")while(result.depth>1){
        const priorDepth=result.depth;
        result=await apiRequest(`${base}/${id}/back`,{method:"POST",body:"{}"},token,currentIdentity);
        if(!alive.current||seq!==generation.current||document.visibilityState!=="visible"){if(returned)dispose(returned);return;}
        if(!validDrillPage(result)||result.contextId!==id||result.depth!==priorDepth-1)throw Error();
      }
      if(!validDrillPage(result)||(kind!=="CREATE"&&result.contextId!==id)
        ||result.depth!==(kind==="CREATE"||kind==="ROOT"?1:kind==="BACK"?oldDepth-1:oldDepth+1))throw Error();
      context.current=result.contextId;depth.current=result.depth;
      const next=kind==="CREATE"||kind==="ROOT"?[{node:result.node,mode:"PAGE" as Mode}]:kind==="BACK"?previous.slice(0,-1):[...previous,{node:result.node,mode:action!.display}];
      setTrail(next);setPage(result);
      if(expiry.current)clearTimeout(expiry.current);
      expiry.current=setTimeout(()=>clear("互動工作階段已到期，資料已清除。"),Math.max(0,Date.parse(result.expiresAtUtc)-Date.now()));
    } catch {
      if(returned&&returned!==context.current)dispose(returned);
      if(alive.current&&seq===generation.current)clear("互動查詢未完成，資料已清除。請確認授權、稽核或工作階段後重新開啟。");
    } finally {if(alive.current&&seq===generation.current){pending.current=false;setBusy(false);}}
  }
  const close=()=>{clear();entry.current?.focus();};
  const content=page&&<>
    <header><h2>互動資料查詢</h2><button type="button" onClick={()=>{clear();onLogout();}}>登出並清除互動</button><button type="button" onClick={close}>關閉互動查詢</button></header>
    <nav aria-label="下鑽階層">{trail.map((_,i)=><span key={i} aria-current={i===trail.length-1?"page":undefined}>{i?" › ":""}第 {i+1} 層</span>)}</nav>
    {page.depth>1&&<div className="drill-actions"><button type="button" onClick={()=>void run("BACK")}>返回上一層</button><button type="button" onClick={()=>void run("ROOT")}>返回主層</button></div>}
    <div className="drill-table"><table><thead><tr>{page.result.columns.map(c=><th key={c.name} scope="col">{c.name}</th>)}{page.actions.some(a=>a.trigger==="ROW")&&<th scope="col">整列操作</th>}</tr></thead><tbody>
      {page.result.rows.map((row,i)=><tr key={page.rowRefs[i]} tabIndex={page.actions.some(a=>a.trigger==="ROW")?0:undefined}
        onClick={e=>{if((e.target as HTMLElement).closest("button"))return;const actions=page.actions.filter(a=>a.trigger==="ROW");if(actions.length===1)void run("NAVIGATE",actions[0],page.rowRefs[i]);}}
        onKeyDown={e=>{if(e.target!==e.currentTarget||!["Enter"," "].includes(e.key))return;const actions=page.actions.filter(a=>a.trigger==="ROW");if(actions.length===1){e.preventDefault();void run("NAVIGATE",actions[0],page.rowRefs[i]);}}}>
        {page.result.columns.map(c=><td key={c.name}>{String(row[c.name]??"")}{page.actions.filter(a=>a.trigger==="COLUMN"&&a.column===c.name).map(a=><button key={a.id} type="button" aria-label={`${c.name} 下鑽 ${a.id}`} onClick={()=>void run("NAVIGATE",a,page.rowRefs[i])}>查看明細</button>)}</td>)}
        {page.actions.some(a=>a.trigger==="ROW")&&<td>{page.actions.filter(a=>a.trigger==="ROW").map(a=><button key={a.id} type="button" onClick={()=>void run("NAVIGATE",a,page.rowRefs[i])}>整列下鑽 {a.id}</button>)}</td>}
      </tr>)}
    </tbody></table>{!page.result.rows.length&&<p role="status">無符合條件資料</p>}</div>
  </>;
  return <div className="drill-entry"><button ref={entry} type="button" disabled={busy||!!page} onClick={()=>void run("CREATE")}>開啟互動表格</button>
    {busy&&<p role="status">安全驗證與查詢中…<button type="button" onClick={close}>取消互動查詢</button></p>}{error&&<p role="alert">{error}</p>}
    {page&&createPortal(<dialog ref={dialog} className={`drill-view drill-${mode.toLowerCase()}`} aria-label={mode==="PAGE"?"整頁互動查詢":mode==="PANEL"?"側邊互動查詢":"彈出互動查詢"} onCancel={e=>{e.preventDefault();close();}}>{content}</dialog>,document.body)}
  </div>;
}
