// 2B-15D-9: dormant HTTP -> Issuer handoff *intent*, not authority.
// No route imports this module. No SQL issuer call, credential handling,
// grant creation, JWT minting, mutation, approved release or production DML.
import type {Request} from "express";
import type sql from "mssql";
import {getTokenSessionState} from "../auth/auth.repository.js";
import {planVerifiedChartCreateRequest} from "./dashboardChartAuthenticatedCreate.js";
import type {DormantChartCreatePlan} from "./dashboardChartAtomicCreate.contract.js";
import {
  CHART_ACTOR_ATTESTATION_PINNED_KEYS,
} from "./dashboardChartActorAttestation.js";
import {
  CHART_DUAL_PROOF_RELEASE_APPROVED,parseIndependentChartIssuerProof,
  type VerifiedSqlChartIssuerProof,
} from "./dashboardChartIndependentIssuerProof.js";
import {
  CHART_ATOMIC_CREATE_RUNTIME_ENABLED,
} from "./dashboardChartAtomicCreate.contract.js";
import {
  CHART_WRITER_APPROVED_PROCEDURE_SHA256,
  CHART_WRITER_DB_ACTOR_BINDING_APPROVED,
} from "./dashboardChartWriterBoundary.js";
import {
  CHART_ISSUER_APPROVED_PROCEDURE_SHA256,attestChartIssuerSqlPools,
} from "./dashboardChartIssuerBoundary.js";
import {
  CHART_SQL_APPROVED_PLATFORM_SID,
  CHART_SQL_APPROVED_ISSUER_SID,
  CHART_SQL_APPROVED_WRITER_SID,
} from "./dashboardChartSqlPrincipalPreflight.js";

/** All values are copied from the *server-derived* authenticated create plan.
 * RequestId is client-supplied for idempotency, never as proof of identity.
 * GrantId, issuer SID, secret, session flags and approval assertions are absent.
 */
export type DormantChartIssuerIntent=Readonly<{
  ActorId:number;TokenVersion:number;DashboardId:number;ProfileId:number;
  RequestId:string;SourceKey:string;ConfigSha256:string;
  X:number;Y:number;Width:number;Height:number;
}>;
/** SQL proof is server-private and must NEVER be included in an HTTP response. */
export type DormantChartVerifiedIssuerHandoff=Readonly<{
  intent:DormantChartIssuerIntent;
  proof:VerifiedSqlChartIssuerProof;
}>;

/** Testable data mapping only. A returned object is NOT an issuer grant.
 * readVerifiedChartExecuteActor uses a Request-private WeakMap populated after
 * jwt.verify AND the live database session check. It cannot be supplied
 * by headers, body or a forged req.authUser object.
 */
function intentFromPlan(plan:DormantChartCreatePlan):DormantChartIssuerIntent{
 return Object.freeze({
   ActorId:plan.actorId,TokenVersion:plan.tokenVersion,
   DashboardId:plan.dashboardId,ProfileId:plan.profileId,
   RequestId:plan.requestId,SourceKey:plan.sourceKey,
   ConfigSha256:plan.config.sha256,
   X:plan.placement.x,Y:plan.placement.y,
   Width:plan.placement.width,Height:plan.placement.height,
 });
}
export function deriveDormantChartIssuerIntent(
 req:Request,dashboardId:number,rawBody:unknown,
):DormantChartIssuerIntent|null{
 const plan=planVerifiedChartCreateRequest(req,dashboardId,rawBody);
 return plan?intentFromPlan(plan):null;
}

/** DORMANT preflight: deliberately refuses until four independent hard-coded
 * review conditions are approved. It never issues a SQL grant or invokes
 * an issuer procedure, including if all metadata checks ever succeed.
 *
 * In addition to the original gates, an independently signed Ed25519
 * actor/scope/expiry proof is mandatory. Production trust keys are pinned
 * to an empty registry until an independently approved signer exists.
 * Even a valid proof cannot replace the DB-owned one-time grant consumption.
 *
 * In particular, the SQL Issuer prototype currently accepts @ActorId;
 * checking that Actor's RBAC is not cryptographic proof of the HTTP caller.
 * A future reviewed bridge must independently bind the original HTTP
 * authentication to the issuer-controlled SQL grant and keep the Writer
 * unable to mint grants or impersonate another valid Actor.
 */
export async function prepareDormantChartIssuerHandoff(
 req:Request,dashboardId:number,rawBody:unknown,
 platformPool:sql.ConnectionPool,issuerPool:sql.ConnectionPool,
 writerPool:sql.ConnectionPool,
 // Only an independent authenticated signer may provide this server-side.
 // Never forward a user-supplied body field or untrusted service response.
 independentActorAttestation:unknown=null,
):Promise<DormantChartVerifiedIssuerHandoff|null>{
 if(!CHART_DUAL_PROOF_RELEASE_APPROVED||
    !CHART_ATOMIC_CREATE_RUNTIME_ENABLED||
    !CHART_WRITER_DB_ACTOR_BINDING_APPROVED||
    !CHART_WRITER_APPROVED_PROCEDURE_SHA256||
    !CHART_ISSUER_APPROVED_PROCEDURE_SHA256||
    !CHART_SQL_APPROVED_PLATFORM_SID||
    !CHART_SQL_APPROVED_ISSUER_SID||
    !CHART_SQL_APPROVED_WRITER_SID)return null;
 const plan=planVerifiedChartCreateRequest(req,dashboardId,rawBody);
 if(!plan)return null;
 // Require BOTH the pinned Ed25519 receipt and SQL HMAC for the same
 // nonce/actor/config/placement/timestamps. SQL must independently verify
 // HMAC before grant issuance; Node cannot mint or skip it.
 const proof=parseIndependentChartIssuerProof(
   independentActorAttestation,plan,CHART_ACTOR_ATTESTATION_PINNED_KEYS);
 if(!proof)return null;
 const intent=intentFromPlan(plan);
 try{
   // Extra current-session check before the planned issuance. This has a
   // TOCTOU gap: the future SQL issuer must recheck identity/permissions
   // under its own transaction, and the final Writer must recheck again.
   const live=await getTokenSessionState(intent.ActorId);
   if(!live||live.isActive!==true||
      live.tokenVersion!==intent.TokenVersion||
      !live.permissions.includes("DESIGN_QUERY")||
      !live.permissions.includes("EXECUTE_QUERY"))return null;
   // This dormant handoff must not bypass independently reviewed login
   // identities by calling the old unpinned Issuer preflight overload.
   await attestChartIssuerSqlPools(
     platformPool,issuerPool,writerPool,
     CHART_ISSUER_APPROVED_PROCEDURE_SHA256,
     {platform:CHART_SQL_APPROVED_PLATFORM_SID,
      issuer:CHART_SQL_APPROVED_ISSUER_SID,
      writer:CHART_SQL_APPROVED_WRITER_SID});
   // Not a SQL grant. Caller must invoke the approved DB Issuer with this
   // exact scope; unapproved runtime and production keys still block here.
   return {intent,proof};
 }catch{
   // Never disclose SQL metadata, logins, private grant data, or secrets.
   return null;
 }
}
