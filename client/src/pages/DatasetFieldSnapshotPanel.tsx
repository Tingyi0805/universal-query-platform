import {useState} from "react";
import {apiRequest} from "../api/client";
type Status={dataset:{definitionVersion:string;configurationVersion:string};collectorConfigured:boolean;
  trust:"UNBOUND_CANDIDATE";deliveryAllowed:false;sourceFence:"BLOCKED_PRIVILEGED_DDL_PATHS";
  snapshot:null|{id:string;state:string;version:string;current:boolean;columns:{name:string;dataType:string;ordinal:number}[]}};
export function DatasetFieldSnapshotPanel({datasetId,token,enabled}:{datasetId:number;token:string|null;enabled:boolean}){
  const safeId=Number.isSafeInteger(datasetId)&&datasetId>0;
  const [status,setStatus]=useState<Status|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
  const load=async()=>{if(!safeId)throw Error("Designer 無法精確表示此 Dataset ID，停止 Metadata 操作；請使用精確 BIGINT 介面查核。");setStatus(null);const s=await apiRequest<Status>(`/dataset-field-initialization/${datasetId}`,{},token);
    if(s.trust!=="UNBOUND_CANDIDATE"||s.deliveryAllowed!==false||s.sourceFence!=="BLOCKED_PRIVILEGED_DDL_PATHS")throw Error("欄位證據格式不符，停止初始化。");setStatus(s);};
  const collect=async()=>{if(!status||busy||uncertain)return;let requestId:string;
    try{const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]!&15)|64;b[8]=(b[8]!&63)|128;
      const h=Array.from(b,x=>x.toString(16).padStart(2,"0")).join("");requestId=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
    }catch{setMessage("瀏覽器無安全亂數，停止收集。");return;}setBusy(true);
    try{await apiRequest(`/dataset-field-initialization/${datasetId}`,{method:"POST",body:JSON.stringify({requestId,
      definitionVersion:status.dataset.definitionVersion,configurationVersion:status.dataset.configurationVersion,expectedSnapshotVersion:status.snapshot?.version??"MISSING"})},token);
      await load();setMessage("候選描述已保存；Source Fence 仍 BLOCKED，不是已確認的分類政策。");
    }catch(e){setUncertain(true);setStatus(null);setMessage(`${(e as Error).message} RequestId：${requestId}，請查證後再操作。`);}finally{setBusy(false);}};
  return <section aria-label="已儲存欄位 Snapshot"><h3>已儲存欄位 Snapshot</h3>
    <p>Source Fence：BLOCKED。受控 Gate 無法保證外部 DBA 路徑；不開放資料列、不更新敏感欄位政策。</p>
    <button type="button" disabled={!enabled||!safeId||busy} onClick={()=>{setBusy(true);void load().catch(e=>setMessage(e.message)).finally(()=>setBusy(false));}}>查詢欄位 Snapshot 狀態</button>
    {!safeId&&<p role="alert">Dataset ID 超出 Designer 安全整數範圍，停止操作，禁止 Number 精度修復。</p>}
    {!enabled&&<p>需有效 Owner／Reviewer Scope 與明確資料分類確認能力；請先儲存 Dataset。</p>}
    <p role="status">{message}</p>
    {status&&<><p>{status.snapshot?.state??"NOT_INITIALIZED"} · UNBOUND_CANDIDATE · 分類未確認</p>
      {!status.collectorConfigured&&<p>尚無核准的 Source Provider，初始化保持 BLOCKED。</p>}
      {status.snapshot&&!status.snapshot.current&&<p role="alert">Dataset／來源版本已失效。保留歷史欄位與原政策，不得用於交付。</p>}
      {status.snapshot&&<table><thead><tr><th>順序</th><th>欄位名稱</th><th>SQL 型別</th></tr></thead><tbody>{status.snapshot.columns.map(c=><tr key={c.ordinal}><td>{c.ordinal}</td><td>{c.name}</td><td>{c.dataType}</td></tr>)}</tbody></table>}
      <button type="button" disabled={busy||uncertain||!status.collectorConfigured} onClick={()=>void collect()}>保存候選欄位描述（非可信發證）</button></>}
  </section>;
}
