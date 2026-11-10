// Native CHART CREATE data-only request for the existing Dashboard designer.
// Browser authority is never sufficient: server-side JWT, Signer, SQL Writer
// and the independently reviewed 928 gate must all approve this operation.
import {chartDraftErrors,type ChartDraft} from "./chartDraft.js";
export type NativeChartCreateScope=Readonly<{
  dashboardId:number;profileId:number;canvasWidth:number;canvasHeight:number;
  allowedSources:readonly string[];
  canCreate:boolean;hasDesignPermission:boolean;hasExecutePermission:boolean;
  hasSourceVersion:boolean;layoutUnmodified:boolean;profileIdsCurrent:boolean;
}>;
export type NativeChartCreateBody=Readonly<{
  profileId:number;requestId:string;config:ChartDraft["config"];
  placement:ChartDraft["placement"];
}>;
export type NativeChartCreateReceipt=Readonly<{
  widgetId:number;sealRevision:string;auditLogId:string;
}>;
const uuidV4=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const id=(v:unknown):v is number=>
  typeof v==="number"&&Number.isSafeInteger(v)&&v>0;
const record=(v:unknown):v is Record<string,unknown>=>
  v!==null&&typeof v==="object"&&!Array.isArray(v);

/** Never copy actor, access token, permissions, arbitrary SQL, grant or
 * self-claimed review flags into the dedicated create POST body.
 * The browser must start from an unchanged, reloaded, persisted profile.
 */
export function buildNativeChartCreateBody(
  draft:ChartDraft,scope:NativeChartCreateScope,requestId:string,
):NativeChartCreateBody|null{
  if(!scope.canCreate||!scope.hasDesignPermission||
     !scope.hasExecutePermission||!scope.hasSourceVersion||
     !scope.layoutUnmodified||!scope.profileIdsCurrent||
     !id(scope.dashboardId)||!id(scope.profileId)||!uuidV4.test(requestId)||
     chartDraftErrors(draft,scope.canvasWidth,scope.canvasHeight,
       scope.allowedSources).length!==0)return null;
  return {
    profileId:scope.profileId,requestId,
    config:{...draft.config},placement:{...draft.placement},
  };
}

/** A 201 response is not evidence of visible persistence: the designer
 * additionally reloads the trusted layout and verifies its widget identity.
 */
export function parseNativeChartCreateReceipt(value:unknown):NativeChartCreateReceipt|null{
  if(!record(value)||
     Object.keys(value).sort().join("|")!=="auditLogId|sealRevision|widgetId"||
     !id(value.widgetId)||typeof value.sealRevision!=="string"||
     !/^[a-f0-9]{16}$/.test(value.sealRevision)||
     typeof value.auditLogId!=="string"||
     !/^[1-9][0-9]{0,18}$/.test(value.auditLogId))return null;
  try{
    if(BigInt(value.auditLogId)>9223372036854775807n)return null;
  }catch{return null;}
  return {widgetId:value.widgetId,
    sealRevision:value.sealRevision,auditLogId:value.auditLogId};
}
export function hasCreatedSealedChartInLayout(
  value:unknown,profileId:number,widgetId:number,
  placement:ChartDraft["placement"],
):boolean{
  if(!id(profileId)||!id(widgetId)||!record(value)||
     !Array.isArray(value.profiles))return false;
  const matches=value.profiles.filter((profile:unknown)=>
    record(profile)&&profile.id===profileId&&Array.isArray(profile.widgets));
  if(matches.length!==1)return false;
  const widgets=(matches[0] as {widgets:unknown[]}).widgets;
  const found=widgets.filter(widget=>record(widget)&&
    widget.id===widgetId&&widget.widgetType==="CHART"&&
    widget.profileId===profileId&&
    widget.x===placement.x&&widget.y===placement.y&&
    widget.width===placement.width&&widget.height===placement.height);
  return found.length===1;
}

/** The author-only DB-backed readback must match the exact saved Widget
 * Seal revision returned by SQL Writer, and all canonical chart settings.
 * Layout-only identity/placement checks cannot prove this persisted seal.
 * Reject unexpected server fields, patient rows or browser trust flags.
 */
export function confirmsNativeChartSavedReadback(
  value:unknown,receipt:NativeChartCreateReceipt,
  config:ChartDraft["config"],
):boolean{
  if(!record(value)||!record(value.config)||
     Object.keys(value).sort().join("|")!=="config|sealRevision|widgetId"||
     value.widgetId!==receipt.widgetId||
     value.sealRevision!==receipt.sealRevision||
     !/^[a-f0-9]{16}$/.test(receipt.sealRevision))return false;
  const keys=[
    "version","chartType","dataSourceKey","categoryColumn","valueColumn",
    "valueMode","maxPoints","showLegend",
  ] as const;
  if(Object.keys(value.config).sort().join("|")!==[...keys].sort().join("|")||
     Object.keys(config).sort().join("|")!==[...keys].sort().join("|"))
    return false;
  return keys.every(key=>Object.is(value.config[key],config[key]));
}
