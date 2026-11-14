// 2B-15D-9: synthetic HTTP/JWT boundary. NO production route, SQL or grant.
import assert from "node:assert/strict";
import test from "node:test";
import {createServer} from "node:http";
import {createHash} from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import type {Request} from "express";
import type sql from "mssql";
import {env} from "../../config/env.js";
import {createAuthenticateJwt} from "../auth/auth.middleware.js";
import {
 deriveDormantChartIssuerIntent,prepareDormantChartIssuerHandoff,
} from "./dashboardChartHttpIssuerHandoff.js";
import {CHART_ATOMIC_CREATE_RUNTIME_ENABLED} from "./dashboardChartAtomicCreate.contract.js";
import {
 CHART_WRITER_DB_ACTOR_BINDING_APPROVED,CHART_WRITER_APPROVED_PROCEDURE_SHA256,
} from "./dashboardChartWriterBoundary.js";
import {CHART_ISSUER_APPROVED_PROCEDURE_SHA256} from "./dashboardChartIssuerBoundary.js";
import {
 CHART_SQL_APPROVED_PLATFORM_SID,CHART_SQL_APPROVED_ISSUER_SID,
 CHART_SQL_APPROVED_WRITER_SID,
} from "./dashboardChartSqlPrincipalPreflight.js";
import {canonicalChartConfig} from "./dashboardChartAtomicCreate.contract.js";

const config={
 version:1,chartType:"BAR",dataSourceKey:"PRIMARY",categoryColumn:"ROOM",
 valueColumn:"TOTAL",valueMode:"QUERY_RESULT",maxPoints:20,showLegend:true,
};
const body={
 profileId:22,requestId:"00000000-0000-4000-8000-000000000011",
 config,placement:{x:80,y:80,width:600,height:360},
};

test("2B-15D-9 handoff intent is derived only from JWT plus live server session",async()=>{
 const before=env.JWT_SECRET;
 env.JWT_SECRET="synthetic-chart-issuer-handoff-secret-only";
 let session={
   isActive:true,tokenVersion:3,permissions:["DESIGN_QUERY","EXECUTE_QUERY"],
 };
 let sqlCalls=0;
 const noDbPool={
   request:()=>{sqlCalls++;throw Error("ISSUER_DB_MUST_NOT_BE_USED");},
 } as unknown as sql.ConnectionPool;
 const app=express();
 app.use(express.json());
 app.use(createAuthenticateJwt(async()=>session));
 app.post("/synthetic-intent",(req,res)=>{
   const intent=deriveDormantChartIssuerIntent(req,7,req.body);
   res.status(intent?200:403).json(intent??{code:"DENIED"});
 });
 app.post("/synthetic-handoff",async(req,res)=>{
   const intent=await prepareDormantChartIssuerHandoff(
     req,7,req.body,noDbPool,noDbPool,noDbPool);
   res.status(intent?200:403).json(intent??{code:"DENIED"});
 });
 const server=createServer(app);
 try{
   await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
   const address=server.address();
   assert(address && typeof address!=="string");
   const root="http://127.0.0.1:"+address.port;
   const token=jwt.sign({sub:"8",tokenVersion:3,permissions:[],
     username:"synthetic"},env.JWT_SECRET);
   const invalid=jwt.sign({sub:"8",tokenVersion:3},"unknown-secret");
   const send=(route:string,payload:unknown,t=token)=>fetch(root+route,{
     method:"POST",
     headers:{"Content-Type":"application/json",Authorization:"Bearer "+t},
     body:JSON.stringify(payload),
   });
   assert.equal((await send("/synthetic-intent",body,invalid)).status,401);
   const valid=await send("/synthetic-intent",body);
   assert.equal(valid.status,200);
   const intent=await valid.json() as Record<string,unknown>;
   assert.deepEqual(Object.keys(intent).sort(),[
     "ActorId","TokenVersion","DashboardId","ProfileId","RequestId",
     "SourceKey","ConfigSha256","X","Y","Width","Height",
   ].sort());
   const canonical=canonicalChartConfig(config);
   assert(canonical);
   assert.deepEqual(intent,{
     ActorId:8,TokenVersion:3,DashboardId:7,ProfileId:22,
     RequestId:body.requestId,SourceKey:"PRIMARY",
     ConfigSha256:canonical.sha256,
     X:80,Y:80,Width:600,Height:360,
   });
   assert.equal(intent.ConfigSha256,createHash("sha256")
     .update(canonical.json,"utf8").digest("hex"));
   assert.equal(JSON.stringify(intent).includes("secret"),false);
   assert.equal(JSON.stringify(intent).includes("GrantId"),false);
   for(const untrusted of [
     {actorId:77},{tokenVersion:999},{grantId:"anything"},
     {secret:"client-secret"},{issuerSid:"fake"},
     {approved:true},{issuerApproved:true},{delegationConsumed:false},
     {permissions:["DESIGN_QUERY"]},
   ]){
     assert.equal((await send("/synthetic-intent",{...body,...untrusted})).status,403);
   }
   assert.equal((await send("/synthetic-intent",{...body,profileId:0})).status,403);
   // Even with valid JWT and all three supplied SQL pool objects, the
   // unapproved issuance/Writer gates reject BEFORE any SQL metadata query.
   assert.equal(CHART_ATOMIC_CREATE_RUNTIME_ENABLED,false);
   assert.equal(CHART_WRITER_DB_ACTOR_BINDING_APPROVED,false);
   assert.equal(CHART_WRITER_APPROVED_PROCEDURE_SHA256,null);
   assert.equal(CHART_ISSUER_APPROVED_PROCEDURE_SHA256,null);
   // Missing independently reviewed SID pins must not be replaced by
   // caller-controlled fields or by three merely distinct SQL logins.
   assert.equal(CHART_SQL_APPROVED_PLATFORM_SID,null);
   assert.equal(CHART_SQL_APPROVED_ISSUER_SID,null);
   assert.equal(CHART_SQL_APPROVED_WRITER_SID,null);
   assert.equal((await send("/synthetic-handoff",body)).status,403);
   assert.equal(sqlCalls,0);
   session={...session,permissions:["DESIGN_QUERY"]};
   assert.equal((await send("/synthetic-intent",body)).status,403);
   assert.equal((await send("/synthetic-handoff",body)).status,403);
   session={...session,permissions:["EXECUTE_QUERY"]};
   assert.equal((await send("/synthetic-intent",body)).status,403);
   session={...session,permissions:[]};
   assert.equal((await send("/synthetic-intent",body)).status,403);
   assert.equal((await send("/synthetic-handoff",body)).status,403);
   session={...session,permissions:["DESIGN_QUERY","EXECUTE_QUERY"],tokenVersion:4};
   assert.equal((await send("/synthetic-intent",body)).status,401);
   assert.equal(sqlCalls,0);
 }finally{
   env.JWT_SECRET=before;
   if(server.listening)
     await new Promise<void>(resolve=>server.close(()=>resolve()));
 }
});

test("2B-15D-9 hand-crafted req.authUser can never become issuer scope",()=>{
 const req={authUser:{id:77,permissions:["DESIGN_QUERY"]}} as
   unknown as Request;
 assert.equal(deriveDormantChartIssuerIntent(req,7,body),null);
});
