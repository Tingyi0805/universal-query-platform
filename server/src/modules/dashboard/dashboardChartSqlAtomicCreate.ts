// Issue #89: SQL Issuer -> Writer atomic-create transport.
// Not an installer or production SQL executor. NO pools/credentials are made
// here. Only independently provisioned SQL logins may run the future,
// reviewed, pinned production procedures (NEVER the disposable prototypes).
// This module is NOT registered in the runtime Dashboard router.
import sql from "mssql";
import {
  planDormantChartCreate,type DormantChartCreatePlan,
} from "./dashboardChartAtomicCreate.contract.js";
import type {VerifiedSqlChartIssuerProof} from
  "./dashboardChartIndependentIssuerProof.js";
import {parseChartCreateSqlReceipt} from "./dashboardChartCreateReceipt.js";
import {
  createDormantChartSqlPrincipalPreflight,
  type ReviewedChartSqlProcedures,
} from "./dashboardChartSqlPrincipalPreflight.js";
import {
  CHART_ISSUER_APPROVED_PROCEDURE_SHA256,
} from "./dashboardChartIssuerBoundary.js";
import {
  CHART_WRITER_APPROVED_PROCEDURE_SHA256,
  CHART_WRITER_DB_ACTOR_BINDING_APPROVED,
} from "./dashboardChartWriterBoundary.js";
import {CHART_ATOMIC_CREATE_RUNTIME_ENABLED} from "./dashboardChartAtomicCreate.contract.js";
import {CHART_DUAL_PROOF_RELEASE_APPROVED} from "./dashboardChartIndependentIssuerProof.js";
import {CHART_SIGNER_ISSUER_HANDOFF_RELEASE_APPROVED} from "./dashboardChartSignerIssuerHandoff.js";
import {CHART_SIGNER_CLIENT_RELEASE_APPROVED} from "./dashboardChartSignerClient.js";

export const CHART_SQL_ATOMIC_CREATE_RELEASE_APPROVED=false as const;
export const chartIssuerGrantSql=[
  "DECLARE @grant UNIQUEIDENTIFIER,@secret VARBINARY(32);",
  "EXEC uqp.usp_ChartDelegationIssue",
  "@ActorId=@actor,@TokenVersion=@token,@DashboardId=@dashboard,",
  "@ProfileId=@profile,@RequestId=@requestId,@SourceKey=@source,",
  "@ConfigSha256=@digest,@X=@x,@Y=@y,@Width=@width,@Height=@height,",
  "@Nonce=@nonce,@IssuedAtUtc=@issued,@ExpiresAtUtc=@expires,",
  "@Signature=@signature,@GrantId=@grant OUTPUT,@Secret=@secret OUTPUT;",
  "SELECT @grant AS GrantId,@secret AS Secret;",
].join(" ");
export const chartWriterCreateSql=[
  "EXEC uqp.usp_DashboardChartCreate",
  "@DashboardId=@dashboard,@ProfileId=@profile,",
  "@ActorId=@actor,@TokenVersion=@token,@RequestId=@requestId,",
  "@GrantId=@grant,@Secret=@secret,@SourceKey=@source,",
  "@ConfigJson=@config,@X=@x,@Y=@y,@Width=@width,@Height=@height;",
].join(" ");

export type DormantSqlChartCreateDependencies=Readonly<{
  issuerPool:sql.ConnectionPool;writerPool:sql.ConnectionPool;
  // Caller must verify DISTINCT ORIGINAL_LOGIN SIDs, proc hashes and
  // least-privilege grants against the pinned independent release evidence.
  attestIndependentPrincipals:()=>Promise<void>;
  // Caller must use independent mTLS + Ed25519 + HMAC proof handoff.
  // Must never be formed from user-provided issuer claims.
  handoff:(plan:DormantChartCreatePlan,originalBearerHeader:string)=>
    Promise<VerifiedSqlChartIssuerProof|null>;
  enabled:()=>boolean;
  now?:()=>number;
}>;
// A 128-bit random nonce converted to SQL UNIQUEIDENTIFIER is NOT an
// RFC-4122 UUID: its version/variant bits are arbitrary. The SQL Issuer
// verifies the MAC and consumes the exact nonce, not an RFC variant bit.
const sqlNonceGuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// Only the grant produced by SQL NEWID() is required to be a v4 UUID.
const grantGuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const exact=(raw:unknown,keys:string):raw is Record<string,unknown>=>
  !!raw&&typeof raw==="object"&&!Array.isArray(raw)&&
  Object.keys(raw).sort().join("|")===keys;
const validTime=(v:unknown)=>typeof v==="number"&&Number.isSafeInteger(v)&&v>0;

function validatedPlan(plan:DormantChartCreatePlan):boolean{
  if(!plan?.config||!plan.placement)return false;
  const rebuilt=planDormantChartCreate({
    dashboardId:plan.dashboardId,profileId:plan.profileId,
    actorId:plan.actorId,tokenVersion:plan.tokenVersion,
    requestId:plan.requestId,config:plan.config.data,
    placement:plan.placement,
  });
  return !!rebuilt&&rebuilt.config.json===plan.config.json&&
    rebuilt.config.sha256===plan.config.sha256&&
    rebuilt.sourceKey===plan.sourceKey;
}
function proofMatches(
  p:VerifiedSqlChartIssuerProof,plan:DormantChartCreatePlan,now:number,
):boolean{
  if(!p||!validTime(now)||!Buffer.isBuffer(p.Signature)||
     p.Signature.length!==32||
     !(p.IssuedAtUtc instanceof Date)||
     !(p.ExpiresAtUtc instanceof Date)||
     !sqlNonceGuid.test(p.Nonce))return false;
  const issued=p.IssuedAtUtc.valueOf(),expires=p.ExpiresAtUtc.valueOf();
  return validTime(issued)&&validTime(expires)&&
    issued<=now&&now<expires&&expires-issued<=10_000&&
    p.ActorId===plan.actorId&&p.TokenVersion===plan.tokenVersion&&
    p.DashboardId===plan.dashboardId&&p.ProfileId===plan.profileId&&
    p.RequestId===plan.requestId&&p.SourceKey===plan.sourceKey&&
    p.ConfigSha256===plan.config.sha256&&
    p.X===plan.placement.x&&p.Y===plan.placement.y&&
    p.Width===plan.placement.width&&p.Height===plan.placement.height;
}

/** Testable but unregistered SQL adapter. Security release approval is an
 * entirely separate act: a returned row is trusted ONLY after two pinned
 * low-rights logins, reviewed stored procs, live actor proof and a successful
 * DB-owned SERIALIZABLE Writer transaction. Never issue an HTTP 201 from
 * an Issuer grant alone.
 */
export function createDormantSqlChartAtomicCreate(
  deps:DormantSqlChartCreateDependencies,
):(plan:DormantChartCreatePlan,originalBearerHeader:string)=>Promise<unknown|null>{
  return async(plan,originalBearerHeader)=>{
    if(!deps.enabled()||!deps.issuerPool||!deps.writerPool||
       deps.issuerPool===deps.writerPool||!validatedPlan(plan)||
       typeof originalBearerHeader!=="string"||
       !/^Bearer [A-Za-z0-9_.-]+$/.test(originalBearerHeader))
      return null;
    let secret:Buffer|null=null;
    const issuerSecrets:Buffer[]=[];
    try{
      // Caller must pin all login SIDs and exact reviewed SQL procedure
      // digests. A missing 928 schema or cross-grant must DENY here.
      await deps.attestIndependentPrincipals();
      const proof=await deps.handoff(plan,originalBearerHeader);
      const now=deps.now?.()??Date.now();
      if(!proof||!proofMatches(proof,plan,now))return null;
      const issuer=deps.issuerPool.request()
        .input("actor",sql.BigInt,proof.ActorId)
        .input("token",sql.Int,proof.TokenVersion)
        .input("dashboard",sql.BigInt,proof.DashboardId)
        .input("profile",sql.BigInt,proof.ProfileId)
        .input("requestId",sql.UniqueIdentifier,proof.RequestId)
        .input("source",sql.VarChar(64),proof.SourceKey)
        .input("digest",sql.Char(64),proof.ConfigSha256)
        .input("x",sql.Int,proof.X).input("y",sql.Int,proof.Y)
        .input("width",sql.Int,proof.Width)
        .input("height",sql.Int,proof.Height)
        .input("nonce",sql.UniqueIdentifier,proof.Nonce)
        .input("issued",sql.DateTime2(3),proof.IssuedAtUtc)
        .input("expires",sql.DateTime2(3),proof.ExpiresAtUtc)
        .input("signature",sql.VarBinary(32),proof.Signature);
      const issuerResult=await issuer.query(chartIssuerGrantSql);
      const rows=issuerResult.recordset;
      // A malformed/multi-row Issuer result must not leave a usable secret
      // resident in process memory, even when its grant ID is invalid.
      for(const candidate of rows??[]){
        if(candidate&&typeof candidate==="object"&&
           Buffer.isBuffer((candidate as Record<string,unknown>).Secret))
          issuerSecrets.push((candidate as {Secret:Buffer}).Secret);
      }
      if(rows?.length!==1||!exact(rows[0],"GrantId|Secret")||
         typeof rows[0].GrantId!=="string"||
         !grantGuid.test(rows[0].GrantId)||
         !Buffer.isBuffer(rows[0].Secret)||
         rows[0].Secret.length!==32)return null;
      const grantId=rows[0].GrantId;
      secret=rows[0].Secret;
      // A short-lived signer proof cannot be converted to a long-lived
      // locally buffered grant; SQL itself also checks nonce/expiry.
      const beforeWrite=deps.now?.()??Date.now();
      if(!validTime(beforeWrite)||
         beforeWrite>=proof.ExpiresAtUtc.valueOf())
        return null;
      const writer=deps.writerPool.request()
        .input("dashboard",sql.BigInt,plan.dashboardId)
        .input("profile",sql.BigInt,plan.profileId)
        .input("actor",sql.BigInt,plan.actorId)
        .input("token",sql.Int,plan.tokenVersion)
        .input("requestId",sql.UniqueIdentifier,plan.requestId)
        .input("grant",sql.UniqueIdentifier,grantId)
        .input("secret",sql.VarBinary(32),secret)
        .input("source",sql.NVarChar(64),plan.sourceKey)
        .input("config",sql.NVarChar(sql.MAX),plan.config.json)
        .input("x",sql.Int,plan.placement.x)
        .input("y",sql.Int,plan.placement.y)
        .input("width",sql.Int,plan.placement.width)
        .input("height",sql.Int,plan.placement.height);
      const result=await writer.query(chartWriterCreateSql);
      const created=result.recordset;
      if(created?.length!==1||
         !parseChartCreateSqlReceipt(created[0],plan))return null;
      // Return only the four DB-owned receipt columns. The HTTP layer
      // performs its own strict receipt validation before sending 201.
      return created[0];
    }catch{
      // Never disclose JWT, grant/secret, SQL errors or patient data.
      return null;
    }finally{
      // The single-use SQL grant secret must not remain in this process
      // after the Writer request completes or fails.
      for(const issuedSecret of issuerSecrets)issuedSecret.fill(0);
      if(secret&&!issuerSecrets.includes(secret))secret.fill(0);
    }
  };
}

/** The actual three-login, two-procedure attestor is supplied to the same
 * SQL grant -> Writer executor. This is the future integration seam: no
 * self-asserted "attestation succeeded" callback can be used by this factory.
 * Only isolated CI tests may supply synthetic reviewed procedure hashes.
 */
export type ChartPreflightBoundSqlCreateDependencies=Omit<
  DormantSqlChartCreateDependencies,"attestIndependentPrincipals"
>&Readonly<{
  platformPool:sql.ConnectionPool;
  reviewed:ReviewedChartSqlProcedures;
}>;
export function createPreflightBoundDormantSqlChartAtomicCreate(
  deps:ChartPreflightBoundSqlCreateDependencies,
){
  const preflight=createDormantChartSqlPrincipalPreflight({
    platform:deps.platformPool,issuer:deps.issuerPool,writer:deps.writerPool,
  },deps.reviewed,deps.enabled);
  return createDormantSqlChartAtomicCreate({
    ...deps,attestIndependentPrincipals:preflight,
  });
}

/** PRODUCTION-BOUND factory, kept offline. It intentionally does not allow
 * injected test flags, reviewed hashes, SQL principal approval, JWT trust
 * keys, or env strings to override the hard release gates. Even if called
 * from a future HTTP route it returns before any SQL request while blocked.
 */
export function createReleaseDisabledChartSqlAtomicCreate(
  deps:Omit<ChartPreflightBoundSqlCreateDependencies,"enabled"|"reviewed">,
){
  return createPreflightBoundDormantSqlChartAtomicCreate({
    ...deps,
    enabled:()=>CHART_SQL_ATOMIC_CREATE_RELEASE_APPROVED &&
      CHART_WRITER_DB_ACTOR_BINDING_APPROVED &&
      CHART_ATOMIC_CREATE_RUNTIME_ENABLED &&
      CHART_DUAL_PROOF_RELEASE_APPROVED &&
      CHART_SIGNER_ISSUER_HANDOFF_RELEASE_APPROVED &&
      CHART_SIGNER_CLIENT_RELEASE_APPROVED,
    reviewed:{
      issuerSha256:CHART_ISSUER_APPROVED_PROCEDURE_SHA256,
      writerSha256:CHART_WRITER_APPROVED_PROCEDURE_SHA256,
    },
  });
}
