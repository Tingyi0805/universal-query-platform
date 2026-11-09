// Isolated CHART signer service HTTPS/mTLS adapter.
// This must run in an independent process using externally provisioned
// server TLS keys, trusted client CA, pinned client certificate fingerprints,
// JWT verification key, read-only current authorization source and signing
// key service. NEVER mount it into UQP's ordinary Express app or IIS routes.
// No key, credential, signing service or SQL grant is provisioned by this file.
import {createServer,type Server as HttpsServer} from "node:https";
import type {ServerOptions} from "node:https";
import type {TLSSocket} from "node:tls";
import {
  CHART_SIGNER_SERVICE_RELEASE_APPROVED,
  createIndependentChartSigner,
  type IndependentChartSignerDeps,
} from "./independentChartSigner.js";

const fingerprint=/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/;
const MAX_BODY_BYTES=12*1024;

export type IsolatedChartSignerTransport=Readonly<{
  serverKey:NonNullable<ServerOptions["key"]>;
  serverCertificate:NonNullable<ServerOptions["cert"]>;
  clientCa:NonNullable<ServerOptions["ca"]>;
  approvedClientFingerprints:readonly string[];
  signerDeps:Omit<IndependentChartSignerDeps,"approved">;
}>;

/** Caller must explicitly bind the resulting HTTPS server on an isolated
 * private interface; no automatically running listener or insecure fallback.
 * The signer is permanently RELEASE-DISABLED until independent change
 * control approves deployment and rotates the necessary credentials.
 */
export function createIsolatedChartSignerMtlsServer(
  configuration:IsolatedChartSignerTransport,
):HttpsServer{
  if(!configuration.serverKey||!configuration.serverCertificate||
     !configuration.clientCa||!configuration.approvedClientFingerprints.length||
     !configuration.approvedClientFingerprints.every(x=>fingerprint.test(x)))
    throw Error("CHART_SIGNER_MTLS_CONFIG_REQUIRED");
  const approved=new Set(configuration.approvedClientFingerprints);
  const issue=createIndependentChartSigner({
    ...configuration.signerDeps,
    approved:()=>CHART_SIGNER_SERVICE_RELEASE_APPROVED,
  });
  const server=createServer({
    key:configuration.serverKey,cert:configuration.serverCertificate,
    ca:configuration.clientCa,
    requestCert:true,rejectUnauthorized:true,minVersion:"TLSv1.2",
    maxVersion:"TLSv1.3",
  },async(req,res)=>{
    // Never let responses or intermediaries cache either signature.
    res.setHeader("Cache-Control","no-store, max-age=0");
    res.setHeader("Pragma","no-cache");
    res.setHeader("X-Content-Type-Options","nosniff");
    res.setHeader("Content-Type","application/json; charset=utf-8");
    const reply=(status:number,code:string)=>{
      res.statusCode=status;
      res.end(JSON.stringify({error:{code}}));
    };
    if(!CHART_SIGNER_SERVICE_RELEASE_APPROVED){
      reply(404,"CHART_SIGNER_NOT_AVAILABLE");return;
    }
    const peer=req.socket as TLSSocket;
    const cert=peer.getPeerCertificate();
    const thumbprint=cert?.fingerprint256?.toUpperCase();
    if(!peer.authorized||!thumbprint||!approved.has(thumbprint)){
      reply(403,"FORBIDDEN");return;
    }
    if(req.method!=="POST"||req.url!=="/v1/chart/issue"){
      reply(404,"NOT_FOUND");return;
    }
    if(!/^application\/json(?:;\s*charset=utf-8)?$/i
       .test(String(req.headers["content-type"]??""))||
       typeof req.headers.authorization!=="string"){
      reply(400,"VALIDATION_ERROR");return;
    }
    try{
      const chunks:Buffer[]=[];
      let total=0;
      for await(const chunk of req){
        const part=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
        total+=part.length;
        if(total>MAX_BODY_BYTES){
          reply(413,"PAYLOAD_TOO_LARGE");return;
        }
        chunks.push(part);
      }
      const text=Buffer.concat(chunks).toString("utf8");
      let body:unknown;
      try{body=JSON.parse(text);}catch{
        reply(400,"VALIDATION_ERROR");return;
      }
      const issued=await issue(req.headers.authorization,body);
      if(!issued){
        // Do not leak DB RBAC, patient, JWT or HSM failure specifics.
        reply(403,"CHART_SIGNING_DENIED");return;
      }
      res.statusCode=200;
      res.end(JSON.stringify(issued));
    }catch{
      reply(503,"CHART_SIGNING_UNAVAILABLE");
    }
  });
  server.requestTimeout=10_000;
  server.headersTimeout=10_000;
  server.maxHeadersCount=32;
  return server;
}
