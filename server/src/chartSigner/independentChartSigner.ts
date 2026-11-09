// Independent CHART signer core: intended for a SEPARATE, mTLS-only process.
// The main UQP HTTP Server must NEVER import/instantiate this class or hold
// the Ed25519 private key / SQL Issuer HMAC key. Signatures must be generated
// by an independently provisioned key service/HSM, not request-supplied data.
//
// NOT RELEASE APPROVED. No automatic key provisioning, SQL DML or live route.
import {randomBytes} from "node:crypto";
import jwt from "jsonwebtoken";
import {
  planDormantChartCreate,
} from "../modules/dashboard/dashboardChartAtomicCreate.contract.js";
import {chartActorAttestationBytes} from "../modules/dashboard/dashboardChartActorAttestation.js";
import {sqlChartIssuerCanonicalScope,
  type VerifiedSqlChartIssuerProof,
} from "../modules/dashboard/dashboardChartIndependentIssuerProof.js";

export const CHART_SIGNER_SERVICE_RELEASE_APPROVED=false as const;
export const CHART_SIGNER_MAX_LIFETIME_MS=8_000 as const;
const keyIdPattern=/^[A-Za-z0-9_-]{1,64}$/;
const bearerPattern=/^Bearer [A-Za-z0-9_.-]+$/;
const isRecord=(v:unknown):v is Record<string,unknown>=>
  v!==null&&typeof v==="object"&&!Array.isArray(v);
const positive=(v:unknown)=>typeof v==="number"&&Number.isSafeInteger(v)&&v>0;
const strictKeys=(v:Record<string,unknown>,keys:readonly string[])=>
  Object.keys(v).sort().join("|")===keys.slice().sort().join("|");

export type IndependentSignerLiveSession=Readonly<{
  isActive:boolean;
  tokenVersion:number;
  permissions:readonly string[];
}>;
export type IndependentSignerCreateRequest=Readonly<{
  dashboardId:number;profileId:number;requestId:string;
  config:unknown;placement:unknown;
}>;
export type IndependentChartSignerDeps=Readonly<{
  /** Secret verifier is provisioned in the separate signer process, never
   * received over HTTP, and matches the current HS256 UQP login contract.
   * Migrate to public-key JWT or independent introspection before go-live.
   */
  jwtVerificationKey:jwt.Secret;
  keyId:string;
  /** Read-only, independent live DB lookup, with no caching/fallback. */
  readLiveSession:(actorId:number)=>Promise<IndependentSignerLiveSession|null>;
  /** Independently authorize this Dashboard/Profile and approved Query scope.
   * Must perform a fresh DB read; the ordinary JWT permission alone is not
   * sufficient to claim patient data is safe for public displays.
   */
  authorizeChartCreate:(actorId:number,dashboardId:number,
    profileId:number,sourceKey:string)=>Promise<boolean>;
  /** Private Ed25519 signer: returns exactly 64 signature bytes.
   * Key custody remains in a separate process, HSM or trusted key service.
   */
  signEd25519:(canonicalMessage:Buffer)=>Promise<Buffer>;
  /** SQL HMAC signer: returns exactly 32 MAC bytes for SQL Issuer to verify.
   * Never pass this signing key to the UQP app or HTTP callers.
   */
  signSqlHmac:(canonicalMessage:string)=>Promise<Buffer>;
  now?:()=>number;
  randomNonce?:()=>Buffer;
  /** The actual isolated service wiring hardcodes this FALSE until external
   * security approval. TRUE only in dedicated isolated tests.
   */
  approved:()=>boolean;
}>;

export type IndependentChartDualReceipt=Readonly<{
  Attestation:Readonly<{
    Version:1;Purpose:"CHART_ACTOR_BIND";
    Audience:"UQP_SQL_CHART_ISSUER_V1";KeyId:string;
    ActorId:number;TokenVersion:number;DashboardId:number;ProfileId:number;
    RequestId:string;SourceKey:string;ConfigSha256:string;
    X:number;Y:number;Width:number;Height:number;Nonce:string;
    IssuedAtUtcMs:number;ExpiresAtUtcMs:number;Signature:string;
  }>;
  SqlMac:string;
}>;

/** Only a verified original UQP JWT + live DB authorization can determine
 * actor/session. No request AuthUser, actorId, tokenVersion, trusted key,
 * signer flags, or SQL-supplied "approval" fields are ever accepted.
 * Returning null is the ONLY failure channel; no secrets/SQL/PHI in output.
 */
export function createIndependentChartSigner(deps:IndependentChartSignerDeps){
  if(!keyIdPattern.test(deps.keyId))throw Error("CHART_SIGNER_INVALID_KEY_ID");
  const now=deps.now??Date.now;
  const nonceFactory=deps.randomNonce??(()=>randomBytes(16));
  return async function issue(
    authorizationHeader:unknown,raw:unknown,
  ):Promise<IndependentChartDualReceipt|null>{
    // Gate before token parsing, DB reads and any cryptographic signing.
    if(!deps.approved())return null;
    if(typeof authorizationHeader!=="string"||
       !bearerPattern.test(authorizationHeader)||
       !isRecord(raw)||!strictKeys(raw,[
         "dashboardId","profileId","requestId","config","placement",
       ]))return null;
    let actorId:number,tokenVersion:number,tokenExpiresAt:number;
    try{
      const checkedAt=now();
      if(!Number.isSafeInteger(checkedAt)||checkedAt<=0)return null;
      const token=jwt.verify(
        authorizationHeader.slice(7),deps.jwtVerificationKey,
        {algorithms:["HS256"],clockTimestamp:Math.floor(checkedAt/1000)},
      );
      if(typeof token!=="object"||token===null)return null;
      actorId=Number(token.sub);
      tokenVersion=Number(token.tokenVersion);
      tokenExpiresAt=Number(token.exp)*1000;
      if(!positive(actorId)||!positive(tokenVersion)||
         !Number.isSafeInteger(tokenExpiresAt)||
         tokenExpiresAt<=checkedAt+CHART_SIGNER_MAX_LIFETIME_MS)
        return null;
    }catch{return null;}

    // Build trusted immutable plan only with actor and tokenVersion read
    // from the cryptographically verified JWT above.
    const plan=planDormantChartCreate({
      ...raw,actorId,tokenVersion,
    });
    if(!plan)return null;
    try{
      const session=await deps.readLiveSession(actorId);
      if(!session?.isActive||session.tokenVersion!==tokenVersion||
         !Array.isArray(session.permissions)||
         !session.permissions.includes("DESIGN_QUERY")||
         !session.permissions.includes("EXECUTE_QUERY")||
         !await deps.authorizeChartCreate(
           actorId,plan.dashboardId,plan.profileId,plan.sourceKey))
        return null;

      // Time is re-read AFTER potentially slow DB checks. Never sign a
      // pre-authorized stale scope. SQL Writer repeats all checks at commit.
      const issued=now(),expires=issued+CHART_SIGNER_MAX_LIFETIME_MS;
      if(!Number.isSafeInteger(issued)||issued<=0||
         !Number.isSafeInteger(expires)||expires>=tokenExpiresAt)
        return null;
      const nonceBytes=nonceFactory();
      if(!Buffer.isBuffer(nonceBytes)||nonceBytes.length!==16)return null;
      const nonce=nonceBytes.toString("hex");
      const unsigned={
        Version:1 as const,Purpose:"CHART_ACTOR_BIND" as const,
        Audience:"UQP_SQL_CHART_ISSUER_V1" as const,
        KeyId:deps.keyId,ActorId:actorId,TokenVersion:tokenVersion,
        DashboardId:plan.dashboardId,ProfileId:plan.profileId,
        RequestId:plan.requestId,SourceKey:plan.sourceKey,
        ConfigSha256:plan.config.sha256,
        X:plan.placement.x,Y:plan.placement.y,
        Width:plan.placement.width,Height:plan.placement.height,
        Nonce:nonce,IssuedAtUtcMs:issued,ExpiresAtUtcMs:expires,
        Signature:Buffer.alloc(64).toString("base64url"),
      };
      const edBytes=chartActorAttestationBytes(unsigned);
      if(!edBytes)return null;
      const edSignature=await deps.signEd25519(edBytes);
      if(!Buffer.isBuffer(edSignature)||edSignature.length!==64)return null;
      const nonceGuid=[
        nonce.slice(0,8),nonce.slice(8,12),nonce.slice(12,16),
        nonce.slice(16,20),nonce.slice(20,32),
      ].join("-");
      const sqlScope:VerifiedSqlChartIssuerProof={
        ActorId:actorId,TokenVersion:tokenVersion,
        DashboardId:plan.dashboardId,ProfileId:plan.profileId,
        RequestId:plan.requestId,SourceKey:plan.sourceKey,
        ConfigSha256:plan.config.sha256,
        X:plan.placement.x,Y:plan.placement.y,
        Width:plan.placement.width,Height:plan.placement.height,
        Nonce:nonceGuid,IssuedAtUtc:new Date(issued),
        ExpiresAtUtc:new Date(expires),Signature:Buffer.alloc(32),
      };
      const sqlMac=await deps.signSqlHmac(
        sqlChartIssuerCanonicalScope(sqlScope));
      if(!Buffer.isBuffer(sqlMac)||sqlMac.length!==32)return null;
      // If the external signer stalls beyond expiry, discard BOTH proofs.
      if(now()>=expires)return null;
      return {
        Attestation:{...unsigned,
          Signature:edSignature.toString("base64url")},
        SqlMac:sqlMac.toString("base64url"),
      };
    }catch{
      // Fail closed for DB outages, key-store failures, revoked sessions or
      // signature failures. Never expose error messages or key material.
      return null;
    }
  };
}
