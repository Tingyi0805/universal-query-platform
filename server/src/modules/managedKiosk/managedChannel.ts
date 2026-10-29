// Standard HTTP CONNECT + TLS 1.2/1.3 mTLS (ECDHE + AEAD only). No application encryption or plaintext proxy.
import {createServer as createTlsServer} from "node:https";
import type {Server,IncomingMessage,ServerResponse,RequestListener} from "node:http";
import type {TLSSocket} from "node:tls";
import type {Socket} from "node:net";
import {constants,X509Certificate} from "node:crypto";
import {readFileSync} from "node:fs";
import path from "node:path";
import {normalizeIp} from "../../utils/clientIp.js";
import {z} from "zod";

const peerSchema=z.object({certificateSha256:z.string().regex(/^[A-F0-9]{64}$/),dashboardId:z.number().int().positive().safe(),deviceId:z.number().int().positive().safe(),publicOrigin:z.string().url(),enrollmentExpiresAtUtc:z.string().datetime()}).strict();
const schema=z.object({schemaVersion:z.literal(1),serverCertificate:z.string().min(1),serverKey:z.string().min(1),clientCa:z.string().min(1),peers:z.array(peerSchema).max(1000)}).strict();
export type ManagedPeer=z.infer<typeof peerSchema>;
function policy(file:string){
 const c=schema.parse(JSON.parse(readFileSync(file,"utf8")));
 if(new Set(c.peers.map(p=>p.certificateSha256)).size!==c.peers.length)throw new Error("AGENT_DUPLICATE_CERTIFICATE");
 for(const p of c.peers){const u=new URL(p.publicOrigin);if(!["http:","https:"].includes(u.protocol)||u.origin!==p.publicOrigin)throw new Error("AGENT_ORIGIN_INVALID");}
 return c;
}
export function channelConfiguration(file:string){
 const c=policy(file);
 const local=(p:string)=>readFileSync(path.resolve(path.dirname(file),p));
 return{...c,cert:local(c.serverCertificate),key:local(c.serverKey),ca:local(c.clientCa)};
}
export type VerifyManagedDevice=(peer:ManagedPeer,token:string,ip:string)=>Promise<void>;
const target="uqp-kiosk.internal:443";
export function attachManagedChannel(server:Server,file:string,application:RequestListener,verify:VerifyManagedDevice){
 const initial=channelConfiguration(file),ca=new X509Certificate(initial.ca),sockets=new Set<Socket>(),replays=new Map<string,number>();
 const tls=createTlsServer({cert:initial.cert,key:initial.key,ca:initial.ca,requestCert:true,rejectUnauthorized:true,minVersion:"TLSv1.2",maxVersion:"TLSv1.3",ciphers:"TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256",honorCipherOrder:true,secureOptions:constants.SSL_OP_NO_TICKET|constants.SSL_OP_NO_RENEGOTIATION,handshakeTimeout:5000,headersTimeout:10000,requestTimeout:80000},async(req,res)=>{
  let peer:ManagedPeer|undefined,playback=false;
  const deny=(status=401)=>{if(res.headersSent){res.destroy();return;}res.getHeaderNames().forEach(k=>res.removeHeader(k));res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});res.end('{"error":{"code":"MANAGED_KIOSK_DENIED"}}');};
  try{
   const socket=req.socket as TLSSocket,certificate=socket.getPeerCertificate(),now=Date.now();
   if(!socket.authorized||!["TLSv1.2","TLSv1.3"].includes(socket.getProtocol()??"")||!certificate.raw||now<Date.parse(certificate.valid_from)||now>=Date.parse(certificate.valid_to)||now<Date.parse(ca.validFrom)||now>=Date.parse(ca.validTo))throw new Error();
   const fingerprint=new X509Certificate(certificate.raw).fingerprint256.replaceAll(":","");
   const current=()=>policy(file).peers.find(p=>p.certificateSha256===fingerprint&&Date.parse(p.enrollmentExpiresAtUtc)>Date.now());
   peer=current();if(!peer)throw new Error();const identity=JSON.stringify(peer);
   for(const name of ["host","authorization","x-dashboard-device-token","x-uqp-agent-request-id","x-uqp-agent-time","x-uqp-public-origin"]){if(req.rawHeaders.filter((_,i)=>i%2===0&&req.rawHeaders[i]!.toLowerCase()===name).length>1)throw new Error();}
   if(req.headers.host!==target||req.headers.origin||req.headers["sec-fetch-site"]||req.headers["transfer-encoding"]||req.headers["x-uqp-public-origin"]!==peer.publicOrigin)throw new Error();
   const nonce=req.headers["x-uqp-agent-request-id"],stamp=Number(req.headers["x-uqp-agent-time"]);
   if(typeof nonce!=="string"||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(nonce)||!Number.isSafeInteger(stamp)||Math.abs(now-stamp)>30000)throw new Error();
   for(const[k,expiry]of replays)if(expiry<=now)replays.delete(k);
   const replayKey=fingerprint+nonce;if(replays.has(replayKey)||replays.size>=10000)throw new Error();replays.set(replayKey,now+65000);
   const route=req.url??"",id=peer.dashboardId,device=peer.deviceId;
   const management=req.method==="POST"&&route==="/api/auth/login"||req.method==="GET"&&route===`/api/dashboards/${id}/query-mode/v1`||req.method==="POST"&&route===`/api/dashboards/${id}/query-mode/v1/devices/${device}/credential`||req.method==="GET"&&route===`/api/dashboards/${id}/devices/${device}/playback-settings`;
   playback=req.method==="GET"&&route===`/api/dashboards/device/${id}/layout`||req.method==="POST"&&(route===`/api/dashboards/device/${id}/page`||new RegExp(`^/api/dashboards/device/${id}/data-sources/[A-Za-z][A-Za-z0-9_]{0,63}/page$`).test(route));
   if(!management&&!playback)throw new Error();
   if(req.method==="POST"&&!/^application\/json(?:;|$)/i.test(String(req.headers["content-type"])))throw new Error();
   // Forwarded addresses are never accepted from a native client. Original TCP peer
   // remains the IP used by every existing device, auth and audit handler.
   for(const name of Object.keys(req.headers))if(name.startsWith("x-forwarded-")||name.startsWith("x-uqp-kiosk")||["x-real-ip","cookie","x-uqp-device-id","x-uqp-expected-device-id"].includes(name))delete req.headers[name];
   const token=String(req.headers["x-dashboard-device-token"]??"");
   const validate=async()=>{if(Date.now()>=Date.parse(certificate.valid_to)||Date.now()>=Date.parse(ca.validTo)||JSON.stringify(current())!==identity)throw new Error();if(playback){if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error();await verify(peer!,token,normalizeIp(socket.remoteAddress));}};
   await validate();
   // All allowed routes are bounded JSON. Revalidate before any response bytes,
   // including replies delayed by SQL/audit; never stream unvalidated patient rows.
   const end=res.end.bind(res),write=res.write.bind(res);let chunks:Buffer[]=[],size=0,ended=false;
   const chunk=(value:unknown,encoding?:BufferEncoding)=>{if(value!==undefined&&value!==null){const b=Buffer.isBuffer(value)?value:Buffer.from(String(value),encoding);size+=b.length;if(size>16*1024*1024)throw new Error();chunks.push(b);}};
   res.write=((value:unknown,encoding?:BufferEncoding)=>{try{chunk(value,encoding);return true;}catch{res.destroy();return false;}}) as typeof res.write;
   res.flushHeaders=()=>{throw new Error("MANAGED_STREAMING_FORBIDDEN");};
   res.end=((value?:unknown,encoding?:BufferEncoding)=>{
    if(ended)return res;ended=true;
    try{chunk(value,encoding);}catch{res.destroy();return res;}
    void validate().then(()=>{if(res.destroyed)return;res.setHeader("Cache-Control","no-store");res.setHeader("X-UQP-Agent-Request-Id",nonce);res.setHeader("X-UQP-Agent-Enrollment-Expires",peer!.enrollmentExpiresAtUtc);res.removeHeader("set-cookie");res.write=write;res.end=end;end(Buffer.concat(chunks));chunks=[];}).catch(()=>{res.end=end;chunks=[];deny();});return res;
   }) as typeof res.end;
   application(req,res);
  }catch{deny();}
 });
 tls.on("tlsClientError",()=>{}); // Static failures; never log credentials/handshake bodies.
 const connect=(req:IncomingMessage,socket:Socket,head:Buffer)=>{
  if(req.url!==target||head.length||sockets.size>=64||req.headers.authorization||req.headers["x-dashboard-device-token"]){socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");return;}
  sockets.add(socket);socket.on("close",()=>sockets.delete(socket));socket.on("error",()=>{});
  socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");tls.emit("connection",socket);
 };
 server.on("connect",connect);
 return()=>{server.off("connect",connect);for(const s of sockets)s.destroy();tls.close(()=>{});};
}
