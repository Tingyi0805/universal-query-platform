import {createHash} from "node:crypto";
/** Existing Gate 3 decisions exposed only in authorized test mode; never supplies patient rows. */
import {Router} from "express";
import {z} from "zod";
import sql from "mssql";
import {getPlatformDbPool} from "../../config/database.js";
import {readVerifiedChartAdminActor,readVerifiedChartPlaybackActor} from "../auth/auth.middleware.js";
import {getTokenSessionState} from "../auth/auth.repository.js";
import {chartAuthorizedTestEnabled,requireChartAuthorizedTest} from "./dashboardChartAuthorizedTest.js";
import {createDormantChartTrustWriters} from "./dashboardChartTrust.writer.js";
import {createDormantChartTrustReaders} from "./dashboardChartTrust.repository.js";
import {chartFactsDefaults,createSqlChartFactsReader} from "./dashboardChartEvidence.reader.js";
import {createVersionBoundCountProofReader} from "./dashboardChartSqlAggregate.reader.js";
import {chartPublicCountScope} from "./dashboardChartDelivery.coordinator.js";
import {evaluateServerChartApproval} from "./dashboardChartApproval.policy.js";
import {datasetPublicDisplayRepository} from "../dataset/datasetPublicDisplay.repository.js";
import {listDashboardChartPrivacySummary} from "./dashboardChartPrivacySummary.js";
// Only the existing verified JWT proof and server-owned saved configuration select scope.
const id=z.coerce.number().int().positive().safe();
const decision=z.discriminatedUnion("action",[
 z.object({action:z.literal("REQUEST"),requestId:z.uuid()}).strict(),
 z.object({action:z.literal("APPROVE"),requestId:z.uuid(),reviewId:id,expectedRevision:z.string().regex(/^[a-f0-9]{16}$/),
 minimumCellCount:z.number().int().min(5).max(1000),validDays:z.number().int().min(1).max(90),categoryPrivacyReviewed:z.literal(true),differencingRiskReviewed:z.literal(true)}).strict(),
 z.object({action:z.literal("REVOKE"),requestId:z.uuid(),reviewId:id,expectedRevision:z.string().regex(/^[a-f0-9]{16}$/)}).strict(),
]);
const readers=createDormantChartTrustReaders();
async function status(dashboardId:number,widgetId:number){
 const pool=await getPlatformDbPool();if(!pool)throw Error("CHART_UNAVAILABLE");
 const saved=await readers.readSavedWidget(dashboardId,widgetId);if(!saved)throw Error("CHART_UNSEALED");
 const rows=(await pool.request().input("d",sql.BigInt,dashboardId).input("w",sql.BigInt,widgetId).query(`
 SELECT p.Status,CONVERT(varchar(16),p.WidgetRevision,2) ApprovalRevision FROM uqp.DashboardChartPlaybackApproval p
 WHERE p.DashboardId=@d AND p.WidgetId=@w;`)).recordset;
 const review=(await pool.request().input("d",sql.BigInt,dashboardId).input("s",sql.NVarChar(64),(saved.config as {dataSourceKey:string}).dataSourceKey)
  .input("category",sql.NVarChar(128),(saved.config as {categoryColumn:string}).categoryColumn).input("value",sql.NVarChar(128),(saved.config as {valueColumn:string}).valueColumn)
  .query(`SELECT TOP(1) Id,Status,CONVERT(varchar(16),ReviewRowVersion,2) Revision,RequestedByUserId
  FROM uqp.DashboardChartPrivacyReview WHERE DashboardId=@d AND SourceKey=@s AND CategoryColumn=@category AND ValueColumn=@value AND Status IN('REQUESTED','APPROVED') ORDER BY Id DESC;`)).recordset;
 return {sealed:true,revision:saved.revision,playbackStatus:rows[0]?.ApprovalRevision?.toLowerCase()===saved.revision?rows[0].Status:"UNCONFIRMED",privacyReview:review.length?{
  id:review[0].Id,status:review[0].Status,revision:String(review[0].Revision).toLowerCase(),requestedBy:review[0].RequestedByUserId}:null};
}
async function publicScope(dashboardId:number,widgetId:number,actor:{userId:number;tokenVersion:number;tokenHash:string},tx?:sql.Transaction){
 const saved=await readers.readSavedWidget(dashboardId,widgetId);if(!saved)throw Error("CHART_UNSEALED");
 const config=saved.config as Parameters<typeof createVersionBoundCountProofReader>[0];
 const parsed=(await import("./dashboardChartWidget.contract.js")).chartWidgetConfigSchema.parse(config);
 const facts=await createSqlChartFactsReader({...chartFactsDefaults,
  getPublicDisplay:tx?(n)=>datasetPublicDisplayRepository.getInTransaction(tx,n):chartFactsDefaults.getPublicDisplay,
  getVerifiedAggregate:createVersionBoundCountProofReader(parsed),
 })(dashboardId,parsed.dataSourceKey,{context:"user",...actor});
 const approved=facts&&evaluateServerChartApproval(parsed,facts,{context:"user",...actor});
 if(!facts||!approved)throw Error("CHART_PUBLIC_POLICY_REQUIRED");
 return chartPublicCountScope(facts,approved.version,parsed);
}
async function applyPrivacyDecision(d:number,w:number,body:z.infer<typeof decision>,admin:NonNullable<ReturnType<typeof readVerifiedChartAdminActor>>,verified:NonNullable<ReturnType<typeof readVerifiedChartPlaybackActor>>){
 const actor={...admin,tokenHash:createHash("sha256").update(verified.originalBearerHeader.slice(7)).digest("hex")};
   const writers=createDormantChartTrustWriters({pool:getPlatformDbPool,enabled:chartAuthorizedTestEnabled,
    async authorize(tx,a){
     if(!verified||verified.expiresAt*1000<=Date.now())throw Error("EXPIRED");
     const live=await getTokenSessionState(a.userId,tx);
     if(!live?.isActive||live.tokenVersion!==a.tokenVersion||!live.permissions.includes("MANAGE_USERS"))throw Error("FORBIDDEN");
     const r=(await new sql.Request(tx).input("u",sql.BigInt,a.userId).query(`SELECT r.Id FROM uqp.UserRole ur WITH(HOLDLOCK)
      JOIN uqp.Role r WITH(HOLDLOCK) ON r.Id=ur.RoleId WHERE ur.UserId=@u AND r.Code=N'SYSTEM_ADMIN' AND r.IsActive=1;`)).recordset;
     if(r.length!==1)throw Error("FORBIDDEN");
    },
    async readLiveScope(tx,expected){
     // Administrative metadata only. Hold metadata snapshots until decision+Audit commit.
     // Existing public-policy reader runs on THIS transaction (it requires UPDLOCK).
     const tables=["Dataset","DataSource","QueryDefinition","QueryDefinitionVersion","DatasetSensitivePolicyVersion","DatasetSensitiveColumn",
      "DatasetPublicDisplayPolicy","DatasetPatientAuditConfig","ReportColumn","DashboardDataSource","RoleQueryAccess","UserQueryAccess","AppUser","UserRole","Role","RolePermission","Permission"];
     for(const table of tables)await new sql.Request(tx).query(`SELECT COUNT_BIG(*) C FROM uqp.${table} WITH(TABLOCK,HOLDLOCK);`);
     const current=await publicScope(d,w,actor,tx);
     return JSON.stringify(current)===JSON.stringify(expected)?current:null;
    },
   });
   if(body.action==="REQUEST")await writers.requestReview({scope:await publicScope(d,w,actor),actor,requestId:body.requestId});
   else if(body.action==="APPROVE")await writers.approveReview({...body,dashboardId:d,id:body.reviewId,actor});
   else await writers.revokeReview({...body,dashboardId:d,id:body.reviewId,actor});
 }
const defaults={enabled:chartAuthorizedTestEnabled,requireTest:requireChartAuthorizedTest,
 readAdmin:readVerifiedChartAdminActor,readPlayback:readVerifiedChartPlaybackActor,status,applyDecision:applyPrivacyDecision,summary:listDashboardChartPrivacySummary};
export function createChartTestManagementRouter(overrides:Partial<typeof defaults>={}){
 const deps={...defaults,...overrides};
 const router=Router();
 router.get("/:id/charts/v1/test-capabilities",(req,res)=>{
  res.setHeader("Cache-Control","no-store");const a=deps.readPlayback(req);
  res.json({playback:deps.enabled()&&a!==null});
 });
 // One read-only management screen per Dashboard. Reuses existing reviewed
 // SQL scope and audit: no browser flags can approve or revoke statistics.
 router.get("/:id/charts/v1/privacy-summary",async(req,res)=>{
  res.setHeader("Cache-Control","no-store, max-age=0");
  if(!deps.enabled()){res.status(404).json({error:{code:"CHART_NOT_AVAILABLE"}});return;}
  try{
   const admin=deps.readAdmin(req),verified=deps.readPlayback(req);
   if(!admin||!verified){res.sendStatus(403);return;}
   const d=id.parse(req.params.id);
   await deps.requireTest(d);
   const tokenHash=createHash("sha256").update(verified.originalBearerHeader.slice(7)).digest("hex");
   const result=await deps.summary(d,{userId:admin.userId,
     tokenVersion:admin.tokenVersion,tokenHash});
   await deps.requireTest(d);
   res.json(result);
  }catch{res.status(503).json({error:{code:"CHART_PRIVACY_SUMMARY_UNAVAILABLE"}});}
 });
 router.get("/:id/charts/v1/:widgetId/status",async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  if(!deps.enabled()){res.status(404).json({error:{code:"CHART_NOT_AVAILABLE"}});return;}
  try{const a=deps.readAdmin(req);if(!a){res.sendStatus(403);return;}
   const d=id.parse(req.params.id),w=id.parse(req.params.widgetId);await deps.requireTest(d);
   res.json(await deps.status(d,w));
  }catch{res.status(503).json({error:{code:"CHART_APPROVAL_STATUS_UNAVAILABLE"}});}
 });
 router.post("/:id/charts/v1/:widgetId/privacy-review",async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  if(!deps.enabled()){res.status(404).json({error:{code:"CHART_NOT_AVAILABLE"}});return;}
  try{
   const admin=deps.readAdmin(req),verified=deps.readPlayback(req);
   if(!admin||!verified){res.sendStatus(403);return;}
   const d=id.parse(req.params.id),w=id.parse(req.params.widgetId),body=decision.parse(req.body);
   await deps.requireTest(d);await deps.applyDecision(d,w,body,admin,verified);
   await deps.requireTest(d);res.json(await deps.status(d,w));
  }catch{res.status(409).json({error:{code:"CHART_PRIVACY_REVIEW_REJECTED",message:"請確認公開政策、彙總欄位、版本及不同審查人員，重新載入後再操作。"}});}
 });
 return router;
}
