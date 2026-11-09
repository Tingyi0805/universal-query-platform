// Issue #89: MAIN-UQP -> INDEPENDENT CHART SIGNER mTLS client.
// Transport only: no signer key, DB Issuer/Writer credentials, grant,
// approved migration, main HTTP registration or production activation.
// The independently verified SQL/Ed25519 proof must be checked separately.
import {request as httpsRequest} from "node:https";
import {checkServerIdentity} from "node:tls";
import type {DormantChartCreatePlan} from "./dashboardChartAtomicCreate.contract.js";
import {planDormantChartCreate} from "./dashboardChartAtomicCreate.contract.js";

export const CHART_SIGNER_CLIENT_RELEASE_APPROVED=false as const;
export const CHART_SIGNER_HTTP_TIMEOUT_MS=8_000 as const;
const MAX_RESPONSE_BYTES=12*1024;
const MAX_REQUEST_BYTES=12*1024;
const pinPattern=/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/;
const hostnamePattern=/^[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*$/;
const bearerPattern=/^Bearer [A-Za-z0-9_.-]+$/;

export type ChartSignerMtlsClientOptions=Readonly<{
  endpoint:string;
  // Must match the independently reviewed server certificate's DNS name;
  // URL host may be a pinned private IP address.
  servername:string;
  serverCa:string|Buffer;
  clientCertificate:string|Buffer;
  clientKey:string|Buffer;
  expectedServerFingerprint256:string;
}>;

/** A transport response is UNTRUSTED until parseIndependentChartIssuerProof
 * verifies the Ed25519 signature against separately pinned keys, matches
 * the original JWT actor, scope, nonce, time window and SQL MAC encoding.
 * Never use transport success as SQL grant or mutation authority.
 */
export function createDormantChartSignerMtlsClient(
  options:ChartSignerMtlsClientOptions,
  approved:()=>boolean=()=>CHART_SIGNER_CLIENT_RELEASE_APPROVED,
):(plan:DormantChartCreatePlan,originalBearerHeader:string)=>Promise<unknown|null>{
  let target:URL;
  try{target=new URL(options.endpoint);}catch{throw Error("CHART_SIGNER_ENDPOINT_INVALID");}
  if(target.protocol!=="https:"||!target.hostname||
     target.pathname!=="/"||target.search||target.hash||
     target.username||target.password||
     !hostnamePattern.test(options.servername)||
     !pinPattern.test(options.expectedServerFingerprint256)||
     !options.serverCa||!options.clientCertificate||!options.clientKey)
    throw Error("CHART_SIGNER_MTLS_CONFIGURATION_REQUIRED");
  const port=target.port?Number(target.port):443;
  if(!Number.isInteger(port)||port<1||port>65535)
    throw Error("CHART_SIGNER_MTLS_CONFIGURATION_REQUIRED");
  // No proxy, redirect, credential fallback, agent re-use or URL path from
  // the user request. Every authorization request has a fresh TLS handshake.
  return async(plan,originalBearerHeader)=>{
    // Gate BEFORE JWT inspection and network access. This is hard-OFF in
    // production; tests can exercise only the supplied synthetic connection.
    if(!approved())return null;
    if(!bearerPattern.test(originalBearerHeader)||!plan)return null;
    const canonical=planDormantChartCreate({
      actorId:plan.actorId,tokenVersion:plan.tokenVersion,
      dashboardId:plan.dashboardId,profileId:plan.profileId,
      requestId:plan.requestId,config:plan.config?.data,
      placement:plan.placement,
    });
    if(!canonical||canonical.config.json!==plan.config.json||
       canonical.config.sha256!==plan.config.sha256||
       canonical.sourceKey!==plan.sourceKey)return null;
    const payload=JSON.stringify({
      dashboardId:canonical.dashboardId,profileId:canonical.profileId,
      requestId:canonical.requestId,config:canonical.config.data,
      placement:canonical.placement,
    });
    const body=Buffer.from(payload,"utf8");
    if(body.length>MAX_REQUEST_BYTES)return null;
    return new Promise<unknown|null>(resolve=>{
      let finished=false;
      const finish=(value:unknown|null)=>{
        if(finished)return;finished=true;resolve(value);
      };
      try{
        const request=httpsRequest({
          protocol:"https:",hostname:target.hostname,port,
          method:"POST",path:"/v1/chart/issue",agent:false,
          key:options.clientKey,cert:options.clientCertificate,
          ca:options.serverCa,servername:options.servername,
          rejectUnauthorized:true,minVersion:"TLSv1.2",maxVersion:"TLSv1.3",
          checkServerIdentity:(_hostname,cert)=>{
            const error=checkServerIdentity(options.servername,cert);
            if(error)return error;
            if(cert.fingerprint256?.toUpperCase()!==
               options.expectedServerFingerprint256)
              return Error("CHART_SIGNER_CERTIFICATE_PIN_MISMATCH");
            return undefined;
          },
          headers:{
            "Authorization":originalBearerHeader,
            "Content-Type":"application/json; charset=utf-8",
            "Content-Length":body.length,
            "Accept":"application/json",
            "Connection":"close",
          },
        },response=>{
          const type=String(response.headers["content-type"]??"");
          const cache=String(response.headers["cache-control"]??"");
          if(response.statusCode!==200||
             !/^application\/json(?:;\s*charset=utf-8)?$/i.test(type)||
             !/(?:^|,)\s*no-store(?:,|$)/i.test(cache)){
            response.resume();finish(null);return;
          }
          let total=0;
          const chunks:Buffer[]=[];
          response.on("data",(part:Buffer)=>{
            total+=part.length;
            if(total>MAX_RESPONSE_BYTES){finish(null);response.destroy();return;}
            chunks.push(part);
          });
          response.on("aborted",()=>finish(null));
          response.on("error",()=>finish(null));
          response.on("end",()=>{
            if(finished)return;
            try{
              const raw:unknown=JSON.parse(Buffer.concat(chunks).toString("utf8"));
              if(!raw||typeof raw!=="object"||Array.isArray(raw)||
                 Object.keys(raw).sort().join("|")!=="Attestation|SqlMac")
                return finish(null);
              finish(raw);
            }catch{finish(null);}
          });
        });
        request.setTimeout(CHART_SIGNER_HTTP_TIMEOUT_MS,()=>request.destroy());
        request.on("error",()=>finish(null));
        request.end(body);
      }catch{finish(null);}
    });
  };
}
