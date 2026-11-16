/** PR #99: test-only trusted CHART positioning and soft-removal.
 * Existing Dashboard activation controls visibility. All 928 frozen objects
 * stay untouched; changes are in Profile ConfigJson with transactional Audit.
 */
import {Router} from "express";
import {createHash} from "node:crypto";
import sql from "mssql";
import {z} from "zod";
import {getPlatformDbPool} from "../../config/database.js";
import {getTokenSessionState} from "../auth/auth.repository.js";
import {readVerifiedChartExecuteActor} from "../auth/auth.middleware.js";
import {writeAuditEvent} from "../audit/audit.repository.js";
import {chartAuthorizedTestEnabled,requireChartAuthorizedTest} from "./dashboardChartAuthorizedTest.js";
import {chartLayoutRevision,chartLayoutGeometryValid,chartLayoutConfig,
  chartLayoutOverrides,withChartLayoutChange} from "./dashboardChartLayoutProfile.js";

export const CHART_LAYOUT_HTTP_RELEASE_APPROVED=false as const;
const id=z.string().regex(/^[1-9][0-9]{0,14}$/).transform(Number)
 .refine(value=>Number.isSafeInteger(value)&&value>0);
const version=z.string().regex(/^[a-f0-9]{64}$/);
const change=z.object({
 action:z.enum(["MOVE","HIDE"]),
 x:z.number().int().min(0),y:z.number().int().min(0),
 width:z.number().int().min(160),height:z.number().int().min(120),
 sortOrder:z.number().int().min(0).max(1000000),
 expectedVersion:version,
 requestId:z.uuid(),
}).strict();
export type ChartLayoutChange=z.infer<typeof change>;
export class ChartLayoutError extends Error{
 constructor(readonly code:string,readonly status:number=409){super(code);}
}
const deny=(code:string,status=409):never=>{throw new ChartLayoutError(code,status);};
export type ChartLayoutChangeDeps={
 enabled:()=>boolean;
 requireTest:typeof requireChartAuthorizedTest;
 write:(input:{dashboardId:number;widgetId:number;actorId:number;
   tokenVersion:number;change:ChartLayoutChange})=>Promise<{
   widgetId:number;revision:string;removed:boolean;
 }>;
};
export async function writeChartLayout(input:{
 dashboardId:number;widgetId:number;actorId:number;tokenVersion:number;
 change:ChartLayoutChange;
}){
 const {dashboardId,widgetId,actorId,tokenVersion,change:cmd}=input;
 const pool=await getPlatformDbPool();
 if(!pool)deny("CHART_LAYOUT_DATABASE_UNAVAILABLE",503);
 const tx=new sql.Transaction(pool);
 let opened=false;
 try{
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);opened=true;
  const session=await getTokenSessionState(actorId,tx);
  if(!session?.isActive||session.tokenVersion!==tokenVersion||
     !session.permissions.includes("DESIGN_QUERY")||
     !session.permissions.includes("EXECUTE_QUERY"))
   deny("CHART_LAYOUT_PERMISSION_DENIED",403);
  // Match frozen CHART Writer's lock: Dashboard, profile, then widget/seal.
  const lock=await new sql.Request(tx).input("d",sql.BigInt,dashboardId)
   .query("SELECT Id,IsActive,QueryMode FROM uqp.Dashboard WITH(UPDLOCK,HOLDLOCK) WHERE Id=@d");
  if(lock.recordset.length!==1||lock.recordset[0].IsActive!==true||
   lock.recordset[0].QueryMode!=="QUERY_ONLY")deny("CHART_LAYOUT_DASHBOARD_NOT_ACTIVE");
  const original=(await new sql.Request(tx)
   .input("d",sql.BigInt,dashboardId).input("w",sql.BigInt,widgetId)
   .query(["SELECT w.Id AS WidgetId,w.X,w.Y,w.Width,w.Height,w.SortOrder,",
    "w.ConfigJson,w.SourceKey,p.Id AS ProfileId,p.ConfigJson AS ProfileConfig,",
    "p.CanvasWidth,p.CanvasHeight,s.ConfigDigest,s.IsActive AS SealActive,",
    "CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM uqp.AuditLog a WITH(HOLDLOCK)",
    "WHERE a.Id=s.AuditLogId AND a.UserId=s.SealedBy AND a.EventType=N'CHART_SEAL_WIDGET'",
    "AND a.Status=N'SUCCESS' AND a.IsImportant=1) OR EXISTS(",
    "SELECT 1 FROM uqp.AuditLogArchive ar WITH(HOLDLOCK)",
    "WHERE ar.Id=s.AuditLogId AND ar.UserId=s.SealedBy AND ar.EventType=N'CHART_SEAL_WIDGET'",
    "AND ar.Status=N'SUCCESS' AND ar.IsImportant=1) THEN 1 ELSE 0 END) VerifiedAudit",
    "FROM uqp.DashboardDisplayProfile p WITH(UPDLOCK,HOLDLOCK)",
    "JOIN uqp.DashboardWidget w WITH(UPDLOCK,HOLDLOCK) ON w.ProfileId=p.Id",
    "JOIN uqp.DashboardChartWidgetSeal s WITH(HOLDLOCK) ON s.WidgetId=w.Id",
    "WHERE p.DashboardId=@d AND w.Id=@w AND w.WidgetType=N'CHART'"].join(" "))).recordset;
  if(original.length!==1||original[0].SealActive!==true||
   original[0].VerifiedAudit!==true||typeof original[0].ConfigJson!=="string"||
   createHash("sha256").update(String(original[0].ConfigJson)).digest("hex")!==original[0].ConfigDigest)
   deny("CHART_LAYOUT_SEAL_INVALID");
  const item=original[0],profileId=Number(item.ProfileId),
   raw=String(item.ProfileConfig??"{}"),
   width=Number(item.CanvasWidth),height=Number(item.CanvasHeight);
  const current=chartLayoutRevision(profileId,raw);
  if(current!==cmd.expectedVersion)deny("CHART_LAYOUT_STALE");
  const config=chartLayoutConfig(raw),overrides=chartLayoutOverrides(config);
  const existing=overrides[String(widgetId)];
  if(existing?.hidden)deny("CHART_LAYOUT_ALREADY_REMOVED");
  // HIDE retains the currently trusted geometry; never trusts client
  // coordinates to change a chart as a side effect of removal.
  const placement=cmd.action==="HIDE"?{
   x:existing?.x??Number(item.X),y:existing?.y??Number(item.Y),
   width:existing?.width??Number(item.Width),height:existing?.height??Number(item.Height),
   sortOrder:existing?.sortOrder??Number(item.SortOrder),
  }:{x:cmd.x,y:cmd.y,width:cmd.width,height:cmd.height,sortOrder:cmd.sortOrder};
  if(!chartLayoutGeometryValid(placement,width,height))
   deny("CHART_LAYOUT_GEOMETRY_INVALID",400);
  const modified=withChartLayoutChange({
   raw,widgetId,action:cmd.action,geometry:placement,
   requestId:cmd.requestId,canvasWidth:width,canvasHeight:height,
  });
  if(modified.length>131072)deny("CHART_LAYOUT_PROFILE_TOO_LARGE",400);
  const receipt=await writeAuditEvent({
   eventType:cmd.action==="HIDE"?"CHART_LAYOUT_HIDE":"CHART_LAYOUT_MOVE",
   userId:actorId,status:"SUCCESS",
   parameters:{dashboardId,widgetId,profileId,requestId:cmd.requestId,
    previousVersion:current,action:cmd.action,...placement},
  },tx);
  if(!Number.isSafeInteger(receipt)||receipt<=0)deny("CHART_LAYOUT_AUDIT_REQUIRED",503);
  const result=await new sql.Request(tx)
   .input("id",sql.BigInt,profileId)
   .input("raw",sql.NVarChar(sql.MAX),modified)
   .query("UPDATE uqp.DashboardDisplayProfile WITH(UPDLOCK) SET ConfigJson=@raw WHERE Id=@id");
  if(result.rowsAffected.length!==1||result.rowsAffected[0]!==1)
   deny("CHART_LAYOUT_UPDATE_FAILED",503);
  await tx.commit();opened=false;
  return {widgetId,revision:chartLayoutRevision(profileId,modified),
   removed:cmd.action==="HIDE"};
 }catch(error){
  if(opened)try{await tx.rollback();}catch{/* preserve original error */}
  if(error instanceof ChartLayoutError)throw error;
  throw new ChartLayoutError("CHART_LAYOUT_WRITE_FAILED",503);
 }
}
export function createChartLayoutRouter(override:Partial<ChartLayoutChangeDeps>={}){
 const deps:ChartLayoutChangeDeps={
  enabled:()=>CHART_LAYOUT_HTTP_RELEASE_APPROVED||chartAuthorizedTestEnabled(),
  requireTest:requireChartAuthorizedTest,write:writeChartLayout,...override,
 };
 const router=Router();
 router.post("/:id/charts/v1/:widgetId/layout",async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  if(!deps.enabled()){res.status(404).json({error:{code:"CHART_NOT_AVAILABLE"}});return;}
  const actor=readVerifiedChartExecuteActor(req);
  if(!actor){res.status(403).json({error:{code:"FORBIDDEN"}});return;}
  const dashboard=id.safeParse(req.params.id),widget=id.safeParse(req.params.widgetId),
   body=change.safeParse(req.body);
  if(!dashboard.success||!widget.success||!body.success||Object.keys(req.query).length!==0){
   res.status(400).json({error:{code:"VALIDATION_ERROR"}});return;
  }
  try{
   await deps.requireTest(dashboard.data);
   const result=await deps.write({
    dashboardId:dashboard.data,widgetId:widget.data,
    actorId:actor.userId,tokenVersion:actor.tokenVersion,change:body.data,
   });
   await deps.requireTest(dashboard.data);
   res.json(result);
  }catch(error){
   const known=error instanceof ChartLayoutError?error:null;
   res.status(known?.status??503).json({error:{
    code:known?.code??"CHART_LAYOUT_NOT_CONFIRMED",
    message:"無法確認圖表版面修改，請重新載入版型。"
   }});
  }
 });
 return router;
}
