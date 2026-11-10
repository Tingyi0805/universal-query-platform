import {useEffect,useRef,useState} from "react";
import {apiRequest} from "../api/client";
import {
  parseChartProjection,type ChartProjection,
} from "../dashboard/chartProjection";
import {
  CHART_DEVICE_PLAYBACK_RELEASE_APPROVED,
  sealedChartProjectionPath,sealedDeviceChartProjectionPath,
  sealedDeviceChartProjectionHeaders,sealedUserChartProjectionPath,
  CHART_USER_PLAYBACK_RELEASE_APPROVED,
} from "../dashboard/nativeChartPlayback";
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
  // Only the actual public-device mode can pass a Device Token. It is NEVER
  // reinterpreted as a Bearer JWT; cookie-only kiosk remains denied.
  deviceMode?:boolean;
  userPlayback?:boolean;
  deviceToken?:string|null;
  expectedDeviceId?:number|null;
}>;

type Loaded=Readonly<{
  dashboardId:number;widgetId:number;accessToken:string;
  refreshKey:string;authorizationGeneration:number;recheckEpoch:number;
  deviceMode:boolean;userPlayback:boolean;expectedDeviceId:number|null;
  projection:ChartProjection|null;failed:boolean;
}>;

/** Native saved-Widget rendering in the real Dashboard playback canvas.
 * The ONLY data source is the sealed, audited server projection endpoint.
 * NEVER read raw Query/page rows, client config, dataset fields or local
 * synthetic chart drafts. The device-only transport has a separate Token/IP
 * route but remains hard-OFF in the browser and server until formally approved;
 * cookie-only kiosk and user bearer playback remain denied.
 */
export function DashboardSavedChartWidget({
  dashboardId,widgetId,accessToken,authorized,refreshKey,
  deviceMode=false,userPlayback=false,deviceToken=null,expectedDeviceId=null,
}:Props){
  const [loaded,setLoaded]=useState<Loaded|null>(null);
  const [recheckEpoch,setRecheckEpoch]=useState(0);
  const authorizedPreviously=useRef(false);
  const authorizationGeneration=useRef(0);
  const path=deviceMode
    ? sealedDeviceChartProjectionPath(dashboardId,widgetId)
    : userPlayback
      ? sealedUserChartProjectionPath(dashboardId,widgetId)
      : sealedChartProjectionPath(dashboardId,widgetId);
  const deviceHeaders=deviceMode
    ? sealedDeviceChartProjectionHeaders(deviceToken,expectedDeviceId)
    : null;
  const selectedToken=deviceMode?deviceToken:accessToken;
  const eligible=authorized&&Boolean(refreshKey)&&Boolean(path)&&
    !(deviceMode&&userPlayback)&&
    (deviceMode
      ? CHART_DEVICE_PLAYBACK_RELEASE_APPROVED && deviceHeaders!==null
      : userPlayback
        ? CHART_USER_PLAYBACK_RELEASE_APPROVED && Boolean(accessToken)
        : Boolean(accessToken));
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
  },[eligible,dashboardId,widgetId,selectedToken,refreshKey,deviceMode,userPlayback,expectedDeviceId]);
  const current=eligible&&authorizedPreviously.current&&
    loaded?.authorizationGeneration===authorizationGeneration.current&&
    loaded?.recheckEpoch===recheckEpoch&&
    loaded?.dashboardId===dashboardId&&
    loaded?.widgetId===widgetId&&loaded?.accessToken===selectedToken&&
    loaded?.deviceMode===deviceMode&&loaded?.userPlayback===userPlayback&&
    loaded?.expectedDeviceId===(expectedDeviceId??null)&&
    loaded?.refreshKey===refreshKey ? loaded : null;

  useEffect(()=>{
    setLoaded(null);
    if(!eligible||!selectedToken||!refreshKey||!path)return;
    const controller=new AbortController();
    let currentRequest=true;
    const generation=authorizationGeneration.current;
    authorizedPreviously.current=true;
    void apiRequest<unknown>(path,{
      method:"POST",signal:controller.signal,
      // Explicitly refuse to transmit a device token in Authorization.
      ...(deviceMode&&deviceHeaders?{headers:deviceHeaders}:{}),
    },deviceMode?null:accessToken,
    ()=>currentRequest&&!controller.signal.aborted)
      .then(response=>{
        if(!currentRequest||controller.signal.aborted||
           !authorizedPreviously.current||generation!==authorizationGeneration.current)return;
        const projection=parseChartProjection(response);
        setLoaded({dashboardId,widgetId,accessToken:selectedToken,refreshKey,
          deviceMode,userPlayback,expectedDeviceId:expectedDeviceId??null,
          authorizationGeneration:generation,recheckEpoch,projection,failed:projection===null});
      }).catch(()=>{
        if(currentRequest&&!controller.signal.aborted&&
           authorizedPreviously.current&&generation===authorizationGeneration.current)
          setLoaded({dashboardId,widgetId,accessToken:selectedToken,refreshKey,
            deviceMode,userPlayback,expectedDeviceId:expectedDeviceId??null,
            authorizationGeneration:generation,recheckEpoch,projection:null,failed:true});
      });
    return ()=>{currentRequest=false;controller.abort();};
  },[eligible,dashboardId,widgetId,selectedToken,refreshKey,recheckEpoch,
    deviceMode,userPlayback,expectedDeviceId,path,accessToken]);

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
