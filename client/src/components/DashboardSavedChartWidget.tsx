import {useEffect,useState} from "react";
import {apiRequest} from "../api/client";
import {
  parseChartProjection,type ChartProjection,
} from "../dashboard/chartProjection";
import {sealedChartProjectionPath} from "../dashboard/nativeChartPlayback";
import {DashboardChartProjection} from "./DashboardChartProjection";
import "./DashboardSavedChartWidget.css";

type Props=Readonly<{
  dashboardId:number;widgetId:number;
  accessToken:string|null;
  authorized:boolean;
  refreshKey:string;
}>;

type Loaded=Readonly<{
  dashboardId:number;widgetId:number;accessToken:string;
  refreshKey:string;projection:ChartProjection|null;failed:boolean;
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
  const current=loaded?.dashboardId===dashboardId&&
    loaded?.widgetId===widgetId&&loaded?.accessToken===accessToken&&
    loaded?.refreshKey===refreshKey ? loaded : null;

  useEffect(()=>{
    if(!authorized||!accessToken||!refreshKey)return;
    const path=sealedChartProjectionPath(dashboardId,widgetId);
    if(!path)return;
    const controller=new AbortController();
    let currentRequest=true;
    setLoaded(null);
    void apiRequest<unknown>(path,{
      method:"POST",signal:controller.signal,
    },accessToken,()=>currentRequest&&!controller.signal.aborted)
      .then(response=>{
        if(!currentRequest||controller.signal.aborted)return;
        const projection=parseChartProjection(response);
        setLoaded({dashboardId,widgetId,accessToken,refreshKey,
          projection,failed:projection===null});
      }).catch(()=>{
        if(currentRequest&&!controller.signal.aborted)
          setLoaded({dashboardId,widgetId,accessToken,refreshKey,
            projection:null,failed:true});
      });
    return ()=>{currentRequest=false;controller.abort();};
  },[authorized,dashboardId,widgetId,accessToken,refreshKey]);

  if(!authorized)return <div className="dashboard-saved-chart-denied" role="status">
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
