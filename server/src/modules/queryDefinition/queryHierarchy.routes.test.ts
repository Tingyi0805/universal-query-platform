import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {once} from "node:events";
import jwt from "jsonwebtoken";
import {env} from "../../config/env.js";
import {createAuthenticateJwt} from "../auth/auth.middleware.js";
import {createRuntimeIdentityVerifier,QueryDeliveryError} from "./queryDelivery.js";
import {createQueryHierarchyRouter} from "./queryHierarchy.routes.js";
import {hierarchyFixture} from "./queryHierarchy.testFixture.js";
async function setup(t:import("node:test").TestContext){
 const f=hierarchyFixture(),session={isActive:true,tokenVersion:1,permissions:["VIEW_QUERY","EXECUTE_QUERY","PUBLISH_QUERY"]},state=Object.assign(f.state,{admin:true,missing:false,saves:0});
 const old=env.JWT_SECRET;env.JWT_SECRET="synthetic-hierarchy-signing-key-not-runtime";t.after(()=>{env.JWT_SECRET=old;});
 const readSession=async()=>session as any;const identity=createRuntimeIdentityVerifier(readSession);
 const app=express();app.use(express.json());app.use(createQueryHierarchyRouter({authenticate:createAuthenticateJwt(readSession),identity,service:f.service,
  store:{...f.deps.store,requireAdmin:async(auth)=>{const a=await auth();if(!state.admin||!a.permissions.includes("PUBLISH_QUERY"))throw new QueryDeliveryError("FORBIDDEN",403);return a;},
   read:async root=>{if(state.missing)throw new QueryDeliveryError("HIERARCHY_SCHEMA_REQUIRED",503);return f.deps.store.read(root);},
   save:async(_root,_g,_rev,_actor,validate)=>{state.saves++;await validate({} as any);return {revision:"2".repeat(16)};}}}));
 // Existing non-hierarchy route must not acquire new feature's middleware or DB checks.
 app.get("/legacy",(_req,res)=>res.json({legacy:true}));
 const server=app.listen(0,"127.0.0.1");await once(server,"listening");t.after(()=>{server.closeAllConnections();server.close();});const address=server.address() as import("node:net").AddressInfo;
 const token=(version=1,expires=60)=>jwt.sign({tokenVersion:version,roles:["SYSTEM_ADMIN"]},env.JWT_SECRET!,{subject:"8",expiresIn:expires});
 return {...f,state,session,token,call:(path:string,body?:unknown,bearer:string|null=token(),method=body===undefined?"GET":"POST")=>fetch(`http://127.0.0.1:${address.port}/${path}`,{method,headers:{"content-type":"application/json",...(bearer?{authorization:`Bearer ${bearer}`}:{})},body:body===undefined?undefined:JSON.stringify(body)})};
}
test("JWT signature/expiry/live TokenVersion and current permissions are mandatory",async t=>{
 const f=await setup(t);
 for(const token of [null,"invalid",f.token(1,-1),f.token(2)])assert.equal((await f.call("1/hierarchy/contexts",{values:{}},token)).status,401);
 f.session.isActive=false;assert.equal((await f.call("1/hierarchy/contexts",{values:{}})).status,401);
 f.session.isActive=true;f.session.permissions=["VIEW_QUERY"];assert.equal((await f.call("1/hierarchy/contexts",{values:{}})).status,403);assert.equal(f.state.pages.length,0);
});
test("JWT role strings cannot assign administrative hierarchy authority",async t=>{
 const f=await setup(t);f.state.admin=false;
 assert.equal((await f.call("1/hierarchy/configuration")).status,403);
 assert.equal((await f.call("1/hierarchy/configuration",{graph:f.state.graph,expectedRevision:"MISSING"},f.token(),"PUT")).status,403);
 assert.equal(f.state.saves,0);assert.equal((await f.call("legacy",undefined,null)).status,200);
});
test("runtime accepts only server-selected row reference and control keys, never SQL/mappings/child parameters",async t=>{
 const f=await setup(t),created=await f.call("1/hierarchy/contexts",{values:{}});assert.equal(created.status,200);assert.match(created.headers.get("cache-control")!,/no-store/);const root:any=await created.json();
 for(const extra of [{sql:"SYNTHETIC_PRIVATE_SQL"},{queryId:2},{values:{KEY:99}},{column:"ID"},{bindings:[]}]){
  const r=await f.call(`1/hierarchy/contexts/${root.contextId}/navigate`,{edge:"open",rowRef:root.rowRefs[0],...extra});assert.equal(r.status,400);assert(!JSON.stringify(await r.json()).includes("SYNTHETIC_PRIVATE"));
 }
 const child=await f.call(`1/hierarchy/contexts/${root.contextId}/navigate`,{edge:"open",rowRef:root.rowRefs[0]});assert.equal(child.status,200);assert.equal((await child.json()).depth,2);
 const bad=await f.call(`1/hierarchy/contexts/${root.contextId}/page`,{page:1,search:{column:"ID",text:"x"}});assert.equal(bad.status,400);
});
test("missing new schema does not affect existing Query routes and capability is unavailable",async t=>{
 const f=await setup(t);f.state.missing=true;
 const r=await f.call("1/hierarchy/capabilities");assert.equal(r.status,200);assert.equal((await r.json()).available,false);
 assert.equal((await f.call("1/hierarchy/configuration")).status,503);assert.equal((await f.call("legacy",undefined,null)).status,200);
});
test("SQL/Audit error messages never expose underlying rows or diagnostic strings",async t=>{
 const f=await setup(t);f.state.dbFail=true;const r=await f.call("1/hierarchy/contexts",{values:{}});
 assert.equal(r.status,503);const body=JSON.stringify(await r.json());assert(!body.includes("PRIVATE_SQL"));assert(!body.includes("王○"));assert.equal(f.state.successes,0);
});
