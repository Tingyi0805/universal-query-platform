import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { createAuthenticateJwt } from "../auth/auth.middleware.js";
import {
  CHART_PROJECTION_HTTP_RELEASE_APPROVED,
  createChartProjectionRouter,
} from "./dashboardChartProjection.routes.js";
import type { ExecutionSubject } from "./dashboardQuerySourceExecution.js";

const config = {
  chartType: "BAR", showLegend: true,
  points: [{label:"診間 A",value:9},{label:"診間 B",value:6}],
} as const;
type Session = {isActive:boolean;tokenVersion:number;permissions:string[]};
type Scenario = {
  approved: boolean;
  project?: (id:number,wid:number,subject:ExecutionSubject) => Promise<unknown>;
  tamper?: "permissions" | "header";
};
async function serverFixture(scenario: Scenario) {
  const previous = env.JWT_SECRET;
  env.JWT_SECRET = "pr91-local-synthetic-key-not-a-deployment-secret";
  let session:Session = {isActive:true,tokenVersion:3,
    permissions:["DESIGN_QUERY","EXECUTE_QUERY"]};
  let calls = 0;
  const subjects:ExecutionSubject[]=[];
  const app=express();
  app.use(express.json({limit:"2kb"}));
  app.use(createAuthenticateJwt(async () => session));
  app.use((req,_res,next)=>{
    if(scenario.tamper==="permissions"&&req.authUser)
      req.authUser={...req.authUser,permissions:["DESIGN_QUERY","EXECUTE_QUERY"]};
    if(scenario.tamper==="header")req.headers.authorization="Bearer unverified.jwt.injected";
    next();
  });
  app.use(createChartProjectionRouter({
    approved: () => scenario.approved,
    project: async(id,wid,subject) => {
      calls++;subjects.push(subject);
      return scenario.project ? scenario.project(id,wid,subject) : config;
    },
  }));
  const server:Server=createServer(app);
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();
  assert(address && typeof address!=="string");
  const root="http://127.0.0.1:"+address.port;
  const valid=jwt.sign({sub:"8",tokenVersion:3,username:"synthetic",
    permissions:[],actorId:999},env.JWT_SECRET,{expiresIn:"1h"});
  const invalid=jwt.sign({sub:"8",tokenVersion:3}, "untrusted-key");
  const send=(path="/dashboards/7/charts/v1/88/projection",
    body:unknown=undefined,token:string=valid)=>
      fetch(root+path.replace("/dashboards/","/"),{
        method:"POST",headers:{
          Authorization:"Bearer "+token,
          ...(body===undefined?{}:{"Content-Type":"application/json"}),
        },...(body===undefined?{}:{body:JSON.stringify(body)}),
      });
  return {
    valid,invalid,send,
    get calls(){return calls;},
    get subjects(){return subjects;},
    session: (updated:Session)=>{session=updated;},
    close: async()=>{
      await new Promise<void>(resolve=>server.close(()=>resolve()));
      env.JWT_SECRET=previous;
    },
  };
}

test("release is pinned OFF; disabled endpoint makes zero projector/SQL calls",async()=>{
  assert.equal(CHART_PROJECTION_HTTP_RELEASE_APPROVED,false);
  const f=await serverFixture({approved:false});
  try{
    const res=await f.send();
    assert.equal(res.status,404);
    assert.equal(res.headers.get("cache-control"),"no-store, max-age=0");
    assert.deepEqual(await res.json(),{error:{code:"CHART_NOT_AVAILABLE"}});
    assert.equal(f.calls,0);
    assert.equal((await f.send("/dashboards/7/charts/v1/88/projection",
      {actorId:99,approved:true})).status,404);
    assert.equal(f.calls,0);
  } finally{await f.close();}
});

test("verified JWT actor is the only projection identity; response contains only points",async()=>{
  const f=await serverFixture({approved:true});
  try{
    const res=await f.send();
    assert.equal(res.status,200);
    assert.deepEqual(await res.json(),config);
    assert.deepEqual(f.subjects[0],{
      context:"designer",userId:8,tokenVersion:3,
      tokenHash:createHash("sha256").update(f.valid).digest("hex"),
    });
    assert.equal(JSON.stringify(f.subjects[0]).includes("actorId"),false);
    assert.equal((await f.send("/dashboards/7/charts/v1/88/projection",
      undefined,f.invalid)).status,401);
    assert.equal(f.calls,1);
    assert.equal((await f.send("/dashboards/7/charts/v1/88/projection",
      {actorId:77})).status,400);
    assert.equal((await f.send("/dashboards/7/charts/v1/88/projection",
      {approved:true,rows:[{PATIENT_ID:"sensitive"}]})).status,400);
    assert.equal((await f.send("/dashboards/7/charts/v1/88/projection?actorId=77")).status,400);
    assert.equal((await f.send("/dashboards/0/charts/v1/88/projection")).status,400);
    assert.equal((await f.send("/dashboards/7/charts/v1/0/projection")).status,400);
    assert.equal(f.calls,1);
    f.session({isActive:false,tokenVersion:3,
      permissions:["DESIGN_QUERY","EXECUTE_QUERY"]});
    assert.equal((await f.send()).status,401);
    assert.equal(f.calls,1);
  }finally{await f.close();}
});


test("CHART projection rejects original tokens without expiry or expired mid-query",async()=>{
  let expirySeconds=0;
  const f=await serverFixture({approved:true,project:async()=>{
    if(expirySeconds>0){
      // The request entered with a valid JWT. Hold the trusted projector
      // until after exp, to prove that the HTTP adapter rechecks it.
      await new Promise<void>(resolve=>setTimeout(resolve,
        Math.max(0,expirySeconds*1000-Date.now()+80)));
    }
    return config;
  }});
  try{
    // The fixture installs this synthetic key before the test starts.
    const signingKey=env.JWT_SECRET;
    if (typeof signingKey!=="string" || signingKey.length===0)
      throw Error("SYNTHETIC_CHART_JWT_TEST_KEY_REQUIRED");
    const withoutExpiry=jwt.sign({sub:"8",tokenVersion:3},signingKey);
    const noExpiry=await f.send(undefined,undefined,withoutExpiry);
    assert.equal(noExpiry.status,503);
    assert.deepEqual(await noExpiry.json(),
      {error:{code:"CHART_TRUSTED_DELIVERY_REQUIRED"}});

    expirySeconds=Math.floor(Date.now()/1000)+3;
    const shortLived=jwt.sign({
      sub:"8",tokenVersion:3,exp:expirySeconds,
    },signingKey);
    const expiredDuringWork=await f.send(undefined,undefined,shortLived);
    assert.equal(expiredDuringWork.status,503);
    const payload=await expiredDuringWork.text();
    assert.deepEqual(JSON.parse(payload),
      {error:{code:"CHART_TRUSTED_DELIVERY_REQUIRED"}});
    assert.equal(payload.includes("診間"),false);
    assert.equal(f.calls,2);
  }finally{await f.close();}
});

test("authorization must come from live session, not a forgeable JWT permission claim",async()=>{
  const f=await serverFixture({approved:true});
  try{
    f.session({isActive:true,tokenVersion:3,permissions:["EXECUTE_QUERY"]});
    assert.equal((await f.send()).status,403);
    f.session({isActive:true,tokenVersion:3,permissions:["DESIGN_QUERY"]});
    assert.equal((await f.send()).status,403);
    f.session({isActive:true,tokenVersion:4,
      permissions:["DESIGN_QUERY","EXECUTE_QUERY"]});
    assert.equal((await f.send()).status,401);
    assert.equal(f.calls,0);
  }finally{await f.close();}
});

test("malformed, untrusted or leaky projections fail closed without returning private content",async()=>{
  const unsafe:unknown[]=[
    {...config,rows:[{PATIENT_ID:"secret"}]},
    {...config,points:[{label:"診間 A",value:9,patientId:"secret"}]},
    {...config,points:[{label:"診間 A",value:9},{label:"診間 A",value:6}]},
    {...config,points:[{label:"A",value:Infinity}]},
    {...config,chartType:"PIE",points:[{label:"A",value:-1}]},
    {...config,chartType:"PIE",points:[{label:"A",value:0}]},
  ];
  for(const value of unsafe){
    const f=await serverFixture({approved:true,project:async()=>value});
    try{
      const res=await f.send(),payload=await res.text();
      assert.equal(res.status,503);
      assert.deepEqual(JSON.parse(payload),{error:{code:"CHART_TRUSTED_DELIVERY_REQUIRED"}});
      assert.equal(payload.includes("secret"),false);
    }finally{await f.close();}
  }
  const f=await serverFixture({approved:true,project:async()=>{
    throw Error("PACS_SQL_PATIENT_ID_DONT_LOG");
  }});
  try{
    const res=await f.send();
    assert.equal(res.status,503);
    assert.equal((await res.text()).includes("PACS_SQL_PATIENT_ID_DONT_LOG"),false);
  }finally{await f.close();}
});

test("CHART projection cannot elevate mutable permissions or swap authenticated JWT hash",async()=>{
  const promoted=await serverFixture({approved:true,tamper:"permissions"});
  try{
    promoted.session({isActive:true,tokenVersion:3,permissions:["DESIGN_QUERY"]});
    assert.equal((await promoted.send()).status,403);
    assert.equal(promoted.calls,0);
  }finally{await promoted.close();}
  const swapped=await serverFixture({approved:true,tamper:"header"});
  try{
    const response=await swapped.send();
    assert.equal(response.status,200);
    assert.deepEqual(swapped.subjects[0],{
      context:"designer",userId:8,tokenVersion:3,
      tokenHash:createHash("sha256").update(swapped.valid).digest("hex"),
    });
  }finally{await swapped.close();}
});
