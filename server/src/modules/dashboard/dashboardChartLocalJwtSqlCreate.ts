// Issue #89 — Option A: LOCAL JWT is the application identity authority.
// The dedicated least-privilege SQL Writer is a separate *execution* boundary,
// NOT a separate independent identity authority. A compromised UQP server may
// impersonate an actor; this residual risk requires explicit owner acceptance.
// This adapter receives only a plan from the immutable, JWT+live-DB-verified
// HTTP request. It does not receive, forward, or store bearer JWT or HMAC keys.
// Production stays hard-OFF until Gate 2/3 source, SQL procedure, SID and
// operator acceptance; an existing disposable SQL prototype is NEVER enough.
import sql from "mssql";
import {
  planDormantChartCreate,type DormantChartCreatePlan,
  CHART_ATOMIC_CREATE_RUNTIME_ENABLED,
} from "./dashboardChartAtomicCreate.contract.js";
import {parseChartCreateSqlReceipt} from "./dashboardChartCreateReceipt.js";
import {
  attestChartWriterSqlPools,CHART_WRITER_APPROVED_PROCEDURE_SHA256,
  type ChartWriterApprovedOriginalSids,
} from "./dashboardChartWriterBoundary.js";
import {
  CHART_SQL_APPROVED_PLATFORM_SID,CHART_SQL_APPROVED_WRITER_SID,
} from "./dashboardChartSqlPrincipalPreflight.js";

// The selected architecture is an accepted design decision, NOT permission
// to execute a production SQL writer or enable the HTTP route.
export const CHART_LOCAL_JWT_WRITER_RELEASE_APPROVED=false as const;

export const chartLocalJwtWriterCreateSql=[
  "EXEC uqp.usp_DashboardChartCreate",
  "@DashboardId=@dashboard,@ProfileId=@profile,",
  "@ActorId=@actor,@TokenVersion=@token,@RequestId=@requestId,",
  "@SourceKey=@source,@ConfigJson=@config,@X=@x,@Y=@y,",
  "@Width=@width,@Height=@height;",
].join(" ");

export type LocalJwtChartCreateDependencies=Readonly<{
  enabled:()=>boolean;
  getPlatformPool:()=>Promise<sql.ConnectionPool|null>;
  getWriterPool:()=>Promise<sql.ConnectionPool|null>;
  // Pins must come from reviewed source/SQL identity evidence, never a JWT,
  // HTTP request, environment override or observed auto-learned DB metadata.
  approvedWriterSha256:string|null;
  approvedSids:ChartWriterApprovedOriginalSids|null;
}>;

function validPlan(plan:DormantChartCreatePlan):boolean{
  if(!plan?.config||!plan.placement)return false;
  const expected=planDormantChartCreate({
    dashboardId:plan.dashboardId,profileId:plan.profileId,
    actorId:plan.actorId,tokenVersion:plan.tokenVersion,
    requestId:plan.requestId,config:plan.config.data,
    placement:plan.placement,
  });
  return !!expected&&expected.config.json===plan.config.json&&
    expected.config.sha256===plan.config.sha256&&
    expected.sourceKey===plan.sourceKey;
}

/** A DI-only test seam for the selected two-login approach.
 * The final approved stored procedure MUST revalidate active actor,
 * TokenVersion, DESIGN_QUERY + EXECUTE_QUERY, Query/Dataset/source
 * revisions, replay, layout ownership and audit under its own SERIALIZABLE
 * transaction, then atomically return the Widget/Seal/Audit receipt.
 * A separate Node-side recheck cannot replace the SQL transaction.
 * No independently signed ActorId claim is made in this trust model.
 */
export function createDormantLocalJwtChartCreate(
  deps:LocalJwtChartCreateDependencies,
):(plan:DormantChartCreatePlan)=>Promise<unknown|null>{
  return async(plan)=>{
    // Block before acquiring any SQL pool or allocating a SQL request.
    if(!deps.enabled()||!validPlan(plan)||
       typeof deps.approvedWriterSha256!=="string"||
       !/^[a-f0-9]{64}$/.test(deps.approvedWriterSha256)||
       !deps.approvedSids)return null;
    try{
      const platform=await deps.getPlatformPool();
      if(!platform)return null;
      const writer=await deps.getWriterPool();
      if(!writer||platform===writer)return null;
      // Two distinct ORIGINAL_LOGIN SIDs, exact module SHA256 and current
      // least-privilege GRANT/DENY are checked on EVERY write attempt.
      await attestChartWriterSqlPools(
        platform,writer,deps.approvedWriterSha256,deps.approvedSids);
      const request=writer.request()
        .input("dashboard",sql.BigInt,plan.dashboardId)
        .input("profile",sql.BigInt,plan.profileId)
        .input("actor",sql.BigInt,plan.actorId)
        .input("token",sql.Int,plan.tokenVersion)
        .input("requestId",sql.UniqueIdentifier,plan.requestId)
        .input("source",sql.NVarChar(64),plan.sourceKey)
        .input("config",sql.NVarChar(sql.MAX),plan.config.json)
        .input("x",sql.Int,plan.placement.x)
        .input("y",sql.Int,plan.placement.y)
        .input("width",sql.Int,plan.placement.width)
        .input("height",sql.Int,plan.placement.height);
      const rows=(await request.query(chartLocalJwtWriterCreateSql)).recordset;
      if(rows?.length!==1||!parseChartCreateSqlReceipt(rows[0],plan))
        return null;
      // Return only the exact SQL-owned receipt, never any Query row data.
      return rows[0];
    }catch{
      // Do not expose SQL grants, user tokens, errors or patient data.
      return null;
    }
  };
}

/** Only factory allowed into Dashboard runtime. No test injection of gate
 * values or approved identities: compile-time hard-OFF until the approved
 * Gate 2/3 release change, followed by a separate Gate 4 IIS acceptance.
 */
export function createReleaseDisabledLocalJwtChartCreate(
  getPlatformPool:()=>Promise<sql.ConnectionPool|null>,
  getWriterPool:()=>Promise<sql.ConnectionPool|null>,
){
  return createDormantLocalJwtChartCreate({
    enabled:()=>CHART_LOCAL_JWT_WRITER_RELEASE_APPROVED&&
      CHART_ATOMIC_CREATE_RUNTIME_ENABLED,
    getPlatformPool,getWriterPool,
    approvedWriterSha256:CHART_WRITER_APPROVED_PROCEDURE_SHA256,
    approvedSids:CHART_SQL_APPROVED_PLATFORM_SID&&CHART_SQL_APPROVED_WRITER_SID?
      {platform:CHART_SQL_APPROVED_PLATFORM_SID,
       writer:CHART_SQL_APPROVED_WRITER_SID}:null,
  });
}
