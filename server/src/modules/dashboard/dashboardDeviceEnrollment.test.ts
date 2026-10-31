import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createHash } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { createAuthenticateJwt } from "../auth/auth.middleware.js";
import { deviceManagementFixture } from "./dashboardDeviceManagement.testFixture.js";
import { createDeviceManagementRouter } from "./dashboardDeviceManagement.routes.js";
import { createKioskRouter, kioskCodec } from "./dashboardKiosk.routes.js";
import { deviceLifecycleBlocksPlayback } from "./dashboardDeviceLifecycle.js";
const actor={userId:1,tokenVersion:1},ip={ipAddress:"192.0.2.2"},oldToken="A".repeat(43);
const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
async function pendingFixture() {
 const f=deviceManagementFixture();Object.assign(f.db().parent,{QueryMode:"QUERY_ONLY",QueryModeVersion:4,IsActive:true});
 f.db().devices[0]!.TokenHash=hash(oldToken);
 const a=await f.service.suspend(1,7,actor,{expectedVersion:await f.version(),confirmed:true});
 await f.service.restore(1,7,actor,{expectedVersion:a.version,confirmed:true});
 return f;
}
const issue=async(f:Awaited<ReturnType<typeof pendingFixture>>)=>f.enrollment.issue(1,7,actor,{expectedVersion:await f.version(),confirmed:true});

test("D2-B issue is one-time CSPRNG plaintext, hash-only, full-versioned, pending until proof",async()=>{
 const f=await pendingFixture(),before=f.snapshot(),input={expectedVersion:await f.version(),confirmed:true as const};
 const a=await f.enrollment.issue(1,7,actor,input),d=f.db().devices[0]!;
 assert.match(a.token,/^[A-Za-z0-9_-]{43}$/);assert.equal(d.TokenHash,hash(a.token));assert.notEqual(d.TokenHash,before.devices[0]!.TokenHash);
 assert.equal(d.ReenrollmentRequired,true);assert.equal(d.QueryModeGrantVersion,4);assert.equal(d.DelegatorTokenVersion,1);
 assert(!JSON.stringify(f.snapshot(),(_k,v)=>typeof v==="bigint"?v.toString():v).includes(a.token));assert(!JSON.stringify(f.db().audits).includes(d.TokenHash));
 assert(f.control.policyReads>=2);assert.equal(f.control.events.at(-1),"commit");assert.equal(f.db().audits.at(-1)!.parameters.credentialIssued,true);
 await assert.rejects(f.enrollment.issue(1,7,actor,input),{code:"DASHBOARD_DEVICE_VERSION_CONFLICT"});
 const b=await issue(f);assert.notEqual(a.token,b.token);
 await assert.rejects(f.enrollment.enroll(1,7,a.token,ip));
 await f.enrollment.enroll(1,7,b.token,ip);assert.equal(f.db().devices[0]!.ReenrollmentRequired,false);
 const enrolled=f.snapshot();await assert.rejects(f.enrollment.enroll(1,7,b.token,ip));assert.deepEqual(f.snapshot(),enrolled);
});
for(const operation of ["issue","enroll"] as const)for(const failure of ["lifecycle-schema","policy","credential","touch","audit","audit-evidence","commit"])test(`D2-B ${operation} rolls back ${failure}`,async()=>{
 const f=await pendingFixture(),issued=operation==="enroll"?await issue(f):null,input={expectedVersion:await f.version(),confirmed:true as const};
 const before=f.snapshot();f.control.failAt=failure;
 await assert.rejects(operation==="issue"?f.enrollment.issue(1,7,actor,input):f.enrollment.enroll(1,7,issued!.token,ip));
 assert.deepEqual(f.snapshot(),before);assert.equal(f.control.events.at(-1),"rollback");
});
for(const reason of ["wrong-token","old-token","expired","ip","owner","permission","acl","workstation","policy","mode","mode-version","grant","revoked","archived","suspended","unissued"])test(`D2-B proof rejects ${reason} without mutation`,async()=>{
 const f=await pendingFixture(),issued=await issue(f),d=f.db().devices[0]!;
 if(reason==="expired")d.ExpiresAtUtc="2026-01-01T00:00:00Z";if(reason==="owner")f.control.deniedUser=2;
 if(reason==="permission")f.control.permissions=["DESIGN_QUERY"];if(reason==="acl")f.control.query=false;
 if(reason==="workstation")f.control.workstation=false;if(reason==="policy")f.control.policy=false;
 if(reason==="mode")f.db().parent.QueryMode="QUERY_ONLY_DISABLED";if(reason==="mode-version")f.db().parent.QueryModeVersion++;
 if(reason==="grant")d.DelegatorTokenVersion=999;if(reason==="revoked")d.RevokedAtUtc="2026-01-01T00:00:00Z";
 if(reason==="archived")d.ArchivedAtUtc="2026-01-01T00:00:00Z";if(reason==="suspended")d.SuspendedAtUtc="2026-01-01T00:00:00Z";
 if(reason==="unissued"){d.QueryModeGrantVersion=null;d.DelegatorTokenVersion=null;}
 const before=f.snapshot();await assert.rejects(f.enrollment.enroll(1,7,reason==="wrong-token"?"B".repeat(43):reason==="old-token"?oldToken:issued.token,reason==="ip"?{ipAddress:"192.0.2.3"}:ip));assert.deepEqual(f.snapshot(),before);
});
for(const reason of ["confirmation","version","manager","owner","policy","binding","ip-binding","expired"])test(`D2-B issue rejects ${reason} without plaintext or mutation`,async()=>{
 const f=await pendingFixture(),d=f.db().devices[0]!;
 if(reason==="manager")f.control.permissions=["DESIGN_QUERY"];if(reason==="owner")f.control.deniedUser=2;if(reason==="policy")f.control.policy=false;
 if(reason==="binding")f.db().parent.QuerySourceMaxRows=null;if(reason==="ip-binding")d.AllowedIp="invalid";if(reason==="expired")d.ExpiresAtUtc="2026-01-01T00:00:00Z";
 const version=(await f.service.safetyRead(1,actor)).version;
 const before=f.snapshot();await assert.rejects(f.enrollment.issue(1,7,actor,{expectedVersion:reason==="version"?"0".repeat(64):version,confirmed:(reason!=="confirmation") as true}));assert.deepEqual(f.snapshot(),before);
});
test("D2-B simultaneous proofs commit exactly once",async()=>{
 const f=await pendingFixture(),a=await issue(f),count=f.db().audits.length;
 const results=await Promise.allSettled([f.enrollment.enroll(1,7,a.token,ip),f.enrollment.enroll(1,7,a.token,ip)]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(f.db().audits.length,count+1);assert.equal(f.db().devices[0]!.ReenrollmentRequired,false);
});
for(const revokeFirst of [true,false])test(`D2-B proof/revoke serialization revokeFirst=${revokeFirst} stays terminal`,async()=>{
 const f=await pendingFixture(),a=await issue(f);
 const results=await Promise.allSettled(revokeFirst?[f.revoke(),f.enrollment.enroll(1,7,a.token,ip)]:[f.enrollment.enroll(1,7,a.token,ip),f.revoke()]);
 assert.equal(results[revokeFirst?0:1]!.status,"fulfilled");if(revokeFirst)assert.equal(results[1]!.status,"rejected");
 const d=f.db().devices[0]!;assert(d.RevokedAtUtc);assert.equal(d.IsActive,false);assert.equal(d.ReenrollmentRequired,null);assert.notEqual(d.TokenHash,hash(a.token));
 await assert.rejects(f.enrollment.enroll(1,7,a.token,ip));
});
test("D2-B metadata invalidation reopens pending and invalidates enrolled Token",async()=>{
 const f=await pendingFixture(),a=await issue(f);await f.enrollment.enroll(1,7,a.token,ip);
 await f.service.metadata(1,7,actor,{expectedVersion:await f.version(),confirmed:true,metadata:{deviceName:"Synthetic edited",enforceIpRestriction:true,allowedIp:ip.ipAddress,allowedCidr:null,expiresAtUtc:null}});
 assert.equal(f.db().devices[0]!.ReenrollmentRequired,true);assert.equal(f.db().devices[0]!.QueryModeGrantVersion,null);
 await assert.rejects(f.enrollment.enroll(1,7,a.token,ip));const b=await issue(f);await f.enrollment.enroll(1,7,b.token,ip);
});

async function httpFixture(t:TestContext,f:ReturnType<typeof deviceManagementFixture>) {
 const config={origin:"https://kiosk.test",key:"a1".repeat(32),enabled:true,trustedProxies:["127.0.0.1","::1"]};
 const app=express();app.use(express.json());let inspected=0,delivered=0;
 app.use("/api/dashboards",createKioskRouter(()=>config,{
  enroll:f.enrollment.enroll,mode:async()=>({mode:f.db().parent.QueryMode,version:f.db().parent.QueryModeVersion}),
  check:async(id,token)=>{
   const d=f.db().devices[0]!;
   if(id!==1||d.TokenHash!==hash(token))return {status:"INVALID_TOKEN"};
   if(!d.IsActive||d.RevokedAtUtc||d.ArchivedAtUtc||deviceLifecycleBlocksPlayback(d))return {status:"DISABLED"};
   return {status:"VALID",device:{id:7,dashboardId:1,createdByUserId:2,isActive:true,expiresAtUtc:d.ExpiresAtUtc,queryModeGrantVersion:d.QueryModeGrantVersion,delegatorTokenVersion:d.DelegatorTokenVersion,authorizationRevision:1}} as any;
  },inspect:async()=>{inspected++;}
 }));
 app.get("/api/dashboards/device/1/layout",(_req,res)=>{delivered++;res.json({synthetic:true});});
 app.post("/api/dashboards/device/1/page",(_req,res)=>{delivered++;res.json({synthetic:true});});
 const oldTrust=env.TRUST_PROXY_ENABLED,oldAddresses=env.TRUSTED_PROXY_ADDRESSES;env.TRUST_PROXY_ENABLED=true;env.TRUSTED_PROXY_ADDRESSES=config.trustedProxies;t.after(()=>{env.TRUST_PROXY_ENABLED=oldTrust;env.TRUSTED_PROXY_ADDRESSES=oldAddresses;});
 const oldSecret=env.JWT_SECRET;env.JWT_SECRET="synthetic-d2b-only-secret";t.after(()=>{env.JWT_SECRET=oldSecret;});
 app.use("/manage",createAuthenticateJwt(async()=>({id:1,isActive:true,tokenVersion:1,permissions:["DESIGN_QUERY","EXECUTE_QUERY"]}) as any),createDeviceManagementRouter(f.service,f.enrollment));
 const credential=jwt.sign({sub:"1",tokenVersion:1},env.JWT_SECRET);
 const server=createServer(app);server.listen(0,"127.0.0.1");await once(server,"listening");t.after(()=>{server.closeAllConnections();server.close();});
 const request=(path:string,body?:unknown,headers:Record<string,string>={},method="POST")=>new Promise<Response>((resolve,reject)=>{
  const req=httpRequest(`http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}${path}`,{method,headers:{host:"kiosk.test",origin:config.origin,"x-uqp-kiosk":"1","x-forwarded-proto":"https","x-forwarded-for":ip.ipAddress,"content-type":"application/json","sec-fetch-site":"same-origin",...headers}},res=>{
   const chunks:Buffer[]=[];res.on("data",v=>chunks.push(v));res.on("end",()=>{const h=new Headers();for(let i=0;i<res.rawHeaders.length;i+=2)h.append(res.rawHeaders[i]!,res.rawHeaders[i+1]!);resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:h}));});
  });req.on("error",reject);req.end(body===undefined?undefined:JSON.stringify(body));
 });
 return {request,credential,config,counts:()=>({inspected,delivered})};
}
const jar=(r:Response)=>r.headers.getSetCookie().map(s=>s.split(";")[0]).join("; ");
const proofPath="/api/dashboards/device/1/kiosk/enrollment-proof";
test("D2-B actual HTTP issue/proof uses commit before existing cookies, no data; old Cookie/BAT Token never revives",async t=>{
 const f=await pendingFixture(),h=await httpFixture(t,f),version=await f.version();
 const issued=await h.request("/manage/1/device-management/v1/7/credential",{expectedVersion:version,confirmed:true},{authorization:`Bearer ${h.credential}`});
 assert.equal(issued.status,200);assert.equal(issued.headers.get("cache-control"),"no-store");const a=await issued.json();assert.match(a.token,/^[A-Za-z0-9_-]{43}$/);
 assert.equal((await h.request("/api/dashboards/device/1/kiosk/enrollment",{deviceId:7,token:a.token})).status,401);
 const oldJar=["enrollment","session"].map(kind=>`__Host-uqp-${kind}-7=${kioskCodec(h.config.origin,h.config.key).seal({dashboardId:1,deviceId:7,token:oldToken,version:4,expires:Date.now()+100000,kind:kind as "enrollment"|"session"})}`).join("; ");
 const proven=await h.request(proofPath,{deviceId:7,token:a.token});assert.equal(proven.status,200);assert.equal(f.control.events.at(-1),"commit");
 assert.deepEqual(Object.keys(await proven.json()).sort(),["authorizationExpiresAt","dashboardId","deviceId"]);assert.deepEqual(h.counts(),{inspected:0,delivered:0});
 assert.equal(proven.headers.getSetCookie().length,2);assert(proven.headers.getSetCookie().every(s=>s.includes("HttpOnly")&&s.includes("Secure")&&s.includes("SameSite=Strict")));
 for(const [path,method,body] of [["layout","GET",undefined],["page","POST",{page:1}],["kiosk/session","POST",{deviceId:7}]] as const)
  assert.equal((await h.request(`/api/dashboards/device/1/${path}`,body,{cookie:oldJar,"x-uqp-device-id":"7"},method)).status,401);
 assert.equal((await h.request("/api/dashboards/device/1/layout",undefined,{"x-uqp-kiosk":"","x-uqp-expected-device-id":"7","x-dashboard-device-token":oldToken},"GET")).status,401);
 assert.equal((await h.request("/api/dashboards/device/1/layout",undefined,{cookie:jar(proven),"x-uqp-device-id":"7"},"GET")).status,200);
});
for(const failure of ["audit","audit-evidence","commit"])test(`D2-B HTTP proof ${failure} never sets positive authorization Cookie`,async t=>{
 const f=await pendingFixture(),a=await issue(f),h=await httpFixture(t,f),before=f.snapshot();f.control.failAt=failure;
 const r=await h.request(proofPath,{deviceId:7,token:a.token});assert.equal(r.status,401);assert.deepEqual(f.snapshot(),before);
 assert(r.headers.getSetCookie().every(c=>! /Max-Age=[1-9]/.test(c)));assert.deepEqual(h.counts(),{inspected:0,delivered:0});
});
test("D2-B proof enforces HTTPS/CSRF/strict input and leaves ordinary NULL-marker enrollment compatible",async t=>{
 const f=await pendingFixture(),a=await issue(f),h=await httpFixture(t,f),before=f.snapshot();
 for(const headers of ([{origin:"https://evil.test"},{"x-forwarded-proto":"http"},{"x-uqp-kiosk":""},{"sec-fetch-site":"cross-site"}] as Record<string,string>[]))assert.equal((await h.request(proofPath,{deviceId:7,token:a.token},headers)).status,401);
 assert.equal((await h.request(proofPath,{deviceId:7,token:a.token,reenrollmentRequired:false})).status,401);assert.deepEqual(f.snapshot(),before);
 Object.assign(f.db().devices[0]!,{ReenrollmentRequired:null,TokenHash:hash(oldToken)});
 await assert.rejects(f.enrollment.enroll(1,7,oldToken,ip));
 const r=await h.request("/api/dashboards/device/1/kiosk/enrollment",{deviceId:7,token:oldToken});assert.equal(r.status,200);
});

for(const action of ["issue","enroll"] as const)test(`D2-B ${action} rechecks public policy after write and rolls back a changed policy`,async()=>{
 const f=await pendingFixture(),a=action==="enroll"?await issue(f):null,version=await f.version(),before=f.snapshot();
 f.control.policyFailAtRead=f.control.policyReads+2;
 await assert.rejects(action==="issue"?f.enrollment.issue(1,7,actor,{expectedVersion:version,confirmed:true}):f.enrollment.enroll(1,7,a!.token,ip),/POLICY_CHANGED/);
 assert.deepEqual(f.snapshot(),before);
});
test("D2-B proof refuses unavailable patient Audit configuration without reading patient data",async()=>{
 const f=await pendingFixture(),a=await issue(f),before=f.snapshot();f.control.patientAudit=true;
 await assert.rejects(f.enrollment.enroll(1,7,a.token,ip),{code:"PATIENT_AUDIT_NOT_CONFIGURED"});assert.deepEqual(f.snapshot(),before);
});
for(const policy of [{status:"UNCONFIRMED",sensitivityVersion:1,policy:null},
 {status:"CONFIRMED",sensitivityVersion:2,policy:{confirmed:true,sensitivityVersion:1,grants:[{columnName:"DISPLAY",permitted:true}]}},
 {status:"CONFIRMED",sensitivityVersion:1,policy:{confirmed:true,sensitivityVersion:1,grants:[{columnName:"DISPLAY",permitted:false}]}}])test(`D2-B proof fails closed for policy ${JSON.stringify(policy)}`,async()=>{
 const f=await pendingFixture(),a=await issue(f),before=f.snapshot();f.deps.publicDisplay=async()=>policy as any;
 await assert.rejects(f.enrollment.enroll(1,7,a.token,ip),{code:"QUERY_SOURCE_PUBLIC_POLICY_REQUIRED"});assert.deepEqual(f.snapshot(),before);
});
test("D2-B management HTTP requires verified JWT, explicit confirmation and full current version",async t=>{
 const f=await pendingFixture(),h=await httpFixture(t,f),version=await f.version(),path="/manage/1/device-management/v1/7/credential",auth={authorization:`Bearer ${h.credential}`};
 assert.equal((await h.request(path,{expectedVersion:version,confirmed:true})).status,401);
 for(const body of [{expectedVersion:version},{confirmed:true},{expectedVersion:version,confirmed:true,token:"forbidden"}])assert.equal((await h.request(path,body,auth)).status,400);
 assert.equal((await h.request(path,{expectedVersion:"0".repeat(64),confirmed:true},auth)).status,409);
 assert.equal(f.db().devices[0]!.QueryModeGrantVersion,null);
});
