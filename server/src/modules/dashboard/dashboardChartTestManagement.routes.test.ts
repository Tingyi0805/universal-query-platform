import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {once} from "node:events";
import {createChartTestManagementRouter} from "./dashboardChartTestManagement.routes.js";

// Synthetic HTTP dependencies, not a SQL or authority issuer.
async function fixture(t:import("node:test").TestContext){
 const state={enabled:true,admin:true,viewer:true,target:true,fail:false,writes:0,reads:0,checks:0};
 const status={sealed:true,revision:"1".repeat(16),playbackStatus:"APPROVED",privacyReview:null};
 const app=express();app.use(express.json());app.use(createChartTestManagementRouter({
  enabled:()=>state.enabled,
  requireTest:async n=>{state.checks++;if(!state.target||n!==7)throw Error("PRIVATE_TARGET");},
  readAdmin:()=>state.admin?{userId:8,tokenVersion:2}:null,
  readPlayback:()=>state.viewer?{userId:8,tokenVersion:2,expiresAt:2000000000,originalBearerHeader:"Bearer synthetic"}:null,
  status:async()=>{state.reads++;return status;},
  applyDecision:async(d,w,body,actor)=>{assert.equal(d,7);assert.equal(w,88);assert.deepEqual(actor,{userId:8,tokenVersion:2});
   state.writes++;if(state.fail)throw Error("PRIVATE_SQL_OR_SECRET");assert(!("scope" in body));},
 }));
 const server=app.listen(0,"127.0.0.1");await once(server,"listening");t.after(()=>{server.closeAllConnections();server.close();});
 const address=server.address() as import("node:net").AddressInfo;
 return {state,status,call:(path:string,body?:unknown)=>fetch(`http://127.0.0.1:${address.port}/7/charts/v1/${path}`,{
  method:body===undefined?"GET":"POST",headers:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),
 })};
}
test("management routes are off by default and never touch SQL or issue authority",async t=>{
 const f=await fixture(t);f.state.enabled=false;
 assert.deepEqual(await (await f.call("test-capabilities")).json(),{playback:false});
 assert.equal((await f.call("88/status")).status,404);
 assert.equal((await f.call("88/privacy-review",{action:"REQUEST",requestId:crypto.randomUUID()})).status,404);
 assert.equal(f.state.writes+f.state.reads+f.state.checks,0);
});
test("mutable role claims or a missing live playback/admin proof cannot manage charts",async t=>{
 const f=await fixture(t);f.state.admin=false;assert.equal((await f.call("88/status")).status,403);
 assert.equal((await f.call("88/privacy-review",{action:"REQUEST",requestId:crypto.randomUUID()})).status,403);
 f.state.admin=true;f.state.viewer=false;assert.deepEqual(await (await f.call("test-capabilities")).json(),{playback:false});
 assert.equal((await f.call("88/privacy-review",{action:"REQUEST",requestId:crypto.randomUUID()})).status,403);assert.equal(f.state.writes,0);
});
test("request/approve/revoke use strict operations, exact revisions and server-selected scope",async t=>{
 const f=await fixture(t);
 for(const body of [{action:"REQUEST",requestId:crypto.randomUUID()},
  {action:"APPROVE",requestId:crypto.randomUUID(),reviewId:19,expectedRevision:"2".repeat(16),minimumCellCount:5,validDays:30,categoryPrivacyReviewed:true,differencingRiskReviewed:true},
  {action:"REVOKE",requestId:crypto.randomUUID(),reviewId:19,expectedRevision:"3".repeat(16)}]){
  const r=await f.call("88/privacy-review",body);assert.equal(r.status,200);assert.match(r.headers.get("cache-control")!,/no-store/);assert.deepEqual(await r.json(),f.status);
 }assert.equal(f.state.writes,3);assert.equal(f.state.checks,6);
});
test("client scope, fake approval, unknown fields, unsafe IDs and small thresholds fail before writing",async t=>{
 const f=await fixture(t);
 for(const patch of [{scope:{}},{actor:{userId:1}},{confirmed:true},{action:"ISSUE"},{requestId:"invalid"},
  {action:"APPROVE",reviewId:Number.MAX_SAFE_INTEGER+1},{action:"APPROVE",minimumCellCount:1}]){
  const r=await f.call("88/privacy-review",{action:"REQUEST",requestId:crypto.randomUUID(),...patch});assert.equal(r.status,409);
 }assert.equal(f.state.writes,0);
});
test("target denial and decision failure are fail-closed, scrub errors and never retry",async t=>{
 const f=await fixture(t);f.state.target=false;
 assert.equal((await f.call("88/privacy-review",{action:"REQUEST",requestId:crypto.randomUUID()})).status,409);assert.equal(f.state.writes,0);
 f.state.target=true;f.state.fail=true;const r=await f.call("88/privacy-review",{action:"REQUEST",requestId:crypto.randomUUID()});
 assert.equal(r.status,409);assert(!JSON.stringify(await r.json()).includes("PRIVATE"));assert.equal(f.state.writes,1);assert.equal(f.state.reads,0);
});
