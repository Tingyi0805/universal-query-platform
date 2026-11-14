// Issue #89: verified bridge from the independent mTLS Signer to the
// separately controlled SQL Issuer. There is NO SQL grant issuance, Writer,
// automatic service connection, private signing key or runtime registration.
// A successful return is a scoped *candidate* for the SQL Issuer, NOT
// authorization to store a CHART: SQL must verify HMAC, actor/current RBAC,
// Issuer SID and consume the grant inside the Writer-owned transaction.
import type {DormantChartCreatePlan} from "./dashboardChartAtomicCreate.contract.js";
import {planDormantChartCreate} from "./dashboardChartAtomicCreate.contract.js";
import {parseIndependentChartIssuerProof,
  type VerifiedSqlChartIssuerProof,
} from "./dashboardChartIndependentIssuerProof.js";
import {CHART_ACTOR_ATTESTATION_PINNED_KEYS} from "./dashboardChartActorAttestation.js";

export const CHART_SIGNER_ISSUER_HANDOFF_RELEASE_APPROVED=false as const;
export type ChartSignerHandoffSession=Readonly<{
  isActive:boolean;tokenVersion:number;permissions:readonly string[];
}>;
export type ChartSignerHandoffDependencies=Readonly<{
  // The production default remains hard-OFF; test fixtures may explicitly
  // inject a synthetic allow predicate and their own ephemeral trust key.
  enabled:()=>boolean;
  requestSignedReceipt:(
    plan:DormantChartCreatePlan,originalBearerHeader:string,
  )=>Promise<unknown|null>;
  readLiveSession:(actorId:number)=>Promise<ChartSignerHandoffSession|null>;
  trustedSignerPublicKeys:Readonly<Record<string,string>>;
  now?:()=>number;
}>;

function scopeIsValid(plan:DormantChartCreatePlan):boolean{
  if(!plan||!plan.config)return false;
  const expected=planDormantChartCreate({
    actorId:plan.actorId,tokenVersion:plan.tokenVersion,
    dashboardId:plan.dashboardId,profileId:plan.profileId,
    requestId:plan.requestId,placement:plan.placement,config:plan.config.data,
  });
  return !!expected&&expected.config.json===plan.config.json&&
    expected.config.sha256===plan.config.sha256&&
    expected.sourceKey===plan.sourceKey;
}
function sameAuthorizedSession(
  session:ChartSignerHandoffSession|null,plan:DormantChartCreatePlan,
):boolean{
  return session?.isActive===true&&
    session.tokenVersion===plan.tokenVersion&&
    Array.isArray(session.permissions)&&
    session.permissions.includes("DESIGN_QUERY")&&
    session.permissions.includes("EXECUTE_QUERY");
}

/** Transport receipt cannot become SQL Issuer evidence until the scoped
 * Ed25519 signature is verified under independently pinned public keys,
 * both proofs have bounded expiry and the live JWT session is rechecked
 * AFTER signing. No HMAC key is ever available to this function.
 */
export function createDormantChartSignerIssuerHandoff(
  dependencies:ChartSignerHandoffDependencies,
):(plan:DormantChartCreatePlan,originalBearerHeader:string)=>
    Promise<VerifiedSqlChartIssuerProof|null>{
  return async(plan,originalBearerHeader)=>{
    // Gate first: never call mTLS, live DB or SQL when not approved.
    if(!dependencies.enabled()||!scopeIsValid(plan)||
       typeof originalBearerHeader!=="string"||
       !/^Bearer [A-Za-z0-9_.-]+$/.test(originalBearerHeader))
      return null;
    try{
      const live=await dependencies.readLiveSession(plan.actorId);
      if(!sameAuthorizedSession(live,plan))return null;
      const receipt=await dependencies.requestSignedReceipt(
        plan,originalBearerHeader);
      if(!receipt)return null;
      const now=dependencies.now?.()??Date.now();
      const proof=parseIndependentChartIssuerProof(receipt,plan,
        dependencies.trustedSignerPublicKeys,now);
      if(!proof)return null;
      // Separate signer verifies its own live state, but UQP must not trust
      // a session that was revoked while the mTLS request was in flight.
      const current=await dependencies.readLiveSession(plan.actorId);
      if(!sameAuthorizedSession(current,plan))return null;
      const finalNow=dependencies.now?.()??Date.now();
      if(!Number.isSafeInteger(finalNow)||finalNow<=0||
         finalNow>=proof.ExpiresAtUtc.valueOf())return null;
      return proof;
    }catch{
      // Error messages, SQL facts, JWT, signed receipts and private data
      // never leave this boundary. No fallback to ordinary SQL identity.
      return null;
    }
  };
}

/** The production construction does not permit a per-request override of
 * the approved gates or of the currently empty pinned key registry.
 * A future reviewed deployment must explicitly adopt both in code.
 */
export const dormantProductionChartSignerIssuerHandoff=
  (requestSignedReceipt:ChartSignerHandoffDependencies["requestSignedReceipt"],
   readLiveSession:ChartSignerHandoffDependencies["readLiveSession"])=>
    createDormantChartSignerIssuerHandoff({
      enabled:()=>CHART_SIGNER_ISSUER_HANDOFF_RELEASE_APPROVED,
      requestSignedReceipt,readLiveSession,
      trustedSignerPublicKeys:CHART_ACTOR_ATTESTATION_PINNED_KEYS,
    });
