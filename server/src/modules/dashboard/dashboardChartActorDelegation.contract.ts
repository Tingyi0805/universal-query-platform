// 2B-15D-6: OFFLINE field-matching contract for a future DB-owned,
// one-time Chart Actor delegation. NOT an issuer, verifier of DB provenance,
// grant consumer, credential, endpoint, release approval or SQL writer.
//
// A matching JS object is never authority. Only an independently privileged
// DB issuer may persist grants; a DB-owned SERIALIZABLE Writer transaction
// must lock, verify, consume and commit a grant with Widget/Seal/Audit/Ledger.
import {createHash,timingSafeEqual} from "node:crypto";
import type {DormantChartCreatePlan} from "./dashboardChartAtomicCreate.contract.js";

export const CHART_DELEGATION_MAX_LIFETIME_MS=60_000 as const;
export type DormantChartDelegationRow=Readonly<{
  GrantId:unknown;Purpose:unknown;Version:unknown;IssuerSid:unknown;
  SecretSha256:unknown;ActorId:unknown;TokenVersion:unknown;
  DashboardId:unknown;ProfileId:unknown;RequestId:unknown;
  SourceKey:unknown;ConfigSha256:unknown;
  X:unknown;Y:unknown;Width:unknown;Height:unknown;
  IssuedAtUtc:unknown;ExpiresAtUtc:unknown;
  ConsumedAtUtc:unknown;IsRevoked:unknown;
}>;
const grantIdPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const shaPattern=/^[a-f0-9]{64}$/;
const isDate=(v:unknown):v is Date=>
  v instanceof Date&&Number.isFinite(v.getTime());
const isObject=(v:unknown):v is Record<string,unknown>=>
  v!==null&&typeof v==="object"&&!Array.isArray(v);

/** Compares only synthetic fields; never grants permission or reads SQL.
 * The future Writer MUST perform these checks against an issuer-owned row
 * UNDER LOCK in the SAME database transaction that consumes it and writes
 * the Chart. Passing a crafted row here does NOT prove its provenance.
 *
 * The 256-bit secret must come from the independent issuer, never a browser
 * chosen RequestId, SQL Writer login, env fallback or SESSION_CONTEXT.
 * The expected issuer SID and time must also come from trusted DB context,
 * not from the client or this function's caller in a production route.
 */
export function matchesDormantChartDelegationFields(
  row:unknown,plan:DormantChartCreatePlan,presentation:unknown,
  expectedIssuerSid:string,nowUtc:Date,
):boolean{
  if(!isObject(row)||!isObject(presentation)||!plan||
     typeof expectedIssuerSid!=="string"||expectedIssuerSid.length<2||
     !isDate(nowUtc))return false;
  if(Object.keys(presentation).sort().join("|")!=="grantId|secret")return false;
  const secret=presentation.secret;
  if(!Buffer.isBuffer(secret)||secret.length!==32||
     typeof presentation.grantId!=="string"||
     !grantIdPattern.test(presentation.grantId))return false;
  const r=row as DormantChartDelegationRow;
  if(r.Version!==1||r.Purpose!=="CHART_CREATE"||
     r.IsRevoked!==false||r.ConsumedAtUtc!==null||
     r.IssuerSid!==expectedIssuerSid||r.GrantId!==presentation.grantId||
     !isDate(r.IssuedAtUtc)||!isDate(r.ExpiresAtUtc))return false;
  const issue=r.IssuedAtUtc.getTime(),expiry=r.ExpiresAtUtc.getTime();
  const now=nowUtc.getTime();
  if(issue>now||now>=expiry||expiry<=issue||
     expiry-issue>CHART_DELEGATION_MAX_LIFETIME_MS)return false;
  if(typeof r.SecretSha256!=="string"||!shaPattern.test(r.SecretSha256))
    return false;
  const expectedSecretHash=createHash("sha256").update(secret).digest();
  const actualSecretHash=Buffer.from(r.SecretSha256,"hex");
  if(actualSecretHash.length!==expectedSecretHash.length||
     !timingSafeEqual(actualSecretHash,expectedSecretHash))return false;

  // Immutable scope is complete; existence of a different authorized actor
  // or a valid SQL Login does not permit substituting any bound field.
  if(!plan.config||!plan.placement||
     typeof plan.config.sha256!=="string"||
     !shaPattern.test(plan.config.sha256)||
     typeof plan.config.json!=="string"||
     createHash("sha256").update(plan.config.json,"utf8").digest("hex")!==
       plan.config.sha256||
     plan.config.data?.dataSourceKey!==plan.sourceKey)return false;
  return r.ActorId===plan.actorId &&
    r.TokenVersion===plan.tokenVersion &&
    r.DashboardId===plan.dashboardId &&
    r.ProfileId===plan.profileId &&
    r.RequestId===plan.requestId &&
    r.SourceKey===plan.sourceKey &&
    r.ConfigSha256===plan.config.sha256 &&
    r.X===plan.placement.x &&r.Y===plan.placement.y &&
    r.Width===plan.placement.width&&r.Height===plan.placement.height;
}
