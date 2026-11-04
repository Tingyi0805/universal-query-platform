// 2B-9: DORMANT transaction-owned CHART seal and public review writers.
// Requires explicit, trusted caller-supplied authorization and live-scope
// verification; no production implementation, migration, API or registration.
// In particular, NEVER bind a user/browser supplied "approved" boolean.
import { createHash } from "node:crypto";
import sql from "mssql";
import { chartWidgetConfigSchema } from "./dashboardChartWidget.contract.js";
import type { PublicCountScope } from "./dashboardChartPublicCountPrivacy.js";

export type ChartTrustActor = Readonly<{ userId: number; tokenVersion: number }>;
export type ChartTrustAction = "SEAL_WIDGET" | "REQUEST_REVIEW" | "APPROVE_REVIEW" | "REVOKE_REVIEW";
export type ChartTrustWriterDependencies = {
  pool: () => Promise<sql.ConnectionPool | null>;
  enabled: () => boolean;
  /** Must revalidate current account, TokenVersion, role and operation-specific
   * permission in the SAME SQL transaction; never accept caller-owned flags. */
  authorize: (tx: sql.Transaction, actor: ChartTrustActor, action: ChartTrustAction,
    scope: PublicCountScope | { dashboardId: number; widgetId: number }) => Promise<void>;
  /** Reads current Query/Dataset, publication, binding, sensitivity, public
   * grant and revision evidence in the SAME transaction. */
  readLiveScope: (tx: sql.Transaction, claimed: PublicCountScope) => Promise<PublicCountScope | null>;
};
export class ChartTrustWriteError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "ChartTrustWriteError"; }
}
const fail = (reason: string): never => { throw new ChartTrustWriteError(reason); };
const validId = (v: number) => Number.isSafeInteger(v) && v > 0;
const isRev = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{16}$/.test(v);
const isUUID = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const revision = (v: unknown) => Buffer.isBuffer(v) && v.length === 8 ? v.toString("hex") : null;
function validScope(s: PublicCountScope): boolean {
  return !!s && [s.dashboardId,s.queryId,s.datasetId].every(validId) &&
    /^(?:PRIMARY|[A-Za-z][A-Za-z0-9_]{0,63})$/.test(s.sourceKey) &&
    [s.categoryColumn,s.valueColumn].every(x =>
      typeof x === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(x)) &&
    s.categoryColumn !== s.valueColumn &&
    isRev(s.queryRevision) && isRev(s.datasetRevision) &&
    typeof s.policyRevision === "string" && /^[a-f0-9]{64}$/.test(s.policyRevision);
}
const sameScope = (a: PublicCountScope, b: PublicCountScope) =>
  (Object.keys(a) as Array<keyof PublicCountScope>).every(key=>a[key]===b[key]);
const keyFromRow = (row: any): PublicCountScope => ({
  dashboardId: Number(row.DashboardId), queryId: Number(row.QueryId),
  datasetId: Number(row.DatasetId), sourceKey: String(row.SourceKey),
  categoryColumn: String(row.CategoryColumn), valueColumn: String(row.ValueColumn),
  queryRevision: revision(row.QueryRevision) ?? "",
  datasetRevision: revision(row.DatasetRevision) ?? "",
  policyRevision: String(row.PolicyRevision),
});

/** Every decision AND its AuditLog row are written atomically. RequestId is
 * unique in an append-only ledger, so replays fail even after A->B->A.
 * No patient data, SQL text, credentials or medical details enter audit. */
async function audit(tx: sql.Transaction, actor: ChartTrustActor, action: ChartTrustAction,
  requestId: string, details: Record<string, string | number>): Promise<number> {
  await new sql.Request(tx)
    .input("requestId",sql.UniqueIdentifier,requestId)
    .input("action",sql.NVarChar(40),action)
    .input("actor",sql.BigInt,actor.userId)
    .query("INSERT uqp.DashboardChartTrustRequest(RequestId,Action,ActorId) VALUES(@requestId,@action,@actor)");
  const payload=JSON.stringify({action,requestId,...details});
  if(payload.length>3000) return fail("CHART_AUDIT_TOO_LARGE");
  const rows=(await new sql.Request(tx)
    .input("event",sql.NVarChar(100),"CHART_"+action)
    .input("actor",sql.BigInt,actor.userId)
    .input("details",sql.NVarChar(sql.MAX),payload)
    .query("INSERT uqp.AuditLog(EventType,EventCategory,IsImportant,UserId,Status,ParametersJson,CompletedAtUtc) " +
      "OUTPUT INSERTED.Id AS Id VALUES(@event,'CONFIG',1,@actor,'SUCCESS',@details,SYSUTCDATETIME())")).recordset;
  const id=Number(rows[0]?.Id);
  if(rows.length!==1||!validId(id)) return fail("CHART_AUDIT_REQUIRED");
  const updated=(await new sql.Request(tx)
    .input("requestId",sql.UniqueIdentifier,requestId).input("auditId",sql.BigInt,id)
    .query("UPDATE uqp.DashboardChartTrustRequest SET AuditLogId=@auditId WHERE RequestId=@requestId; SELECT @@ROWCOUNT AS Affected")).recordset;
  if(Number(updated[0]?.Affected)!==1) return fail("CHART_AUDIT_REQUIRED");
  return id;
}
async function inTransaction<T>(deps: ChartTrustWriterDependencies,
  job:(tx: sql.Transaction)=>Promise<T>):Promise<T> {
  if(!deps.enabled()) return fail("CHART_WRITE_DISABLED");
  const pool=await deps.pool();
  if(!pool) return fail("CHART_WRITE_UNAVAILABLE");
  const tx=new sql.Transaction(pool);
  try{
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await new sql.Request(tx).query("SET XACT_ABORT ON; SET LOCK_TIMEOUT 5000");
    const result=await job(tx);
    await tx.commit();
    return result;
  }catch(e){
    try{await tx.rollback();}catch{/* closed transaction */}
    if(e instanceof ChartTrustWriteError)throw e;
    return fail("CHART_TRUST_WRITE_REJECTED");
  }
}
function actorIsValid(a: ChartTrustActor){return !!a&&validId(a.userId)&&validId(a.tokenVersion);}
function requestIsValid(a: ChartTrustActor, requestId: string){
  if(!actorIsValid(a)||!isUUID(requestId))return fail("CHART_WRITE_INPUT_INVALID");
}

export function createDormantChartTrustWriters(deps: ChartTrustWriterDependencies){
  return {
    /** CAS on sidecar SealRowVersion; Widget ConfigJson and seal are updated in
     * the SAME transaction. Existing SQL WidgetType CK still blocks CHART in
     * production, and this writer is not registered on any route. */
    sealWidget: async(input:{
      dashboardId:number;widgetId:number;actor:ChartTrustActor;
      requestId:string; expectedRevision:string; config:unknown;
    }):Promise<string>=>{
      const {dashboardId,widgetId,actor,requestId,expectedRevision}=input;
      requestIsValid(actor,requestId);
      if(!validId(dashboardId)||!validId(widgetId)||!isRev(expectedRevision))return fail("CHART_SEAL_INPUT_INVALID");
      const parsed=chartWidgetConfigSchema.safeParse(input.config);
      if(!parsed.success)return fail("CHART_SEAL_INPUT_INVALID");
      const normalized=JSON.stringify(parsed.data);
      if(normalized.length>8192)return fail("CHART_SEAL_INPUT_INVALID");
      const digest=createHash("sha256").update(normalized).digest("hex");
      return inTransaction(deps,async tx=>{
        const scope={dashboardId,widgetId};
        await deps.authorize(tx,actor,"SEAL_WIDGET",scope);
        const locked=(await new sql.Request(tx)
          .input("dashboardId",sql.BigInt,dashboardId)
          .input("widgetId",sql.BigInt,widgetId)
          .query("SELECT w.Id,w.WidgetType,w.SourceKey,s.SealRowVersion,s.IsActive " +
            "FROM uqp.DashboardWidget w WITH(UPDLOCK,HOLDLOCK) " +
            "JOIN uqp.DashboardDisplayProfile p WITH(UPDLOCK,HOLDLOCK) ON p.Id=w.ProfileId " +
            "JOIN uqp.DashboardChartWidgetSeal s WITH(UPDLOCK,HOLDLOCK) ON s.WidgetId=w.Id " +
            "WHERE p.DashboardId=@dashboardId AND w.Id=@widgetId")).recordset;
        const row=locked.length===1?locked[0]:null;
        if(!row||row.WidgetType!=="CHART"||row.SourceKey!==parsed.data.dataSourceKey||
            row.IsActive!==true||revision(row.SealRowVersion)!==expectedRevision)
          return fail("CHART_SEAL_VERSION_CONFLICT");
        const auditId=await audit(tx,actor,"SEAL_WIDGET",requestId,{dashboardId,widgetId,digest});
        const changed=(await new sql.Request(tx)
          .input("widgetId",sql.BigInt,widgetId)
          .input("raw",sql.NVarChar(sql.MAX),normalized)
          .query("UPDATE uqp.DashboardWidget SET ConfigJson=@raw WHERE Id=@widgetId; SELECT @@ROWCOUNT AS Affected")).recordset;
        if(Number(changed[0]?.Affected)!==1)return fail("CHART_SEAL_VERSION_CONFLICT");
        const updated=(await new sql.Request(tx)
          .input("widgetId",sql.BigInt,widgetId)
          .input("expected",sql.Binary,Buffer.from(expectedRevision,"hex"))
          .input("digest",sql.Char(64),digest)
          .input("actor",sql.BigInt,actor.userId)
          .input("audit",sql.BigInt,auditId)
          .query("UPDATE uqp.DashboardChartWidgetSeal SET ConfigDigest=@digest,SealedBy=@actor,AuditLogId=@audit " +
            "OUTPUT INSERTED.SealRowVersion AS Revision WHERE WidgetId=@widgetId AND IsActive=1 " +
            "AND SealRowVersion=@expected")).recordset;
        const next=updated.length===1?revision(updated[0].Revision):null;
        if(!next||next===expectedRevision)return fail("CHART_SEAL_VERSION_CONFLICT");
        await deps.authorize(tx,actor,"SEAL_WIDGET",scope);
        return next;
      });
    },
    requestReview: async(input:{
      scope:PublicCountScope;actor:ChartTrustActor;requestId:string;
    }):Promise<{id:number;revision:string}>=>{
      requestIsValid(input.actor,input.requestId);
      if(!validScope(input.scope))return fail("CHART_REVIEW_INPUT_INVALID");
      return inTransaction(deps,async tx=>{
        await deps.authorize(tx,input.actor,"REQUEST_REVIEW",input.scope);
        const live=await deps.readLiveScope(tx,input.scope);
        if(!live||!sameScope(input.scope,live))return fail("CHART_REVIEW_SCOPE_STALE");
        // Locks the complete review set, including missing keys, to prevent
        // two simultaneous REQUESTED decisions for the same scope.
        const rows=(await new sql.Request(tx)
          .input("dash",sql.BigInt,input.scope.dashboardId)
          .input("query",sql.BigInt,input.scope.queryId)
          .input("dataset",sql.BigInt,input.scope.datasetId)
          .input("source",sql.NVarChar(64),input.scope.sourceKey)
          .input("category",sql.NVarChar(128),input.scope.categoryColumn)
          .input("value",sql.NVarChar(128),input.scope.valueColumn)
          .query("SELECT Status FROM uqp.DashboardChartPrivacyReview WITH(TABLOCKX,HOLDLOCK) " +
            "WHERE DashboardId=@dash AND QueryId=@query AND DatasetId=@dataset " +
            "AND SourceKey=@source AND CategoryColumn=@category AND ValueColumn=@value")).recordset;
        if(rows.some((r:any)=>r.Status==="REQUESTED"||r.Status==="APPROVED"))
          return fail("CHART_REVIEW_ALREADY_ACTIVE");
        const idAudit=await audit(tx,input.actor,"REQUEST_REVIEW",input.requestId,{
          dashboardId:input.scope.dashboardId,queryId:input.scope.queryId,datasetId:input.scope.datasetId});
        const s=input.scope;
        const records=(await new sql.Request(tx)
          .input("dashboard",sql.BigInt,s.dashboardId)
          .input("query",sql.BigInt,s.queryId).input("dataset",sql.BigInt,s.datasetId)
          .input("source",sql.NVarChar(64),s.sourceKey)
          .input("category",sql.NVarChar(128),s.categoryColumn)
          .input("value",sql.NVarChar(128),s.valueColumn)
          .input("qRev",sql.Binary,Buffer.from(s.queryRevision,"hex"))
          .input("dRev",sql.Binary,Buffer.from(s.datasetRevision,"hex"))
          .input("policy",sql.Char(64),s.policyRevision)
          .input("actor",sql.BigInt,input.actor.userId)
          .input("audit",sql.BigInt,idAudit)
          .query("INSERT uqp.DashboardChartPrivacyReview(" +
            "DashboardId,QueryId,DatasetId,SourceKey,CategoryColumn,ValueColumn," +
            "QueryRevision,DatasetRevision,PolicyRevision,Status,MinimumCellCount," +
            "CategoryPrivacyReviewed,DifferencingRiskReviewed,RequestedByUserId,RequestedAtUtc,AuditLogId)" +
            "OUTPUT INSERTED.Id AS Id,INSERTED.ReviewRowVersion AS Revision " +
            "VALUES(@dashboard,@query,@dataset,@source,@category,@value,@qRev,@dRev,@policy," +
            "'REQUESTED',0,0,0,@actor,SYSUTCDATETIME(),@audit)")).recordset;
        const result=records.length===1?records[0]:null;
        const id=Number(result?.Id),rev=revision(result?.Revision);
        if(!validId(id)||!rev)return fail("CHART_REVIEW_WRITE_FAILED");
        await deps.authorize(tx,input.actor,"REQUEST_REVIEW",input.scope);
        return {id,revision:rev};
      });
    },
    /** Review decisions require a *different*, independently authorized
     * actor from the requester. Must explicitly attest BOTH risk reviews. */
    approveReview: async(input:{
      id:number;expectedRevision:string;actor:ChartTrustActor;requestId:string;
      minimumCellCount:number;validDays:number;
      categoryPrivacyReviewed:true;differencingRiskReviewed:true;
    }):Promise<string>=>{
      requestIsValid(input.actor,input.requestId);
      if(!validId(input.id)||!isRev(input.expectedRevision)||
          !Number.isSafeInteger(input.minimumCellCount)||input.minimumCellCount<5||
          input.minimumCellCount>1000||!Number.isSafeInteger(input.validDays)||
          input.validDays<1||input.validDays>90||
          input.categoryPrivacyReviewed!==true||input.differencingRiskReviewed!==true)
        return fail("CHART_REVIEW_INPUT_INVALID");
      return inTransaction(deps,async tx=>{
        const records=(await new sql.Request(tx).input("id",sql.BigInt,input.id)
          .query("SELECT * FROM uqp.DashboardChartPrivacyReview WITH(UPDLOCK,HOLDLOCK) WHERE Id=@id")).recordset;
        const r=records.length===1?records[0]:null;
        if(!r||r.Status!=="REQUESTED"||revision(r.ReviewRowVersion)!==input.expectedRevision||
            !validId(Number(r.RequestedByUserId))||Number(r.RequestedByUserId)===input.actor.userId)
          return fail("CHART_REVIEW_VERSION_CONFLICT");
        const scope=keyFromRow(r);
        if(!validScope(scope))return fail("CHART_REVIEW_SCOPE_STALE");
        await deps.authorize(tx,input.actor,"APPROVE_REVIEW",scope);
        const live=await deps.readLiveScope(tx,scope);
        if(!live||!sameScope(scope,live))return fail("CHART_REVIEW_SCOPE_STALE");
        const auditId=await audit(tx,input.actor,"APPROVE_REVIEW",input.requestId,{
          dashboardId:scope.dashboardId,reviewId:input.id,minimumCellCount:input.minimumCellCount});
        const rows=(await new sql.Request(tx)
          .input("id",sql.BigInt,input.id)
          .input("expected",sql.Binary,Buffer.from(input.expectedRevision,"hex"))
          .input("actor",sql.BigInt,input.actor.userId)
          .input("audit",sql.BigInt,auditId)
          .input("minimum",sql.Int,input.minimumCellCount)
          .input("days",sql.Int,input.validDays)
          .query("UPDATE uqp.DashboardChartPrivacyReview SET Status='APPROVED'," +
            "MinimumCellCount=@minimum,CategoryPrivacyReviewed=1,DifferencingRiskReviewed=1," +
            "ReviewerUserId=@actor,ReviewedAtUtc=SYSUTCDATETIME()," +
            "ValidUntilUtc=DATEADD(day,@days,SYSUTCDATETIME()),AuditLogId=@audit " +
            "OUTPUT INSERTED.ReviewRowVersion AS Revision " +
            "WHERE Id=@id AND Status='REQUESTED' AND ReviewRowVersion=@expected")).recordset;
        const updated=rows.length===1?revision(rows[0].Revision):null;
        if(!updated||updated===input.expectedRevision)return fail("CHART_REVIEW_VERSION_CONFLICT");
        await deps.authorize(tx,input.actor,"APPROVE_REVIEW",scope);
        return updated;
      });
    },
    revokeReview: async(input:{id:number;expectedRevision:string;actor:ChartTrustActor;requestId:string;}):Promise<string>=>{
      requestIsValid(input.actor,input.requestId);
      if(!validId(input.id)||!isRev(input.expectedRevision))return fail("CHART_REVIEW_INPUT_INVALID");
      return inTransaction(deps,async tx=>{
        const rows=(await new sql.Request(tx).input("id",sql.BigInt,input.id)
          .query("SELECT * FROM uqp.DashboardChartPrivacyReview WITH(UPDLOCK,HOLDLOCK) WHERE Id=@id")).recordset;
        const r=rows.length===1?rows[0]:null;
        if(!r||r.Status!=="APPROVED"||revision(r.ReviewRowVersion)!==input.expectedRevision)
          return fail("CHART_REVIEW_VERSION_CONFLICT");
        const scope=keyFromRow(r);
        if(!validScope(scope))return fail("CHART_REVIEW_SCOPE_STALE");
        await deps.authorize(tx,input.actor,"REVOKE_REVIEW",scope);
        const auditId=await audit(tx,input.actor,"REVOKE_REVIEW",input.requestId,{
          dashboardId:scope.dashboardId,reviewId:input.id});
        const changed=(await new sql.Request(tx)
          .input("id",sql.BigInt,input.id)
          .input("expected",sql.Binary,Buffer.from(input.expectedRevision,"hex"))
          .input("audit",sql.BigInt,auditId)
          .query("UPDATE uqp.DashboardChartPrivacyReview SET Status='REVOKED'," +
            "ValidUntilUtc=SYSUTCDATETIME(),AuditLogId=@audit " +
            "OUTPUT INSERTED.ReviewRowVersion AS Revision " +
            "WHERE Id=@id AND Status='APPROVED' AND ReviewRowVersion=@expected")).recordset;
        const updated=changed.length===1?revision(changed[0].Revision):null;
        if(!updated||updated===input.expectedRevision)return fail("CHART_REVIEW_VERSION_CONFLICT");
        await deps.authorize(tx,input.actor,"REVOKE_REVIEW",scope);
        return updated;
      });
    },
  };
}
// Do not export a configured production singleton or register a route.
