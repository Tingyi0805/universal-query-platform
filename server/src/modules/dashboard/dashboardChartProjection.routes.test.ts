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
    permissions:[],actorId:999},env.JWT_SECRET);
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
