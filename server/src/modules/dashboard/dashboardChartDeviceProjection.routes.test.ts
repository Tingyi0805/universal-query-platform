import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createServer} from "node:http";
import express from "express";
import {
  CHART_DEVICE_PROJECTION_HTTP_RELEASE_APPROVED,
  createChartDeviceProjectionRouter,
} from "./dashboardChartDeviceProjection.routes.js";
import type {ExecutionSubject} from "./dashboardQuerySourceExecution.js";

const token="A".repeat(43);
const config={chartType:"BAR",showLegend:true,
  points:[{label:"診間一",value:9},{label:"診間二",value:8}]};
const originalDevice={
  id:71,dashboardId:7,createdByUserId:8,authorizationRevision:3,
  queryModeGrantVersion:2,delegatorTokenVersion:3,lastUsedAtUtc:null as string|null,
};
type Scenario={
  approved?:boolean; status?:string;mode?:string;version?:number;
  devicePatch?:Partial<typeof originalDevice>;
  projected?:unknown;
  project?:(s:ExecutionSubject)=>Promise<unknown>;
};
async function setup(scenario:Scenario={}){
  let checkCalls=0,modeCalls=0,projectCalls=0;
  let state=scenario.status??"VALID";
  let device={...originalDevice,...scenario.devicePatch};
  let mode=scenario.mode??"QUERY_ONLY";
  let version=scenario.version??2;
  const app=express();
  app.use(express.json({limit:"2kb"}));
  app.use(createChartDeviceProjectionRouter({
    approved:()=>scenario.approved===true,
    mode:async()=>{modeCalls++;return {mode,version};},
    checkDevice:async(_id,header,ip)=>{
      checkCalls++;
      assert.equal(header,token);
      assert.equal(typeof ip,"string");
      assert(ip.length>0);
      return state==="VALID"
        ? {status:"VALID",device:{...device}}
        : {status:state};
    },
    project:async(_id,_widget,subject)=>{
      projectCalls++;
      return scenario.project ? scenario.project(subject) : scenario.projected??config;
    },
  }));
  const server=createServer(app);
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  const addr=server.address();
  assert(addr&&typeof addr!=="string");
  const url="http://127.0.0.1:"+addr.port;
  const send=(opts:{
    path?:string;token?:string|null;body?:unknown;
    headers?:Record<string,string>;
  }={})=>fetch(url+(opts.path??"/device/7/charts/v1/88/projection"),{
    method:"POST",headers:{
      ...(opts.token===null?{}:{"X-Dashboard-Device-Token":opts.token??token}),
      ...(opts.body===undefined?{}:{"Content-Type":"application/json"}),
      ...opts.headers,
    },...(opts.body===undefined?{}:{body:JSON.stringify(opts.body)}),
  });
  return {
    send,revoked:()=>{state="DISABLED";},
    mode:(m:string,v=version)=>{mode=m;version=v;},
    device:(patch:Partial<typeof originalDevice>)=>{device={...device,...patch};},
    counts:()=>({checkCalls,modeCalls,projectCalls}),
    close:async()=>new Promise<void>(resolve=>server.close(()=>resolve())),
  };
}

test("device CHART HTTP release is fixed OFF and never checks tokens, SQL or projects",async()=>{
  assert.equal(CHART_DEVICE_PROJECTION_HTTP_RELEASE_APPROVED,false);
  const f=await setup();
  try{
    const r=await f.send();
    assert.equal(r.status,404);
    assert.equal(r.headers.get("cache-control"),"no-store, max-age=0");
    assert.deepEqual(await r.json(),{error:{code:"CHART_NOT_AVAILABLE"}});
    assert.deepEqual(f.counts(),{checkCalls:0,modeCalls:0,projectCalls:0});
  }finally{await f.close();}
});

test("device projection uses original Token/IP + QUERY_ONLY live mode, never designer JWT",async()=>{
  const seen:ExecutionSubject[]=[];
  const f=await setup({approved:true,project:async subject=>{
    seen.push(subject);
    const proof=await subject.verifyDevice?.();
    assert.equal(proof?.deviceId,71);
    assert.equal(proof?.userId,8);
    assert.equal(proof?.tokenVersion,3);
    assert.match(proof?.fingerprint??"",/^[a-f0-9]{64}$/);
    return config;
  }});
  try{
    const response=await f.send();
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),config);
    assert.equal(seen[0]?.context,"device");
    assert.equal(seen[0]?.deviceId,71);
    assert.equal(seen[0]?.userId,8);
    assert.equal(seen[0]?.tokenVersion,3);
    assert.equal(seen[0]?.tokenHash,createHash("sha256").update(token).digest("hex"));
    assert.equal(f.counts().projectCalls,1);
    assert(f.counts().checkCalls>=3);
  }finally{await f.close();}
});

test("device endpoint rejects missing token, cookie-only kiosk and malformed input",async()=>{
  const f=await setup({approved:true});
  try{
    assert.equal((await f.send({token:null})).status,401);
    assert.equal((await f.send({token:null,headers:{"X-UQP-Kiosk":"1","Cookie":"session=synthetic"}})).status,401);
    assert.equal((await f.send({token:"invalid"})).status,401);
    assert.equal((await f.send({path:"/device/0/charts/v1/88/projection"})).status,400);
    assert.equal((await f.send({path:"/device/7/charts/v1/0/projection"})).status,400);
    assert.equal((await f.send({path:"/device/7/charts/v1/88/projection?actorId=8"})).status,400);
    assert.equal((await f.send({body:{actorId:8,permission:true}})).status,400);
    assert.deepEqual(f.counts(),{checkCalls:0,modeCalls:0,projectCalls:0});
  }finally{await f.close();}
});

test("public CHART playback denies revoked devices, wrong mode and stale mode grants",async()=>{
  for(const s of [
    {status:"DISABLED"},{status:"IP_RESTRICTED"},
    {mode:"LEGACY"},{mode:"QUERY_ONLY_DISABLED"},
    {devicePatch:{queryModeGrantVersion:1}},
    {devicePatch:{delegatorTokenVersion:2}},
    {devicePatch:{dashboardId:99}},
  ] as Scenario[]){
    const f=await setup({approved:true,...s});
    try{
      const response=await f.send();
      assert.equal(response.status,503);
      assert.deepEqual(await response.json(),{
        error:{code:"CHART_TRUSTED_DELIVERY_REQUIRED"},
      });
      assert.equal(f.counts().projectCalls,0);
    }finally{await f.close();}
  }
});

test("revoke Token, mode or grant during audited projection: deny, no leaked data",async()=>{
  for(const change of ["revoke","mode","grant"]){
    let mutate:()=>void=()=>{};
    const f=await setup({approved:true,project:async subject=>{
      const before=await subject.verifyDevice?.();
      assert.equal(before?.deviceId,71);
      mutate();
      return {...config,points:[{label:"PATIENT_SECRET",value:7}]};
    }});
    mutate=()=>change==="revoke"?f.revoked():
      change==="mode"?f.mode("QUERY_ONLY_DISABLED"):f.device({authorizationRevision:4});
    try{
      const result=await f.send();
      assert.equal(result.status,503);
      const payload=await result.text();
      assert.deepEqual(JSON.parse(payload),{error:{code:"CHART_TRUSTED_DELIVERY_REQUIRED"}});
      assert.equal(payload.includes("PATIENT_SECRET"),false);
      assert.equal(f.counts().projectCalls,1);
    }finally{await f.close();}
  }
});

test("invalid projection and wrong expected device identity never leak rows",async()=>{
  for(const opts of [
    {projected:{...config,rows:[{PATIENT_ID:"secret"}]}},
    {projected:{...config,points:[{label:"A",value:-1}],chartType:"PIE"}},
    {projected:{...config,points:[{label:"A",value:1},{label:"A",value:2}]}},
  ]){
    const f=await setup({approved:true,...opts});
    try{
      const r=await f.send();assert.equal(r.status,503);
      assert.equal((await r.text()).includes("secret"),false);
    }finally{await f.close();}
  }
  const f=await setup({approved:true});
  try{
    const bad=await f.send({headers:{"X-UQP-Expected-Device-Id":"72"}});
    assert.equal(bad.status,503);
    assert.equal(f.counts().projectCalls,0);
  }finally{await f.close();}
});

test("LastUsedAtUtc telemetry change does not fabricate device revocation",async()=>{
  let mutate:()=>void=()=>{};
  const f=await setup({approved:true,project:async subject=>{
    mutate();
    const proof=await subject.verifyDevice?.();
    assert.equal(proof?.deviceId,71);
    return config;
  }});
  mutate=()=>f.device({lastUsedAtUtc:"2026-11-10T08:00:00.000Z"});
  try{
    const r=await f.send();
    assert.equal(r.status,200);
  }finally{await f.close();}
});
