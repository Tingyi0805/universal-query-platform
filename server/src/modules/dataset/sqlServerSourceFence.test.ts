import {test} from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {createServer} from "node:http";
import jwt from "jsonwebtoken";
import {randomUUID} from "node:crypto";
import {env} from "../../config/env.js";
import {createAuthenticateJwt} from "../auth/auth.middleware.js";
import {restrictedSavedSelect,sourceObservationSafety,SourceFenceError,acquireControlledMetadataLease} from "./sqlServerSourceFence.js";
import {initializeFieldsCommand,type datasetFieldInitialization} from "./datasetFieldInitialization.repository.js";
import {createDatasetFieldInitializationRouter} from "./datasetFieldInitialization.routes.js";

test("bounded parser accepts only explicit columns of one two-part physical dependency",()=>{
  assert.deepEqual(restrictedSavedSelect("SELECT [Id], [Label] AS [顯示欄] FROM [f3].[Records];"),{schema:"f3",table:"Records",columns:[{name:"Id",alias:"Id"},{name:"Label",alias:"顯示欄"}]});
  assert.equal(sourceObservationSafety.authority,"NONE");assert.equal(sourceObservationSafety.deliveryAllowed,false);
});
for(const text of ["SELECT * FROM f3.Records","SELECT Id FROM db.f3.Records","SELECT Id FROM server.db.f3.Records","SELECT Id FROM dbo.fn()",
  "SELECT dbo.fn(Id) FROM f3.Records","SELECT Id INTO f3.Other FROM f3.Records","EXEC sys.sp_tables","SELECT Id FROM f3.Records JOIN f3.Other ON 1=1",
  "SELECT Id FROM f3.Records WHERE Id=1","SELECT Id, Label AS ID FROM f3.Records","SELECT @P FROM f3.Records","SELECT Id FROM f3.Records; DROP TABLE f3.Records",
  "SELECT Id FROM f3.Records -- comment","WITH x AS (SELECT Id FROM f3.Records) SELECT Id FROM x"])
  test("unsupported SQL rejects without disclosing its contents: "+String(text.length)+"/"+text.slice(0,6),()=>{
    assert.throws(()=>restrictedSavedSelect(text),(e:unknown)=>e instanceof SourceFenceError&&!e.message.includes(text));
  });
test("parser refuses objects without invoking getters or Proxy hooks",()=>{
  let hooks=0;const proxy=new Proxy({},{get(){hooks++;throw Error("secret");}});
  assert.throws(()=>restrictedSavedSelect(proxy as unknown as string));assert.equal(hooks,0);
});
test("collector requires bounded source request timeout before transaction acquisition",async()=>{
  await assert.rejects(()=>acquireControlledMetadataLease({config:{requestTimeout:30000}} as any,{identity:randomUUID(),incarnation:randomUUID(),database:"Synthetic"}),{code:"SOURCE_BOUNDED_TIMEOUT_REQUIRED"});
});
test("collection command rejects authority assertions and unsafe IDs/revisions",()=>{
  const c={requestId:randomUUID(),definitionVersion:"0000000000000001",configurationVersion:"0000000000000001",expectedSnapshotVersion:"MISSING"};
  assert.ok(initializeFieldsCommand.safeParse(c).success);
  for(const bad of [{...c,sourceFence:"VERIFIED"},{...c,sql:"SELECT secret"},{...c,definitionVersion:1},{...c,expectedSnapshotVersion:"0000000000000000"}])assert.equal(initializeFieldsCommand.safeParse(bad).success,false);
});
test("metadata API checks live session and both capabilities, refuses fake source proof and hides errors",async()=>{
  const secret=env.JWT_SECRET;env.JWT_SECRET="F3_SYNTHETIC_TEST_SECRET_ONLY";
  const state={active:true,tv:1,permissions:["DESIGN_QUERY","CONFIRM_DATASET_CLASSIFICATION"],calls:0,fail:false};
  const invoke=async()=>{state.calls++;if(state.fail)throw Error("SELECT SQL private_password");return {deliveryAllowed:false,authority:"NONE"};};
  const app=express();app.use(express.json());app.use(createDatasetFieldInitializationRouter({status:invoke,collect:invoke} as unknown as typeof datasetFieldInitialization,
    createAuthenticateJwt(async()=>({isActive:state.active,tokenVersion:state.tv,permissions:state.permissions}))));
  const server=createServer(app);await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  const token=jwt.sign({sub:"303",tokenVersion:1,roles:["SYSTEM_ADMIN"]},env.JWT_SECRET),base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const req=async(method="GET",body?:unknown)=>{const r=await fetch(base+"/9007199254740993",{method,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json(),cache:r.headers.get("cache-control")};};
  try{
    assert.equal((await req()).status,200);state.tv=2;assert.equal((await req()).status,401);state.tv=1;
    state.active=false;assert.equal((await req()).status,401);state.active=true;
    state.permissions=["DESIGN_QUERY"];assert.equal((await req()).status,403);state.permissions=["CONFIRM_DATASET_CLASSIFICATION"];assert.equal((await req()).status,403);
    state.permissions=["DESIGN_QUERY","CONFIRM_DATASET_CLASSIFICATION"];
    assert.equal((await req("POST",{sourceFence:"VERIFIED"})).status,400);
    state.fail=true;const r=await req();assert.equal(r.status,503);assert.equal(r.cache,"no-store");assert.ok(!JSON.stringify(r.body).includes("private_password"));
  }finally{await new Promise<void>(r=>server.close(()=>r()));env.JWT_SECRET=secret;}
});
