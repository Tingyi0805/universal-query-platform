import {useEffect,useRef,useState} from "react";
import {apiRequest} from "../api/client";
import {parseTaipeiDateTime} from "../dashboard/taipeiDateTime";
import {deviceHistoryLabels,trustedDeviceHistory,taipeiHistoryHour,type DeviceHistory,type HistoryFilters} from "../dashboard/deviceHistory";
import "../pages/AuditLogPage.css";
const initial:HistoryFilters={source:"LIVE",eventType:"",startDate:"",endDate:"",username:"",pageSize:20};
export function DashboardDeviceHistory({dashboardId,deviceId,deviceName,accessToken,onClose}:{dashboardId:number;deviceId:number;deviceName:string;accessToken:string|null;onClose:()=>void}){
 const [draft,setDraft]=useState(initial),[query,setQuery]=useState({...initial,page:1,revision:0});
 const [data,setData]=useState<DeviceHistory|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true);
 const dialog=useRef<HTMLDialogElement>(null),sequence=useRef(0),request=useRef<AbortController|null>(null);
 useEffect(()=>{dialog.current?.showModal();const hide=()=>onClose();window.addEventListener("pagehide",hide);return()=>{window.removeEventListener("pagehide",hide);request.current?.abort();++sequence.current;};},[onClose]);
 useEffect(()=>{
  const current=++sequence.current,controller=new AbortController();request.current?.abort();request.current=controller;setData(null);setError("");setLoading(true);
  const params=new URLSearchParams({source:query.source,page:String(query.page),pageSize:String(query.pageSize)});
  for(const key of ["eventType","startDate","endDate","username"] as const)if(query[key])params.set(key,query[key]);
  void apiRequest<DeviceHistory>(`/dashboards/${dashboardId}/device-management/v1/${deviceId}/history?${params}`,{signal:controller.signal},accessToken).then(value=>{
   if(current===sequence.current&&!controller.signal.aborted)setData(trustedDeviceHistory(value,dashboardId,deviceId,query.source,query.page,query.pageSize));
  }).catch((e:unknown)=>{if(current!==sequence.current||controller.signal.aborted)return;const status=(e as {status?:number}).status;setError(status===401||status===403?"權限不足或登入已失效，無法查看操作歷史。":status===404?"找不到此看板的指定裝置，無法查看操作歷史。":"操作歷史讀取失敗，請重試。");}).finally(()=>{if(current===sequence.current)setLoading(false);});
  return()=>{controller.abort();++sequence.current;};
 },[dashboardId,deviceId,accessToken,query]);
 function apply(next=draft){
  ++sequence.current;request.current?.abort();setData(null);
  try{for(const day of [next.startDate,next.endDate])if(day){parseTaipeiDateTime(`${day} 00:00`);if(Number(day.slice(0,4))>9998)throw new Error();}if(next.startDate&&next.endDate&&next.startDate>next.endDate)throw new Error();}
  catch{setLoading(false);setError("請輸入有效日期，起日不可晚於迄日。");return;}
  setQuery({...next,username:next.username.trim(),page:1,revision:query.revision+1});
 }
 function choose(patch:Partial<HistoryFilters>){const next={...draft,...patch};setDraft(next);apply(next);}
 return <dialog className="uqp-device-history" ref={dialog} aria-label="裝置操作歷史" onCancel={e=>{e.preventDefault();onClose();}}>
  <h3>{deviceName}（裝置 {deviceId}）操作歷史</h3>
  <button type="button" onClick={onClose}>關閉操作歷史</button>
  <p>僅顯示已留存的稽核紀錄；未提交或回滾的失敗操作可能沒有紀錄。線上與封存分開查詢，並受保留政策限制。操作時間固定 Asia/Taipei；完成註冊的操作人員依既有稽核歸屬顯示委派者。</p>
  <form className="audit-filter" aria-label="操作歷史篩選" onSubmit={e=>{e.preventDefault();apply();}}>
   <label>資料區<select aria-label="歷史資料區" value={draft.source} onChange={e=>choose({source:e.target.value as HistoryFilters["source"]})}><option value="LIVE">線上 LIVE</option><option value="ARCHIVE">封存 ARCHIVE</option></select></label>
   <label>操作類型<select aria-label="歷史操作類型" value={draft.eventType} onChange={e=>choose({eventType:e.target.value})}><option value="">全部操作</option>{Object.entries(deviceHistoryLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label>起日（Asia/Taipei）<input type="date" aria-label="歷史起日" value={draft.startDate} onChange={e=>setDraft({...draft,startDate:e.target.value})}/></label>
   <label>迄日（含當日）<input type="date" aria-label="歷史迄日" value={draft.endDate} onChange={e=>setDraft({...draft,endDate:e.target.value})}/></label>
   <label>操作人員帳號<input aria-label="歷史操作人員" maxLength={100} value={draft.username} onChange={e=>setDraft({...draft,username:e.target.value})}/></label>
   <label>每頁筆數<select aria-label="歷史每頁筆數" value={draft.pageSize} onChange={e=>choose({pageSize:Number(e.target.value)})}>{[10,20,50,100].map(n=><option key={n}>{n}</option>)}</select></label>
   <button type="submit">查詢操作歷史</button>
  </form>
  {loading&&<p role="status">操作歷史載入中…</p>}
  {error&&<div role="alert">{error}<button type="button" onClick={()=>apply()}>重試操作歷史</button></div>}
  {data&&<>
   <p>共 {data.total} 筆，最新操作優先；第 {data.page}／{Math.max(1,Math.ceil(data.total/data.pageSize))} 頁。</p>
   {data.items.length===0?<p role="status">沒有符合條件的操作歷史。</p>:<table className="preview-table history-table"><thead><tr><th>操作時間</th><th>操作項目</th><th>操作人員</th><th>執行結果</th><th>詳細資訊</th></tr></thead><tbody>{data.items.map(item=><tr key={item.id}>
    <td data-label="操作時間">{taipeiHistoryHour(item.createdAtUtc)}</td><td data-label="操作項目">{deviceHistoryLabels[item.eventType]}</td><td data-label="操作人員">{item.displayName||item.username||"未知使用者"}{item.displayName&&item.username&&<small>（{item.username}）</small>}</td>
    <td data-label="執行結果"><span className={`audit-status ${item.status.toLowerCase()}`}>{item.status==="SUCCESS"?"成功":item.status==="FAILED"?"失敗":"未完成"}</span></td><td data-label="詳細資訊">Audit ID：{item.id}{item.errorCode&&<div>錯誤碼：{item.errorCode}</div>}</td>
   </tr>)}</tbody></table>}
   <nav className="audit-pagination" aria-label="操作歷史分頁"><button type="button" disabled={data.page<=1} onClick={()=>setQuery(q=>({...q,page:q.page-1}))}>上一頁歷史</button><button type="button" disabled={data.page*data.pageSize>=data.total||data.page*data.pageSize>1_000_000} onClick={()=>setQuery(q=>({...q,page:q.page+1}))}>下一頁歷史</button></nav>
  </>}
 </dialog>;
}
