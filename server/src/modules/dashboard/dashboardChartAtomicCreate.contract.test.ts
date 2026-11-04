import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {
  canonicalChartConfig,planDormantChartCreate,CHART_ATOMIC_CREATE_RUNTIME_ENABLED,
} from "./dashboardChartAtomicCreate.contract.js";

const config={
  version:1,chartType:"BAR",dataSourceKey:"PRIMARY",categoryColumn:"ROOM",
  valueColumn:"TOTAL",valueMode:"QUERY_RESULT",maxPoints:20,showLegend:true,
};
const input={
  dashboardId:7,profileId:22,actorId:8,tokenVersion:1,
  requestId:"00000000-0000-4000-8000-000000000011",config,
  placement:{x:80,y:80,width:600,height:360},
};

test("2B-15C draft plan never enables CHART or accepts caller WidgetId",()=>{
  assert.equal(CHART_ATOMIC_CREATE_RUNTIME_ENABLED,false);
  const plan=planDormantChartCreate(input);
  assert(plan);
  assert.equal(plan.sourceKey,"PRIMARY");
  assert.equal("widgetId" in plan,false);
  assert.equal(plan.config.json,JSON.stringify(config));
  assert.equal(plan.config.sha256,createHash("sha256").update(JSON.stringify(config),"utf8").digest("hex"));
  assert.equal(plan.config.sha256.length,64);
  assert.equal(planDormantChartCreate({...input,widgetId:88}),null);
  assert.equal(planDormantChartCreate({...input,authorized:true}),null);
});

test("2B-15C canonical config is shared by initial create and sealed CAS writer",()=>{
 const original=canonicalChartConfig(config);
 assert(original);
 assert.equal(original.sha256,createHash("sha256").update(original.json).digest("hex"));
 assert.equal(canonicalChartConfig({...config,patientId:"x"}),null);
 assert.equal(canonicalChartConfig({...config,categoryColumn:"ROOM",valueColumn:"ROOM"}),null);
 assert.equal(canonicalChartConfig({...config,dataSourceKey:"PRIMARY;DROP"}),null);
 assert.equal(canonicalChartConfig({...config,maxPoints:100}),null);
});

test("2B-15C enforces request uniqueness witness and bounded placement preflight",()=>{
  assert.equal(planDormantChartCreate({...input,requestId:"not-uuid"}),null);
  assert.equal(planDormantChartCreate({...input,actorId:0}),null);
  assert.equal(planDormantChartCreate({...input,placement:{...input.placement,width:1}}),null);
  assert.equal(planDormantChartCreate({...input,placement:{...input.placement,x:Infinity}}),null);
  assert.equal(planDormantChartCreate({...input,placement:{...input.placement,browserApproved:true}}),null);
});
