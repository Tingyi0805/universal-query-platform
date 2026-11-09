import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { createAuthenticateJwt } from "../auth/auth.middleware.js";
import {
  CHART_CREATE_HTTP_RELEASE_APPROVED,
  createChartCreateRouter,
} from "./dashboardChartCreate.routes.js";
import type { DormantChartCreatePlan } from "./dashboardChartAtomicCreate.contract.js";

const body = {
  profileId: 22,
  requestId: "00000000-0000-4000-8000-000000000011",
  config: {
    version: 1, chartType: "BAR", dataSourceKey: "PRIMARY",
    categoryColumn: "ROOM", valueColumn: "TOTAL",
    valueMode: "QUERY_RESULT", maxPoints: 20, showLegend: true,
  },
  placement: { x: 80, y: 80, width: 600, height: 360 },
};
const receipt = {
  widgetId: 88, sealRevision: "0011223344556677",
  auditLogId: "9007199254740993",
};
type Session = { isActive: boolean; tokenVersion: number; permissions: string[] };

async function fixture(approved: boolean, create?: (plan: DormantChartCreatePlan)=>Promise<unknown>) {
  const previous = env.JWT_SECRET;
  env.JWT_SECRET = "issue89-chart-create-http-synthetic-only";
  let session: Session = {
    isActive: true, tokenVersion: 3,
    permissions: ["DESIGN_QUERY", "EXECUTE_QUERY"],
  };
  const plans: DormantChartCreatePlan[] = [];
  const app = express();
  app.use(express.json({limit:"4kb"}));
  app.use(createAuthenticateJwt(async()=>session));
  app.use(createChartCreateRouter({
    approved: () => approved,
    create: async plan => {
      plans.push(plan);
      return create ? create(plan) : receipt;
    },
  }));
  const server = createServer(app);
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const root = "http://127.0.0.1:" + address.port;
  const valid = jwt.sign({sub:"8",tokenVersion:3,actorId:777,
    permissions:["DESIGN_QUERY","EXECUTE_QUERY"]},env.JWT_SECRET);
  const invalid = jwt.sign({sub:"8",tokenVersion:3},"untrusted-key");
  const send = (payload:unknown=body, token=valid, path="/7/charts/v1") =>
    fetch(root+path,{method:"POST",headers:{
      Authorization:"Bearer "+token,"Content-Type":"application/json",
    },body:JSON.stringify(payload)});
  return {
    send, valid, invalid, plans,
    session: (next:Session)=>{session=next;},
    close: async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));env.JWT_SECRET=previous;},
  };
}

test("CHART create route remains hard-OFF with zero SQL/Writer invocations",async()=>{
  assert.equal(CHART_CREATE_HTTP_RELEASE_APPROVED,false);
  const f=await fixture(false,async()=>{throw Error("MUST_NOT_BE_CALLED");});
  try{
    for(const payload of [body,{...body,actorId:999,approved:true}]){
      const result=await f.send(payload);
      assert.equal(result.status,404);
      assert.equal(result.headers.get("cache-control"),"no-store, max-age=0");
      assert.deepEqual(await result.json(),{error:{code:"CHART_NOT_AVAILABLE"}});
    }
    assert.equal(f.plans.length,0);
  }finally{await f.close();}
});

test("test-only transport honors only verified JWT actor, strict plan and safe audit receipt",async()=>{
  const f=await fixture(true);
  try{
    const r=await f.send();
    assert.equal(r.status,201);
    assert.deepEqual(await r.json(),receipt);
    assert.equal(f.plans.length,1);
    assert.equal(f.plans[0]!.actorId,8);
    assert.equal(f.plans[0]!.tokenVersion,3);
    assert.equal(f.plans[0]!.dashboardId,7);
    assert.equal(f.plans[0]!.profileId,22);
    assert.equal(f.plans[0]!.config.data.chartType,"BAR");
    assert.equal((await f.send(body,f.invalid)).status,401);
    for(const extra of [
      {actorId:999},{tokenVersion:100},{approved:true},
      {grantId:"00000000-0000-4000-8000-000000000001"},
      {deviceToken:"public"},{widgetId:100},{issuerSid:"fake"},
      {sqlMac:"fake"},{signerKey:"fake"},{rows:[{PATIENT_ID:"secret"}]},
    ]){
      assert.equal((await f.send({...body,...extra})).status,400);
    }
    for(const invalid of [
      {...body,profileId:0},
      {...body,placement:{...body.placement,width:0}},
      {...body,config:{...body.config,approved:true}},
    ])assert.equal((await f.send(invalid)).status,400);
    assert.equal((await f.send(body,f.valid,"/7/charts/v1?approved=1")).status,400);
    assert.equal((await f.send(body,f.valid,"/0/charts/v1")).status,400);
    assert.equal(f.plans.length,1);
    f.session({isActive:true,tokenVersion:3,permissions:["DESIGN_QUERY"]});
    assert.equal((await f.send()).status,403);
    f.session({isActive:true,tokenVersion:4,permissions:["DESIGN_QUERY","EXECUTE_QUERY"]});
    assert.equal((await f.send()).status,401);
    f.session({isActive:false,tokenVersion:3,permissions:["DESIGN_QUERY","EXECUTE_QUERY"]});
    assert.equal((await f.send()).status,401);
    assert.equal(f.plans.length,1);
  }finally{await f.close();}
});

test("malformed/oversharing Writer results never reach HTTP, SQL errors are redacted",async()=>{
  for(const create of [
    async()=>({...receipt,sql:"PATIENT_ID_SECRET"}),
    async()=>({...receipt,auditLogId:9007199254740993}),
    async()=>({...receipt,widgetId:-1}),
    async()=>{throw Error("PRIVATE_PACS_SQL_PATIENT_ID");},
  ]){
    const f=await fixture(true,create);
    try{
      const response=await f.send();
      assert.equal(response.status,503);
      const txt=await response.text();
      assert.deepEqual(JSON.parse(txt),{error:{code:"CHART_TRUSTED_CREATE_REQUIRED"}});
      assert.equal(txt.includes("PATIENT"),false);
      assert.equal(txt.includes("PRIVATE"),false);
      assert.equal(f.plans.length,1);
    }finally{await f.close();}
  }
});
