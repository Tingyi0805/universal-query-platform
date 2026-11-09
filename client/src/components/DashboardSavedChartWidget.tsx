import {useEffect,useRef,useState} from "react";
import {apiRequest} from "../api/client";
import {
  parseChartProjection,type ChartProjection,
} from "../dashboard/chartProjection";
import {sealedChartProjectionPath} from "../dashboard/nativeChartPlayback";
import {DashboardChartProjection} from "./DashboardChartProjection";
import "./DashboardSavedChartWidget.css";

// Revalidate the trusted server projection even without a layout version change.
// The last snapshot is hidden while an authorization recheck is in flight.
export const CHART_PROJECTION_RECHECK_MS=30_000 as const;

type Props=Readonly<{
  dashboardId:number;widgetId:number;
  accessToken:string|null;
  authorized:boolean;
  refreshKey:string;
}>;

type Loaded=Readonly<{
  dashboardId:number;widgetId:number;accessToken:string;
  refreshKey:string;authorizationGeneration:number;recheckEpoch:number;
  projection:ChartProjection|null;failed:boolean;
}>;

/** Native saved-Widget rendering in the real Dashboard playback canvas.
 * The ONLY data source is the sealed, audited server projection endpoint.
 * NEVER read raw Query/page rows, client config, dataset fields or local
 * synthetic chart drafts. Public/device playback has no approved endpoint
 * yet: the parent forbids its request and this component fails closed.
 */
export function DashboardSavedChartWidget({
  dashboardId,widgetId,accessToken,authorized,refreshKey,
}:Props){
  const [loaded,setLoaded]=useState<Loaded|null>(null);
  const [recheckEpoch,setRecheckEpoch]=useState(0);
  const authorizedPreviously=useRef(false);
  const authorizationGeneration=useRef(0);
  const eligible=authorized&&Boolean(accessToken)&&Boolean(refreshKey)&&
    sealedChartProjectionPath(dashboardId,widgetId)!==null;
  // Invalidate any earlier projection on the FIRST denied render, not only
  // in a delayed effect. A later re-authorization of the same token/key must
  // never resurrect the previous view while a new request is in flight.
  if(!eligible&&authorizedPreviously.current){
    authorizedPreviously.current=false;
    authorizationGeneration.current++;
  }
  // Seal, reviewer approval and account status may change while the page
  // remains open. Never display a cached projection indefinitely.
  useEffect(()=>{
    if(!eligible)return;
    const timer=setInterval(()=>setRecheckEpoch(n=>n+1),CHART_PROJECTION_RECHECK_MS);
    return ()=>clearInterval(timer);
  },[eligible,dashboardId,widgetId,accessToken,refreshKey]);
  const current=eligible&&authorizedPreviously.current&&
    loaded?.authorizationGeneration===authorizationGeneration.current&&
    loaded?.recheckEpoch===recheckEpoch&&
    loaded?.dashboardId===dashboardId&&
    loaded?.widgetId===widgetId&&loaded?.accessToken===accessToken&&
    loaded?.refreshKey===refreshKey ? loaded : null;

  useEffect(()=>{
    setLoaded(null);
    if(!eligible||!accessToken||!refreshKey)return;
    const path=sealedChartProjectionPath(dashboardId,widgetId);
    if(!path)return;
    const controller=new AbortController();
    let currentRequest=true;
    const generation=authorizationGeneration.current;
    authorizedPreviously.current=true;
    void apiRequest<unknown>(path,{
      method:"POST",signal:controller.signal,
    },accessToken,()=>currentRequest&&!controller.signal.aborted)
      .then(response=>{
        if(!currentRequest||controller.signal.aborted||
           !authorizedPreviously.current||generation!==authorizationGeneration.current)return;
        const projection=parseChartProjection(response);
        setLoaded({dashboardId,widgetId,accessToken,refreshKey,
          authorizationGeneration:generation,recheckEpoch,projection,failed:projection===null});
      }).catch(()=>{
        if(currentRequest&&!controller.signal.aborted&&
           authorizedPreviously.current&&generation===authorizationGeneration.current)
          setLoaded({dashboardId,widgetId,accessToken,refreshKey,
            authorizationGeneration:generation,recheckEpoch,projection:null,failed:true});
      });
    return ()=>{currentRequest=false;controller.abort();};
  },[eligible,dashboardId,widgetId,accessToken,refreshKey,recheckEpoch]);

  if(!eligible)return <div className="dashboard-saved-chart-denied" role="status">
    圖表尚未獲准在此播放模式顯示
  </div>;
  if(current?.failed)return <div className="dashboard-saved-chart-denied" role="status">
    圖表未取得核准的彙總資料，停止顯示
  </div>;
  if(!current?.projection)return <div className="dashboard-saved-chart-denied" role="status">
    驗證圖表資料中…
  </div>;
  return <div className="dashboard-saved-chart" data-chart-source="trusted-server-projection">
    <DashboardChartProjection projection={current.projection}
      ariaLabel="經授權之 Dashboard 彙總圖表"/>
  </div>;
}
