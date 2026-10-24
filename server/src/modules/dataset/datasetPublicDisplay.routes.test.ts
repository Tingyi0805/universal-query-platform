import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import {createServer} from "node:http";
import {env} from "../../config/env.js";
import {createAuthenticateJwt} from "../auth/auth.middleware.js";
import {createRuntimeIdentityVerifier} from "../queryDefinition/queryDelivery.js";
import {createDatasetPublicDisplayRouter} from "./datasetPublicDisplay.routes.js";
import {DatasetDisplayError} from "./datasetDisplaySchema.js";
import {randomUUID} from "node:crypto";
async function fixture(run:(f:{state:any;call:(body:unknown,token?:string)=>Promise<{status:number;body:any}>})=>Promise<void>){
 const secret=env.JWT_SECRET;env.JWT_SECRET="SYNTHETIC_PUBLIC_POLICY";
 const state={isActive:true,tokenVersion:1,permissions:["DESIGN_QUERY","EXECUTE_QUERY"],calls:0,enabled:true,denied:false};
 const session=async()=>({...state});const identity=createRuntimeIdentityVerifier(session);const verify=async(actor:any)=>{const a=await actor({});if(!a.permissions.includes("DESIGN_QUERY")||!a.permissions.includes("EXECUTE_QUERY")||state.denied)throw new DatasetDisplayError("FORBIDDEN",403);};
 const repository={get:async(_id:number,actor:any)=>{await verify(actor);return {} as never;},save:async(_id:number,actor:any,input:any)=>{await verify(actor);state.calls++;return {grants:input.grants} as never;},getInTransaction:async()=>({}) as never};
 const app=express();app.use(express.json());app.use((req,_res,next)=>{req.id="synthetic-public-request";next();});app.use(createDatasetPublicDisplayRouter({repository,identity,authenticate:createAuthenticateJwt(session),enabled:()=>state.enabled}));
 const server=createServer(app);await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const token=jwt.sign({sub:"4",tokenVersion:1},env.JWT_SECRET);
 const call=async(body:unknown,t=token)=>{const r=await fetch(`http://127.0.0.1:${(server.address() as any).port}/1/public-display-policy`,{method:"PUT",headers:{Authorization:`Bearer ${t}`,"Content-Type":"application/json"},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 try{await run({state,call});}finally{await new Promise<void>(r=>server.close(()=>r()));env.JWT_SECRET=secret;}
}
const command=()=>({expectedVersion:null,expectedSensitivityVersion:1,expectedDefinitionVersion:"0000000000000001",expectedConfigurationVersion:"0000000000000001",requestId:randomUUID(),confirm:true,grants:[{columnName:"NAME",permitted:true}]});
for(const scenario of ["valid","invalidJWT","token","permission","dataset","disabled","injection","no-confirm"])test(`public policy HTTP ${scenario}`,()=>fixture(async f=>{
 const c:any=command();let token: string|undefined;if(scenario==="invalidJWT")token="bad";if(scenario==="token")f.state.tokenVersion++;if(scenario==="permission")f.state.permissions=[];if(scenario==="dataset")f.state.denied=true;if(scenario==="disabled")f.state.enabled=false;if(scenario==="injection")c.sql="PRIVATE_PATIENT_SQL";if(scenario==="no-confirm")c.confirm=false;
 const r=await f.call(c,token);assert.equal(r.status,scenario==="valid"?200:["invalidJWT","token"].includes(scenario)?401:["permission","dataset"].includes(scenario)?403:scenario==="disabled"?503:400);assert.equal(f.state.calls,scenario==="valid"?1:0);assert.ok(!JSON.stringify(r).includes("PRIVATE_PATIENT_SQL"));
}));
