import {useEffect,useRef,useState} from "react";
import {apiRequest} from "../api/client";
type Rule={columnName:string;sensitivityType:string;deviceMaskMode:string};
type Snapshot={status:string;version:string|null;sensitivityVersion:number;definitionVersion:string;configurationVersion:string;policy:{grants:{columnName:string;permitted:boolean}[]}|null;confirmedBy:string|null;confirmedAtUtc:string|null};
const validSnapshot=(s:Snapshot)=>s&&["UNCONFIRMED","CONFIRMED","STALE"].includes(s.status)&&(s.version===null||/^[0-9a-f]{16}$/.test(s.version))&&Number.isSafeInteger(s.sensitivityVersion)&&s.sensitivityVersion>0&&/^[0-9a-f]{16}$/.test(s.definitionVersion)&&/^[0-9a-f]{16}$/.test(s.configurationVersion)&&(s.policy===null||Array.isArray(s.policy?.grants));
export function DatasetPublicDisplayEditor({datasetId,accessToken,sensitivityVersion,rules,dirty}:{datasetId:number;accessToken:string|null;sensitivityVersion:number|null;rules:Rule[];dirty:boolean}){
 const [value,setValue]=useState<Snapshot|null>(null),[selected,setSelected]=useState<string[]>([]),[changed,setChanged]=useState(false),[confirmed,setConfirmed]=useState(false),[conflict,setConflict]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const sequence=useRef(0),request=useRef<{id:string;body:string}|null>(null);
 const eligible=(r:Rule)=>r.deviceMaskMode!=="OMIT"&&(r.deviceMaskMode!=="NONE"||r.sensitivityType==="OTHER");
 const error=(e:unknown)=>{const c=(e as {code?:string})?.code;return `${c??"PUBLIC_DISPLAY_FAILED"}：${e instanceof Error?e.message:"操作失敗"}`;};
 const reload=async()=>{const seq=++sequence.current;setBusy(true);setMessage("");try{const s=await apiRequest<Snapshot>(`/datasets/${datasetId}/public-display-policy`,{},accessToken);if(!validSnapshot(s))throw new Error("公共政策回應不完整，維持未核准。");if(seq!==sequence.current)return;setValue(s);setSelected(s.policy?.grants.filter(g=>g.permitted).map(g=>g.columnName)??[]);setChanged(false);setConfirmed(false);setConflict(false);request.current=null;}catch(e){if(seq===sequence.current){setValue(null);setMessage(error(e));}}finally{if(seq===sequence.current)setBusy(false);}};
 useEffect(()=>{void reload();return()=>{sequence.current++;};},[datasetId,accessToken,sensitivityVersion]);
 const select=(names:string[])=>{setSelected(names);setChanged(true);setConfirmed(false);request.current=null;};
 const save=async()=>{if(!value||!confirmed||dirty||conflict)return;const seq=sequence.current;setBusy(true);try{
   const payload={expectedVersion:value.version,expectedSensitivityVersion:value.sensitivityVersion,expectedDefinitionVersion:value.definitionVersion,expectedConfigurationVersion:value.configurationVersion,confirm:true,grants:rules.map(r=>({columnName:r.columnName,permitted:eligible(r)&&selected.some(n=>n.toUpperCase()===r.columnName.toUpperCase())}))};
   const body=JSON.stringify(payload);if(request.current?.body!==body)request.current={id:crypto.randomUUID(),body};
   const result=await apiRequest<Snapshot>(`/datasets/${datasetId}/public-display-policy`,{method:"PUT",body:JSON.stringify({...payload,requestId:request.current.id})},accessToken);
   if(!validSnapshot(result))throw new Error("公共政策儲存結果不明，請重新載入確認。");if(seq!==sequence.current)return;setValue(result);setChanged(false);setConfirmed(false);request.current=null;setMessage("公共顯示政策已確認並完成稽核；沒有自動啟用 Dashboard 或裝置。");
  }catch(e){if(seq===sequence.current){setMessage(error(e));if((e as {code?:string}).code?.includes("VERSION_CONFLICT"))setConflict(true);}}finally{if(seq===sequence.current)setBusy(false);}};
 return <section aria-label="Dataset 公共顯示政策"><h3>Dataset 公共顯示政策</h3>
  <p>遮蔽方式與公開許可是兩項設定。只有明確核准且版本有效的欄位才能在 Query-only 公共播放中傳送；未設定、新增及 OMIT 欄位預設拒絕。設計預覽仍使用 Dataset 遮蔽。</p>
  <p role="status">{value?`狀態：${value.status==="CONFIRMED"?"已核准":value.status==="STALE"?"需重新確認":"未核准"}；敏感政策版本 ${value.sensitivityVersion}；確認版本 ${value.version??"尚無"}`:"公共政策不可用：尚未核准 Schema 或功能開關時保持拒絕。"}</p>
  {dirty&&<p role="status">請先儲存遮蔽規則，再確認公共顯示。</p>}
  <button type="button" disabled={!value||dirty||busy||conflict} onClick={()=>select(rules.filter(eligible).map(r=>r.columnName))}>勾選目前可公開欄位（仍須確認儲存）</button>
  <button type="button" disabled={!value||dirty||busy||conflict} onClick={()=>select([])}>取消所有公共顯示</button>
  {value&&<table><thead><tr><th>欄位</th><th>分類／遮蔽</th><th>允許公共顯示</th></tr></thead><tbody>{rules.map(r=><tr key={r.columnName}><td>{r.columnName}</td><td>{r.sensitivityType}／{r.deviceMaskMode}</td><td><input aria-label={`${r.columnName} 允許公共顯示`} type="checkbox" checked={eligible(r)&&selected.some(n=>n.toUpperCase()===r.columnName.toUpperCase())} disabled={!value||dirty||busy||conflict||!eligible(r)} onChange={e=>select(e.target.checked?[...selected,r.columnName]:selected.filter(n=>n.toUpperCase()!==r.columnName.toUpperCase()))}/></td></tr>)}</tbody></table>}
  <label><input type="checkbox" checked={confirmed} disabled={!value||dirty||busy||conflict} onChange={e=>setConfirmed(e.target.checked)}/>我確認所選欄位與遮蔽方式適合公共螢幕顯示</label>
  <button type="button" disabled={!value||dirty||busy||conflict||!confirmed||(!changed&&value.status==="CONFIRMED")} onClick={()=>void save()}>儲存公共顯示政策</button>
  <button type="button" disabled={busy} onClick={()=>{if(!changed||window.confirm("重新載入將捨棄公共顯示草稿，確定？"))void reload();}}>重新載入公共政策</button>
  {conflict&&<p role="alert">版本衝突：勾選草稿保留，請重新載入後確認。</p>}{message&&<p role="status">{message}</p>}
 </section>;
}
