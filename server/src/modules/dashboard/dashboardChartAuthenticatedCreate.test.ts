import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import {createServer} from "node:http";
import type sql from "mssql";
import {
 chartWriterIdentitySql,CHART_WRITER_DB_ACTOR_BINDING_APPROVED,
} from "./dashboardChartWriterBoundary.js";
import {createAuthenticateJwt,readVerifiedJwtActor} from "../auth/auth.middleware.js";
import {env} from "../../config/env.js";
import {
  planVerifiedChartCreateRequest,recheckChartActorInTransaction,
  prepareDormantChartWriteRequest,
} from "./dashboardChartAuthenticatedCreate.js";
import {CHART_ATOMIC_CREATE_RUNTIME_ENABLED} from "./dashboardChartAtomicCreate.contract.js";

const config={
 version:1,chartType:"BAR",dataSourceKey:"PRIMARY",
 categoryColumn:"ROOM",valueColumn:"TOTAL",valueMode:"QUERY_RESULT",
 maxPoints:20,showLegend:true,
};
const body={
 profileId:22,requestId:"00000000-0000-4000-8000-000000000011",
 config,placement:{x:80,y:80,width:600,height:360},
};

test("2B-15C actor is bound ONLY to verified JWT + live session, never request body",async()=>{
 const old=env.JWT_SECRET;
 env.JWT_SECRET="synthetic-chart-session-secret-not-production";
 let session={
  isActive:true,tokenVersion:3,permissions:["DESIGN_QUERY","EXECUTE_QUERY"],
 };
 const app=express();app.use(express.json());
 app.use(createAuthenticateJwt(async()=>session));
 app.post("/chart-plan",(req,res)=>{
  const plan=planVerifiedChartCreateRequest(req,7,req.body);
  res.status(plan?200:403).json(plan?
   {actorId:plan.actorId,tokenVersion:plan.tokenVersion,sourceKey:plan.sourceKey}:{code:"DENIED"});
 });
 // Simulate a buggy later internal middleware replacing mutable req.authUser.
 // The original live session is still authoritative and cannot be upgraded.
 app.post("/chart-poisoned",(req,res)=>{
  if(req.authUser)req.authUser={...req.authUser,permissions:["DESIGN_QUERY"]};
  const plan=planVerifiedChartCreateRequest(req,7,req.body);
  res.status(plan?200:403).json({code:plan?"UNSAFE_ALLOW":"DENIED"});
 });
 const server=createServer(app);
 await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
 const port=(server.address() as {port:number}).port;
 const url="http://127.0.0.1:"+port+"/chart-plan";
 const token=jwt.sign({sub:"8",tokenVersion:3,permissions:[],username:"test"},env.JWT_SECRET);
 const badToken=jwt.sign({sub:"8",tokenVersion:3,permissions:["DESIGN_QUERY"]},"other-key");
 const send=(payload:unknown,t=token,endpoint=url)=>fetch(endpoint,{method:"POST",headers:{
  "Content-Type":"application/json",Authorization:"Bearer "+t,
 },body:JSON.stringify(payload)});
 try{
  assert.equal(CHART_ATOMIC_CREATE_RUNTIME_ENABLED,false);
  assert.equal((await send(body,badToken)).status,401);
  const ok=await send(body);
  assert.equal(ok.status,200);
  assert.deepEqual(await ok.json(),{actorId:8,tokenVersion:3,sourceKey:"PRIMARY"});
  for(const field of [
   {actorId:77},{tokenVersion:999},{approved:true},{permissions:["DESIGN_QUERY"]},
   {deviceToken:"anything"},{widgetId:123},{jwt:"fake"},
   {grantId:"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"},
   {issuerSid:"FAKE_SQL_ISSUER"},{secret:"fake-secret"},
   {issuerApproved:true},{delegationConsumed:false},
  ])assert.equal((await send({...body,...field})).status,403);
  assert.equal((await send({...body,profileId:0})).status,403);
  session={...session,permissions:["DESIGN_QUERY"]};
  assert.equal((await send(body)).status,403);
  session={...session,permissions:["EXECUTE_QUERY"]};
  assert.equal((await send(body)).status,403);
  session={...session,permissions:[]};
  assert.equal((await send(body)).status,403);
  // No permission in the verified DB session: a forged authUser cannot grant it.
  assert.equal((await send(body,token,url.replace("/chart-plan","/chart-poisoned"))).status,403);
  session={...session,permissions:["DESIGN_QUERY","EXECUTE_QUERY"],tokenVersion:4};
  assert.equal((await send(body)).status,401);
  session={...session,tokenVersion:3,isActive:false};
  assert.equal((await send(body)).status,401);
 }finally{
  env.JWT_SECRET=old;
  await new Promise<void>(r=>server.close(()=>r()));
 }
});

test("2B-15C fabricated request authUser cannot forge WeakMap JWT proof",()=>{
 const mock={authUser:{id:8,permissions:["DESIGN_QUERY"]}} as
   unknown as Parameters<typeof readVerifiedJwtActor>[0];
 assert.equal(readVerifiedJwtActor(mock),null);
 assert.equal(planVerifiedChartCreateRequest(mock,7,body),null);
});

test("2B-15C final transaction recheck fails closed on revoke, missing DB and RBAC",async()=>{
 const plan={
  dashboardId:7,profileId:22,actorId:8,tokenVersion:3,
  requestId:body.requestId,
  config:{data:config,json:JSON.stringify(config),sha256:"a".repeat(64)},
  sourceKey:"PRIMARY",placement:body.placement,
 } as NonNullable<ReturnType<typeof planVerifiedChartCreateRequest>>;
 const tx={} as Parameters<typeof recheckChartActorInTransaction>[0];
 const mock=(state:unknown)=>async(_id:number,_tx?:unknown)=>state as
   Awaited<ReturnType<typeof import("../auth/auth.repository.js").getTokenSessionState>>;
 assert.equal(await recheckChartActorInTransaction(tx,plan,mock({
  isActive:true,tokenVersion:3,permissions:["DESIGN_QUERY","EXECUTE_QUERY"],
 }) as never),true);
 for(const state of [
  null,undefined,
  {isActive:false,tokenVersion:3,permissions:["DESIGN_QUERY"]},
  {isActive:true,tokenVersion:4,permissions:["DESIGN_QUERY"]},
  {isActive:true,tokenVersion:3,permissions:[]},
  {isActive:true,tokenVersion:3,permissions:["DESIGN_QUERY"]},
  {isActive:true,tokenVersion:3,permissions:["EXECUTE_QUERY"]},
 ])assert.equal(await recheckChartActorInTransaction(tx,plan,mock(state) as never),false);
 assert.equal(await recheckChartActorInTransaction(tx,plan,async()=>{throw Error("DATABASE_FAILURE");}),false);
});


test("2B-15C dormant write preflight demands verified actor AND two independent SQL logins",async()=>{
 const prior=env.JWT_SECRET;
 env.JWT_SECRET="synthetic-chart-two-login-preflight-only";
 let calls=0;
 const zero={
   DbName:"UQP_TEST",ServerName:"CI_SQL",OriginalSid:"AAA",
   EffectiveUser:"app",ProcedureId:1234,Sysadmin:0,DbOwner:0,
   DbDdlAdmin:0,DbSecurityAdmin:0,DbDataWriter:0,DbControl:0,
   SchemaControl:0,SchemaAlter:0,ImpersonateWriter:0,CreateExecute:0,
   CreateAlter:0,PermitInsert:0,SealInsert:0,LedgerInsert:0,ReviewUpdate:0,
 };
 const platformIdentity={...zero};
 const writerIdentity={...zero,OriginalSid:"BBB",EffectiveUser:"chartWriter",CreateExecute:1};
 const fakePool=(getRow:()=>unknown)=>({
   request:()=>({query:async(text:string)=>{
     assert.equal(text,chartWriterIdentitySql);
     calls++;
     return {recordset:[getRow()]};
   }})
 }) as unknown as sql.ConnectionPool;
 const appPool=fakePool(()=>platformIdentity);
 const chartPool=fakePool(()=>writerIdentity);
 const app=express(); app.use(express.json());
 app.use(createAuthenticateJwt(async()=>({
   isActive:true,tokenVersion:3,permissions:["DESIGN_QUERY","EXECUTE_QUERY"],
 })));
 app.post("/preflight",async(req,res)=>{
   const plan=await prepareDormantChartWriteRequest(req,7,req.body,appPool,chartPool);
   res.status(plan?200:403).json(plan?
     {actorId:plan.actorId,tokenVersion:plan.tokenVersion}:{code:"DENIED"});
 });
 const server=createServer(app);
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 const port=(server.address() as {port:number}).port;
 const url="http://127.0.0.1:"+port+"/preflight";
 const token=jwt.sign({sub:"8",tokenVersion:3,permissions:[]},env.JWT_SECRET);
 const send=(payload:unknown,t=token)=>fetch(url,{method:"POST",headers:{
   Authorization:"Bearer "+t,"Content-Type":"application/json",
 },body:JSON.stringify(payload)});
 try{
   assert.equal((await send(body,"not-a-jwt")).status,401);
   assert.equal(calls,0);
   assert.equal((await send({...body,actorId:77})).status,403);
   assert.equal(calls,0);
   assert.equal(CHART_WRITER_DB_ACTOR_BINDING_APPROVED,false);
   // Independently unapproved DB-owned caller/ActorId binding: this
   // remains blocked even if JWT is valid and SQL credentials differ.
   // The approved procedure digest is intentionally UNPINNED; future
   // API preflight cannot succeed just because JWT and mock SQL roles pass.
   const approved=await send(body);
   assert.equal(approved.status,403);
   assert.equal(calls,0);
   writerIdentity.OriginalSid="AAA";
   assert.equal((await send(body)).status,403);
   writerIdentity.OriginalSid="BBB";
   writerIdentity.DbOwner=1;
   assert.equal((await send(body)).status,403);
   writerIdentity.DbOwner=0;
   writerIdentity.CreateExecute=0;
   assert.equal((await send(body)).status,403);
 }finally{
   env.JWT_SECRET=prior;
   await new Promise<void>(resolve=>server.close(()=>resolve()));
 }
});
