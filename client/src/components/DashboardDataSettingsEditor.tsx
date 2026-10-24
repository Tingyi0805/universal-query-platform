import {useEffect,useState} from "react";
import {Link} from "react-router-dom";
import {apiRequest} from "../api/client";
import {managementError,trustedConfiguration,type QuerySourceConfiguration} from "../dashboard/querySourceManagement";
/** Presentation only. Dataset owns masking and public grants; never writes approval JSON. */
export function DashboardDataSettingsEditor({dashboardId,accessToken}:{dashboardId:number;accessToken:string|null}){
 const [state,setState]=useState<QuerySourceConfiguration|null>(null),[error,setError]=useState("");
 useEffect(()=>{let active=true;const load=()=>{void apiRequest<QuerySourceConfiguration>(`/dashboards/${dashboardId}/query-sources/v1/configuration`,{},accessToken).then(r=>{if(active){setState(trustedConfiguration(r));setError("");}}).catch(e=>{if(active){setState(null);setError(managementError(e));}});};load();window.addEventListener("uqp.dashboard.configuration.changed",load);return()=>{active=false;window.removeEventListener("uqp.dashboard.configuration.changed",load);};},[dashboardId,accessToken]);
 return <section aria-label="Dataset 政策來源"><h3>集中使用 Dataset 顯示政策</h3><p>此處不設定遮蔽或逐欄核准。設計預覽使用 Dataset 遮蔽；Query-only 公共播放另需 Dataset 已確認公共政策、裝置及必要稽核。修改 Dataset 後所有來源重新驗證，舊快照失效。</p>
  {state&&<ul>{[state.primary,...state.sources].map((s,i)=><li key={i}>{i===0?"PRIMARY":state.sources[i-1]?.sourceKey}：Query {s.queryDefinitionId??"待轉換"}</li>)}</ul>}
  <Link to="/designer/datasets">前往 Dataset 欄位與公共政策設定</Link>{error&&<p role="status">{error}</p>}
 </section>;
}
