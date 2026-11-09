import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {X509Certificate} from "node:crypto";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import https from "node:https";
import type {IncomingHttpHeaders} from "node:http";
import {createIsolatedChartSignerMtlsServer} from "./independentChartSignerMtls.js";

test("standalone signer requires pinned mTLS clients and release stays closed",async t=>{
  const folder=await mkdtemp(path.join(tmpdir(),"uqp-chart-mtls-ci-"));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const makeCert=async(name:string)=>{
    const key=path.join(folder,name+".key");
    const cert=path.join(folder,name+".crt");
    execFileSync("openssl",[
      "req","-x509","-nodes","-newkey","rsa:2048",
      "-keyout",key,"-out",cert,"-days","1",
      "-subj","/CN="+name,
    ],{stdio:"ignore"});
    return {key:await readFile(key),cert:await readFile(cert)};
  };
  const serverCert=await makeCert("localhost");
  const clientCert=await makeCert("chart-test-client");
  const clientThumbprint=new X509Certificate(clientCert.cert)
    .fingerprint256.toUpperCase();
  let sessionReads=0,keyCalls=0;
  const config={
    serverKey:serverCert.key,serverCertificate:serverCert.cert,
    clientCa:clientCert.cert,
    approvedClientFingerprints:[clientThumbprint],
    signerDeps:{
      keyId:"ci-only",jwtVerificationKey:"never-used-secret",
      readLiveSession:async()=>{sessionReads++;return null;},
      authorizeChartCreate:async()=>false,
      signEd25519:async()=>{keyCalls++;return Buffer.alloc(64);},
      signSqlHmac:async()=>{keyCalls++;return Buffer.alloc(32);},
    },
  };
  assert.throws(()=>createIsolatedChartSignerMtlsServer({
    ...config,approvedClientFingerprints:[],
  }),/CHART_SIGNER_MTLS_CONFIG_REQUIRED/);
  assert.throws(()=>createIsolatedChartSignerMtlsServer({
    ...config,approvedClientFingerprints:["forged-client"],
  }),/CHART_SIGNER_MTLS_CONFIG_REQUIRED/);

  const server=createIsolatedChartSignerMtlsServer(config);
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();
  assert(address && typeof address!=="string");

  const response=await new Promise<{
    status:number;headers:IncomingHttpHeaders;body:string;
  }>((resolve,reject)=>{
    const req=https.request({
      hostname:"127.0.0.1",servername:"localhost",port:address.port,
      path:"/v1/chart/issue",method:"POST",
      ca:serverCert.cert,cert:clientCert.cert,key:clientCert.key,
      rejectUnauthorized:true,
      headers:{
        Authorization:"Bearer synthetic-claim-is-not-trusted",
        "Content-Type":"application/json",
      },
    },res=>{
      const chunks:Buffer[]=[];
      res.on("data",(data:Buffer)=>chunks.push(data));
      res.on("end",()=>resolve({
        status:res.statusCode??0,headers:res.headers,
        body:Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.once("error",reject);
    req.end(JSON.stringify({actorId:999,approved:true}));
  });
  assert.equal(response.status,404);
  assert.deepEqual(JSON.parse(response.body),
    {error:{code:"CHART_SIGNER_NOT_AVAILABLE"}});
  assert.equal(response.headers["cache-control"],"no-store, max-age=0");
  assert.equal(sessionReads,0);
  assert.equal(keyCalls,0);

  // Transport rejects clients without a trusted client certificate at
  // TLS handshake: HTTP bearer/body/header flags cannot bypass mTLS.
  await assert.rejects(new Promise<void>((resolve,reject)=>{
    const req=https.request({
      hostname:"127.0.0.1",servername:"localhost",port:address.port,
      path:"/v1/chart/issue",method:"POST",
      ca:serverCert.cert,rejectUnauthorized:true,
    },res=>{
      res.resume();
      res.on("end",()=>resolve());
    });
    req.on("error",reject);
    req.end("{}");
  }));
});
