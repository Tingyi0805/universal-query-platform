/** PR99: CHART geometry is presentation metadata in saved Profile ConfigJson.
 * Frozen 928 CHART Widget+Seal and Audit remain untouched; no migration needed.
 * A soft-removed widget must fail closed even when addressed by direct URL.
 */
import {createHash} from "node:crypto";
export const CHART_LAYOUT_OVERRIDES_KEY="chartLayoutOverridesV1";
export type ChartGeometry={x:number;y:number;width:number;height:number;sortOrder:number;hidden:boolean;requestId:string};
const id=(n:unknown):n is number=>typeof n==="number"&&Number.isSafeInteger(n)&&n>0;
const integer=(n:unknown):n is number=>typeof n==="number"&&Number.isSafeInteger(n);
export const chartLayoutRevision=(profileId:number,raw:string)=>
 createHash("sha256").update("UQP_CHART_PROFILE_LAYOUT_V1\n"+profileId+"\n"+raw).digest("hex");
export function chartLayoutConfig(raw:unknown):Record<string,unknown>{
 if(typeof raw!=="string"||raw.length>131072)throw Error("CHART_LAYOUT_PROFILE_INVALID");
 const value=JSON.parse(raw);
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("CHART_LAYOUT_PROFILE_INVALID");
 return value as Record<string,unknown>;
}
export function chartLayoutGeometryValid(r:Pick<ChartGeometry,"x"|"y"|"width"|"height"|"sortOrder">,
 canvasWidth:number,canvasHeight:number):boolean{
 return [r.x,r.y,r.width,r.height,r.sortOrder,canvasWidth,canvasHeight].every(integer)&&
 r.x>=0&&r.y>=0&&r.width>=160&&r.height>=120&&r.sortOrder>=0&&r.sortOrder<=1000000&&
 r.width<=canvasWidth&&r.height<=canvasHeight&&r.x+r.width<=canvasWidth&&r.y+r.height<=canvasHeight;
}
export function chartLayoutOverrides(config:Record<string,unknown>):Record<string,ChartGeometry>{
 const raw=config[CHART_LAYOUT_OVERRIDES_KEY];
 if(raw===undefined)return {};
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||Object.keys(raw).length>100)
   throw Error("CHART_LAYOUT_OVERRIDES_INVALID");
 const result:Record<string,ChartGeometry>={};
 for(const [key,value] of Object.entries(raw)){
  if(!/^[1-9][0-9]{0,14}$/.test(key)||!id(Number(key))||
   !value||typeof value!=="object"||Array.isArray(value))throw Error("CHART_LAYOUT_OVERRIDES_INVALID");
  const item=value as Record<string,unknown>;
  if(Object.keys(item).sort().join("|")!=="height|hidden|requestId|sortOrder|width|x|y"||
     ![item.x,item.y,item.width,item.height,item.sortOrder].every(integer)||
     typeof item.hidden!=="boolean"||
     typeof item.requestId!=="string"||
     !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(item.requestId))
     throw Error("CHART_LAYOUT_OVERRIDES_INVALID");
  result[key]={x:item.x as number,y:item.y as number,width:item.width as number,
   height:item.height as number,sortOrder:item.sortOrder as number,
   hidden:item.hidden,requestId:item.requestId};
 }
 return result;
}
export function chartIsSoftRemoved(raw:unknown,widgetId:number):boolean{
 try{
  if(!id(widgetId))return true;
  const override=chartLayoutOverrides(chartLayoutConfig(raw))[String(widgetId)];
  return override?.hidden===true;
 }catch{return true;}
}
export function chartLayoutPublicRow(
 widget:Record<string,unknown>,profileId:number,raw:unknown,
 canvasWidth:number,canvasHeight:number):Record<string,unknown>|null{
 const key=Number(widget.id);
 if(!id(key))throw Error("CHART_LAYOUT_WIDGET_ID_INVALID");
 const config=chartLayoutConfig(raw),override=chartLayoutOverrides(config)[String(key)];
 if(override?.hidden)return null;
 const placement=override??{x:widget.x,y:widget.y,width:widget.width,
  height:widget.height,sortOrder:widget.sortOrder};
 if(!chartLayoutGeometryValid(placement as ChartGeometry,canvasWidth,canvasHeight))
  throw Error("CHART_LAYOUT_GEOMETRY_INVALID");
 return {...widget,...(override?{
  x:override.x,y:override.y,width:override.width,height:override.height,
  sortOrder:override.sortOrder}:{}),
  chartLayoutRevision:chartLayoutRevision(profileId,String(raw))};
}
export function withChartLayoutChange(input:{
 raw:string;widgetId:number;action:"MOVE"|"HIDE";
 geometry:{x:number;y:number;width:number;height:number;sortOrder:number};
 requestId:string;canvasWidth:number;canvasHeight:number;
}):string{
 const {raw,widgetId,action,geometry,requestId,canvasWidth,canvasHeight}=input;
 if(!id(widgetId)||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId))
  throw Error("CHART_LAYOUT_INPUT_INVALID");
 const config=chartLayoutConfig(raw),overrides=chartLayoutOverrides(config);
 if(overrides[String(widgetId)]?.hidden)throw Error("CHART_LAYOUT_ALREADY_REMOVED");
 if(!chartLayoutGeometryValid(geometry,canvasWidth,canvasHeight))
  throw Error("CHART_LAYOUT_GEOMETRY_INVALID");
 // Preserve EVERY other profile setting, including existing layout/styling.
 const next={...overrides,[String(widgetId)]:{...geometry,hidden:action==="HIDE",requestId}};
 return JSON.stringify({...config,[CHART_LAYOUT_OVERRIDES_KEY]:next});
}
export function chartLayoutPublicConfig(raw:unknown):Record<string,unknown>{
 const config=chartLayoutConfig(raw);
 // No writer nonce/version/hidden metadata should flow to public clients.
 const {[CHART_LAYOUT_OVERRIDES_KEY]:_overrides,...publicData}=config;
 return publicData;
}
