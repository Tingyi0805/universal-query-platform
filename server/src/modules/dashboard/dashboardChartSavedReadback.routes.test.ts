import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import {env} from "../../config/env.js";
import {createAuthenticateJwt} from "../auth/auth.middleware.js";
import {
  CHART_SAVED_READBACK_HTTP_RELEASE_APPROVED,
  createChartSavedReadbackRouter,
} from "./dashboardChartSavedReadback.routes.js";
import type {TrustedSavedChartWidget} from "./dashboardChartDelivery.coordinator.js";

const config={version:1,chartType:"BAR" as const,dataSourceKey:"PRIMARY",
  categoryColumn:"ROOM",valueColumn:"TOTAL",
  valueMode:"QUERY_RESULT" as const,maxPoints:20,showLegend:true};
type Session={isActive:boolean;tokenVersion:number;permissions:string[]};
async function fixture(approved=false,
  read?:(id:number,widget:number)=>Promise<TrustedSavedChartWidget|null>){
  const previous=env.JWT_SECRET;env.JWT_SECRET="chart-saved-readback-test-only";
  let session:Session={isActive:true,tokenVersion:3,
    permissions:["DESIGN_QUERY","EXECUTE_QUERY"]};
  let reads=0,checks=0;
  const app=express();
  app.use(createAuthenticateJwt(async()=>session));
  app.use(createChartSavedReadbackRouter({
    approved:()=>approved,
    readSavedWidget:async(id,widget)=>{
      reads++;
      return read?read(id,widget):{
        id:88,dashboardId:7,widgetType:"CHART",
        revision:"0011223344556677",config,
      };
    },
    readSession:async()=>{checks++;return session;},
  }));
  const server=createServer(app);
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  const addr=server.address();
  assert(addr&&typeof addr!=="string");
  const base="http://127.0.0.1:"+addr.port;
  const token=jwt.sign({sub:"8",tokenVersion:3},env.JWT_SECRET,
    {expiresIn:"1h"});
  const get=(path="/7/charts/v1/88/readback",bearer=token)=>
    fetch(base+path,{headers:{Authorization:"Bearer "+bearer}});
  return {
    get,token,
    update:(next:Session)=>{session=next;},
    get reads(){return reads;},get checks(){return checks;},
    close:async()=>{await new Promise<void>(r=>server.close(()=>r()));
      env.JWT_SECRET=previous;},
  };
}

test("saved CHART readback release is OFF; no trusted SQL metadata access",async()=>{
  assert.equal(CHART_SAVED_READBACK_HTTP_RELEASE_APPROVED,false);
  const f=await fixture();
  try{
    const r=await f.get();
    assert.equal(r.status,404);
    assert.equal(r.headers.get("cache-control"),"no-store, max-age=0");
    assert.deepEqual(await r.json(),{error:{code:"CHART_NOT_AVAILABLE"}});
    assert.equal(f.reads,0);assert.equal(f.checks,0);
  }finally{await f.close();}
});

test("test-only designer reads only the validated saved CHART seal and configuration",async()=>{
  const f=await fixture(true);
  try{
    const r=await f.get();
    assert.equal(r.status,200);
    assert.deepEqual(await r.json(),{
      widgetId:88,sealRevision:"0011223344556677",config,
    });
    assert.equal(f.reads,1);assert.equal(f.checks,1);
    for(const path of ["/0/charts/v1/88/readback",
      "/7/charts/v1/0/readback",
      "/7/charts/v1/88/readback?approved=1"]){
      assert.equal((await f.get(path)).status,400);
    }
  }finally{await f.close();}
});

test("missing designer/execute privileges, revoked token and no-exp JWT are refused",async()=>{
  const f=await fixture(true);
  try{
    for(const permissions of [[],["DESIGN_QUERY"],["EXECUTE_QUERY"],["VIEW_QUERY"]]){
      f.update({isActive:true,tokenVersion:3,permissions});
      assert.equal((await f.get()).status,403);
    }
    assert.equal(f.reads,0);
    f.update({isActive:false,tokenVersion:3,
      permissions:["DESIGN_QUERY","EXECUTE_QUERY"]});
    assert.equal((await f.get()).status,401);
    f.update({isActive:true,tokenVersion:4,
      permissions:["DESIGN_QUERY","EXECUTE_QUERY"]});
    assert.equal((await f.get()).status,401);
    f.update({isActive:true,tokenVersion:3,
      permissions:["DESIGN_QUERY","EXECUTE_QUERY"]});
    const noExpiry=jwt.sign({sub:"8",tokenVersion:3},env.JWT_SECRET!);
    assert.equal((await f.get(undefined as never,noExpiry)).status,503);
  }finally{await f.close();}
});

test("mid-read revoke, invalid seal or SQL failure cannot disclose saved config",async()=>{
  let mutate:()=>void=()=>{};
  const f=await fixture(true,async()=>{
    mutate();
    return {id:88,dashboardId:7,widgetType:"CHART",
      revision:"0011223344556677",config};
  });
  mutate=()=>f.update({isActive:true,tokenVersion:3,permissions:["DESIGN_QUERY"]});
  try{
    const r=await f.get();
    assert.equal(r.status,503);
    assert.deepEqual(await r.json(),{error:{code:"CHART_SAVED_READBACK_REQUIRED"}});
  }finally{await f.close();}
  for(const read of [
    async()=>({id:88,dashboardId:7,widgetType:"CHART" as const,
      revision:"wrong",config}),
    async()=>({id:88,dashboardId:7,widgetType:"CHART" as const,
      revision:"0011223344556677",config:{...config,rows:["PRIVATE"]}}),
    async()=>{throw Error("PATIENT_SQL_PRIVATE");},
  ]){
    const g=await fixture(true,read);
    try{
      const r=await g.get(),body=await r.text();
      assert.equal(r.status,503);
      assert.deepEqual(JSON.parse(body),
        {error:{code:"CHART_SAVED_READBACK_REQUIRED"}});
      assert.equal(body.includes("PRIVATE"),false);
    }finally{await g.close();}
  }
});
