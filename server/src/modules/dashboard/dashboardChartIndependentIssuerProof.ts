// Issue #89: dual-proof binding of independently signed HTTP actor scope to
// the existing SQL Server HMAC Issuer contract.
// NO SIGNER/PRIVATE KEY HERE. Caller MUST provision an external independently
// authenticated signer holding BOTH keys outside UQP; SQL owns HMAC
// verification and Writer owns the SID-pinned one-time grant transaction.
// This adapter never issues grants, accesses SQL, or enables CHART runtime.
import {
  verifyChartActorAttestation,
} from "./dashboardChartActorAttestation.js";
import type {DormantChartCreatePlan} from "./dashboardChartAtomicCreate.contract.js";

const hex32=/^[0-9a-f]{32}$/;
const signature43=/^[A-Za-z0-9_-]{43}$/;
const record=(value:unknown):value is Record<string,unknown>=>
  !!value&&typeof value==="object"&&!Array.isArray(value);

export const CHART_SQL_ISSUER_PROOF_MAX_AGE_MS=10_000 as const;
export const CHART_DUAL_PROOF_RELEASE_APPROVED=false as const;

export type VerifiedSqlChartIssuerProof=Readonly<{
  ActorId:number;TokenVersion:number;DashboardId:number;ProfileId:number;
  RequestId:string;SourceKey:string;ConfigSha256:string;
  X:number;Y:number;Width:number;Height:number;
  Nonce:string;IssuedAtUtc:Date;ExpiresAtUtc:Date;
  Signature:Buffer;
}>;

// HMAC canonical string MUST stay byte-identical to SQL 2019/2022
// usp_ChartDelegationIssueSigned_IsolatedDraft. Not a signing operation.
export function sqlChartIssuerCanonicalScope(p:VerifiedSqlChartIssuerProof):string{
  return [
    "UQP_CHART_ACTOR_V1",p.ActorId,p.TokenVersion,p.DashboardId,p.ProfileId,
    p.RequestId.toLowerCase(),p.SourceKey,p.ConfigSha256.toLowerCase(),
    p.X,p.Y,p.Width,p.Height,p.Nonce.toLowerCase(),
    p.IssuedAtUtc.toISOString().slice(0,23),
    p.ExpiresAtUtc.toISOString().slice(0,23),
  ].join("|");
}

/** Require the Ed25519 signer identity/scope AND the separate SQL HMAC
 * signature to refer to EXACTLY the same immutable request and nonce.
 * A valid Ed25519 receipt alone is not sufficient: SQL Issuer independently
 * verifies HMAC and consumes nonce under its SERIALIZABLE transaction.
 * The UQP process never receives either private key. No envelope input
 * may supply a signer public key, issuer SID, actorId or approval flag.
 */
export function parseIndependentChartIssuerProof(
  raw:unknown,plan:DormantChartCreatePlan,
  trustedSignerKeys:Readonly<Record<string,string>>,
  nowUtcMs:number=Date.now(),
):VerifiedSqlChartIssuerProof|null{
  if(!record(raw)||Object.keys(raw).sort().join("|")!=="Attestation|SqlMac"||
     !record(raw.Attestation)||typeof raw.SqlMac!=="string"||
     !signature43.test(raw.SqlMac)||
     !Number.isSafeInteger(nowUtcMs)||nowUtcMs<=0)return null;
  const signature=Buffer.from(raw.SqlMac,"base64url");
  if(signature.length!==32||signature.toString("base64url")!==raw.SqlMac)return null;

  // Never accept unverified ActorId from the external signer as authority:
  // comparison uses the already JWT/session-verified immutable server plan.
  const attestation=raw.Attestation;
  if(!verifyChartActorAttestation(
      attestation,plan,trustedSignerKeys,nowUtcMs))return null;
  const nonce=attestation.Nonce;
  const issued=attestation.IssuedAtUtcMs;
  const expires=attestation.ExpiresAtUtcMs;
  if(typeof nonce!=="string"||!hex32.test(nonce)||
     typeof issued!=="number"||typeof expires!=="number"||
     !Number.isSafeInteger(issued)||!Number.isSafeInteger(expires)||
     issued>nowUtcMs||nowUtcMs>=expires||
     expires-issued<1||expires-issued>CHART_SQL_ISSUER_PROOF_MAX_AGE_MS)
    return null;
  const guid=[
    nonce.slice(0,8),nonce.slice(8,12),nonce.slice(12,16),
    nonce.slice(16,20),nonce.slice(20,32),
  ].join("-");
  const issueDate=new Date(issued),expiryDate=new Date(expires);
  if(!Number.isFinite(issueDate.valueOf())||
     !Number.isFinite(expiryDate.valueOf()))return null;

  return {
    ActorId:plan.actorId,TokenVersion:plan.tokenVersion,
    DashboardId:plan.dashboardId,ProfileId:plan.profileId,
    RequestId:plan.requestId,SourceKey:plan.sourceKey,
    ConfigSha256:plan.config.sha256,
    X:plan.placement.x,Y:plan.placement.y,
    Width:plan.placement.width,Height:plan.placement.height,
    Nonce:guid,IssuedAtUtc:issueDate,ExpiresAtUtc:expiryDate,
    Signature:signature,
  };
}
