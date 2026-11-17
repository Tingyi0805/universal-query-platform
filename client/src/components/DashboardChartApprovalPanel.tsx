import {newNativeChartRequestId} from "../dashboard/nativeChartCreate";
import {useEffect,useRef,useState} from "react";
import {apiRequest} from "../api/client";
type Status={sealed:boolean;revision:string;playbackStatus:string;privacyReview:null|{id:number;status:string;revision:string;requestedBy:number}};
export function DashboardChartApprovalPanel({dashboardId,widgetId,accessToken,canManage}:{dashboardId:number;widgetId:number;accessToken:string|null;canManage:boolean}){
 const [state,setState]=useState<Status|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const [minimum,setMinimum]=useState(5),[category,setCategory]=useState(false),[difference,setDifference]=useState(false);
 const base=`/dashboards/${dashboardId}/charts/v1/${widgetId}`;
 const identity=`${base}|${accessToken}|${canManage}`;
 const active=useRef(identity);active.current=identity;
 const lifetime=useRef({alive:true,sequence:0,pending:new Set<AbortController>()});
 const current=()=>lifetime.current.alive&&active.current===identity;
 async function request<T>(path:string,options:RequestInit={}){
  const controller=new AbortController();lifetime.current.pending.add(controller);
  try{return await apiRequest<T>(path,{...options,signal:controller.signal},accessToken,current);}
  finally{lifetime.current.pending.delete(controller);}
 }
 async function load(){const sequence=++lifetime.current.sequence;setState(null);
 try{const r=await request<Status>(base+"/status");
  if(!current()||sequence!==lifetime.current.sequence)return false;
  if(r?.sealed!==true||!/^([a-f0-9]{16})$/.test(r.revision)||!["UNCONFIRMED","APPROVED","REVOKED"].includes(r.playbackStatus)||
   r.privacyReview!==null&&(!Number.isSafeInteger(r.privacyReview?.id)||r.privacyReview.id<1||
   !Number.isSafeInteger(r.privacyReview.requestedBy)||r.privacyReview.requestedBy<1||
   !["REQUESTED","APPROVED"].includes(r.privacyReview.status)||!/^([a-f0-9]{16})$/.test(r.privacyReview.revision)))throw Error("INVALID_STATUS");
  setState(r);setMessage("");return true;
 }catch{if(current()&&sequence===lifetime.current.sequence)setMessage("尚未開放已授權測試，或核准狀態無法驗證；停止圖表交付。");return false;}}
 useEffect(()=>{
  lifetime.current.alive=true;setState(null);setBusy(false);setCategory(false);setDifference(false);
  if(canManage)void load();
  return()=>{lifetime.current.alive=false;lifetime.current.sequence++;for(const c of lifetime.current.pending)c.abort();};
 },[dashboardId,widgetId,accessToken,canManage]);
 async function decide(path:string,body:unknown){setBusy(true);setMessage("");try{
  await request(base+path,{method:"POST",body:JSON.stringify(body)});
  if(current()&&await load())setMessage("已重新讀取伺服器決策；播放仍須通過當下權限、公開政策及稽核。");
 }catch{if(current()){setState(null);setMessage("決策未獲確認，請重新載入；不要自動重試。公開彙總核准需不同於申請人的 SYSTEM_ADMIN。");}}
 finally{if(current())setBusy(false);}}
 if(!canManage)return null;
 return <section className="notice"><h3>受控圖表核准與撤銷</h3>
 <button type="button" disabled={busy} onClick={()=>void load()}>重新載入圖表核准</button>
 {message&&<p role="status">{message}</p>}
 {state&&<><p>Seal：{state.revision}；播放：{state.playbackStatus}；公開彙總：{state.privacyReview?.status??"未申請"}</p>
 <button type="button" disabled={busy} onClick={()=>void decide("/playback-approval",{action:"APPROVE"})}>核准此版本圖表播放</button>
 <button type="button" disabled={busy||state.playbackStatus!=="APPROVED"} onClick={()=>void decide("/playback-approval",{action:"REVOKE"})}>撤銷圖表播放</button>
 <p>一般使用者／裝置播放還須 Dataset 公開顯示政策及獨立彙總隱私審查；設計者不能替另一個帳號取得權限。</p>
 {!state.privacyReview&&<button type="button" disabled={busy} onClick={()=>void decide("/privacy-review",{action:"REQUEST",requestId:newNativeChartRequestId()})}>申請公開彙總審查</button>}
 {state.privacyReview?.status==="REQUESTED"&&<>
 <label>最小群組筆數<input type="number" min={5} max={1000} value={minimum} onChange={e=>setMinimum(Number(e.target.value))}/></label>
 <label><input type="checkbox" checked={category} onChange={e=>setCategory(e.target.checked)}/>已審查分類欄位及群組隱私</label>
 <label><input type="checkbox" checked={difference} onChange={e=>setDifference(e.target.checked)}/>已審查重複播放與差分揭露風險</label>
 <button type="button" disabled={busy||!category||!difference||!Number.isInteger(minimum)||minimum<5||minimum>1000}
 onClick={()=>void decide("/privacy-review",{action:"APPROVE",requestId:newNativeChartRequestId(),reviewId:state.privacyReview!.id,
 expectedRevision:state.privacyReview!.revision,minimumCellCount:minimum,validDays:30,categoryPrivacyReviewed:true,differencingRiskReviewed:true})}>以獨立審查人核准彙總</button></>}
 {state.privacyReview?.status==="APPROVED"&&<button type="button" disabled={busy} onClick={()=>void decide("/privacy-review",{
 action:"REVOKE",requestId:newNativeChartRequestId(),reviewId:state.privacyReview!.id,expectedRevision:state.privacyReview!.revision})}>撤銷公開彙總審查</button>}
 </>}
 </section>;
}
