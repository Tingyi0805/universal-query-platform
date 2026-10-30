import { request as httpRequest } from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { QuerySourceError } from "./dashboardQuerySources.service.js";
import { env } from "../../config/env.js";
import { kioskFixture } from "./dashboardKiosk.testFixture.js";
import { kioskCodec,kioskOrigin } from "./dashboardKiosk.routes.js";
import { kioskLauncher,kioskPlaybackLink,manualPlaybackLink } from "./dashboardKioskLauncher.js";
async function setup(t: import("node:test").TestContext) {
 const f=kioskFixture();f.server.listen(0,"127.0.0.1");await once(f.server,"listening");t.after(()=>{f.server.closeAllConnections();f.server.close();});const address=f.server.address() as import("node:net").AddressInfo;
 const request=(path:string,body:unknown={deviceId:7},headers:Record<string,string>={},method="POST")=>new Promise<Response>((resolve,reject)=>{
  const req=httpRequest(`http://127.0.0.1:${address.port}/api/dashboards/device/1/${path}`,{method,headers:{host:"kiosk.test",origin:"https://kiosk.test","content-type":"application/json","x-uqp-kiosk":"1","x-forwarded-proto":"https","x-forwarded-for":"127.0.0.1","sec-fetch-site":"same-origin",...headers}},res=>{
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
test("ARR trust/IP ACL/patient Audit agree; forwarded Host is pinned to the public origin",async t=>{
 const old={enabled:env.TRUST_PROXY_ENABLED,addresses:env.TRUSTED_PROXY_ADDRESSES};t.after(()=>{env.TRUST_PROXY_ENABLED=old.enabled;env.TRUSTED_PROXY_ADDRESSES=old.addresses;});
 env.TRUST_PROXY_ENABLED=true;env.TRUSTED_PROXY_ADDRESSES=["127.0.0.1","::1"];
 const f=await setup(t);f.state.requiredIp="2001:db8::7";
 const forwarded={"x-forwarded-for":"192.0.2.99, [2001:0DB8::7]:60000","x-forwarded-host":"kiosk.test",host:"127.0.0.1:3200"};
 const enrolled=await f.request("kiosk/enrollment",{deviceId:7,token:f.state.token},forwarded);assert.equal(enrolled.status,200);assert.equal(f.state.seenIp,"2001:db8::7");
 const page=await f.request("page",{page:1},{...forwarded,cookie:cookies(enrolled),"x-uqp-device-id":"7"});assert.equal(page.status,200);assert.equal(f.state.patientAuditIp,"2001:db8::7");
 const delivered=f.state.delivered;
 const fakeHost=await f.request("kiosk/session",{deviceId:7},{...forwarded,"x-forwarded-host":"evil.test",cookie:cookies(enrolled)});assert.equal(fakeHost.status,401);
 const wrongIp=await f.request("page",{page:1},{...forwarded,"x-forwarded-for":"2001:db8::7, 203.0.113.5:50000",cookie:cookies(enrolled),"x-uqp-device-id":"7"});assert.equal(wrongIp.status,401);assert.equal(f.state.delivered,delivered);
});
test("365-day enrollment ceiling is fixed; device renewal and session restore cannot extend it",async t=>{
 const f=await setup(t),start=Date.now();f.state.expires=null;const result=await f.enroll();assert.equal(result.status,200);
 const jar=cookies(result),enrollment=jar.split("; ")[0]!.split("=")[1]!,grant=kioskCodec(f.config.origin,f.config.key).open(enrollment,"enrollment",1,7);
 assert(grant.expires>=start+365*86400000&&grant.expires<=Date.now()+365*86400000);
 const restored=await f.request("kiosk/session",{deviceId:7},{cookie:jar});assert.equal(restored.status,200);assert.equal(restored.headers.getSetCookie().length,1);assert.match(restored.headers.getSetCookie()[0]!,/^__Host-uqp-session-/);
 f.state.expires=Date.now()+10000;const short=await f.enroll(),shortJar=cookies(short),originalExpiry=f.state.expires;f.state.expires=Date.now()+365*86400000;
 const renewed=await f.request("kiosk/session",{deviceId:7},{cookie:shortJar});assert.equal(renewed.status,200);assert((await renewed.json()).authorizationExpiresAt<=originalExpiry);assert.equal(renewed.headers.getSetCookie().length,1);
});
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
 let reads=0,deny=false,knownDeny=false;const device={id:7,isActive:true,expiresAtUtc:null as string|null,revokedAtUtc:null as string|null,archivedAtUtc:null as string|null,placement:{browser:"edge",screenNumber:1,fullscreen:true,windowX:0,windowY:0,windowWidth:1920,windowHeight:1080}};const service={read:async()=>{reads++;if(deny)throw new Error("PRIVATE_SQL_TOKEN");if(knownDeny)throw new QuerySourceError("FORBIDDEN",403);return{devices:[device]};}} as unknown as Parameters<typeof createDeviceManagementRouter>[0];
 const app=express();app.use((req,_res,next)=>{if(req.header("x-test-role"))req.authUser={id:1,username:"synthetic",displayName:"Synthetic",permissions:req.header("x-test-role")==="designer"?["DESIGN_QUERY"]:[]} as NonNullable<typeof req.authUser>;next();});app.use(createDeviceManagementRouter(service));const server=createServer(app);server.listen(0,"127.0.0.1");await once(server,"listening");t.after(()=>{server.closeAllConnections();server.close();});const port=(server.address() as import("node:net").AddressInfo).port;
 const call=(role?:string,id=7)=>fetch(`http://127.0.0.1:${port}/1/device-management/v1/${id}/playback-link`,{headers:{authorization:`Bearer ${jwt.sign({sub:"1",tokenVersion:3},"synthetic")}`,...(role?{"x-test-role":role}:{})}});
 assert.equal((await call()).status,403);assert.equal((await call("viewer")).status,403);assert.equal(reads,0);
 const r=await call("designer");assert.equal(r.status,200);const body=await r.json();assert.equal(body.url,"https://hospital.example:8443/display/dashboards/1?deviceId=7");assert(body.bat.startsWith("@echo off"));assert.equal(r.headers.get("cache-control"),"no-store");assert(!JSON.stringify(body).includes(grant.token));
 assert.equal((await call("designer",8)).status,404);assert.equal((await call("designer",0)).status,400);
 deny=true;const failed=await call("designer");assert.equal(failed.status,503);assert(!JSON.stringify(await failed.json()).includes("PRIVATE"));deny=false;
 knownDeny=true;assert.equal((await call("designer")).status,403);knownDeny=false;
 for(const [origin,code] of [[undefined,"PLAYBACK_ORIGIN_REQUIRED"],["http://hospital.example/","PLAYBACK_ORIGIN_INVALID"],["http://user:PRIVATE@hospital.example","PLAYBACK_ORIGIN_INVALID"]]){env.DASHBOARD_PUBLIC_CLIENT_ORIGIN=origin;const res=await call("designer");assert.equal(res.status,503);const body=await res.json();assert.equal(body.error.code,code);assert(!JSON.stringify(body).includes("PRIVATE"));}
 env.DASHBOARD_PUBLIC_CLIENT_ORIGIN="http://hospital.example";assert.equal((await call("designer")).status,200);
 device.placement.windowWidth=0;const badPlacement=await call("designer");assert.equal(badPlacement.status,409);assert.equal((await badPlacement.json()).error.code,"PLAYBACK_PLACEMENT_INVALID");device.placement.windowWidth=1920;
 for(const change of [{isActive:false},{revokedAtUtc:"2020-01-01T00:00:00Z"},{archivedAtUtc:"2020-01-01T00:00:00Z"},{expiresAtUtc:"2020-01-01T00:00:00Z"},{expiresAtUtc:"invalid"}]){const previous={...device};Object.assign(device,change);const res=await call("designer");assert.equal(res.status,409);assert.equal((await res.json()).error.code,"DASHBOARD_DEVICE_NOT_EDITABLE");Object.assign(device,previous);}
 device.expiresAtUtc="2099-01-01T00:00:00Z";assert.equal((await call("designer")).status,200);
});

for(const origin of ["http://hospital.example:8080","https://hospital.example:8443"])test(`configured manual URL/BAT ${origin} contains no authority and keeps secure-cookie origin strict`,()=>{
 const url=manualPlaybackLink(origin,1,7),{bat,script}=kioskLauncher(url,{browser:"edge",screenNumber:1,fullscreen:true,windowX:0,windowY:0,windowWidth:1920,windowHeight:1080});assert.equal(url,`${origin}/display/dashboards/1?deviceId=7`);assert(script.includes(`--app=${url}`));assert(!bat.includes(grant.token));if(origin.startsWith("http:")){assert.match(bat,/HTTP manual playback only/);assert.throws(()=>kioskOrigin(origin));}
});
for(const origin of [undefined,"http://user:secret@host.test","http://host.test/","http://host.test/path","http://host.test?token=x","javascript:alert(1)","https://host.test#x"])test(`manual URL rejects ${origin}`,()=>assert.throws(()=>manualPlaybackLink(origin,1,7)));
