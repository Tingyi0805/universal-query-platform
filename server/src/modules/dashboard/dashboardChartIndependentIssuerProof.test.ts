import test from "node:test";
import assert from "node:assert/strict";
import {
  createHmac,generateKeyPairSync,randomBytes,sign,
} from "node:crypto";
import {
  chartActorAttestationBytes,CHART_ACTOR_ATTESTATION_PINNED_KEYS,
} from "./dashboardChartActorAttestation.js";
import {
  planDormantChartCreate,
} from "./dashboardChartAtomicCreate.contract.js";
import {
  CHART_DUAL_PROOF_RELEASE_APPROVED,
  CHART_SQL_ISSUER_PROOF_MAX_AGE_MS,
  parseIndependentChartIssuerProof,
  sqlChartIssuerCanonicalScope,
} from "./dashboardChartIndependentIssuerProof.js";

const now=1_800_000_000_000;
const nullablePlan=planDormantChartCreate({
  actorId:8,tokenVersion:3,dashboardId:7,profileId:22,
  requestId:"00000000-0000-4000-8000-000000000011",
  config:{version:1,chartType:"BAR",dataSourceKey:"PRIMARY",
    categoryColumn:"ROOM",valueColumn:"TOTAL",
    valueMode:"QUERY_RESULT",maxPoints:20,showLegend:true},
  placement:{x:80,y:90,width:600,height:360},
});
assert(nullablePlan);
const plan=nullablePlan;
const signer=generateKeyPairSync("ed25519");
const hmacKey=randomBytes(32);
const trusted=Object.freeze({
  "separate-signer-1":signer.publicKey.export({
    format:"pem",type:"spki",
  }).toString(),
});
const placeholder=Buffer.alloc(64).toString("base64url");
const unsigned=()=>({
  Version:1,Purpose:"CHART_ACTOR_BIND",
  Audience:"UQP_SQL_CHART_ISSUER_V1",KeyId:"separate-signer-1",
  ActorId:plan.actorId,TokenVersion:plan.tokenVersion,
  DashboardId:plan.dashboardId,ProfileId:plan.profileId,
  RequestId:plan.requestId,SourceKey:plan.sourceKey,
  ConfigSha256:plan.config.sha256,
  X:plan.placement.x,Y:plan.placement.y,
  Width:plan.placement.width,Height:plan.placement.height,
  Nonce:"a".repeat(32),IssuedAtUtcMs:now-500,
  ExpiresAtUtcMs:now+8000,Signature:placeholder,
});
function signEd<T extends ReturnType<typeof unsigned>>(data:T){
  const bytes=chartActorAttestationBytes(data);
  assert(bytes);
  return {...data,
    Signature:sign(null,bytes,signer.privateKey).toString("base64url")};
}
function makeDual(data=unsigned()){
  const attestation=signEd(data);
  const nonce=attestation.Nonce;
  const proof={
    ActorId:plan.actorId,TokenVersion:plan.tokenVersion,
    DashboardId:plan.dashboardId,ProfileId:plan.profileId,
    RequestId:plan.requestId,SourceKey:plan.sourceKey,
    ConfigSha256:plan.config.sha256,
    X:plan.placement.x,Y:plan.placement.y,
    Width:plan.placement.width,Height:plan.placement.height,
    Nonce:[nonce.slice(0,8),nonce.slice(8,12),
      nonce.slice(12,16),nonce.slice(16,20),nonce.slice(20,32)].join("-"),
    IssuedAtUtc:new Date(data.IssuedAtUtcMs),
    ExpiresAtUtc:new Date(data.ExpiresAtUtcMs),
    Signature:Buffer.alloc(32),
  };
  const sqlMac=createHmac("sha256",hmacKey)
    .update(sqlChartIssuerCanonicalScope(proof),"utf8")
    .digest("base64url");
  return {Attestation:attestation,SqlMac:sqlMac};
}

test("dual signer and SQL release are OFF until reviewed provisioning",()=>{
  assert.equal(CHART_DUAL_PROOF_RELEASE_APPROVED,false);
  assert.equal(CHART_SQL_ISSUER_PROOF_MAX_AGE_MS,10_000);
  assert.deepEqual(CHART_ACTOR_ATTESTATION_PINNED_KEYS,{});
  assert.equal(parseIndependentChartIssuerProof(
    makeDual(),plan,CHART_ACTOR_ATTESTATION_PINNED_KEYS,now),null);
});

test("independent Ed25519 attestation yields SQL issuer scope with exact canonical bytes",()=>{
  const raw=makeDual();
  const checked=parseIndependentChartIssuerProof(raw,plan,trusted,now);
  assert(checked);
  assert.equal(checked.ActorId,8);
  assert.equal(checked.TokenVersion,3);
  assert.equal(checked.RequestId,plan.requestId);
  assert.equal(checked.ConfigSha256,plan.config.sha256);
  assert.equal(checked.Nonce,"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  assert.equal(checked.Signature.toString("base64url"),raw.SqlMac);
  assert.equal(checked.IssuedAtUtc.toISOString(),"2027-01-15T07:59:59.500Z");
  assert.equal(checked.ExpiresAtUtc.valueOf()-checked.IssuedAtUtc.valueOf(),8500);
  const expected=[
    "UQP_CHART_ACTOR_V1","8","3","7","22",plan.requestId,
    "PRIMARY",plan.config.sha256,"80","90","600","360",
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    checked.IssuedAtUtc.toISOString().slice(0,23),
    checked.ExpiresAtUtc.toISOString().slice(0,23),
  ].join("|");
  assert.equal(sqlChartIssuerCanonicalScope(checked),expected);
  // UQP did not need the HMAC secret to verify Ed25519 scope; the SQL
  // procedure verifies SQL HMAC with its independently provisioned pads.
});

test("JWT-derived plan cannot be swapped by a valid dual proof",()=>{
  const raw=makeDual();
  for(const mutation of [
    {actorId:77},{tokenVersion:4},{dashboardId:8},{profileId:23},
    {sourceKey:"OTHER"},
    {requestId:"00000000-0000-4000-8000-000000000022"},
  ])
    assert.equal(parseIndependentChartIssuerProof(
      raw,{...plan,...mutation},trusted,now),null);
  for(const mutation of [
    {x:81},{y:91},{width:601},{height:361},
  ])
    assert.equal(parseIndependentChartIssuerProof(raw,{
      ...plan,placement:{...plan.placement,...mutation},
    },trusted,now),null);
});

test("malformed, injected, altered or substituted proof always fails closed",()=>{
  const raw=makeDual();
  for(const value of [
    null,{},[],{...raw,ActorId:77},{...raw,IssuerSid:"fake"},
    {...raw,KeyId:"attacker"}, {...raw,Approved:true},
    {...raw,SqlMac:"bad"}, {...raw,SqlMac:"a".repeat(43)},
    {...raw,SqlMac:raw.SqlMac+"="}, {...raw,SqlMac:raw.SqlMac.slice(0,42)},
    {...raw,Attestation:{...raw.Attestation,ActorId:77}},
    {...raw,Attestation:{...raw.Attestation,Nonce:"b".repeat(32)}},
    {...raw,Attestation:{...raw.Attestation,ExpiresAtUtcMs:now+6000}},
    {...raw,Attestation:{...raw.Attestation,Signature:"invalid"}},
    {...raw,Attestation:{...raw.Attestation,SqlSignature:"client"}},
  ]) {
    assert.equal(parseIndependentChartIssuerProof(value,plan,trusted,now),null);
  }
  assert.equal(parseIndependentChartIssuerProof(
    raw,plan,{"separate-signer-1":"not a public key"},now),null);
  // An invalid-but-canonical HMAC is structurally valid here; SQL MUST
  // independently recompute and reject the signature before any grant.
  const wrongMac={...raw,SqlMac:Buffer.alloc(32,7).toString("base64url")};
  const parsed=parseIndependentChartIssuerProof(wrongMac,plan,trusted,now);
  assert(parsed);
  assert.notDeepEqual(parsed.Signature,
    Buffer.from(raw.SqlMac,"base64url"));
  const wrongKey=generateKeyPairSync("ed25519");
  assert.equal(parseIndependentChartIssuerProof(raw,plan,{
    "separate-signer-1":wrongKey.publicKey.export({
      format:"pem",type:"spki",
    }).toString(),
  },now),null);
});

test("SQL 10-second bound is stricter than Ed25519 60-second receipt",()=>{
  for(const data of [
    {...unsigned(),IssuedAtUtcMs:now-1,ExpiresAtUtcMs:now+10_000},
    {...unsigned(),IssuedAtUtcMs:now+1,ExpiresAtUtcMs:now+1000},
    {...unsigned(),IssuedAtUtcMs:now-1000,ExpiresAtUtcMs:now},
    {...unsigned(),IssuedAtUtcMs:now-8000,ExpiresAtUtcMs:now+3000},
    {...unsigned(),IssuedAtUtcMs:now-61_000,ExpiresAtUtcMs:now+1},
  ]) assert.equal(parseIndependentChartIssuerProof(
    makeDual(data),plan,trusted,now),null);
  assert(parseIndependentChartIssuerProof(makeDual(),plan,trusted,now));
});
