// Issue #89: independent-signer Chart Actor attestation verifier.
// OFFLINE TRUST BOUNDARY ONLY. No private key, signer, issuer, SQL grant,
// replay ledger, Writer invocation or runtime release is implemented here.
// A valid signature is necessary but NEVER sufficient for chart creation:
// the DB Issuer and Writer must independently bind/recheck the HTTP actor,
// consume a one-time grant, and atomically persist Widget/Seal/Audit/Ledger.
import {createHash,createPublicKey,verify} from "node:crypto";
import {
  canonicalChartConfig,type DormantChartCreatePlan,
} from "./dashboardChartAtomicCreate.contract.js";

export const CHART_ACTOR_ATTESTATION_MAX_AGE_MS=60_000 as const;
// Production trust anchors require independent security review, provisioning
// and rotation. Never populate this from HTTP, .env or JWT header/body.
export const CHART_ACTOR_ATTESTATION_PINNED_KEYS:
  Readonly<Record<string,string>>=Object.freeze({});

const fields=[
  "Version","Purpose","Audience","KeyId","ActorId","TokenVersion",
  "DashboardId","ProfileId","RequestId","SourceKey","ConfigSha256",
  "X","Y","Width","Height","Nonce","IssuedAtUtcMs","ExpiresAtUtcMs",
] as const;
const expectedKeys=[...fields,"Signature"].sort().join("|");
const hex64=/^[a-f0-9]{64}$/;
const sourceKey=/^(?:PRIMARY|[A-Za-z][A-Za-z0-9_]{0,63})$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const positive=(n:unknown)=>typeof n==="number"&&Number.isSafeInteger(n)&&n>0;
const int=(n:unknown)=>typeof n==="number"&&Number.isSafeInteger(n);
const record=(v:unknown):v is Record<string,unknown>=>
  v!==null&&typeof v==="object"&&!Array.isArray(v);

/** Deterministic domain-separated signature input. Strict field order and
 * exact JSON type matching prevent ambiguous or alternative encodings.
 * No signing capability or private key is exported/held by UQP.
 */
export function chartActorAttestationBytes(raw:unknown):Buffer|null{
  if(!record(raw)||Object.keys(raw).sort().join("|")!==expectedKeys)
    return null;
  if(raw.Version!==1||raw.Purpose!=="CHART_ACTOR_BIND"||
      raw.Audience!=="UQP_SQL_CHART_ISSUER_V1"||
      typeof raw.KeyId!=="string"||!/^[A-Za-z0-9_-]{1,64}$/.test(raw.KeyId)||
      !positive(raw.ActorId)||!positive(raw.TokenVersion)||
      !positive(raw.DashboardId)||!positive(raw.ProfileId)||
      typeof raw.RequestId!=="string"||!uuid.test(raw.RequestId)||
      typeof raw.SourceKey!=="string"||!sourceKey.test(raw.SourceKey)||
      typeof raw.ConfigSha256!=="string"||!hex64.test(raw.ConfigSha256)||
      !int(raw.X)||!int(raw.Y)||!int(raw.Width)||!int(raw.Height)||
      (raw.X as number)<0||(raw.Y as number)<0||
      (raw.Width as number)<160||(raw.Height as number)<120||
      (raw.Width as number)>7680||(raw.Height as number)>4320||
      typeof raw.Nonce!=="string"||!/^[a-f0-9]{32}$/.test(raw.Nonce)||
      !positive(raw.IssuedAtUtcMs)||!positive(raw.ExpiresAtUtcMs)||
      typeof raw.Signature!=="string"||
      !/^[A-Za-z0-9_-]{86}$/.test(raw.Signature))
    return null;
  const bytes=Buffer.from(raw.Signature,"base64url");
  if(bytes.length!==64||bytes.toString("base64url")!==raw.Signature)return null;
  return Buffer.from("UQP_CHART_ACTOR_ATTESTATION_V1\n"+
    JSON.stringify(fields.map(name=>raw[name])),"utf8");
}

/** This verifies an independent signer's integrity/scope but NOT its
 * provenance, live session, SQL authorization, one-time use or DB transaction.
 * A caller must pass the trusted key registry, never request-provided keys.
 * The production handoff passes only CHART_ACTOR_ATTESTATION_PINNED_KEYS.
 */
export function verifyChartActorAttestation(
  raw:unknown,plan:DormantChartCreatePlan,
  trustedPublicKeys:Readonly<Record<string,string>>,
  nowUtcMs:number=Date.now(),
):boolean {
  const bytes=chartActorAttestationBytes(raw);
  if(!bytes||!record(raw)||!plan||!record(trustedPublicKeys)||
      !int(nowUtcMs)||nowUtcMs<=0)return false;
  const issued=raw.IssuedAtUtcMs as number;
  const expires=raw.ExpiresAtUtcMs as number;
  if(issued>nowUtcMs||nowUtcMs>=expires||
      expires<=issued||
      expires-issued>CHART_ACTOR_ATTESTATION_MAX_AGE_MS)
    return false;
  const canonical=plan.config&&canonicalChartConfig(plan.config.data);
  if(!canonical||canonical.json!==plan.config.json||
      canonical.sha256!==plan.config.sha256||
      !hex64.test(plan.config.sha256)||!plan.placement||
      plan.config.data.dataSourceKey!==plan.sourceKey)return false;
  if(raw.ActorId!==plan.actorId||
      raw.TokenVersion!==plan.tokenVersion||
      raw.DashboardId!==plan.dashboardId||
      raw.ProfileId!==plan.profileId||
      raw.RequestId!==plan.requestId||
      raw.SourceKey!==plan.sourceKey||
      raw.ConfigSha256!==plan.config.sha256||
      raw.X!==plan.placement.x||raw.Y!==plan.placement.y||
      raw.Width!==plan.placement.width||raw.Height!==plan.placement.height)
    return false;
  const kid=raw.KeyId as string;
  if(!Object.hasOwn(trustedPublicKeys,kid))return false;
  const pem=trustedPublicKeys[kid];
  if(typeof pem!=="string"||pem.length<80||pem.length>4096)return false;
  try{
    const key=createPublicKey(pem);
    return key.asymmetricKeyType==="ed25519"&&
      verify(null,bytes,key,Buffer.from(raw.Signature as string,"base64url"));
  }catch{return false;}
}
