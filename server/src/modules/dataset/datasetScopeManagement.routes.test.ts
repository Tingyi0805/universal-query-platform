import assert from "node:assert/strict";
import {test} from "node:test";
import express from "express";
import {createServer} from "node:http";
import {randomUUID} from "node:crypto";
import jwt from "jsonwebtoken";
import {env} from "../../config/env.js";
import {createAuthenticateJwt} from "../auth/auth.middleware.js";
import {createDatasetScopeManagementRouter} from "./datasetScopeManagement.routes.js";
import {DatasetScopeError} from "./datasetScopeManagement.js";
import type {datasetScopeManagement} from "./datasetScopeManagement.repository.js";

test("API contract: JWT/session, admin errors, strict CAS fields, no diagnostic disclosure",async()=>{
  const old=env.JWT_SECRET;env.JWT_SECRET="SYNTHETIC_SCOPE_API_TEST_SECRET_ONLY";
  const state={version:1,active:true,admin:true,calls:0,fail:false};
  const call=async()=>{state.calls++;if(!state.admin)throw new DatasetScopeError("SCOPE_ADMIN_REQUIRED",403);if(state.fail)throw Error("SQL password=synthetic_private");return {deliveryAllowed:false};};
  const service={options:call,list:call,mutate:call,history:call} as unknown as typeof datasetScopeManagement;
  const app=express();app.use(express.json());
  app.use(createDatasetScopeManagementRouter(service,createAuthenticateJwt(async()=>({isActive:state.active,tokenVersion:state.version,permissions:state.admin?["MANAGE_DATASET_SECURITY_SCOPE"]:[]}))));
  const server=createServer(app);await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const token=jwt.sign({sub:"5",tokenVersion:1,roles:["SYSTEM_ADMIN"],permissions:["MANAGE_DATASET_SECURITY_SCOPE"]},env.JWT_SECRET);
  const request=async(path:string,method="GET",body?:unknown,auth=token)=>{const r=await fetch(base+path,{method,headers:{"Content-Type":"application/json",Authorization:auth?`Bearer ${auth}`:""},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json(),cache:r.headers.get("cache-control")};};
  try{
    assert.equal((await request("/options","GET",undefined,"")).status,401);
    assert.equal((await request("/options","GET",undefined,"forged")).status,401);
    state.version=2;assert.equal((await request("/options")).status,401);state.version=1;
    state.active=false;assert.equal((await request("/options")).status,401);state.active=true;
    state.admin=false;assert.equal((await request("/options")).status,403);state.admin=true;
    assert.equal((await request("/options")).cache,"no-store");
    const body={requestId:randomUUID(),action:"GRANT",expectedVersion:"MISSING",definitionVersion:"0000000000000001",configurationVersion:"0000000000000001",parentOwnerUserId:null,parentOwnerVersion:null};
    for(const invalid of [{...body,verified:true},{...body,parentOwnerUserId:42},{...body,expectedVersion:"0"}])assert.equal((await request("/datasets/9007199254740993/scopes/OWNER/8","PUT",invalid)).status,400);
    assert.equal((await request("/datasets/01/scopes")).status,400);
    assert.equal((await request("/datasets/9007199254740993/scopes/OWNER/8","PUT",body)).status,200);
    state.fail=true;const failure=await request("/options");assert.equal(failure.status,503);assert.ok(!JSON.stringify(failure.body).includes("synthetic_private"));
  }finally{await new Promise<void>(r=>server.close(()=>r()));env.JWT_SECRET=old;}
});
