import { request as httpRequest } from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { kioskFixture } from "./dashboardKiosk.testFixture.js";
import { kioskCodec,kioskOrigin } from "./dashboardKiosk.routes.js";
import { kioskLauncher,kioskPlaybackLink } from "./dashboardKioskLauncher.js";
async function setup(t: import("node:test").TestContext) {
 const f=kioskFixture();f.server.listen(0,"127.0.0.1");await once(f.server,"listening");t.after(()=>{f.server.closeAllConnections();f.server.close();});const address=f.server.address() as import("node:net").AddressInfo;
 const request=(path:string,body:unknown={deviceId:7},headers:Record<string,string>={},method="POST")=>new Promise<Response>((resolve,reject)=>{
  const req=httpRequest(`http://127.0.0.1:${address.port}/api/dashboards/device/1/${path}`,{method,headers:{host:"kiosk.test",origin:"https://kiosk.test","content-type":"application/json","x-uqp-kiosk":"1","x-forwarded-proto":"https","sec-fetch-site":"same-origin",...headers}},res=>{
   const parts:Buffer[]=[];res.on("data",data=>parts.push(data));res.on("end",()=>{const h=new Headers();for(let i=0;i<res.rawHeaders.length;i+=2)h.append(res.rawHeaders[i]!,res.rawHeaders[i+1]!);resolve(new Response(Buffer.concat(parts),{status:res.statusCode,headers:h}));});
  });req.on("error",reject);req.end(method==="POST"?JSON.stringify(body):undefined);
 });
 return{...f,request,enroll:()=>request("kiosk/enrollment",{deviceId:7,token:f.state.token})};
}
const cookies=(res:Response)=>res.headers.getSetCookie().map(s=>s.split(";")[0]).join("; ");
const grant={dashboardId:1,deviceId:7,token:"A".repeat(43),version:4,expires:Date.now()+100000,kind:"enrollment" as const};
test("encrypted enrollment is origin, purpose, expiry, dashboard, device and key bound",()=>{
 const a=kioskCodec("https://kiosk.test","a1".repeat(32)),value=a.seal(grant);assert(!value.includes(grant.token));assert.deepEqual(a.open(value,"enrollment",1,7),grant);
 for(const args of [["session",1,7],["enrollment",2,7],["enrollment",1,8]] as const)assert.throws(()=>a.open(value,args[0],args[1],args[2]));
 assert.throws(()=>a.open(value.slice(0,30)+"AA"+value.slice(32),"enrollment",1,7));for(const b of [kioskCodec("https://other.test","a1".repeat(32)),kioskCodec("https://kiosk.test","b1".repeat(32))])assert.throws(()=>b.open(value,"enrollment",1,7));assert.throws(()=>a.open(a.seal({...grant,expires:Date.now()-1}),"enrollment",1,7));
});
test("restart restoration uses enrollment; only short sessions reach audited delivery",async t=>{
 const f=await setup(t),r=await f.enroll();assert.equal(r.status,200);
 for(const c of r.headers.getSetCookie()){for(const re of [/^__Host-uqp-/,/HttpOnly/,/Secure/,/SameSite=Strict/,/Path=\//])assert.match(c,re);assert(!c.includes("Domain="));assert(!c.includes(f.state.token));}
 const body=await r.json();assert(body.authorizationExpiresAt<=Date.now()+300000);assert(!JSON.stringify(body).includes(f.state.token));const enrollment=cookies(r).split("; ")[0]!;
 const restored=await f.request("kiosk/session",{deviceId:7},{cookie:enrollment});assert.equal(restored.status,200);
 assert.equal((await f.request("page",{page:1},{cookie:enrollment,"x-uqp-device-id":"7"})).status,401);
 const page=await f.request("page",{page:1},{cookie:cookies(restored),"x-uqp-device-id":"7"});assert.equal(page.status,200);assert.equal(f.state.delivered,1);assert(f.state.inspected>=3);
 assert.equal((await f.request("layout",undefined,{cookie:cookies(restored),"x-uqp-device-id":"7",origin:""},"GET")).status,200);
});
for(const change of ["revoked","expired","ipDenied","delegationDenied","policyDenied"] as const)test(`${change} rejects restoration and session, deletes cookies, no rows`,async t=>{
 const f=await setup(t),jar=cookies(await f.enroll());f.state[change]=true;
 for(const path of ["kiosk/session","page"]){const failed=await f.request(path,path==="page"?{page:1}:{deviceId:7},{cookie:jar,"x-uqp-device-id":"7"});assert.equal(failed.status,401);assert.equal(failed.headers.getSetCookie().length,2);assert(!JSON.stringify(await failed.json()).includes("PRIVATE"));}assert.equal(f.state.delivered,0);
});
for(const change of [{mode:"LEGACY"},{mode:"QUERY_ONLY_DISABLED"},{version:5},{token:"B".repeat(43)}])test(`mode/revision/reissue rejects ${JSON.stringify(change)}`,async t=>{const f=await setup(t),jar=cookies(await f.enroll());Object.assign(f.state,change);assert.equal((await f.request("kiosk/session",{deviceId:7},{cookie:jar})).status,401);assert.equal(f.state.delivered,0);});
for(const headers of ([{origin:"https://evil.test"},{origin:""},{"sec-fetch-site":"cross-site"},{"x-uqp-kiosk":""},{"x-forwarded-proto":"http"},{host:"evil.test"},{"content-type":"text/plain"}] as Record<string,string>[]))test(`CSRF/TLS/host rejects ${JSON.stringify(headers)}`,async t=>{const f=await setup(t),r=await f.request("kiosk/enrollment",{deviceId:7,token:f.state.token},headers);assert.equal(r.status,401);assert.equal(r.headers.getSetCookie().length,0);assert.equal(f.state.inspected,0);});
test("untrusted proxy cannot claim TLS or override IP",async t=>{const f=await setup(t);f.config.trustedProxies=[];assert.equal((await f.enroll()).status,401);f.config.trustedProxies=["127.0.0.1"];assert.equal((await f.request("kiosk/enrollment",{deviceId:7,token:f.state.token},{"x-forwarded-for":"203.0.113.6"})).status,200);assert.equal(f.state.seenIp,"127.0.0.1");});
test("wrong device, duplicate cookie, mixed token and expired session fail closed",async t=>{
 const f=await setup(t),jar=cookies(await f.enroll());assert.equal((await f.request("kiosk/session",{deviceId:8},{cookie:jar})).status,401);assert.equal((await f.request("kiosk/session",{deviceId:7},{cookie:jar+"; "+jar})).status,401);assert.equal((await f.request("page",{page:1},{cookie:jar,"x-uqp-device-id":"7","x-dashboard-device-token":f.state.token})).status,401);
 const value=kioskCodec(f.config.origin,f.config.key).seal({...grant,kind:"session",expires:Date.now()-1});assert.equal((await f.request("page",{page:1},{cookie:`__Host-uqp-session-7=${value}`,"x-uqp-device-id":"7"})).status,401);assert.equal((await f.request("kiosk/enrollment",{deviceId:8,token:f.state.token})).status,401);assert.equal(f.state.delivered,0);
});
test("explicit forget removes cookies without reissue or revocation",async t=>{const f=await setup(t),r=await f.request("kiosk/forget",{deviceId:7},{cookie:cookies(await f.enroll())});assert.equal(r.status,200);assert.equal(r.headers.getSetCookie().length,2);assert(!f.state.revoked);});
test("device expiry caps persistent and short cookie lifetime",async t=>{const f=await setup(t);f.state.expires=Date.now()+10000;const r=await f.enroll();assert.equal(r.status,200);assert((await r.json()).authorizationExpiresAt<=f.state.expires);const value=cookies(r).split("; ")[0]!.split("=")[1]!;assert.equal(kioskCodec(f.config.origin,f.config.key).open(value,"enrollment",1,7).expires,f.state.expires);});
for(const origin of [undefined,"http://hospital.test","https://hospital.test/","https://user:pass@hospital.test","https://hospital.test/path","https://hospital.test?token=x"])test(`URL refuses ${origin}`,()=>assert.throws(()=>kioskOrigin(origin)));
for(const browser of ["edge","chrome"] as const)for(const fullscreen of [true,false])test(`launcher ${browser} fullscreen=${fullscreen}`,()=>{
 const url=kioskPlaybackLink("https://hospital.test:8443",1,7);assert.equal(url,"https://hospital.test:8443/display/dashboards/1?deviceId=7");const{bat,script}=kioskLauncher(url,{browser,screenNumber:3,fullscreen,windowX:-2000,windowY:100,windowWidth:1400,windowHeight:800});assert.equal(Buffer.from(bat.match(/-EncodedCommand (\S+)/)![1]!,"base64").toString("utf16le"),script);
 for(const part of ["$screen=$screens[2]","$x=-2000;$y=100","--window-size=1400,800","--user-data-dir=",browser==="edge"?"msedge.exe":"chrome.exe"])assert(script.includes(part));assert.equal(script.includes("--start-fullscreen"),fullscreen);assert(!/token|password|inprivate|incognito|--kiosk/i.test(script));assert(!bat.includes(grant.token));
});
test("server restart with stable key restores; rotation/missing key/flag-off do not fallback",async t=>{
 const first=await setup(t),jar=cookies(await first.enroll());const next=await setup(t);assert.equal((await next.request("kiosk/session",{deviceId:7},{cookie:jar})).status,200);
 for(const value of ["b1".repeat(32),""]){next.config.key=value;assert.equal((await next.request("kiosk/session",{deviceId:7},{cookie:jar})).status,401);}next.config.key=first.config.key;next.config.enabled=false;assert.equal((await next.request("kiosk/session",{deviceId:7},{cookie:jar})).status,401);
});
test("authenticated revocation purges only the affected device snapshots; unauthenticated requests cannot evict",async t=>{
 const {createDashboardPageSnapshot,getDashboardPageSnapshot}=await import("./dashboardPageSnapshot.js");const f=await setup(t),jar=cookies(await f.enroll());
 const make=(deviceId:number)=>createDashboardPageSnapshot({deviceId,dashboardId:1,queryId:1,datasetId:1,sourceScope:"synthetic",columns:[{name:"VALUE"}],rows:[{VALUE:"synthetic"}]});const own=make(7),other=make(8);
 await f.request("kiosk/session",{deviceId:7});assert(getDashboardPageSnapshot(own.id,7,1));f.state.revoked=true;await f.request("kiosk/session",{deviceId:7},{cookie:jar});assert.equal(getDashboardPageSnapshot(own.id,7,1),null);assert(getDashboardPageSnapshot(other.id,8,1));
});
test("playback link API preserves designer guard and service authorization; uses configured origin, no secrets",async t=>{
 const express=(await import("express")).default,{createServer}=await import("node:http"),jwt=(await import("jsonwebtoken")).default;
 const{createDeviceManagementRouter}=await import("./dashboardDeviceManagement.routes.js"),{env}=await import("../../config/env.js");const old=env.DASHBOARD_PUBLIC_CLIENT_ORIGIN;t.after(()=>{env.DASHBOARD_PUBLIC_CLIENT_ORIGIN=old;});env.DASHBOARD_PUBLIC_CLIENT_ORIGIN="https://hospital.example:8443";
 let reads=0,deny=false;const service={read:async()=>{reads++;if(deny)throw new Error("PRIVATE_SQL_TOKEN");return{devices:[{id:7,isActive:true,revokedAtUtc:null,archivedAtUtc:null,placement:{browser:"edge",screenNumber:1,fullscreen:true,windowX:0,windowY:0,windowWidth:1920,windowHeight:1080}}]};}} as unknown as Parameters<typeof createDeviceManagementRouter>[0];
 const app=express();app.use((req,_res,next)=>{if(req.header("x-test-role"))req.authUser={id:1,username:"synthetic",displayName:"Synthetic",permissions:req.header("x-test-role")==="designer"?["DESIGN_QUERY"]:[]} as NonNullable<typeof req.authUser>;next();});app.use(createDeviceManagementRouter(service));const server=createServer(app);server.listen(0,"127.0.0.1");await once(server,"listening");t.after(()=>{server.closeAllConnections();server.close();});const port=(server.address() as import("node:net").AddressInfo).port;
 const call=(role?:string,id=7)=>fetch(`http://127.0.0.1:${port}/1/device-management/v1/${id}/playback-link`,{headers:{authorization:`Bearer ${jwt.sign({sub:"1",tokenVersion:3},"synthetic")}`,...(role?{"x-test-role":role}:{})}});
 assert.equal((await call()).status,403);assert.equal((await call("viewer")).status,403);assert.equal(reads,0);
 const r=await call("designer");assert.equal(r.status,200);const body=await r.json();assert.equal(body.url,"https://hospital.example:8443/display/dashboards/1?deviceId=7");assert(body.bat.startsWith("@echo off"));assert.equal(r.headers.get("cache-control"),"no-store");assert(!JSON.stringify(body).includes(grant.token));
 assert.equal((await call("designer",8)).status,409);deny=true;const failed=await call("designer");assert.equal(failed.status,409);assert(!JSON.stringify(await failed.json()).includes("PRIVATE"));deny=false;env.DASHBOARD_PUBLIC_CLIENT_ORIGIN="http://hospital.example";assert.equal((await call("designer")).status,409);
});
