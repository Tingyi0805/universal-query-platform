import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import type {DormantChartCreatePlan} from "./dashboardChartAtomicCreate.contract.js";
import {
  CHART_DELEGATION_MAX_LIFETIME_MS,
  matchesDormantChartDelegationFields,
  type DormantChartDelegationRow,
} from "./dashboardChartActorDelegation.contract.js";

// All data below is synthetic. Matching a forged object must NEVER grant
// authority: only a DB-owned, separately-issued grant may be consumed.
const ISSUER_SID="a1b2c3d4";
const GRANT="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const REQUEST="00000000-0000-4000-8000-000000000011";
const secret=Buffer.alloc(32,0x6b);
const config={
  version:1 as const,chartType:"BAR" as const,dataSourceKey:"PRIMARY",
  categoryColumn:"ROOM",valueColumn:"TOTAL",valueMode:"QUERY_RESULT" as const,
  maxPoints:20,showLegend:true,
};
const json=JSON.stringify(config);
const digest=createHash("sha256").update(json,"utf8").digest("hex");
const plan:DormantChartCreatePlan={
  actorId:8,tokenVersion:3,dashboardId:7,profileId:22,
  requestId:REQUEST,sourceKey:"PRIMARY",
  config:{data:config,json,sha256:digest},
  placement:{x:80,y:80,width:600,height:360},
};
const now=new Date("2026-11-04T10:00:30.000Z");
const row=():DormantChartDelegationRow=>({
  GrantId:GRANT,Purpose:"CHART_CREATE",Version:1,IssuerSid:ISSUER_SID,
  SecretSha256:createHash("sha256").update(secret).digest("hex"),
  ActorId:8,TokenVersion:3,DashboardId:7,ProfileId:22,
  RequestId:REQUEST,SourceKey:"PRIMARY",ConfigSha256:digest,
  X:80,Y:80,Width:600,Height:360,
  IssuedAtUtc:new Date("2026-11-04T10:00:00.000Z"),
  ExpiresAtUtc:new Date("2026-11-04T10:01:00.000Z"),
  ConsumedAtUtc:null,IsRevoked:false,
});
const presentation=()=>({grantId:GRANT,secret:Buffer.from(secret)});
const matches=(r:unknown=row(),p:DormantChartCreatePlan=plan,c:unknown=presentation(),
  sid=ISSUER_SID,time=now)=>
  matchesDormantChartDelegationFields(r,p,c,sid,time);

test("2B-15D-6 offline grant match accepts exact synthetic scoped fields only",()=>{
  assert.equal(CHART_DELEGATION_MAX_LIFETIME_MS,60_000);
  assert.equal(matches(),true);
  // A second valid actor with DESIGN_QUERY has no right to substitute its
  // ActorId or TokenVersion into another user's one-time delegation.
  assert.equal(matches(row(),{...plan,actorId:77}),false);
  assert.equal(matches(row(),{...plan,tokenVersion:4}),false);
  assert.equal(matches(row(),{...plan,requestId:
    "00000000-0000-4000-8000-000000000012"}),false);
});

test("2B-15D-6 altered DB grant scope never matches",()=>{
  const altered:ReadonlyArray<[keyof DormantChartDelegationRow,unknown]>=[
    ["ActorId",77],["TokenVersion",4],
    ["DashboardId",8],["ProfileId",23],
    ["RequestId","00000000-0000-4000-8000-000000000099"],
    ["SourceKey","OTHER"],["ConfigSha256","f".repeat(64)],
    ["X",81],["Y",81],["Width",601],["Height",361],
    ["IssuerSid","ffffffff"],["Purpose","CHART_REVIEW"],["Version",2],
    ["ConsumedAtUtc",new Date("2026-11-04T10:00:10.000Z")],
    ["IsRevoked",true],
  ];
  for(const [key,value] of altered)
    assert.equal(matches({...row(),[key]:value}),false,String(key));
  const alteredPlan:DormantChartCreatePlan={
    ...plan,config:{...plan.config,sha256:"e".repeat(64)},
  };
  assert.equal(matches(row(),alteredPlan),false);
  assert.equal(matches(row(),{...plan,config:{...plan.config,json:"{}"}}),false);
  assert.equal(matches(row(),{...plan,sourceKey:"OTHER"}),false);
  assert.equal(matches(row(),{...plan,placement:{...plan.placement,x:79}}),false);
});

test("2B-15D-6 secret, grant ID and opaque presentation cannot be forged",()=>{
  assert.equal(matches(row(),plan,{grantId:GRANT,secret:Buffer.alloc(32,0)}),false);
  assert.equal(matches(row(),plan,{grantId:GRANT,secret:Buffer.alloc(31,0x6b)}),false);
  assert.equal(matches(row(),plan,{grantId:"not-a-uuid",secret}),false);
  assert.equal(matches(row(),plan,{...presentation(),actorId:77}),false);
  assert.equal(matches(row(),plan,{...presentation(),approved:true}),false);
  assert.equal(matches(row(),plan,{grantId:GRANT}),false);
  assert.equal(matches({...row(),SecretSha256:null}),false);
  assert.equal(matches({...row(),SecretSha256:"f".repeat(64)}),false);
  assert.equal(matches({...row(),GrantId:"aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff"}),false);
});

test("2B-15D-6 expired, future, oversized, consumed or unknown evidence fails closed",()=>{
  assert.equal(matches(row(),plan,presentation(),ISSUER_SID,
    new Date("2026-11-04T10:01:00.000Z")),false);
  assert.equal(matches(row(),plan,presentation(),ISSUER_SID,
    new Date("2026-11-04T09:59:59.999Z")),false);
  assert.equal(matches({...row(),ExpiresAtUtc:new Date("2026-11-04T10:01:00.001Z")}),false);
  assert.equal(matches({...row(),IssuedAtUtc:null}),false);
  assert.equal(matches({...row(),ExpiresAtUtc:null}),false);
  assert.equal(matches({...row(),ConsumedAtUtc:undefined}),false);
  assert.equal(matches(row(),plan,presentation(),"wrong-issuer"),false);
  assert.equal(matches(row(),plan,presentation(),ISSUER_SID,new Date(NaN)),false);
  assert.equal(matches(null),false);
  assert.equal(matches({}),false);
});
