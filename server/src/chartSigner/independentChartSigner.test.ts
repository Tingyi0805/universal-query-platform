import test from "node:test";
import assert from "node:assert/strict";
import {createHmac,generateKeyPairSync,randomBytes,sign} from "node:crypto";
import jwt from "jsonwebtoken";
import {
  CHART_SIGNER_MAX_LIFETIME_MS,CHART_SIGNER_SERVICE_RELEASE_APPROVED,
  createIndependentChartSigner,type IndependentSignerLiveSession,
} from "./independentChartSigner.js";
import {
  parseIndependentChartIssuerProof,sqlChartIssuerCanonicalScope,
} from "../modules/dashboard/dashboardChartIndependentIssuerProof.js";
import {planDormantChartCreate} from "../modules/dashboard/dashboardChartAtomicCreate.contract.js";

const now=1_800_000_000_000;
const jwtKey="independent-ci-auth-verification-only-secret-32-bytes";
const ed=generateKeyPairSync("ed25519"),sqlKey=randomBytes(32);
const validPermissions=["DESIGN_QUERY","EXECUTE_QUERY"];
const nonce=Buffer.alloc(16,0x45);
const raw={
  dashboardId:7,profileId:22,
  requestId:"00000000-0000-4000-8000-000000000024",
  config:{version:1,chartType:"BAR",dataSourceKey:"PRIMARY",
    categoryColumn:"ROOM",valueColumn:"TOTAL",
    valueMode:"QUERY_RESULT",maxPoints:20,showLegend:true},
  placement:{x:80,y:90,width:600,height:360},
};
const token=(claims:Record<string,unknown>={})=>
  "Bearer "+jwt.sign({
    sub:"8",tokenVersion:3,username:"synthetic",
    permissions:["DANGEROUS_CLAIM"],...claims,
  },jwtKey,{algorithm:"HS256",expiresIn:3600});
const live:IndependentSignerLiveSession={
  isActive:true,tokenVersion:3,permissions:validPermissions,
};

function harness(options:{
  approved?:boolean;
  live?:IndependentSignerLiveSession|null;
  allowed?:boolean;dbError?:boolean;
  badSignature?:"ED"|"MAC"|"EXPIRED";
}={}){
  let dbReads=0,scopeChecks=0,edCalls=0,macCalls=0,clock=now;
  const signer=createIndependentChartSigner({
    approved:()=>options.approved??true,
    keyId:"external-key-01",
    jwtVerificationKey:jwtKey,
    now:()=>clock,
    randomNonce:()=>nonce,
    readLiveSession:async actorId=>{
      dbReads++;assert.equal(actorId,8);
      if(options.dbError)throw Error("private DB connection failure / PHI");
      return options.live===undefined?live:options.live;
    },
    authorizeChartCreate:async(a,d,p,s)=>{
      scopeChecks++;assert.deepEqual([a,d,p,s],[8,7,22,"PRIMARY"]);
      return options.allowed??true;
    },
    signEd25519:async bytes=>{
      edCalls++;
      if(options.badSignature==="ED")return Buffer.alloc(62);
      return sign(null,bytes,ed.privateKey);
    },
    signSqlHmac:async bytes=>{
      macCalls++;
      if(options.badSignature==="EXPIRED")clock=now+9_000;
      if(options.badSignature==="MAC")return Buffer.alloc(31);
      return createHmac("sha256",sqlKey).update(bytes,"utf8").digest();
    },
  });
  return {signer,
    counts:()=>({dbReads,scopeChecks,edCalls,macCalls}),
    clock:(value:number)=>{clock=value;},
  };
}

test("production signer is hard-disabled; no JWT, DB or private key operations",async()=>{
  assert.equal(CHART_SIGNER_SERVICE_RELEASE_APPROVED,false);
  assert.equal(CHART_SIGNER_MAX_LIFETIME_MS,8_000);
  const h=harness({approved:false});
  assert.equal(await h.signer(token(),raw),null);
  assert.equal(await h.signer("Bearer invalid",raw),null);
  assert.deepEqual(h.counts(),{dbReads:0,scopeChecks:0,edCalls:0,macCalls:0});
});

test("independent signer checks original JWT/live RBAC then emits both matching cryptographic proofs",async()=>{
  const h=harness();
  const envelope=await h.signer(token(),raw);
  assert(envelope);
  assert.deepEqual(h.counts(),{
    dbReads:1,scopeChecks:1,edCalls:1,macCalls:1,
  });
  const plan=planDormantChartCreate({
    ...raw,actorId:8,tokenVersion:3,
  });
  assert(plan);
  const keyRegistry={"external-key-01":ed.publicKey.export({
    format:"pem",type:"spki",
  }).toString()};
  const scope=parseIndependentChartIssuerProof(envelope,plan,keyRegistry,now);
  assert(scope);
  assert.equal(scope.ActorId,8);
  assert.equal(scope.TokenVersion,3);
  assert.equal(scope.Nonce,"45454545-4545-4545-4545-454545454545");
  assert.equal(scope.ExpiresAtUtc.valueOf()-scope.IssuedAtUtc.valueOf(),8000);
  assert.deepEqual(scope.Signature,createHmac("sha256",sqlKey)
    .update(sqlChartIssuerCanonicalScope(scope),"utf8").digest());
  assert.deepEqual(Object.keys(envelope).sort(),["Attestation","SqlMac"]);
  const serialized=JSON.stringify(envelope);
  assert(!serialized.includes(jwtKey));
  assert(!serialized.includes("DANGEROUS_CLAIM"));
  assert(!serialized.includes("privateKey"));
});

test("forged actor, tokenVersion, algorithm and caller-supplied permissions never authorize signing",async()=>{
  const invalid=[
    token({sub:"77"}),token({tokenVersion:2}),
    "Bearer "+jwt.sign({sub:"8",tokenVersion:3}, "wrong-jwt-verification-key"),
    "Basic 123", "Bearer fake.jwt.signature", "",
  ];
  for(const header of invalid){
    const h=harness();
    assert.equal(await h.signer(header,raw),null);
    assert.equal(h.counts().edCalls,0);
    assert.equal(h.counts().macCalls,0);
  }
  const extra=[
    {...raw,ActorId:8}, {...raw,tokenVersion:3},
    {...raw,signerKey:"private"}, {...raw,approved:true},
    {...raw,SqlMac:"forged"}, {...raw,IssuerSid:"attacker"},
    {...raw,query:"SELECT * FROM PATIENT"},
    {...raw,config:{...raw.config,patientId:"sensitive"}},
    {...raw,placement:{...raw.placement,width:"600"}},
    {...raw,dashboardId:0},
  ];
  for(const invalidBody of extra){
    const h=harness();
    assert.equal(await h.signer(token(),invalidBody),null);
    assert.equal(h.counts().dbReads,0);
    assert.equal(h.counts().edCalls,0);
  }
});

test("expired or revoked JWT, disabled user, stale token and insufficient current RBAC fail closed",async()=>{
  const expired=jwt.sign({sub:"8",tokenVersion:3,exp:1},
    jwtKey,{algorithm:"HS256"});
  const fakeSessions=[
    null,
    {...live,isActive:false},
    {...live,tokenVersion:4},
    {...live,permissions:["DESIGN_QUERY"]},
    {...live,permissions:["EXECUTE_QUERY"]},
    {...live,permissions:[]},
  ];
  for(const session of fakeSessions){
    const h=harness({live:session});
    assert.equal(await h.signer(token(),raw),null);
    assert.equal(h.counts().edCalls,0);
    assert.equal(h.counts().macCalls,0);
  }
  const h=harness();
  assert.equal(await h.signer("Bearer "+expired,raw),null);
  assert.equal(h.counts().dbReads,0);
  const denied=harness({allowed:false});
  assert.equal(await denied.signer(token(),raw),null);
  assert.deepEqual(denied.counts(),{
    dbReads:1,scopeChecks:1,edCalls:0,macCalls:0,
  });
});

test("DB/key-store faults, bad signatures and signing delay return no partial receipts",async()=>{
  for(const config of [
    {dbError:true},{badSignature:"ED" as const},
    {badSignature:"MAC" as const},
    {badSignature:"EXPIRED" as const},
  ]){
    const h=harness(config);
    assert.equal(await h.signer(token(),raw),null);
  }
});

test("replay and durable audit are owned by the SQL Issuer/Writer, never signed from user-supplied keys",async()=>{
  const h=harness();
  const value=await h.signer(token(),raw);
  assert(value);
  // The immutable RequestId is bound to both proofs; the SQL Issuer
  // atomically rejects duplicate nonce and the Writer rejects RequestId
  // replay under its SERIALIZABLE transaction. The signer must not claim
  // that emitting a signature constitutes a committed Widget or audit.
  assert.equal(value.Attestation.RequestId,raw.requestId);
  assert.equal(value.Attestation.KeyId,"external-key-01");
  assert.equal("WidgetId" in value,false);
  assert.equal("GrantId" in value,false);
});
