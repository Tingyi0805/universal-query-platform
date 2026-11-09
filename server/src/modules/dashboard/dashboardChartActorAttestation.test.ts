import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {
  CHART_ACTOR_ATTESTATION_MAX_AGE_MS,
  CHART_ACTOR_ATTESTATION_PINNED_KEYS,
  chartActorAttestationBytes,verifyChartActorAttestation,
} from "./dashboardChartActorAttestation.js";
import {
  canonicalChartConfig,CHART_ATOMIC_CREATE_RUNTIME_ENABLED,
} from "./dashboardChartAtomicCreate.contract.js";

const now=1_800_000_000_000;
const cfg={
  version:1,chartType:"BAR",dataSourceKey:"PRIMARY",categoryColumn:"ROOM",
  valueColumn:"TOTAL",valueMode:"QUERY_RESULT",maxPoints:20,showLegend:true,
};
const canonical=canonicalChartConfig(cfg);
assert(canonical);
const plan={
  actorId:8,tokenVersion:3,dashboardId:7,profileId:22,
  requestId:"00000000-0000-4000-8000-000000000011",sourceKey:"PRIMARY",
  config:canonical,placement:{x:80,y:90,width:600,height:360},
};
const keys=generateKeyPairSync("ed25519");
const pem=keys.publicKey.export({type:"spki",format:"pem"}).toString();
const registry=Object.freeze({"reviewed-key-v1":pem});
const sigPlaceholder=Buffer.alloc(64).toString("base64url");
const unsigned=()=>({
  Version:1,Purpose:"CHART_ACTOR_BIND",Audience:"UQP_SQL_CHART_ISSUER_V1",
  KeyId:"reviewed-key-v1",
  ActorId:8,TokenVersion:3,DashboardId:7,ProfileId:22,
  RequestId:plan.requestId,SourceKey:"PRIMARY",
  ConfigSha256:canonical.sha256,
  X:80,Y:90,Width:600,Height:360,
  Nonce:"3".repeat(32),
  IssuedAtUtcMs:now-15_000,ExpiresAtUtcMs:now+30_000,
  Signature:sigPlaceholder,
});
function signed(input:ReturnType<typeof unsigned>){
  const bytes=chartActorAttestationBytes(input);
  assert(bytes);
  return {...input,Signature:sign(null,bytes,keys.privateKey).toString("base64url")};
}

test("independent attestation defaults to no trust keys and no runtime permission",()=>{
  assert.deepEqual(CHART_ACTOR_ATTESTATION_PINNED_KEYS,{});
  assert(Object.isFrozen(CHART_ACTOR_ATTESTATION_PINNED_KEYS));
  assert.equal(CHART_ATOMIC_CREATE_RUNTIME_ENABLED,false);
  assert.equal(CHART_ACTOR_ATTESTATION_MAX_AGE_MS,60_000);
  assert.equal(verifyChartActorAttestation(
    signed(unsigned()),plan,CHART_ACTOR_ATTESTATION_PINNED_KEYS,now),false);
});

test("Ed25519 signature, domain separation and immutable plan scope match",()=>{
  const proof=signed(unsigned());
  assert.equal(verifyChartActorAttestation(proof,plan,registry,now),true);
  const bytes=chartActorAttestationBytes(proof);
  assert(bytes);
  assert(bytes.toString().startsWith("UQP_CHART_ACTOR_ATTESTATION_V1\n"));
  assert(!bytes.toString().includes("Signature"));
  assert(!bytes.toString().includes(proof.Signature));
  assert.equal(verifyChartActorAttestation(proof,plan,{},now),false);
  assert.equal(verifyChartActorAttestation(proof,plan,
    {"reviewed-key-v1":"invalid PEM"},now),false);
  const other=generateKeyPairSync("ed25519");
  assert.equal(verifyChartActorAttestation(proof,plan,{
    "reviewed-key-v1":other.publicKey.export({type:"spki",format:"pem"}).toString(),
  },now),false);
  const rsa=generateKeyPairSync("rsa",{modulusLength:2048});
  assert.equal(verifyChartActorAttestation(proof,plan,{
    "reviewed-key-v1":rsa.publicKey.export({type:"spki",format:"pem"}).toString(),
  },now),false);
});

test("actor/token, dashboard/profile, idempotency and config hash cannot be substituted",()=>{
  const proof=signed(unsigned());
  for(const changed of [
    {actorId:9},{tokenVersion:4},{dashboardId:8},{profileId:23},
    {requestId:"00000000-0000-4000-8000-000000000022"},
    {sourceKey:"WARD"},
  ])assert.equal(verifyChartActorAttestation(proof,{...plan,...changed},registry,now),false);
  for(const changed of [
    {x:81},{y:91},{width:601},{height:361},
  ])assert.equal(verifyChartActorAttestation(proof,{
    ...plan,placement:{...plan.placement,...changed},
  },registry,now),false);
  assert.equal(verifyChartActorAttestation(proof,{
    ...plan,config:{...canonical,sha256:"a".repeat(64)},
  },registry,now),false);
  assert.equal(verifyChartActorAttestation(proof,{
    ...plan,config:{...canonical,json:JSON.stringify({...cfg,maxPoints:21})},
  },registry,now),false);
  assert.equal(createHash("sha256").update(canonical.json).digest("hex"),canonical.sha256);
});

test("signed tampering, unknown or extra fields and forged approvals fail closed",()=>{
  const proof=signed(unsigned());
  const changes=[
    {ActorId:7},{TokenVersion:4},{DashboardId:8},{ProfileId:9},
    {ConfigSha256:"a".repeat(64)},{RequestId:"00000000-0000-4000-8000-000000000022"},
    {X:99},{Y:91},{Width:650},{Height:400},
    {Nonce:"4".repeat(32)},{IssuedAtUtcMs:now-25_000},
    {ExpiresAtUtcMs:now+20_000},{KeyId:"unknown"},
    {Purpose:"CHART_EDIT"},{Audience:"OTHER_WRITER"},
    {Signature:Buffer.alloc(64,1).toString("base64url")},
    {Signature:"!"},{Signature:"A".repeat(85)},
    {approved:true},{patientId:"sensitive"},{signatureKey:"client-controlled"},
  ];
  for(const change of changes){
    const altered={...proof,...change};
    assert.equal(verifyChartActorAttestation(altered,plan,registry,now),false,
      JSON.stringify(change));
  }
  assert.equal(verifyChartActorAttestation(null,plan,registry,now),false);
  assert.equal(verifyChartActorAttestation([],plan,registry,now),false);
  assert.equal(verifyChartActorAttestation({Signature:"x"},plan,registry,now),false);
});

test("expired, premature, long-lived or clock-skewed receipts cannot be accepted",()=>{
  const source=unsigned();
  for(const modified of [
    {...source,IssuedAtUtcMs:now+1,ExpiresAtUtcMs:now+1000},
    {...source,IssuedAtUtcMs:now-30_000,ExpiresAtUtcMs:now},
    {...source,IssuedAtUtcMs:now-70_000,ExpiresAtUtcMs:now+1},
    {...source,IssuedAtUtcMs:now,ExpiresAtUtcMs:now+60_001},
    {...source,IssuedAtUtcMs:now+100,ExpiresAtUtcMs:now+60},
    {...source,IssuedAtUtcMs:now-5_000,ExpiresAtUtcMs:now-1},
  ]){
    assert.equal(verifyChartActorAttestation(signed(modified),plan,registry,now),false);
  }
  assert.equal(verifyChartActorAttestation(
    signed({...source,IssuedAtUtcMs:now-10_000,ExpiresAtUtcMs:now+50_000}),
    plan,registry,now),true);
  // Cryptographic validation alone does not protect against replay: SQL must
  // consume the delegation grant under lock in the Writer's same transaction.
});
