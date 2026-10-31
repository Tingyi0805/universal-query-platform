import {QuerySourceError} from "../dashboard/dashboardQuerySources.service.js";
import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {deviceAuditEvents,deviceHistoryQuery,taipeiAuditDay,deviceHistorySql,readDeviceAuditHistory} from "./deviceAuditHistory.js";
import {deviceManagementFixture} from "../dashboard/dashboardDeviceManagement.testFixture.js";
import {createDeviceManagementStore} from "../dashboard/dashboardDeviceManagement.repository.js";
import {createDeviceManagementService} from "../dashboard/dashboardDeviceManagement.service.js";

test("strict history query rejects bad dates, event types, offsets and duplicate parameters",()=>{
 assert.equal(deviceHistoryQuery.parse({}).pageSize,20);
 for(const pageSize of ["10","20","50","100"])assert.equal(deviceHistoryQuery.parse({pageSize}).pageSize,Number(pageSize));
 for(const input of [{source:"ALL"},{eventType:"LOGIN_FAILED"},{eventType:"DASHBOARD_DEVICE_UNKNOWN"},{startDate:"2027-02-29"},{endDate:"9999-12-31"},{startDate:"2028-03-02",endDate:"2028-03-01"},{page:"0"},{page:"1e2"},{page:"999999",pageSize:"100"},{pageSize:"200"},{page:["1","2"]},{dashboardId:"2"},{sort:"Id DESC;DROP"}])assert.equal(deviceHistoryQuery.safeParse(input).success,false);
 assert.equal(taipeiAuditDay("1979-07-01").toISOString(),"1979-06-30T16:00:00.000Z");
 assert.equal(taipeiAuditDay("1979-07-01",true).toISOString(),"1979-07-01T15:00:00.000Z");
 assert.equal(taipeiAuditDay("2028-02-29").toISOString(),"2028-02-28T16:00:00.000Z");
 assert.equal(taipeiAuditDay("2028-02-29",true).toISOString(),"2028-02-29T16:00:00.000Z");
});
test("inventory: lifecycle writes use common root IDs and archive copies the same ParametersJson",async()=>{
 const repo=await readFile(new URL("../dashboard/dashboardDeviceManagement.repository.ts",import.meta.url),"utf8");
 assert.match(repo,/parameters: \{ dashboardId: id, deviceId,/);assert.match(repo,/eventType: `DASHBOARD_DEVICE_\$\{action\}`/);
 const service=await readFile(new URL("../dashboard/dashboardDeviceManagement.service.ts",import.meta.url),"utf8"),enroll=await readFile(new URL("../dashboard/dashboardDeviceEnrollment.service.ts",import.meta.url),"utf8");
 for(const event of deviceAuditEvents)assert((service+enroll).includes(event.replace("DASHBOARD_DEVICE_","")));
 const audit=await readFile(new URL("./audit.repository.ts",import.meta.url),"utf8");assert.match(audit,/a\.Status, a\.ParametersJson, a\.ResultRowCount/);
 const schema=await readFile(new URL("../../../../database/migrations/016_audit_retention.sql",import.meta.url),"utf8");assert.match(schema,/ParametersJson\s+NVARCHAR\(MAX\)/);
});
test("LIVE and ARCHIVE use identical strict double-ID scope and parameterized filters with safe projection",async()=>{
 for(const source of ["LIVE","ARCHIVE"] as const){
  const inputs:Record<string,unknown>={};const req={input(name:string,_type:unknown,value:unknown){inputs[name]=value;return this;},async query(text:string){
   assert.equal(text,deviceHistorySql(source));assert.match(text,/scope.DashboardKeys=1 AND scope.DeviceKeys=1/);assert.match(text,/j.type=2/);assert.match(text,/CASE WHEN ISJSON/);assert.match(text,/DashboardId=@dashboardId AND Id=@deviceId/);assert.match(text,/ORDER BY h\.CreatedAtUtc DESC,h\.Id DESC OFFSET @offset/);assert(!text.includes("' OR 1=1;--"));
   return {recordsets:[[{Total:1}],[{Id:"9007199254740993",CreatedAtUtc:new Date("2028-02-29T00:00:00Z"),EventType:"DASHBOARD_DEVICE_SUSPENDED",Status:"FAILED",Username:"admin",DisplayName:"管理者",ErrorCode:"SECRET_TOKEN_VALUE",ParametersJson:"SECRET",TokenHash:"SECRET",IpAddress:"PRIVATE"}]]};}};
  const result=await readDeviceAuditHistory(req as any,1,7,deviceHistoryQuery.parse({source,username:"%' OR 1=1;--",startDate:"2028-02-29",endDate:"2028-02-29"}));
  assert.equal(inputs.dashboardId,1);assert.equal(inputs.deviceId,7);assert.equal((inputs.startUtc as Date).toISOString(),"2028-02-28T16:00:00.000Z");assert.equal((inputs.endUtc as Date).toISOString(),"2028-02-29T16:00:00.000Z");
  assert.equal(inputs.username,"%' OR 1=1;--");assert.equal(result.items[0]!.id,"9007199254740993");assert.equal(result.items[0]!.errorCode,null);assert.doesNotMatch(JSON.stringify(result),/SECRET|ParametersJson|TokenHash|IpAddress/);
 }
});
test("live session requires DESIGN_QUERY and VIEW_AUDIT before any history query; no write privilege",async()=>{
 const f=deviceManagementFixture();let queried=0;
 const deps={...f.deps,createRequest:(tx:import("mssql").Transaction)=>{
  const req=f.deps.createRequest(tx),query=req.query.bind(req);
  req.query=(async(text:string)=>{if(text.includes("INTO #DeviceHistory")){queried++;return {recordsets:[[{Total:0}],[]]};}return query(text);}) as typeof req.query;return req;
 }};
 const service=createDeviceManagementService(createDeviceManagementStore(deps),()=>true),actor={userId:1,tokenVersion:1};
 f.control.permissions=["DESIGN_QUERY"];await assert.rejects(service.history(1,7,actor,{}),{code:"FORBIDDEN"});assert.equal(queried,0);
 f.control.permissions=["VIEW_AUDIT"];await assert.rejects(service.history(1,7,actor,{}),{code:"FORBIDDEN"});
 f.control.permissions=["DESIGN_QUERY","VIEW_AUDIT"];f.control.query=false;const result=await service.history(1,7,actor,{});assert.equal(result.total,0);assert.equal(queried,1);
 f.control.tokenVersion=2;await assert.rejects(service.history(1,7,actor,{}),{code:"TOKEN_REVOKED"});assert.equal(queried,1);assert.equal(f.db().audits.length,0);
});

test("HTTP history guards both sources with verified JWT and VIEW_AUDIT; original APIs remain intact",async()=>{
 const [{default:express},{createServer},{default:jwt},{env},{createAuthenticateJwt},{createDeviceManagementRouter}]=await Promise.all([import("express"),import("node:http"),import("jsonwebtoken"),import("../../config/env.js"),import("../auth/auth.middleware.js"),import("../dashboard/dashboardDeviceManagement.routes.js")]);
 const f=deviceManagementFixture(),original=env.JWT_SECRET;env.JWT_SECRET="D4D-http-test";
 const session={id:1,isActive:true,tokenVersion:1,permissions:["DESIGN_QUERY"]};let calls=0;
 const app=express();app.use(createAuthenticateJwt(async()=>session as any));app.use(createDeviceManagementRouter({...f.service,history:async(id,deviceId,_actor,input)=>{calls++;const q=deviceHistoryQuery.safeParse(input);if(!q.success)throw new QuerySourceError("VALIDATION_ERROR",400);return {dashboardId:id,deviceId,source:q.data.source,items:[],total:0,page:q.data.page,pageSize:q.data.pageSize};}}));
 const server=createServer(app);await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const token=jwt.sign({sub:"1",tokenVersion:1},env.JWT_SECRET,{expiresIn:"1h"}),url=`http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/1/device-management/v1/7/history`;
 try{
  for(const source of ["LIVE","ARCHIVE"]){const denied=await fetch(url+`?source=${source}`,{headers:{Authorization:`Bearer ${token}`}});assert.equal(denied.status,403);}assert.equal(calls,0);
  session.permissions.push("VIEW_AUDIT");for(const source of ["LIVE","ARCHIVE"]){const good=await fetch(url+`?source=${source}`,{headers:{Authorization:`Bearer ${token}`}});assert.equal(good.status,200);assert.equal(good.headers.get("cache-control"),"no-store");assert.equal((await good.json()).source,source);}
  assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url+"?eventType=LOGIN_FAILED",{headers:{Authorization:`Bearer ${token}`}})).status,400);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));env.JWT_SECRET=original;}
});
