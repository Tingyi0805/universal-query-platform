import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {X509Certificate} from "node:crypto";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {createServer} from "node:https";
import {tmpdir} from "node:os";
import path from "node:path";
import {
  CHART_SIGNER_CLIENT_RELEASE_APPROVED,
  CHART_SIGNER_HTTP_TIMEOUT_MS,
  createDormantChartSignerMtlsClient,
} from "./dashboardChartSignerClient.js";
import {planDormantChartCreate} from "./dashboardChartAtomicCreate.contract.js";

const plan=planDormantChartCreate({
  dashboardId:7,profileId:22,actorId:8,tokenVersion:3,
  requestId:"00000000-0000-4000-8000-000000000011",
  config:{version:1,chartType:"BAR",dataSourceKey:"PRIMARY",
    categoryColumn:"ROOM",valueColumn:"TOTAL",valueMode:"QUERY_RESULT",
    maxPoints:20,showLegend:true},
  placement:{x:80,y:80,width:600,height:360},
});
assert(plan);
const sample={Attestation:{notYetVerified:true},SqlMac:"synthetic"};
test("isolated signer transport pins CA, server certificate, mTLS and immutable JWT scope",async t=>{
  const folder=await mkdtemp(path.join(tmpdir(),"uqp-ch-signer-client-"));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const cert=async(name:string)=>{
    const key=path.join(folder,name+".key"),crt=path.join(folder,name+".crt");
    execFileSync("openssl",["req","-x509","-nodes","-newkey","rsa:2048",
      "-keyout",key,"-out",crt,"-days","1","-subj","/CN="+name],{stdio:"ignore"});
    return {key:await readFile(key),crt:await readFile(crt)};
  };
  const serverCert=await cert("localhost"),clientCert=await cert("synthetic-client");
  let count=0,lastBody:unknown=null,lastBearer:string|undefined;
  let replyStatus=200;
  let replyPayload:unknown=sample;
  let trickleResponse=false;
  const server=createServer({
    key:serverCert.key,cert:serverCert.crt,ca:clientCert.crt,
    requestCert:true,rejectUnauthorized:true,
  },async(req,res)=>{
    count++;
    lastBearer=req.headers.authorization;
    const bytes:Buffer[]=[];
    for await(const x of req)bytes.push(Buffer.from(x));
    lastBody=JSON.parse(Buffer.concat(bytes).toString("utf8"));
    res.statusCode=replyStatus;
    res.setHeader("Content-Type","application/json; charset=utf-8");
    res.setHeader("Cache-Control","no-store, max-age=0");
    if(trickleResponse){
      // The peer stays responsive at the TCP layer without finishing JSON.
      // A socket-idle timeout cannot stop this indefinite signer response.
      res.write(" ");
      const ticker=setInterval(()=>{if(!res.destroyed)res.write(" ");},500);
      res.once("close",()=>clearInterval(ticker));
      return;
    }
    res.end(JSON.stringify(replyPayload));
  });
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const addr=server.address();assert(addr && typeof addr!=="string");
  const opts={
    endpoint:"https://127.0.0.1:"+addr.port,
    servername:"localhost",serverCa:serverCert.crt,
    clientCertificate:clientCert.crt,clientKey:clientCert.key,
    expectedServerFingerprint256:
      new X509Certificate(serverCert.crt).fingerprint256.toUpperCase(),
  };
  const issued=createDormantChartSignerMtlsClient(opts,()=>true);
  assert.equal(CHART_SIGNER_CLIENT_RELEASE_APPROVED,false);
  assert.equal(await createDormantChartSignerMtlsClient(opts)(
    plan,"Bearer synthetic.token.here"),null);
  assert.equal(count,0,"hard-OFF must not make network requests");

  assert.deepEqual(await issued(plan,"Bearer synthetic.token.here"),sample);
  assert.equal(count,1);
  assert.equal(lastBearer,"Bearer synthetic.token.here");
  assert.deepEqual(lastBody,{
    dashboardId:7,profileId:22,requestId:plan.requestId,
    config:plan.config.data,placement:plan.placement,
  });
  assert.equal(JSON.stringify(lastBody).includes("actorId"),false);
  assert.equal(JSON.stringify(lastBody).includes("tokenVersion"),false);
  assert.equal(JSON.stringify(lastBody).includes("approved"),false);

  for(const bad of ["Bearer untrusted token","Bearer ","synthetic","Bearer bad\nInjected: true"]){
    assert.equal(await issued(plan,bad),null);
  }
  assert.equal(await issued({...plan,sourceKey:"OTHER"},"Bearer synthetic.token.here"),null);
  assert.equal(await issued({...plan,config:{...plan.config,sha256:"f".repeat(64)}},
    "Bearer synthetic.token.here"),null);
  assert.equal(count,1,"invalid plan or bearer must fail before TLS");

  assert.equal(await createDormantChartSignerMtlsClient({
    ...opts,expectedServerFingerprint256:("FF:".repeat(31)+"FF"),
  },()=>true)(plan,"Bearer synthetic.token.here"),null);
  assert.equal(count,1,"wrong server pin must reject TLS before application route");
  replyStatus=503;
  assert.equal(await issued(plan,"Bearer synthetic.token.here"),null);
  replyStatus=200;
  replyPayload={...sample,rows:[{PATIENT_ID:"PRIVATE"}]};
  assert.equal(await issued(plan,"Bearer synthetic.token.here"),null);
  replyPayload={...sample,SqlMac:"x".repeat(13_000)};
  assert.equal(await issued(plan,"Bearer synthetic.token.here"),null);

  // A server that trickles data must not keep an authorization request
  // pending indefinitely; all phases share the same absolute deadline.
  trickleResponse=true;
  const started=Date.now();
  assert.equal(await issued(plan,"Bearer synthetic.token.here"),null);
  const elapsed=Date.now()-started;
  assert.ok(elapsed>=CHART_SIGNER_HTTP_TIMEOUT_MS-1000,
    "request must not terminate before the absolute signing deadline");
  assert.ok(elapsed<CHART_SIGNER_HTTP_TIMEOUT_MS+5000,
    "trickle response must be canceled by the absolute signing deadline");
  trickleResponse=false;
});

test("signer client configuration rejects HTTP, URL-injected paths, missing pin and keys",()=>{
  const valid={
    endpoint:"https://localhost:5443",servername:"localhost",
    serverCa:"trusted-ca",clientCertificate:"cert",clientKey:"key",
    expectedServerFingerprint256:"11:".repeat(31)+"11",
  };
  for(const bad of [
    {endpoint:"http://localhost:5443"},
    {endpoint:"https://localhost:5443/steal"},
    {endpoint:"https://login:secret@localhost"},
    {endpoint:"https://localhost/?authorization=yes"},
    {servername:"localhost/path"},
    {serverCa:""},
    {clientCertificate:""},
    {clientKey:""},
    {expectedServerFingerprint256:"not-a-sha256"},
  ])assert.throws(()=>createDormantChartSignerMtlsClient({...valid,...bad}));
});
