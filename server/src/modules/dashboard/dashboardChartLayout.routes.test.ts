import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import {env} from "../../config/env.js";
import {createAuthenticateJwt} from "../auth/auth.middleware.js";
import {createChartLayoutRouter,CHART_LAYOUT_HTTP_RELEASE_APPROVED} from "./dashboardChartLayout.routes.js";

type State={testEnabled:boolean;target:boolean;layoutReady:boolean;
 sessionValid:boolean;inspectCalls:number;testChecks:number;writeCalls:number};
async function fixture(){
 const originalSecret=env.JWT_SECRET;
 env.JWT_SECRET="chart-layout-capabilities-synthetic-jwt-test-only";
 const state:State={testEnabled:true,target:true,layoutReady:true,
  sessionValid:true,inspectCalls:0,testChecks:0,writeCalls:0};
 const app=express();
 app.use(createAuthenticateJwt(async()=>({
  isActive:state.sessionValid,tokenVersion:3,
  permissions:["DESIGN_QUERY","EXECUTE_QUERY"]
 })));
 app.use(createChartLayoutRouter({
  enabled:()=>state.testEnabled,
  requireTest:async id=>{state.testChecks++;if(id!==7||!state.target)throw Error("PRIVATE_TARGET");},
  inspect:async input=>{
   state.inspectCalls++;
   assert.deepEqual(input,{dashboardId:7,actorId:8,tokenVersion:3});
   return state.layoutReady?{canManage:true,reason:"READY"}:
     {canManage:false,reason:"DASHBOARD_QUERY_ONLY_REQUIRED"};
  },
  write:async()=>{state.writeCalls++;throw Error("WRITE_SHOULD_NOT_BE_CALLED");}
 }));
 const server=createServer(app);
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 const address=server.address();
 assert(address&&typeof address!=="string");
 const root="http://127.0.0.1:"+address.port;
 const token=jwt.sign({sub:"8",tokenVersion:3,
  permissions:["DESIGN_QUERY","EXECUTE_QUERY"]},env.JWT_SECRET);
 const get=(path="/7/charts/v1/layout-capabilities",bearer=token)=>
   fetch(root+path,{headers:{Authorization:"Bearer "+bearer}});
 const close=async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));
  env.JWT_SECRET=originalSecret;};
 return {state,get,close};
}

test("layout discovery stays production OFF and never touches SQL/Writer",async()=>{
 const f=await fixture();
 try{
  assert.equal(CHART_LAYOUT_HTTP_RELEASE_APPROVED,false);
  f.state.testEnabled=false;
  const res=await f.get();
  assert.equal(res.status,200);
  assert.equal(res.headers.get("cache-control"),"no-store, max-age=0");
  assert.deepEqual(await res.json(),{canManage:false,reason:"TEST_AUTHORIZATION_INACTIVE"});
  assert.equal(f.state.inspectCalls,0);
  assert.equal(f.state.testChecks,0);
  assert.equal(f.state.writeCalls,0);
 }finally{await f.close();}
});
test("layout discovery is independent of CHART creation and requires verified test target",async()=>{
 const f=await fixture();
 try{
  assert.deepEqual(await (await f.get()).json(),{canManage:true,reason:"READY"});
  assert.equal(f.state.inspectCalls,1);
  assert.equal(f.state.testChecks,2);
  f.state.layoutReady=false;
  assert.deepEqual(await (await f.get()).json(),{
   canManage:false,reason:"DASHBOARD_QUERY_ONLY_REQUIRED"});
  f.state.target=false;
  assert.deepEqual(await (await f.get()).json(),{
   canManage:false,reason:"TEST_TARGET_NOT_READY"});
  assert.equal(f.state.inspectCalls,2);
  assert.equal(f.state.writeCalls,0);
 }finally{await f.close();}
});
test("unverified JWT and invalid dashboard cannot discover layout authority",async()=>{
 const f=await fixture();
 try{
  assert.equal((await f.get("/7/charts/v1/layout-capabilities","invalid")).status,401);
  assert.equal((await f.get("/0/charts/v1/layout-capabilities")).status,400);
  assert.equal((await f.get("/7/charts/v1/layout-capabilities?grant=1")).status,400);
  f.state.sessionValid=false;
  assert.equal((await f.get()).status,401);
  assert.equal(f.state.writeCalls,0);
 }finally{await f.close();}
});
