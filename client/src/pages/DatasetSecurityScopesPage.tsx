import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { apiRequest } from "../api/client";
type Choice={id:string;name:string};
type Scope={userId:string;kind:"OWNER"|"REVIEWER";state:string;version:string;boundDataSourceId:string;parentOwnerUserId:string|null;effective:boolean};
type Snapshot={dataset:{id:string;name:string;dataSourceId:string;definitionVersion:string;configurationVersion:string;active:boolean};scopes:Scope[]};
const validId=(s:string)=>/^[1-9][0-9]{0,18}$/.test(s)&&BigInt(s)<=9223372036854775807n;
function requestUuid(){
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]!&15)|64;bytes[8]=(bytes[8]!&63)|128;
  const h=Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export function DatasetSecurityScopesPage(){
  const {accessToken}=useAuth();
  const [choices,setChoices]=useState<{datasets:Choice[];users:Choice[]}>({datasets:[],users:[]});
  const [search,setSearch]=useState(""),[datasetId,setDatasetId]=useState(""),[userId,setUserId]=useState(""),[kind,setKind]=useState<Scope["kind"]>("OWNER");
  const [ownerId,setOwnerId]=useState(""),[snapshot,setSnapshot]=useState<Snapshot|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const current=useRef({datasetId,accessToken});current.current={datasetId,accessToken};
  const [uncertain,setUncertain]=useState(false);
  const [history,setHistory]=useState<Array<{decisionId:string;auditLogId:string;requestId:string;action:string;userId:string}>>([]);
  useEffect(()=>{const controller=new AbortController();setSnapshot(null);setChoices({datasets:[],users:[]});
    apiRequest<{datasets:Choice[];users:Choice[]}>(`/dataset-security/options?search=${encodeURIComponent(search)}`,{signal:controller.signal},accessToken)
      .then(r=>{if(!controller.signal.aborted)setChoices(r);}).catch(e=>{if(!controller.signal.aborted)setMessage(e.message);});
    return()=>controller.abort();
  },[accessToken,search]);
  useEffect(()=>{const controller=new AbortController();setSnapshot(null);setOwnerId("");setUserId("");setHistory([]);
    if(validId(datasetId))apiRequest<Snapshot>(`/dataset-security/datasets/${datasetId}/scopes`,{signal:controller.signal},accessToken)
      .then(r=>{if(!controller.signal.aborted)setSnapshot(r);}).catch(e=>{if(!controller.signal.aborted)setMessage(e.message);});
    return()=>controller.abort();
  },[accessToken,datasetId]);
  async function load(){setSnapshot(null);if(validId(datasetId)){const result=await apiRequest<Snapshot>(`/dataset-security/datasets/${datasetId}/scopes`,{},accessToken);if(current.current.datasetId===datasetId&&current.current.accessToken===accessToken)setSnapshot(result);}}
  async function mutate(action:"GRANT"|"REVOKE",subject=userId,scopeKind=kind){
    if(!snapshot||snapshot.dataset.id!==datasetId||busy||uncertain||!validId(subject))return;
    const old=snapshot.scopes.find(s=>s.userId===subject&&s.kind===scopeKind);
    const parent=action==="GRANT"&&scopeKind==="REVIEWER"?snapshot.scopes.find(s=>s.userId===ownerId&&s.kind==="OWNER"&&s.effective):null;
    if(action==="GRANT"&&scopeKind==="REVIEWER"&&!parent){setMessage("請選擇有效 Owner。");return;}
    let requestId:string;
    try{requestId=requestUuid();}catch{setMessage("瀏覽器無法提供安全亂數，請使用受支援的瀏覽器。");return;}
    setBusy(true);setMessage("");
    try{
      await apiRequest(`/dataset-security/datasets/${datasetId}/scopes/${scopeKind}/${subject}`,{method:"PUT",body:JSON.stringify({
        requestId,action,expectedVersion:old?.version??"MISSING",definitionVersion:snapshot.dataset.definitionVersion,configurationVersion:snapshot.dataset.configurationVersion,
        parentOwnerUserId:parent?.userId??null,parentOwnerVersion:parent?.version??null,
      })},accessToken);
      setMessage(action==="GRANT"?"已指派；查詢預覽仍需其他安全條件。":"已撤銷指派。");await load();
    }catch(e){
      const error=e as Error&{code?:string};setSnapshot(null);
      if(!error.code||["SCOPE_COMMIT_UNKNOWN","SCOPE_ROLLBACK_UNKNOWN"].includes(error.code)){
        setUncertain(true);setMessage(`${error.message} 請保留 RequestId：${requestId}，由管理員查證後再操作。`);
      }else {setMessage(error.message);}
    }finally{setBusy(false);}
  }
  return <main className="page-shell"><Link to="/">返回首頁</Link><h1>Dataset 負責人指派</h1>
    <p>須有效 SYSTEM_ADMIN 與獨立管理能力。指派不會開啟資料預覽、來源發證或資料交付。</p>
    <p role="status">{message}</p>
    <label>搜尋 Dataset<input value={search} disabled={busy} onChange={e=>{setSearch(e.target.value);setDatasetId("");}} /></label>
    <label>Dataset<select value={datasetId} disabled={busy} onChange={e=>setDatasetId(e.target.value)}><option value="">請選擇</option>{choices.datasets.map(d=><option key={d.id} value={d.id}>{d.name}（{d.id}）</option>)}</select></label>
    <p>選單最多列出 100 筆；可搜尋 Dataset，或輸入已核對的精確 ID。</p>
    <label>Dataset ID<input value={datasetId} disabled={busy} onChange={e=>setDatasetId(e.target.value)} /></label>
    {snapshot&&<><h2>{snapshot.dataset.name}</h2><p>目前來源 ID：{snapshot.dataset.dataSourceId}</p>
      <label>受指派使用者<select value={userId} disabled={busy} onChange={e=>setUserId(e.target.value)}><option value="">請選擇具確認能力的帳號</option>{choices.users.map(u=><option key={u.id} value={u.id}>{u.name}（{u.id}）</option>)}</select></label>
      <label>使用者 ID<input value={userId} disabled={busy} onChange={e=>setUserId(e.target.value)} /></label>
      <label>指派類型<select value={kind} disabled={busy} onChange={e=>{setKind(e.target.value as Scope["kind"]);setOwnerId("");}}><option value="OWNER">Owner</option><option value="REVIEWER">Reviewer</option></select></label>
      {kind==="REVIEWER"&&<label>有效 Owner<select value={ownerId} disabled={busy} onChange={e=>setOwnerId(e.target.value)}><option value="">請選擇</option>{snapshot.scopes.filter(s=>s.kind==="OWNER"&&s.effective).map(s=><option key={s.userId} value={s.userId}>{s.userId}</option>)}</select></label>}
      <button type="button" disabled={busy||uncertain||!snapshot.dataset.active||!validId(userId)||(kind==="REVIEWER"&&!ownerId)} onClick={()=>void mutate("GRANT")}>確認指派</button>
      <ul>{snapshot.scopes.map(s=><li key={`${s.userId}:${s.kind}`}>{s.userId} / {s.kind}：{s.effective?"有效":"已撤銷或版本失效"}{s.parentOwnerUserId&&` / Owner ${s.parentOwnerUserId}`} <button type="button" disabled={busy||uncertain||s.state==="REVOKED"} onClick={()=>void mutate("REVOKE",s.userId,s.kind)}>撤銷 {s.userId} {s.kind}</button></li>)}</ul>
    </>}
    <button type="button" disabled={busy||!validId(datasetId)} onClick={()=>void load().catch(e=>setMessage(e.message))}>重新載入指派</button>
    <button type="button" disabled={busy||!validId(datasetId)} onClick={()=>void apiRequest<{decisions:typeof history}>(`/dataset-security/datasets/${datasetId}/decisions`,{},accessToken).then(r=>{if(current.current.datasetId===datasetId&&current.current.accessToken===accessToken)setHistory(r.decisions);}).catch(e=>{setHistory([]);setMessage(e.message);})}>查看最近決策</button>
    {history.length>0&&<section><h2>決策紀錄</h2><p>稽核 ID 為關聯參照，並非永久保存證明。</p><ul>{history.map(h=><li key={h.decisionId}>{h.action} / {h.userId} / RequestId {h.requestId} / Decision {h.decisionId} / Audit {h.auditLogId}</li>)}</ul></section>}
  </main>;
}
