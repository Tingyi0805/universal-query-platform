import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createServer} from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import {env} from "../../config/env.js";
import {createAuthenticateJwt} from "../auth/auth.middleware.js";
import {
  CHART_USER_PROJECTION_HTTP_RELEASE_APPROVED,
  createChartUserProjectionRouter,
} from "./dashboardChartUserProjection.routes.js";
import type {ExecutionSubject} from "./dashboardQuerySourceExecution.js";

const key="synthetic-chart-user-playback-jwt-test-only";
const tokenClaims={sub:"8",tokenVersion:3,username:"test-user"};
const config={chartType:"BAR",showLegend:true,
  points:[{label:"診間 A",value:9},{label:"診間 B",value:6}]};
type Session={isActive:boolean;tokenVersion:number;permissions:string[]};
type Scenario={
  approved?:boolean;
  tamper?:"header"|"permissions";
  project?:(subject:ExecutionSubject)=>Promise<unknown>;
};
async function fixture(s:Scenario={}){
  const old=env.JWT_SECRET;env.JWT_SECRET=key;
  let session:Session={isActive:true,tokenVersion:3,
    permissions:["VIEW_QUERY","EXECUTE_QUERY"]};
  let calls=0,reads=0;
  const subjects:ExecutionSubject[]=[];
  const app=express();
  app.use(express.json({limit:"2kb"}));
  app.use(createAuthenticateJwt(async()=>session));
  app.use((req,_res,next)=>{
    if(s.tamper==="header")req.headers.authorization="Bearer unverified.fake";
    if(s.tamper==="permissions"&&req.authUser)
      req.authUser={...req.authUser,permissions:["VIEW_QUERY","EXECUTE_QUERY"]};
    next();
  });
  app.use(createChartUserProjectionRouter({
    approved:()=>s.approved===true,
    readSession:async()=>{reads++;return session;},
    project:async(_id,_widget,subject)=>{
      calls++;subjects.push(subject);
      return s.project?s.project(subject):config;
    },
  }));
  const server=createServer(app);
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const addr=server.address();
  assert(addr&&typeof addr!=="string");
  const root="http://127.0.0.1:"+addr.port;
  const valid=jwt.sign(tokenClaims,key,{expiresIn:"1h"});
  const send=(path="/7/playback/v1/charts/88/projection",
    body:unknown=undefined,bearer=valid)=>{
    const headers:Record<string,string>={Authorization:"Bearer "+bearer};
    if(body!==undefined)headers["Content-Type"]="application/json";
    return fetch(root+path,{
      method:"POST",headers,
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
    });
  };
  return {
    send,valid,
    update:(next:Session)=>{session=next;},
    get calls(){return calls;},get reads(){return reads;},
    get subjects(){return subjects;},
    close:async()=>{await new Promise<void>(r=>server.close(()=>r()));env.JWT_SECRET=old;},
  };
}

test("public user CHART route is permanently OFF; no projector or final session call",async()=>{
  assert.equal(CHART_USER_PROJECTION_HTTP_RELEASE_APPROVED,false);
  const f=await fixture();
  try{
    const r=await f.send();
    assert.equal(r.status,404);
    assert.equal(r.headers.get("cache-control"),"no-store, max-age=0");
    assert.deepEqual(await r.json(),{error:{code:"CHART_NOT_AVAILABLE"}});
    assert.equal(f.calls,0);assert.equal(f.reads,0);
  }finally{await f.close();}
});

test("user CHART authorizes VIEW_QUERY/EXECUTE_QUERY without designer privilege",async()=>{
  const f=await fixture({approved:true});
  try{
    const r=await f.send();
    assert.equal(r.status,200);
    assert.deepEqual(await r.json(),config);
    assert.equal(f.calls,1);assert.equal(f.reads,1);
    const s=f.subjects[0]!;
    assert.equal(s.context,"user");
    assert.equal(s.userId,8);assert.equal(s.tokenVersion,3);
    assert.equal(s.deviceId,undefined);
    assert(Number.isSafeInteger(s.expiresAt));
    assert.equal(s.tokenHash,createHash("sha256").update(f.valid).digest("hex"));
    assert.equal(JSON.stringify(s).includes("originalBearerHeader"),false);
  }finally{await f.close();}
});

test("user CHART rejects absent, revoked, stale or upgraded JWT permissions",async()=>{
  const f=await fixture({approved:true});
  try{
    for(const permissions of [[],["VIEW_QUERY"],["EXECUTE_QUERY"],["DESIGN_QUERY"]]){
      f.update({isActive:true,tokenVersion:3,permissions});
      assert.equal((await f.send()).status,403);
    }
    f.update({isActive:true,tokenVersion:4,
      permissions:["VIEW_QUERY","EXECUTE_QUERY"]});
    assert.equal((await f.send()).status,401);
    f.update({isActive:false,tokenVersion:3,
      permissions:["VIEW_QUERY","EXECUTE_QUERY"]});
    assert.equal((await f.send()).status,401);
    assert.equal(f.calls,0);
  }finally{await f.close();}
  const forged=await fixture({approved:true,tamper:"permissions"});
  try{
    forged.update({isActive:true,tokenVersion:3,permissions:["VIEW_QUERY"]});
    assert.equal((await forged.send()).status,403);
    assert.equal(forged.calls,0);
  }finally{await forged.close();}
});

test("user CHART refuses client-provided actor, SQL, widget or chart config",async()=>{
  const f=await fixture({approved:true});
  try{
    for(const data of [
      {actorId:8},{deviceToken:"fake"},{approved:true},{sourceKey:"PRIMARY"},
      {ConfigJson:{rows:[{PATIENT_ID:"secret"}]}},{rows:[{id:"private"}]},
    ])assert.equal((await f.send(undefined as never,data)).status,400);
    assert.equal((await f.send("/0/playback/v1/charts/88/projection")).status,400);
    assert.equal((await f.send("/7/playback/v1/charts/0/projection")).status,400);
    assert.equal((await f.send("/7/playback/v1/charts/88/projection?approved=1")).status,400);
    assert.equal(f.calls,0);
  }finally{await f.close();}
});

test("original user JWT is immutable across later header mutation",async()=>{
  const f=await fixture({approved:true,tamper:"header"});
  try{
    const r=await f.send();
    assert.equal(r.status,200);
    assert.equal(f.subjects[0]?.tokenHash,
      createHash("sha256").update(f.valid).digest("hex"));
  }finally{await f.close();}
});

test("user Query access revoked after audited chart projection is denied without rows",async()=>{
  let mutate:()=>void=()=>{};
  const f=await fixture({approved:true,project:async()=>{
    mutate();
    return {...config,points:[{label:"PRIVATE-QUERY-ROW",value:9}]};
  }});
  mutate=()=>f.update({isActive:true,tokenVersion:3,permissions:["VIEW_QUERY"]});
  try{
    const r=await f.send(),body=await r.text();
    assert.equal(r.status,503);
    assert.deepEqual(JSON.parse(body),{error:{code:"CHART_TRUSTED_DELIVERY_REQUIRED"}});
    assert.equal(body.includes("PRIVATE-QUERY-ROW"),false);
    assert.equal(f.calls,1);assert.equal(f.reads,1);
  }finally{await f.close();}
});

test("user JWT expired during Query delivery or missing exp is denied at end",async()=>{
  let expireAt=0;
  const f=await fixture({approved:true,project:async()=>{
    if(expireAt>0)await new Promise<void>(resolve=>setTimeout(resolve,
      Math.max(0,expireAt*1000-Date.now()+60)));
    return config;
  }});
  try{
    const noExpiry=jwt.sign(tokenClaims,key);
    assert.equal((await f.send(undefined as never,undefined,noExpiry)).status,403);
    expireAt=Math.floor(Date.now()/1000)+3;
    const short=jwt.sign({...tokenClaims,exp:expireAt},key);
    const result=await f.send(undefined as never,undefined,short);
    assert.equal(result.status,503);
    assert.deepEqual(await result.json(),{error:{code:"CHART_TRUSTED_DELIVERY_REQUIRED"}});
    assert.equal(f.calls,1);
  }finally{await f.close();}
});

test("user projection rejects untrusted points and redacts internal SQL errors",async()=>{
  for(const project of [
    async()=>({...config,rows:[{PATIENT_ID:"secret"}]}),
    async()=>({...config,points:[{label:"A",value:2},{label:"A",value:3}]}),
    async()=>{throw Error("PATIENT_SQL_SECRET");},
  ]){
    const f=await fixture({approved:true,project});
    try{
      const r=await f.send(),body=await r.text();
      assert.equal(r.status,503);
      assert.deepEqual(JSON.parse(body),{error:{code:"CHART_TRUSTED_DELIVERY_REQUIRED"}});
      assert.equal(body.includes("PATIENT"),false);
    }finally{await f.close();}
  }
});
