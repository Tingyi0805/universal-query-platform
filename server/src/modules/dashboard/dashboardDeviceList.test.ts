import {createDeviceManagementStore} from "./dashboardDeviceManagement.repository.js";
import test from "node:test";
import assert from "node:assert/strict";
import {createDeviceListReader,deviceListQuery,readDeviceList,deviceListSql} from "./dashboardDeviceList.js";
import {deviceManagementFixture} from "./dashboardDeviceManagement.testFixture.js";
const actor={userId:1,tokenVersion:1};
function fixture(){
 const f=deviceManagementFixture();let digest="a".repeat(64),now="2026-11-01T00:00:00.000Z",next:string|null=null,reads=0;
 const read=createDeviceListReader({transaction:work=>createDeviceManagementStore(f.deps).transaction(async tx=>{
  tx.listDevices=async(_id,_q,asOf)=>{reads++;return {digest,nowUtc:now,asOfUtc:asOf??now,nextExpiryUtc:next,total:1,items:[{Id:7,DeviceName:"Safe",CreatedByUserId:1,IsActive:true,LifecycleState:"UNVERIFIED",TokenHash:"private",credentialFingerprint:"private"}]};};return work(tx);
 })},()=>f.control.enabled);
 return {f,read,change:()=>{digest="b".repeat(64);},time:(value:string)=>{now=value;},expiry:(value:string)=>{next=value;},reads:()=>reads};
}
test("strict bounded query accepts only supported inputs",()=>{
 assert.equal(deviceListQuery.parse({}).pageSize,20);
 for(const q of [{page:"0"},{page:"1e3"},{page:"1.5"},{page:"2"},{page:"999999",pageSize:"100",snapshot:"x"},{pageSize:"21"},{pageSize:["20"]},{status:"ENABLED"},{search:"x".repeat(201)},{sort:"DeviceName DESC"}])assert.equal(deviceListQuery.safeParse(q).success,false);
 for(const pageSize of ["10","20","50","100"])assert.equal(deviceListQuery.parse({pageSize}).pageSize,Number(pageSize));
});
test("page continuation is bound to identity, query, content and expiration, not a write version",async()=>{
 const f=fixture();const first=await f.read(1,actor,{});
 assert.equal(first.items[0]!.status,"UNVERIFIED");assert.equal(first.writeVersionIncluded,false);assert.equal(first.sort,"ID_ASC");
 assert.doesNotMatch(JSON.stringify(first),/private|TokenHash|credentialFingerprint|expectedVersion|"version"/);
 assert.equal((await f.read(1,actor,{page:"2",snapshot:first.snapshot})).page,2);
 for(const patch of [{search:"other"},{status:"ACTIVE"},{pageSize:"10"}])await assert.rejects(f.read(1,actor,{page:"2",snapshot:first.snapshot,...patch}),{code:"DASHBOARD_DEVICE_LIST_CHANGED"});
 await assert.rejects(f.read(1,{...actor,userId:2},{page:"2",snapshot:first.snapshot}));
 f.change();await assert.rejects(f.read(1,actor,{page:"2",snapshot:first.snapshot}),{code:"DASHBOARD_DEVICE_LIST_CHANGED"});
});
test("time-only status changes, malformed tokens and timeout require reload",async()=>{
 const f=fixture();f.expiry("2026-11-01T00:00:01.000Z");const a=await f.read(1,actor,{});
 f.time("2026-11-01T00:00:01.000Z");await assert.rejects(f.read(1,actor,{page:"2",snapshot:a.snapshot}),{code:"DASHBOARD_DEVICE_LIST_CHANGED"});
 await assert.rejects(f.read(1,actor,{page:"2",snapshot:"invalid"}),{code:"DASHBOARD_DEVICE_LIST_CHANGED"});
 const g=fixture(),b=await g.read(1,actor,{});g.time("2026-11-01T00:05:00.000Z");await assert.rejects(g.read(1,actor,{page:"2",snapshot:b.snapshot}),{code:"DASHBOARD_DEVICE_LIST_CHANGED"});
});
test("real management RBAC allows DESIGN_QUERY without execution, rejects stale session and absent design",async()=>{
 const f=fixture();f.f.control.permissions=["DESIGN_QUERY"];f.f.control.query=false;await f.read(1,actor,{});
 f.f.control.permissions=["EXECUTE_QUERY"];await assert.rejects(f.read(1,actor,{}),{code:"FORBIDDEN"});
 f.f.control.permissions=["DESIGN_QUERY"];f.f.control.tokenVersion=2;await assert.rejects(f.read(1,actor,{}),{code:"TOKEN_REVOKED"});
});
test("SQL parameters own all user text and SQL executes COUNT/OFFSET with fixed ordering",async()=>{
 const values:Record<string,unknown>={};const attack="%' OR 1=1;--_[\\";
 const request={input(name:string,_type:unknown,value:unknown){values[name]=value;return this;},async query(text:string){assert.equal(text,deviceListSql);assert(!text.includes(attack));assert.match(text,/COUNT_BIG\(\*\)/);assert.match(text,/ORDER BY Id ASC OFFSET @offset ROWS FETCH NEXT @limit/);return {recordsets:[[{Digest:"a".repeat(64),NowUtc:new Date(),AsOfUtc:new Date(),NextExpiryUtc:null,Total:0}],[]]};}};
 await readDeviceList(request as any,1,deviceListQuery.parse({search:attack}),null);
 assert.equal(values.search,attack);assert.equal(values.exactId,null);assert.equal(values.pattern,"%\\%' OR 1=1;--\\_\\[\\\\%");
 await readDeviceList(request as any,1,deviceListQuery.parse({search:"7"}),null);assert.equal(values.exactId,7);
});

test("HTTP list uses JWT/role guards, no-store, strict query and leaves complete snapshot API unchanged",async()=>{
 const [{default:express},{createServer},{default:jwt},{env},{createAuthenticateJwt},{createDeviceManagementRouter}]=await Promise.all([
  import("express"),import("node:http"),import("jsonwebtoken"),import("../../config/env.js"),import("../auth/auth.middleware.js"),import("./dashboardDeviceManagement.routes.js")]);
 const f=fixture(),old=env.JWT_SECRET;env.JWT_SECRET="c1-test-secret";
 const session={id:1,isActive:true,tokenVersion:1,permissions:["DESIGN_QUERY"]};
 f.f.control.permissions=["DESIGN_QUERY"];
 const app=express();app.use(createAuthenticateJwt(async()=>session as any));app.use(createDeviceManagementRouter({...f.f.service,list:f.read}));
 const server=createServer(app);await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 const token=jwt.sign({sub:"1",tokenVersion:1},env.JWT_SECRET,{expiresIn:"1h"});
 const url=`http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/1/device-management/v1`;
 const get=(path:string,auth=true)=>fetch(url+path,{headers:auth?{Authorization:`Bearer ${token}`}:{}});
 try{
  const result=await get("/list");assert.equal(result.status,200);assert.equal(result.headers.get("cache-control"),"no-store");assert.equal((await result.json()).items[0].status,"UNVERIFIED");
  for(const query of ["?page=2","?pageSize=5","?page=1&page=2","?sort=Id;DROP","?search[x]=y"])assert.equal((await get("/list"+query)).status,400);
  assert.equal((await get("/list",false)).status,401);
  const complete=await get("/lifecycle");assert.equal(complete.status,200);const body=await complete.json();assert(body.version);assert(Array.isArray(body.devices));assert.equal(body.items,undefined);
  f.f.control.failAt="lifecycle-schema";
  const failure=await get("/list");assert.equal(failure.status,503);assert.doesNotMatch(await failure.text(),/synthetic-private|SQL|TokenHash/);f.f.control.failAt="";
  f.f.control.enabled=false;assert.equal((await get("/list")).status,404);f.f.control.enabled=true;
  session.permissions=[];assert.equal((await get("/list")).status,403);
  assert.equal(f.f.db().audits.length,0);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));env.JWT_SECRET=old;}
});
