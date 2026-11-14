import assert from "node:assert/strict";
import test from "node:test";
import {generateKeyPairSync,sign} from "node:crypto";
import jwt from "jsonwebtoken";
import {createIndependentChartSigner} from "../../chartSigner/independentChartSigner.js";
import {planDormantChartCreate} from "./dashboardChartAtomicCreate.contract.js";
import {
  CHART_SIGNER_ISSUER_HANDOFF_RELEASE_APPROVED,
  createDormantChartSignerIssuerHandoff,
  dormantProductionChartSignerIssuerHandoff,
} from "./dashboardChartSignerIssuerHandoff.js";

const now=1_800_000_000_000;
const signerKey=generateKeyPairSync("ed25519");
const trustedKeys={
  "ci-signing-key":signerKey.publicKey.export({format:"pem",type:"spki"}).toString(),
};
const jwtSecret="nonproduction-synthetic-signer-handoff-jwt";
const validBearer="Bearer "+jwt.sign({
  sub:"8",tokenVersion:3,iat:Math.floor(now/1000),
  exp:Math.floor(now/1000)+60,
},jwtSecret,{algorithm:"HS256"});
const plan=planDormantChartCreate({
  dashboardId:7,profileId:22,actorId:8,tokenVersion:3,
  requestId:"00000000-0000-4000-8000-000000000011",
  config:{version:1,chartType:"BAR",dataSourceKey:"PRIMARY",
    categoryColumn:"ROOM",valueColumn:"TOTAL",valueMode:"QUERY_RESULT",
    maxPoints:20,showLegend:true},
  placement:{x:80,y:80,width:600,height:360},
});
assert(plan);
const active=()=>({isActive:true,tokenVersion:3,
  permissions:["DESIGN_QUERY","EXECUTE_QUERY"]});

function scenario(){
  let reads=0,signerCalls=0,signingCalls=0;
  let session=active();
  let modifiedReceipt:(receipt:unknown)=>unknown=x=>x;
  let afterRequest:()=>void=()=>{};
  let clock=now;
  const independent=createIndependentChartSigner({
    approved:()=>true,keyId:"ci-signing-key",
    jwtVerificationKey:jwtSecret,
    now:()=>clock,
    randomNonce:()=>Buffer.alloc(16,0x44),
    readLiveSession:async()=>session,
    authorizeChartCreate:async()=>true,
    signEd25519:async(bytes)=>{signingCalls++;return sign(null,bytes,signerKey.privateKey);},
    // The bridge can structurally validate the MAC, but only the final
    // independently signed SQL Issuer procedure can verify its HMAC value.
    signSqlHmac:async()=>Buffer.alloc(32,0x33),
  });
  const deps={
    enabled:()=>true,
    now:()=>clock,
    trustedSignerPublicKeys:trustedKeys,
    readLiveSession:async(userId:number)=>{
      reads++;
      assert.equal(userId,8);
      return session;
    },
    requestSignedReceipt:async(
      requestPlan:NonNullable<typeof plan>,header:string,
    ):Promise<unknown>=>{
      signerCalls++;
      assert.deepEqual(requestPlan,plan);
      assert.equal(header,validBearer);
      const receipt=await independent(header,{
        dashboardId:requestPlan.dashboardId,
        profileId:requestPlan.profileId,
        requestId:requestPlan.requestId,
        config:requestPlan.config.data,
        placement:requestPlan.placement,
      });
      afterRequest();
      return modifiedReceipt(receipt);
    },
  };
  return {
    deps,
    get reads(){return reads;},
    get signerCalls(){return signerCalls;},
    get signingCalls(){return signingCalls;},
    setSession:(next:ReturnType<typeof active>)=>{session=next;},
    mutate:(transform:(v:unknown)=>unknown)=>{modifiedReceipt=transform;},
    after:(fn:()=>void)=>{afterRequest=fn;},
    setNow:(value:number)=>{clock=value;},
  };
}

test("production gate remains OFF without network, session reads or SQL activity",async()=>{
  assert.equal(CHART_SIGNER_ISSUER_HANDOFF_RELEASE_APPROVED,false);
  const s=scenario();
  const production=dormantProductionChartSignerIssuerHandoff(
    s.deps.requestSignedReceipt,s.deps.readLiveSession);
  assert.equal(await production(plan,validBearer),null);
  assert.equal(s.signerCalls,0);
  assert.equal(s.reads,0);
  assert.equal(s.signingCalls,0);
});

test("ephemeral signer proof binds exact JWT actor/scope/expiry before issuer handoff",async()=>{
  const s=scenario();
  const bridge=createDormantChartSignerIssuerHandoff(s.deps);
  const proof=await bridge(plan,validBearer);
  assert(proof);
  assert.equal(proof.ActorId,8);
  assert.equal(proof.TokenVersion,3);
  assert.equal(proof.DashboardId,7);
  assert.equal(proof.ProfileId,22);
  assert.equal(proof.ConfigSha256,plan.config.sha256);
  assert.equal(proof.SourceKey,"PRIMARY");
  assert.equal(proof.Nonce,"44444444-4444-4444-4444-444444444444");
  assert.equal(proof.Signature.length,32);
  assert.equal(s.reads,2);
  assert.equal(s.signerCalls,1);
  assert.equal(s.signingCalls,1);
  assert.equal(JSON.stringify(proof).includes(jwtSecret),false);
  assert.equal(JSON.stringify(proof).includes(validBearer),false);
});

test("never invoke signer for forged body, malformed JWT header or revoked scope",async()=>{
  const s=scenario(),bridge=createDormantChartSignerIssuerHandoff(s.deps);
  for(const malformed of [
    {...plan,actorId:77},{...plan,sourceKey:"OTHER"},
    {...plan,config:{...plan.config,sha256:"e".repeat(64)}},
    {...plan,config:{...plan.config,json:plan.config.json+" "}},
    {...plan,profileId:0},
  ])assert.equal(await bridge(malformed,validBearer),null);
  for(const header of ["", "Bearer ","Bearer wrong token",
    "Bearer abc\nInjected: header"])
    assert.equal(await bridge(plan,header),null);
  assert.equal(s.signerCalls,0);
  s.setSession({...active(),permissions:["DESIGN_QUERY"]});
  assert.equal(await bridge(plan,validBearer),null);
  s.setSession({...active(),tokenVersion:4});
  assert.equal(await bridge(plan,validBearer),null);
  assert.equal(s.signerCalls,0);
});

test("revoked account during signing, expired or substituted proof fail closed",async()=>{
  const s=scenario(),bridge=createDormantChartSignerIssuerHandoff(s.deps);
  s.after(()=>s.setSession({...active(),isActive:false}));
  assert.equal(await bridge(plan,validBearer),null);
  assert.equal(s.signerCalls,1);
  assert.equal(s.reads,2);
  const t=scenario(),check=createDormantChartSignerIssuerHandoff(t.deps);
  t.mutate(v=>({...v as Record<string,unknown>,ActorId:77}));
  assert.equal(await check(plan,validBearer),null);
  t.mutate(v=>{
    const receipt=v as {Attestation:Record<string,unknown>;SqlMac:string};
    return {...receipt,Attestation:{...receipt.Attestation,ActorId:77}};
  });
  assert.equal(await check(plan,validBearer),null);
  t.mutate(v=>v);
  t.after(()=>t.setNow(now+9_000));
  assert.equal(await check(plan,validBearer),null);
});

test("outage/invalid pinned key cannot supply a SQL issuer candidate",async()=>{
  const s=scenario();
  const noKey=createDormantChartSignerIssuerHandoff({
    ...s.deps,trustedSignerPublicKeys:{},
  });
  assert.equal(await noKey(plan,validBearer),null);
  const outage=createDormantChartSignerIssuerHandoff({
    ...s.deps,readLiveSession:async()=>{throw Error("SQL_CONNECTION_PRIVATE");},
  });
  assert.equal(await outage(plan,validBearer),null);
  const noNetwork=createDormantChartSignerIssuerHandoff({
    ...s.deps,requestSignedReceipt:async()=>{throw Error("MTLS_PRIVATE");},
  });
  assert.equal(await noNetwork(plan,validBearer),null);
});
