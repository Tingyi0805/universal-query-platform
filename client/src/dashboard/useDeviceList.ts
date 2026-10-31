import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api/client";
import { trustedDeviceList, type DeviceList, type ListStatus } from "./deviceList";
export function useDeviceList(dashboardId:number,accessToken:string|null,allowed:boolean) {
  const [query,setQuery]=useState({search:"",status:"ALL" as ListStatus,pageSize:20,page:1,revision:0});
  const [view,setView]=useState<{id:number;token:string|null;data:DeviceList}|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const sequence=useRef(0),request=useRef<AbortController|null>(null),snapshot=useRef<string|null>(null);
  const recovering=useRef(false);
  const identity=useRef({dashboardId,accessToken});
  function invalidate(){++sequence.current;request.current?.abort();snapshot.current=null;setView(null);setError("");}
  function reset(next?:Partial<Pick<typeof query,"search"|"status"|"pageSize">>,recovery=false){recovering.current=recovery;invalidate();setQuery(q=>({...q,...next,page:1,revision:q.revision+1}));}
  useEffect(()=>{
    const changed=identity.current.dashboardId!==dashboardId||identity.current.accessToken!==accessToken;
    identity.current={dashboardId,accessToken};
    if(changed){setNotice("");reset({search:"",status:"ALL",pageSize:20});return;}
    const current=++sequence.current,controller=new AbortController();request.current?.abort();request.current=controller;
    setView(null);setError("");setLoading(true);
    if(!allowed){snapshot.current=null;setError("權限不足，無法讀取裝置清單。");setLoading(false);return;}
    const token=query.page===1?undefined:snapshot.current??undefined;
    if(query.page>1&&!token){reset();return;}
    const params=new URLSearchParams({search:query.search,status:query.status,page:String(query.page),pageSize:String(query.pageSize),...(token?{snapshot:token}:{})});
    void apiRequest<DeviceList>(`/dashboards/${dashboardId}/device-management/v1/list?${params}`,{signal:controller.signal},accessToken).then(value=>{
      if(current!==sequence.current||controller.signal.aborted)return;
      const data=trustedDeviceList(value,dashboardId,query.page,query.pageSize,token);
      recovering.current=false;
      if(query.page===1)snapshot.current=data.snapshot;
      setView({id:dashboardId,token:accessToken,data});
    }).catch((e:unknown)=>{
      if(current!==sequence.current||controller.signal.aborted)return;
      snapshot.current=null;setView(null);
      const failure=e as {status?:number;code?:string};
      if(failure.status===409&&failure.code==="DASHBOARD_DEVICE_LIST_CHANGED"){
        setNotice("清單已更新或已到期，已清除舊清單，重新從第一頁載入。");
        if(!recovering.current){reset(undefined,true);return;}
      }
      setError(failure.status===401||failure.status===403?"權限不足或登入已失效，無法讀取裝置清單。":"裝置清單讀取失敗，請重試。");
    }).finally(()=>{if(current===sequence.current)setLoading(false);});
    return()=>{controller.abort();++sequence.current;};
  },[dashboardId,accessToken,allowed,query]);
  useEffect(()=>{const hide=()=>{invalidate();setLoading(false);setError("請重新載入裝置清單。");};window.addEventListener("pagehide",hide);return()=>window.removeEventListener("pagehide",hide);},[]);
  const data=allowed&&view?.id===dashboardId&&view.token===accessToken?view.data:null;
  return {query,data,loading,error,notice,reset,change:(next:Partial<Pick<typeof query,"search"|"status"|"pageSize">>)=>{setNotice("");reset(next);},go:(page:number)=>{
    if(loading||!data||!snapshot.current||page<1||page>Math.ceil(data.total/data.pageSize)||(page-1)*data.pageSize>1_000_000)return;
    ++sequence.current;request.current?.abort();setView(null);setQuery(q=>({...q,page}));
  }};
}
