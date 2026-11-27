import {useEffect,useRef,useState,type FormEvent} from "react";
import {apiRequest} from "../api/client";
import {WorkstationIdentity} from "../security/workstationIdentity";
import "./hierarchy.css";
type Controls={page:number;search:{column:string;text:string}|null;sort:{column:string;direction:"ASC"|"DESC"}|null};
type View={contextId:string;expiresAtUtc:string;depth:number;trail:string[];query:{name:string};layout:"TABLE"|"CARDS";controls:Controls;
 result:{columns:{name:string}[];rows:Record<string,unknown>[]};pagination:{page:number;pageSize:number;totalRows:number;totalPages:number;capped:boolean};
 columns:{key:string;name:string;label:string;canFilter:boolean;alignment:string}[];rowRefs:string[];
 actions:{id:string;label:string;trigger:"ROW"|"COLUMN"|"MORE";display:"PAGE"|"PANEL"|"MODAL";columnKey:string|null}[]};
const ref=/^[A-Za-z0-9_-]{43}$/;
function checked(v:View):View{
 if(!v||!ref.test(v.contextId)||!Number.isFinite(Date.parse(v.expiresAtUtc))||Date.parse(v.expiresAtUtc)<=Date.now()||!Number.isInteger(v.depth)||v.depth<1||v.depth>5||
  !["TABLE","CARDS"].includes(v.layout)||!Array.isArray(v.trail)||v.trail.length!==v.depth||!Array.isArray(v.result?.rows)||v.result.rows.length>100||
  !Array.isArray(v.rowRefs)||v.rowRefs.length!==v.result.rows.length||v.rowRefs.some(r=>!ref.test(r))||!Array.isArray(v.columns)||!Array.isArray(v.actions)||
  ![v.pagination?.page,v.pagination?.pageSize,v.pagination?.totalRows,v.pagination?.totalPages].every(Number.isSafeInteger)||
  v.pagination.page<1||v.pagination.pageSize<1||v.pagination.pageSize>100||v.pagination.totalRows<0||v.pagination.page>v.pagination.totalPages||
  v.columns.some(c=>!/^c[0-9]{1,3}$/.test(c.key)||typeof c.name!=="string"||typeof c.label!=="string")||
  v.actions.some(a=>!["ROW","COLUMN","MORE"].includes(a.trigger)||!["PAGE","PANEL","MODAL"].includes(a.display)))throw Error("HIERARCHY_RESPONSE_INVALID");
 return v;
}
export function QueryHierarchyWorkspace({rootQueryId,values,accessToken,onExit}:{rootQueryId:number;values:Record<string,unknown>;accessToken:string|null;onExit:()=>void}){
 const base=`/queries/${rootQueryId}/hierarchy`,[view,setView]=useState<View|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [mode,setMode]=useState<"PAGE"|"PANEL"|"MODAL">("PAGE"),[searchColumn,setSearchColumn]=useState(""),[searchText,setSearchText]=useState("");
 const fence=useRef(new WorkstationIdentity()),context=useRef<string|null>(null),epoch=useRef(0),alive=useRef(true),expiry=useRef<ReturnType<typeof setTimeout>|null>(null);
 const container=useRef<HTMLElement|null>(null);
 useEffect(()=>{if(view&&mode!=="PAGE")container.current?.focus();},[view?.depth,mode]);
 const exit=useRef(onExit);exit.current=onExit;
 function discard(reason="已停止查詢，請重新登入或回主層。"){
  const old=context.current;context.current=null;epoch.current++;fence.current.clear();if(expiry.current)clearTimeout(expiry.current);
  setView(null);setSearchText("");setSearchColumn("");setBusy(false);setMessage(reason);setMode("PAGE");
  if(old)void apiRequest(base+`/contexts/${old}`,{method:"DELETE",keepalive:true,body:"{}"},accessToken,()=>false).catch(()=>{});
 }
 async function request(path:string,body:unknown,display?:"PAGE"|"PANEL"|"MODAL"){
  const current=++epoch.current;fence.current.clear();setBusy(true);setView(null);setMessage("");
  try{const v=checked(await fence.current.run(signal=>apiRequest<View>(base+path,{method:"POST",signal,body:JSON.stringify(body)},accessToken,()=>alive.current&&current===epoch.current)));
   if(!alive.current||epoch.current!==current)return;context.current=v.contextId;setView(v);setSearchColumn(v.controls.search?.column??v.columns.find(c=>c.canFilter)?.key??"");setSearchText(v.controls.search?.text??"");
   if(display)setMode(display);if(v.depth===1)setMode("PAGE");if(expiry.current)clearTimeout(expiry.current);
   expiry.current=setTimeout(()=>discard("查詢階層已到期，已清除資料；請重新回主層。"),Math.min(2147483647,Date.parse(v.expiresAtUtc)-Date.now()));
  }catch(error){if(alive.current&&epoch.current===current){
   const details=error as {code?:unknown;requestId?:unknown}|null;
   const code=typeof details?.code==="string"&&/^[A-Z][A-Z0-9_]{1,95}$/.test(details.code)?details.code:"";
   const requestId=typeof details?.requestId==="string"&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(details.requestId)?details.requestId:"";
   const reason=code==="HIERARCHY_NON_UNIQUE_ORDER"?"排序鍵有重複，請管理者設定可唯一識別每列的欄位。":
    code==="HIERARCHY_SOURCE_PAGE_CHANGED"?"來源資料已異動，請重新回主層。":
    code==="HIERARCHY_PAGING_UNSUPPORTED"?"目前資料來源或 SQL 不支援此分頁方式，請管理者確認。":
    code==="HIERARCHY_PAGING_TIMEOUT"?"來源分頁驗證逾時，請管理者確認查詢範圍與效能。":
    code==="HIERARCHY_SAVED_BINDING_STALE"?"Query 或 Dataset 已異動，請管理者重新儲存多層設定。":
    "授權、版本、政策、稽核或來源查詢無法驗證時停止交付。";
   discard("多層查詢未完成。"+reason+"請重新回主層，不會自動重送。"+(code?"（"+code+"）":"")+(requestId?" Request ID: "+requestId:""));
  }}
  finally{if(alive.current&&epoch.current===current)setBusy(false);}
 }
 useEffect(()=>{
  alive.current=true;const purge=()=>discard(),hidden=()=>{if(document.hidden)purge();};
  const channel=typeof BroadcastChannel!=="undefined"?new BroadcastChannel("uqp-workstation-identity"):null;
  if(channel)channel.onmessage=()=>window.dispatchEvent(new Event("uqp-interactive-clear"));
  window.addEventListener("uqp-interactive-clear",purge);window.addEventListener("offline",purge);window.addEventListener("pagehide",purge);document.addEventListener("visibilitychange",hidden);
  // Defer until mount settles: React StrictMode's setup/cleanup replay must
  // cancel the first start, not create/audit the same root request twice.
  const startup=window.setTimeout(()=>void request("/contexts",{values}),0);
  return()=>{window.clearTimeout(startup);alive.current=false;discard("");channel?.close();window.removeEventListener("uqp-interactive-clear",purge);window.removeEventListener("offline",purge);window.removeEventListener("pagehide",purge);document.removeEventListener("visibilitychange",hidden);};
 },[rootQueryId,accessToken]);
 const go=(edge:View["actions"][number],i:number)=>{if(view&&!busy)void request(`/contexts/${view.contextId}/navigate`,{edge:edge.id,rowRef:view.rowRefs[i]},edge.display);};
 const back=()=>{if(view&&!busy)void request(`/contexts/${view.contextId}/back`,{},"PAGE");};
 const page=(controls:Controls)=>{if(view&&!busy)void request(`/contexts/${view.contextId}/page`,controls);};
 const search=(e:FormEvent)=>{e.preventDefault();if(view)page({...view.controls,page:1,search:searchText?{column:searchColumn,text:searchText}:null});};
 const actions=(i:number)=><>{view?.actions.filter(a=>a.trigger==="MORE").length?<details onClick={e=>e.stopPropagation()}><summary className="secondary-button hierarchy-more-trigger">更多操作</summary>{view.actions.filter(a=>a.trigger==="MORE").map(a=><button className="secondary-button" key={a.id} type="button" disabled={busy} onClick={()=>go(a,i)}>{a.label}</button>)}</details>:null}</>;
 const cell=(row:Record<string,unknown>,c:View["columns"][number],i:number)=>{const action=view?.actions.find(a=>a.trigger==="COLUMN"&&a.columnKey===c.key),value=row[c.name];return action?<button className="hierarchy-cell-link" type="button" onClick={e=>{e.stopPropagation();go(action,i);}}>{value==null?"—":String(value)}</button>:value==null?"—":String(value);};
 return <section ref={container} tabIndex={-1} onKeyDown={e=>{if(mode!=="MODAL")return;if(e.key==="Escape"&&view&&view.depth>1){e.preventDefault();back();}if(e.key==="Tab"){const nodes=container.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input,select,summary,[tabindex=\"0\"]");if(nodes?.length){const first=nodes[0]!,last=nodes[nodes.length-1]!;if(e.shiftKey&&(document.activeElement===first||document.activeElement===container.current)){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}}} className={`hierarchy-workspace hierarchy-layer-${mode}${mode==="PAGE"&&view&&view.depth>1?" hierarchy-page-detail":""}`} role={mode==="PAGE"?"region":"dialog"} aria-modal={mode==="MODAL"?true:undefined} aria-label="多層資料查詢" aria-busy={busy}>
 <div className="hierarchy-heading section-title hierarchy-runtime-heading">
  <div><p className="hierarchy-eyebrow">多層資料查詢{view&&` · 第 ${view.depth} 層`}</p><h2>{view?.query.name??"多層資料查詢"}</h2>{view&&<p className="hierarchy-breadcrumb">{view.trail.join(" ／ ")}</p>}</div>
  <nav className="hierarchy-toolbar" aria-label="查詢層級操作"><button className="secondary-button" type="button" disabled={busy||!view||view.depth<2} onClick={back}>返回上一層</button><button className="secondary-button" type="button" onClick={()=>{discard("");exit.current();}}>關閉並清除查詢</button></nav>
 </div>
 {message&&<p className="form-error hierarchy-notice" role="alert">{message}</p>}{busy&&<p className="notice hierarchy-notice" role="status">伺服器驗權、查詢及稽核中…</p>}
 {!view&&!busy&&<button className="primary-button" type="button" onClick={()=>void request("/contexts",{values},"PAGE")}>重新回主層</button>}
 {view&&<><form className="hierarchy-search" onSubmit={search}><label>搜尋欄位<select aria-label="本層搜尋欄位" value={searchColumn} onChange={e=>setSearchColumn(e.target.value)}>{view.columns.filter(c=>c.canFilter).map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select></label><label>搜尋<input aria-label="本層搜尋" placeholder="輸入搜尋條件" value={searchText} maxLength={200} onChange={e=>setSearchText(e.target.value)}/></label><button className="primary-button" disabled={busy||!searchColumn} type="submit">伺服器搜尋</button></form>
 <div className="hierarchy-results-heading"><h3>查詢結果</h3><span>共 {view.pagination.totalRows.toLocaleString()} 筆 · 每頁 {view.pagination.pageSize} 筆</span></div>
 {view.layout==="TABLE"?<div className="runtime-table-wrap hierarchy-table-shell"><table><thead><tr>{view.columns.map(c=><th key={c.key} aria-sort={view.controls.sort?.column===c.key?(view.controls.sort.direction==="ASC"?"ascending":"descending"):undefined}>{c.canFilter?<button className="runtime-sort-button hierarchy-sort-button" type="button" onClick={()=>page({...view.controls,page:1,sort:{column:c.key,direction:view.controls.sort?.column===c.key&&view.controls.sort.direction==="ASC"?"DESC":"ASC"}})}>{c.label} {view.controls.sort?.column===c.key?(view.controls.sort.direction==="ASC"?"↑":"↓"):"↕"}</button>:c.label}</th>)}{view.actions.some(a=>a.trigger==="MORE")&&<th>操作</th>}</tr></thead><tbody>{view.result.rows.map((row,i)=>{const action=view.actions.find(a=>a.trigger==="ROW");return <tr key={view.rowRefs[i]} tabIndex={action?0:undefined} onClick={()=>action&&go(action,i)} onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==="Enter"||e.key===" ")&&action){e.preventDefault();go(action,i);}}}>{view.columns.map(c=><td key={c.key} className={c.alignment==="RIGHT"?"hierarchy-align-right":c.alignment==="CENTER"?"hierarchy-align-center":undefined}>{cell(row,c,i)}</td>)}{view.actions.some(a=>a.trigger==="MORE")&&<td>{actions(i)}</td>}</tr>;})}</tbody></table></div>:
 <div className="hierarchy-cards">{view.result.rows.map((row,i)=><article key={view.rowRefs[i]}>{view.actions.filter(a=>a.trigger==="ROW").map(a=><button className="primary-button" key={a.id} type="button" onClick={()=>go(a,i)}>{a.label}</button>)}<dl>{view.columns.map(c=><div key={c.key}><dt>{c.label}</dt><dd>{cell(row,c,i)}</dd></div>)}</dl>{actions(i)}</article>)}</div>}
 {!view.result.rows.length&&<p className="empty-state hierarchy-hint">本層沒有符合條件的資料。</p>}
 <nav className="runtime-pagination hierarchy-pagination" aria-label="本層分頁"><span className="runtime-page-size">共 {view.pagination.totalRows.toLocaleString()} 筆</span><div className="runtime-page-buttons"><button className="secondary-button" type="button" disabled={busy||view.pagination.page<=1} onClick={()=>page({...view.controls,page:view.pagination.page-1})}>上一頁</button><span>第 {view.pagination.page} / {view.pagination.totalPages} 頁</span><button className="secondary-button" type="button" disabled={busy||view.pagination.page>=view.pagination.totalPages} onClick={()=>page({...view.controls,page:view.pagination.page+1})}>下一頁</button></div></nav>
 {view.pagination.capped&&<p className="runtime-pagination-note" role="status">已達 Dataset 筆數上限，並非來源全部資料。</p>}<p className="hierarchy-hint">每頁由伺服器取得並重新稽核；欄位搜尋／排序僅限允許原始顯示的欄位。</p></>}
 </section>;
}
export function QueryHierarchyLauncher({queryId,values,accessToken,onStart}:{queryId:number;values:Record<string,unknown>;accessToken:string|null;onStart:()=>void}){
 const [available,setAvailable]=useState(false),[active,setActive]=useState<{values:Record<string,unknown>;token:string|null;queryId:number}|null>(null);
 useEffect(()=>{setAvailable(false);setActive(null);const c=new AbortController();void apiRequest<{available:boolean}>(`/queries/${queryId}/hierarchy/capabilities`,{signal:c.signal},accessToken).then(v=>{if(!c.signal.aborted)setAvailable(v.available===true);}).catch(()=>{});
  const clear=()=>setActive(null);window.addEventListener("uqp-interactive-clear",clear);window.addEventListener("uqp-hierarchy-close",clear);return()=>{c.abort();window.removeEventListener("uqp-interactive-clear",clear);window.removeEventListener("uqp-hierarchy-close",clear);};
 },[queryId,accessToken]);
 return <>{available&&!active&&<div className="hierarchy-launcher"><button className="secondary-button" type="button" onClick={()=>{onStart();setActive({values:structuredClone(values),token:accessToken,queryId});}}>開啟多層分頁查詢</button></div>}{active&&active.token===accessToken&&active.queryId===queryId&&<QueryHierarchyWorkspace rootQueryId={queryId} values={active.values} accessToken={accessToken} onExit={()=>setActive(null)}/>}</>;
}
