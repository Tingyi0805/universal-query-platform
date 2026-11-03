import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import { createServer } from "node:http";
import { env } from "../../config/env.js";
import { createAuthenticateJwt } from "../auth/auth.middleware.js";
import { createRuntimeIdentityVerifier, createQueryDelivery, defaultQueryDeliveryDependencies } from "../queryDefinition/queryDelivery.js";
import { createDrilldownRouter } from "./dashboardDrilldown.routes.js";
import { createDrilldownService, drilldownDependencies } from "./dashboardDrilldown.service.js";
import { publicConfig } from "./dashboardLayout.repository.js";

test("public config strips interaction graph and binding keys, preserving existing presentation",()=>{assert.deepEqual(publicConfig(JSON.stringify({interactiveDrilldown:{secret:"MRN"},interactiveRoot:"r",lastSuccess:{position:"BOTTOM_RIGHT"}})),{lastSuccess:{position:"BOTTOM_RIGHT"}});});
test("JWT-only HTTP contract, strict payloads, no-store and live token revocation",async()=>{
  const old=env.JWT_SECRET;env.JWT_SECRET="synthetic-drilldown-key";
  let version=1,creates=0;
  const session=async()=>({isActive:true,tokenVersion:version,permissions:["VIEW_QUERY","EXECUTE_QUERY"]});
  const identity=createRuntimeIdentityVerifier(session);
  const service={create:async()=>{creates++;return {contextId:"x"};},act:async()=>({status:"OK"})} as unknown as ReturnType<typeof createDrilldownService>;
  const app=express();app.use(express.json());app.use(createDrilldownRouter(service,createAuthenticateJwt(session),identity));
  const server=createServer(app);await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const base=`http://127.0.0.1:${(server.address() as any).port}/1/interactive/v1/contexts`;
  const token=jwt.sign({sub:"1",tokenVersion:1},env.JWT_SECRET,{expiresIn:60});
  const expired=jwt.sign({sub:"1",tokenVersion:1},env.JWT_SECRET,{expiresIn:-1});
  const send=(body:any,authorization?:string)=>fetch(base,{method:"POST",headers:{"Content-Type":"application/json",...(authorization?{Authorization:`Bearer ${authorization}`}:{})},body:JSON.stringify(body)});
  try{
    for(const auth of [undefined,"device-token",jwt.sign({dashboardId:1,deviceId:4},env.JWT_SECRET),expired]){
      const r=await send({profileId:1},auth);assert.equal(r.status,401);assert.equal(r.headers.get("cache-control"),"no-store");
    }
    for(const extra of [{queryId:999},{sql:"SELECT 1"},{values:{MRN:"forged"}},{rowRef:"forged"}])assert.equal((await send({profileId:1,...extra},token)).status,400);
    assert.equal((await send({profileId:1},token)).status,200);assert.equal(creates,1);
    version=2;assert.equal((await send({profileId:1},token)).status,401);assert.equal(creates,1);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));env.JWT_SECRET=old;}
});

for (const failure of ["patient-audit","ordinary-audit","revoked-during-execute","policy-changed","missing-disclosure"] as const) test(`real QueryDelivery integration: ${failure} rejects data and rowRefs`,async()=>{
  let revoked=false,policyVersion="1",executions=0;
  const graph={version:1,root:"root",nodes:[{id:"root",queryId:1}],edges:[]};
  const identity=async()=>{if(revoked)throw new Error("TOKEN_REVOKED");return {userId:1,tokenVersion:1,permissions:["VIEW_QUERY","EXECUTE_QUERY"]};};
  const delivery=createQueryDelivery({
    ...defaultQueryDeliveryDependencies,
    access:async()=>({id:1,datasetId:1,canView:true,canExecute:true,isPublished:true,isActive:true,isArchived:false}) as any,
    accessRevision:async()=>"1",
    snapshot:async()=>({datasetId:1,definitionVersion:"0000000000000001",sensitivityVersion:policyVersion,
      policy:{state:"CONFIRMED",version:policyVersion,rules:[{columnName:"ID",mode:"NONE"},{columnName:"MRN",mode:"OMIT"}],patientAuditOnlyColumns:["MRN"]},patientAudit:{enabled:true}}) as any,
    dataset:async()=>({id:1,dataSourceId:1,sqlText:"SELECT ID,MRN",isActive:true,isArchived:false}) as any,
    reports:async()=>[],patientState:async()=>({status:"CONFIRMED",fingerprint:"p"}) as any,
    execute:async()=>{executions++;if(failure==="revoked-during-execute")revoked=true;if(failure==="policy-changed")policyVersion="2";
      return {columns:[{name:"ID"},{name:"MRN"}],rows:[{ID:1,MRN:"SYNTHETIC-ONLY"}],rowCount:1,truncated:false,elapsedMs:1};},
    auditPatient:async()=>{if(failure==="patient-audit")throw new Error("audit offline");return failure==="missing-disclosure"?null:1;},
  });
  const service=createDrilldownService({...drilldownDependencies,delivery,enabled:()=>true,load:async()=>({revision:"1",rootQueryId:1,graph,rootValues:{}}),parameters:async()=>[],startAudit:async()=>1,
    completeAuditFailure:async()=>undefined,finalizeDeliveryAudit:async(_id,_stats,verify)=>{if(failure==="ordinary-audit")throw new Error("Audit failure");await verify({} as any);}});
  await assert.rejects(service.create(1,1,"jwt",identity,{ipAddress:null,userAgent:null}));assert.equal(executions,1);
});
