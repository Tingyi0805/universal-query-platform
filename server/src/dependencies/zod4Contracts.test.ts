import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { app } from "../app.js";
import { logger } from "../config/logger.js";
import { env } from "../config/env.js";
import { querySourcePatchSchema } from "../modules/dashboard/dashboardQuerySources.schema.js";
import { approvalPatchSchema } from "../modules/dashboard/dashboardApproval.routes.js";
import { layoutSchema } from "../modules/dashboard/dashboardLayout.schema.js";
test("Zod 4 records retain arbitrary parameter/column keys, values and strict request contracts",()=>{
 const source={sourceKey:"WARD",id:null,queryDefinitionId:20,refreshSeconds:5,pageSeconds:5,pageSize:10,maxRows:100,isEnabled:true,parameters:{DATE:"2026-10-29",N:null,FLAG:false,LIST:["a","b"]}};
 const body={expectedVersion:"a".repeat(64),upserts:[source],removals:[]};assert.deepEqual(querySourcePatchSchema.parse(body).upserts[0]!.parameters,source.parameters);
 assert.equal(querySourcePatchSchema.safeParse({...body,token:"injection"}).success,false);assert.equal(querySourcePatchSchema.safeParse({...body,upserts:[{...source,queryDefinitionId:9007199254740992}]}).success,false);
 assert.deepEqual(approvalPatchSchema.parse({expectedVersion:"synthetic",sourceKey:"PRIMARY",upsert:{PATIENT_NAME:"NAME"}}).upsert,{PATIENT_NAME:"NAME"});
 assert.equal(approvalPatchSchema.safeParse({expectedVersion:"synthetic",sourceKey:"PRIMARY",upsert:{PATIENT_NAME:"INVALID"}}).success,false);
 assert.deepEqual(approvalPatchSchema.parse({expectedVersion:"synthetic",sourceKey:"PRIMARY",remove:["PATIENT_NAME"]}).upsert,{});
});
test("Zod 4 preserves Dashboard optional/default output and nested config records",()=>{
 const parsed=layoutSchema.parse({profiles:[{name:"Synthetic",canvasWidth:1920,canvasHeight:1080,widgets:[{widgetType:"TEXT",x:0,y:0,width:100,height:100,config:{color:"red",custom:null}}]}]});
 assert.deepEqual(parsed.profiles[0]!.config,{});assert.equal(parsed.profiles[0]!.isDefault,false);const widget=parsed.profiles[0]!.widgets[0]!;assert.equal(widget.title,null);assert.equal(widget.fontSize,36);assert.deepEqual(widget.config,{color:"red",custom:null});
});
test("actual application starts with Zod 4; malformed auth input and missing/invalid JWT fail closed before DB work",async t=>{
 const logLevel=logger.level;logger.level="silent";t.after(()=>{logger.level=logLevel;});
 const old=env.JWT_SECRET;env.JWT_SECRET="synthetic-zod4-contract-key";const server=createServer(app);await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));t.after(()=>{env.JWT_SECRET=old;server.closeAllConnections();server.close();});
 const port=(server.address() as import("node:net").AddressInfo).port;
 for(const body of [{},{username:{operator:"invalid"},password:"x"},{username:"x"},{username:" ",password:"x"}]){const r=await fetch(`http://127.0.0.1:${port}/api/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});assert.equal(r.status,400);assert.equal((await r.json()).error.code,"VALIDATION_ERROR");}
 for(const header of [undefined,"Bearer invalid-synthetic-signature"]){const r=await fetch(`http://127.0.0.1:${port}/api/dashboards`,{headers:header?{authorization:header}:{}});assert.equal(r.status,401);const text=await r.text();assert(!text.includes("invalid-synthetic-signature"));}
});
