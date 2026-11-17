import {useCallback,useEffect,useRef,useState} from "react";
import {apiRequest} from "../api/client";
import {newNativeChartRequestId} from "../dashboard/nativeChartCreate";
type Scope={
 widgetId:number;sourceKey:string;categoryColumn:string;valueColumn:string;
 currentApproval:boolean;
 review:null|{id:number;status:"REQUESTED"|"APPROVED";revision:string;requestedBy:number};
};
type Summary={dashboardId:number;dashboardEnabled:boolean;items:Scope[]};
const valid=(data:Summary,id:number)=>data&&data.dashboardId===id&&
 typeof data.dashboardEnabled==="boolean"&&Array.isArray(data.items)&&data.items.length<=100&&
 data.items.every(item=>Number.isSafeInteger(item.widgetId)&&item.widgetId>0&&
 typeof item.sourceKey==="string"&&typeof item.categoryColumn==="string"&&
 typeof item.valueColumn==="string"&&typeof item.currentApproval==="boolean"&&
 (item.review===null||(Number.isSafeInteger(item.review?.id)&&
 /^[a-f0-9]{16}$/.test(item.review.revision)&&
 ["REQUESTED","APPROVED"].includes(item.review.status)&&
 Number.isSafeInteger(item.review.requestedBy))));
/** One Dashboard-level list for shared Chart privacy scope reviews.
 * These are DATA privacy decisions only, never per-widget playback switches.
 * No patient rows, SQL, chart configs or locally forged authorizations.
 */
export function DashboardChartPrivacySummary({dashboardId,accessToken,actorUserId}:{
 dashboardId:number;accessToken:string|null;actorUserId:number|null;
}){
 const [summary,setSummary]=useState<Summary|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [minCell,setMinCell]=useState(5);
 const [checkedCategory,setCheckedCategory]=useState(false);
 const [checkedDifference,setCheckedDifference]=useState(false);
 const seq=useRef(0);
 const [reload,setReload]=useState(0);
 const load=useCallback(async()=>{
  const seqNo=++seq.current;
  setError("");
  try{
   const next=await apiRequest<Summary>(
    `/dashboards/${dashboardId}/charts/v1/privacy-summary`,{},accessToken);
   if(seqNo!==seq.current)return;
   if(!valid(next,dashboardId))throw Error("INVALID_PRIVACY_SUMMARY");
   setSummary(next);
  }catch{
   if(seqNo===seq.current){setSummary(null);
    setError("公開統計審查狀態無法驗證；不會自動核准或開放播放。");}
  }
 },[dashboardId,accessToken]);
 useEffect(()=>{void load();return()=>{seq.current++;};},[load,reload]);
 const apply=async(widgetId:number,body:Record<string,unknown>)=>{
  if(busy)return;
  setBusy(true);setError("");
  try{
   await apiRequest(
    `/dashboards/${dashboardId}/charts/v1/${widgetId}/privacy-review`,
    {method:"POST",body:JSON.stringify(body)},accessToken);
   await load();
  }catch{
   setSummary(null);
   setError("統計來源審查操作未獲確認。請重新載入確認，勿直接重送。");
  }finally{setBusy(false);}
 };
 const approved=summary?.items.filter(item=>item.currentApproval).length??0;
 return <details className="notice" aria-label="Dashboard 公開統計資料審查">
  <summary>Dashboard 公開統計資料審查
   {summary&&`（${approved}/${summary.items.length} 個來源已符合）`}</summary>
  <p>圖表啟用、停用與播放沿用 Dashboard。此處僅檢查公開統計來源的隱私政策，相同來源只審查一次；不會修改 CHART Seal。</p>
  <button type="button" disabled={busy} onClick={()=>setReload(n=>n+1)}>重新讀取統計審查</button>
  {error&&<p role="alert">{error}</p>}
  {summary&&!summary.dashboardEnabled&&<p>Dashboard 尚未啟用 Query-only；統計審查不代表圖表可以播放。</p>}
  {summary?.items.length===0&&<p>此 Dashboard 目前沒有需要審查的已儲存 CHART。</p>}
  {summary?.items.map(item=><section key={`${item.sourceKey}:${item.categoryColumn}:${item.valueColumn}`} className="notice">
   <p><strong>來源：{item.sourceKey}</strong>；分類：{item.categoryColumn}；統計：{item.valueColumn}</p>
   {item.currentApproval?<p>公開統計審查有效；播放仍由 Dashboard 與即時資料政策決定。</p>:
     <p>{item.review?.status==="REQUESTED"?"已提出審查申請，尚未核准":
       item.review?.status==="APPROVED"?"原審查已失效或統計來源版本改變":"尚未完成公開統計審查"}</p>}
   {!item.review&&<button type="button" disabled={busy||!summary.dashboardEnabled}
     onClick={()=>void apply(item.widgetId,{action:"REQUEST",requestId:newNativeChartRequestId()})}>申請此統計來源的公開顯示審查</button>}
   {item.review?.status==="REQUESTED"&&<>
    {actorUserId===item.review.requestedBy&&<p>依既有安全政策，審查者不能與申請者相同。可維持 Dashboard 內部測試；未通過審查前不會公開播放。</p>}
    <label>最低群組筆數
     <input type="number" min={5} max={1000} value={minCell}
      onChange={e=>setMinCell(Number(e.target.value))}/></label>
    <label><input type="checkbox" checked={checkedCategory}
      onChange={e=>setCheckedCategory(e.target.checked)}/>已確認分類欄位及小群組資料風險</label>
    <label><input type="checkbox" checked={checkedDifference}
      onChange={e=>setCheckedDifference(e.target.checked)}/>已確認重複播放與跨時段差分風險</label>
    <button type="button" disabled={busy||actorUserId===item.review.requestedBy||
      !checkedCategory||!checkedDifference||!Number.isInteger(minCell)||minCell<5||minCell>1000}
      onClick={()=>void apply(item.widgetId,{
       action:"APPROVE",requestId:newNativeChartRequestId(),
       reviewId:item.review!.id,expectedRevision:item.review!.revision,
       minimumCellCount:minCell,validDays:30,
       categoryPrivacyReviewed:true,differencingRiskReviewed:true,
      })}>審核此統計來源</button>
   </>}
   {item.review?.status==="APPROVED"&&<button type="button" disabled={busy}
    onClick={()=>void apply(item.widgetId,{
     action:"REVOKE",requestId:newNativeChartRequestId(),
     reviewId:item.review!.id,expectedRevision:item.review!.revision
    })}>撤銷此統計來源的公開審查</button>}
  </section>)}
 </details>;
}
