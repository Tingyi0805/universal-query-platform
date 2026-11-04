// 2B-9: exercise dormant trust writers with actual SQL Server transactions
// in the pre-existing, isolated UQP_CF_ synthetic database only.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sql from "mssql";
import { getTokenSessionState } from "../modules/auth/auth.repository.js";
import { createDormantChartTrustWriters, ChartTrustWriteError,
  type ChartTrustActor, type ChartTrustAction } from "../modules/dashboard/dashboardChartTrust.writer.js";
import { createDormantChartTrustReaders } from "../modules/dashboard/dashboardChartTrust.repository.js";
import type { PublicCountScope } from "../modules/dashboard/dashboardChartPublicCountPrivacy.js";
const uid = (suffix: number) => "00000000-0000-4000-8000-" + suffix.toString(16).padStart(12, "0");
const normalized = (row: any): PublicCountScope => ({
  dashboardId: 7,queryId: 9,datasetId: 10,sourceKey: "PRIMARY",
  categoryColumn: "ROOM",valueColumn: "TOTAL",
  queryRevision: BigInt(row.QueryVersion).toString(16).padStart(16,"0"),
  datasetRevision: (row.DatasetRevision as Buffer).toString("hex"),
  policyRevision: createHash("sha256").update(JSON.stringify([
    (row.DashboardRevision as Buffer).toString("hex"),
    (row.SourceRevision as Buffer).toString("hex"),
    (row.PublicRevision as Buffer).toString("hex"),
    String(row.SensitivityVersion),
  ])).digest("hex"),
});
export async function verifyChartTrustWriterSql(db: sql.ConnectionPool){
  if(process.env.UQP_D1_SCOPE!=="DISPOSABLE_ONLY")throw Error("CHART_WRITER_DISPOSABLE_ONLY");
  const database=(await db.request().query("SELECT DB_NAME() AS Db")).recordset[0]?.Db;
  if(!/^UQP_CF_[a-f0-9]{12}$/i.test(String(database??"")))throw Error("CHART_WRITER_DATABASE_MISMATCH");

  const requester:ChartTrustActor={userId:8,tokenVersion:1};
  const reviewer:ChartTrustActor={userId:77,tokenVersion:1};
  await db.request().query("UPDATE uqp.DataSource SET IsActive=1 WHERE Id=11; " +
    "UPDATE p SET ConfigurationVersion=s.ConfigurationRowVersion " +
    "FROM uqp.DatasetPublicDisplayPolicy p JOIN uqp.DataSource s ON s.Id=p.DataSourceId WHERE p.DatasetId=10; " +
    "UPDATE uqp.DashboardChartPrivacyReview SET Status='REVOKED' WHERE Id=123; " +
    "INSERT uqp.AppUser(Id,IsActive,TokenVersion) VALUES(77,1,1); " +
    "INSERT uqp.Role(Id,IsActive) VALUES(2,1); " +
    "INSERT uqp.UserRole(UserId,RoleId) VALUES(77,2); " +
    "INSERT uqp.Permission(Id,Code) VALUES(4,N'APPROVE_CHART_PUBLIC'); " +
    "INSERT uqp.RolePermission(RoleId,PermissionId) VALUES(2,4);");
  const current=async(req:sql.Request)=>{
    const rows=(await req.query("SELECT d.DefinitionRowVersion AS DatasetRevision," +
      " db.ApprovalRowVersion AS DashboardRevision,s.ConfigurationRowVersion AS SourceRevision," +
      " p.RowVersion AS PublicRevision,v.QueryVersion,sp.VersionNumber AS SensitivityVersion " +
      "FROM uqp.QueryDefinition q WITH(HOLDLOCK) " +
      "JOIN uqp.Dataset d WITH(HOLDLOCK) ON d.Id=q.DatasetId " +
      "JOIN uqp.DataSource s WITH(HOLDLOCK) ON s.Id=d.DataSourceId " +
      "JOIN uqp.Dashboard db WITH(HOLDLOCK) ON db.Id=7 AND db.QueryDefinitionId=q.Id " +
      "JOIN uqp.DatasetSensitivePolicyVersion sp WITH(HOLDLOCK) ON sp.DatasetId=d.Id " +
      "JOIN uqp.DatasetPublicDisplayPolicy p WITH(HOLDLOCK) ON p.DatasetId=d.Id " +
      "OUTER APPLY(SELECT MAX(VersionNo) AS QueryVersion FROM uqp.QueryDefinitionVersion WITH(HOLDLOCK) WHERE QueryDefinitionId=q.Id) v " +
      "WHERE q.Id=9 AND d.Id=10 AND q.IsPublished=1 AND q.IsActive=1 AND q.IsArchived=0 " +
      "AND d.IsActive=1 AND d.IsArchived=0 AND s.IsActive=1 AND db.IsActive=1 " +
      "AND db.QueryMode='QUERY_ONLY' AND p.SensitivityVersion=sp.VersionNumber " +
      "AND p.ConfigurationVersion=s.ConfigurationRowVersion " +
      "AND p.DefinitionVersion=d.DefinitionRowVersion")).recordset;
    return rows.length===1?normalized(rows[0]):null;
  };
  const initialScope=await current(db.request());
  assert(initialScope);
  const readers=createDormantChartTrustReaders(async()=>db);
  const writer=createDormantChartTrustWriters({
    enabled:()=>true,
    pool:async()=>db,
    authorize:async(tx,actor,action:ChartTrustAction,scope)=>{
      if(!Number.isSafeInteger(actor.userId)||!Number.isSafeInteger(actor.tokenVersion))
        throw Error("ACCESS_DENIED");
      const state=await getTokenSessionState(actor.userId,tx);
      if(!state?.isActive||state.tokenVersion!==actor.tokenVersion)
        throw Error("TOKEN_REVOKED");
      const permission=action==="SEAL_WIDGET"||action==="REQUEST_REVIEW"
        ?"DESIGN_QUERY":"APPROVE_CHART_PUBLIC";
      if(!state.permissions.includes(permission)||scope.dashboardId!==7)
        throw Error("ACCESS_DENIED");
    },
    readLiveScope:async(tx,claimed)=>{
      const currentScope=await current(new sql.Request(tx));
      return currentScope &&
        (Object.keys(claimed) as Array<keyof PublicCountScope>)
          .every(key=>currentScope[key]===claimed[key]) ? currentScope : null;
    },
  });
  const original=await readers.readSavedWidget(7,88);assert(original);
  const config={...(original.config as object),maxPoints:12};
  const sealRevision=await writer.sealWidget({
    dashboardId:7,widgetId:88,actor:requester,requestId:uid(1),
    expectedRevision:original.revision,config,
  });
  assert.notEqual(sealRevision,original.revision);
  assert.equal((await readers.readSavedWidget(7,88))?.revision,sealRevision);
  await assert.rejects(writer.sealWidget({
    dashboardId:7,widgetId:88,actor:requester,requestId:uid(2),
    expectedRevision:original.revision,config,
  }),ChartTrustWriteError);
  await assert.rejects(writer.sealWidget({
    dashboardId:7,widgetId:88,actor:requester,requestId:uid(1),
    expectedRevision:sealRevision,config,
  }),ChartTrustWriteError);
  const revisedBack=await writer.sealWidget({
    dashboardId:7,widgetId:88,actor:requester,requestId:uid(3),
    expectedRevision:sealRevision,config:original.config,
  });
  assert(revisedBack!==original.revision&&revisedBack!==sealRevision);
  // Synthetic request uses the database-current approval revision, not a
  // browser-provided or hardcoded version digest.
  const requested=await writer.requestReview({
    scope:initialScope,actor:requester,requestId:uid(4),
  });
  assert(requested.id>0&&/^[a-f0-9]{16}$/.test(requested.revision));
  assert.equal(await readers.readPublicReview(initialScope,{
    context:"user",userId:8,tokenVersion:1,tokenHash:"synthetic",
  }),null); // REQUESTED is never accepted as approval.
  await assert.rejects(writer.requestReview({
    scope:initialScope,actor:requester,requestId:uid(5),
  }),ChartTrustWriteError);
  await assert.rejects(writer.approveReview({
    id:requested.id,expectedRevision:requested.revision,
    actor:requester,requestId:uid(6),minimumCellCount:5,validDays:30,
    categoryPrivacyReviewed:true,differencingRiskReviewed:true,
  }),ChartTrustWriteError); // requester cannot approve
  const approvedRevision=await writer.approveReview({
    id:requested.id,expectedRevision:requested.revision,
    actor:reviewer,requestId:uid(7),minimumCellCount:5,validDays:90,
    categoryPrivacyReviewed:true,differencingRiskReviewed:true,
  });
  assert(approvedRevision!==requested.revision);
  // The maximum approved duration must be exactly 90 days, never longer:
  // the dormant reader enforces this same upper bound in milliseconds.
  const windowRows=(await db.request().input("id",sql.BigInt,requested.id)
    .query("SELECT DATEDIFF_BIG(millisecond,ReviewedAtUtc,ValidUntilUtc) AS WindowMs " +
      "FROM uqp.DashboardChartPrivacyReview WHERE Id=@id")).recordset;
  assert.equal(windowRows.length,1);
  assert.equal(Number(windowRows[0].WindowMs),90*86400000);
  const scopeViewer={context:"user" as const,userId:8,tokenVersion:1,tokenHash:"synthetic"};
  const approved=await readers.readPublicReview(initialScope,scopeViewer);
  assert(approved&&approved.minimumCellCount===5);
  await assert.rejects(writer.approveReview({
    id:requested.id,expectedRevision:requested.revision,
    actor:reviewer,requestId:uid(8),minimumCellCount:5,validDays:30,
    categoryPrivacyReviewed:true,differencingRiskReviewed:true,
  }),ChartTrustWriteError);
  const revoked=await writer.revokeReview({
    id:requested.id,expectedRevision:approvedRevision,
    actor:reviewer,requestId:uid(9),
  });
  assert(revoked!==approvedRevision);
  assert.equal(await readers.readPublicReview(initialScope,scopeViewer),null);
  await assert.rejects(writer.revokeReview({
    id:requested.id,expectedRevision:approvedRevision,actor:reviewer,requestId:uid(10),
  }),ChartTrustWriteError);
  // Revocation cannot be undone by reusing an old approval or RequestId.
  const second=await writer.requestReview({
    scope:initialScope,actor:requester,requestId:uid(11),
  });
  assert(second.id!==requested.id);
  await db.request().query("UPDATE uqp.Dataset SET SqlText=SqlText WHERE Id=10");
  await assert.rejects(writer.approveReview({
    id:second.id,expectedRevision:second.revision,
    actor:reviewer,requestId:uid(12),minimumCellCount:5,validDays:30,
    categoryPrivacyReviewed:true,differencingRiskReviewed:true,
  }),ChartTrustWriteError);
  const audits=(await db.request().query("SELECT COUNT(*) AS Total FROM uqp.AuditLog")).recordset[0]?.Total;
  const decision=(await db.request().query("SELECT COUNT(*) AS Total FROM uqp.DashboardChartTrustRequest")).recordset[0]?.Total;
  assert.equal(Number(audits),6);
  assert.equal(Number(decision),6);
  console.log("CHART_TRUST_WRITER_2B9_ATOMIC_SEAL_CAS_AUDIT_REVIEW_REVOKE_PASS");
}
