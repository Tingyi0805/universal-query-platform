// 2B-15C: canonical WidgetConfig serialization and proposed atomic-create
// inputs. This module NEVER grants authorization or executes SQL. Until a
// vetted database-owned procedure and API are ready, CHART remains closed.
import {createHash} from "node:crypto";
import {chartWidgetConfigSchema,type ChartWidgetConfig} from "./dashboardChartWidget.contract.js";

export type ChartCanonicalConfig=Readonly<{
  data:ChartWidgetConfig;
  json:string;
  sha256:string;
}>;
export const CHART_ATOMIC_CREATE_RUNTIME_ENABLED=false as const;
const validId=(v:unknown)=>typeof v==="number"&&Number.isSafeInteger(v)&&v>0;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function canonicalChartConfig(raw:unknown):ChartCanonicalConfig|null{
  const parsed=chartWidgetConfigSchema.safeParse(raw);
  if(!parsed.success)return null;
  const json=JSON.stringify(parsed.data);
  if(json.length>8192)return null;
  return {data:parsed.data,json,
    sha256:createHash("sha256").update(json,"utf8").digest("hex")};
}

export type DormantChartCreatePlan=Readonly<{
  dashboardId:number;profileId:number; actorId:number;tokenVersion:number;
  requestId:string;
  config:ChartCanonicalConfig;
  sourceKey:string;
  placement:Readonly<{x:number;y:number;width:number;height:number}>;
}>;
/** No widgetId parameter. SQL Server must own the IDENTITY value and
 * return it with OUTPUT INSERTED.Id inside the same transaction as Seal.
 * This plan has no permissions, mutation, route or approval assertions.
 */
export function planDormantChartCreate(raw:unknown):DormantChartCreatePlan|null{
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;
  const r=raw as Record<string,unknown>;
  if(Object.keys(r).sort().join("|")!==
     "actorId|config|dashboardId|placement|profileId|requestId|tokenVersion")return null;
  if(!validId(r.dashboardId)||!validId(r.profileId)||!validId(r.actorId)||
     !validId(r.tokenVersion)||typeof r.requestId!=="string"||!uuid.test(r.requestId))
    return null;
  const config=canonicalChartConfig(r.config);
  if(!config||!r.placement||typeof r.placement!=="object"||Array.isArray(r.placement))
    return null;
  const p=r.placement as Record<string,unknown>;
  if(Object.keys(p).sort().join("|")!=="height|width|x|y")return null;
  for(const key of ["x","y","width","height"] as const){
    if(typeof p[key]!=="number"||!Number.isSafeInteger(p[key]))return null;
  }
  if((p.x as number)<0||(p.y as number)<0||(p.width as number)<160||
     (p.height as number)<120||(p.width as number)>7680||
     (p.height as number)>4320)return null;
  return {
    dashboardId:r.dashboardId as number,profileId:r.profileId as number,
    actorId:r.actorId as number,tokenVersion:r.tokenVersion as number,
    requestId:r.requestId,config,sourceKey:config.data.dataSourceKey,
    placement:{x:p.x as number,y:p.y as number,
      width:p.width as number,height:p.height as number},
  };
}
