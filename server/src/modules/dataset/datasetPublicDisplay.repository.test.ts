import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {createDatasetPublicDisplayRepository,displayRepositoryDefaults} from "./datasetPublicDisplay.repository.js";
const rv=Buffer.from("0000000000000001","hex");
function fixture(){
 const s={version:1,row:null as any,audits:0,fail:"",permission:true,token:1,access:true,trace:[] as string[]};let draft:any;
 const tx={begin:async()=>{s.trace.push("BEGIN");draft={row:s.row,audits:s.audits};},commit:async()=>{s.trace.push("COMMIT");if(s.fail==="COMMIT")throw Error("PRIVATE_SQL");s.row=draft.row;s.audits=draft.audits;},rollback:async()=>{s.trace.push("ROLLBACK");}};
 const request=()=>{const p:any={};const r:any={input:(n:string,_t:unknown,v:unknown)=>{p[n]=v;return r;},query:async(q:string)=>{
   let rows:any[]=[];
   if(q.includes("FROM uqp.Dataset d"))rows=[{DefinitionRowVersion:rv,ConfigurationRowVersion:rv,SourceId:"2"}];
   else if(q.includes("FROM uqp.QueryDefinition"))rows=[{Id:3}];
   else if(q.includes("FROM uqp.DatasetSensitivePolicyVersion"))rows=[{VersionNumber:s.version}];
   else if(q.includes("FROM uqp.DatasetSensitiveColumn"))rows=[{ColumnName:"NAME",SensitivityType:"NAME",DeviceMaskMode:"FULL",CustomMaskJson:null}];
   else if(q.includes("FROM uqp.DatasetPublicDisplayPolicy"))rows=draft.row?[draft.row]:[];
   else if(q.includes("FROM uqp.DatasetColumn"))rows=[{ColumnName:"NAME"}];
   else if(q.startsWith("INSERT uqp.AuditLog")){s.trace.push("AUDIT");if(s.fail==="AUDIT")throw Error("PRIVATE_SQL");draft.audits++;rows=[{Id:s.fail==="ID"?9007199254740992:"9007199254740993"}];}
   else if(q.startsWith("INSERT uqp.DatasetPublicDisplayPolicy")||q.startsWith("UPDATE uqp.DatasetPublicDisplayPolicy")){s.trace.push("WRITE");if(s.fail==="WRITE")throw Error("PRIVATE_SQL");draft.row={DefinitionVersion:p.definition,ConfigurationVersion:p.configuration,SourceExact:p.source,SensitivityVersion:p.sensitivity,GrantsJson:p.grants,RowVersion:rv,ActorExact:"4",ConfirmedAtUtc:new Date(0),RequestId:p.requestId,RequestDigest:p.digest};}
   return {recordset:rows};}};return r;};
 const store=createDatasetPublicDisplayRepository({...displayRepositoryDefaults,getPool:async()=>({}) as never,schema:async()=>{},transaction:()=>tx as never,request,access:async()=>s.access?{canView:true,canExecute:true} as never:null});
 const actor=async()=>({userId:4,tokenVersion:s.token,permissions:s.permission?["DESIGN_QUERY","EXECUTE_QUERY"]:[]});
 const command=()=>({expectedVersion:null,expectedSensitivityVersion:1,expectedDefinitionVersion:rv.toString("hex"),expectedConfigurationVersion:rv.toString("hex"),requestId:randomUUID(),grants:[{columnName:"NAME",permitted:true}]});
 return {s,store,actor,command};
}
test("public confirmation is explicit, exact-audit, atomic and replay bounded",async()=>{const f=fixture(),c=f.command();assert.equal((await f.store.get(1,f.actor)).status,"UNCONFIRMED");assert.equal((await f.store.save(1,f.actor,c)).status,"CONFIRMED");assert.equal(f.s.audits,1);await f.store.save(1,f.actor,c);assert.equal(f.s.audits,1);await assert.rejects(f.store.save(1,f.actor,{...c,grants:[]}),/REQUEST_CONFLICT/);});
for(const fail of ["AUDIT","WRITE","COMMIT","ID"])test(`public ${fail} failure rolls back, never leaks details`,async()=>{const f=fixture();f.s.fail=fail;await assert.rejects(f.store.save(1,f.actor,f.command()),e=>e instanceof Error&&!e.message.includes("PRIVATE_SQL"));assert.equal(f.s.row,null);assert.equal(f.s.audits,0);assert.equal(f.s.trace.at(-1),"ROLLBACK");});
for(const denied of ["permission","access","version","unknownColumn"])test(`public confirmation rejects ${denied}`,async()=>{const f=fixture(),c=f.command();if(denied==="permission")f.s.permission=false;if(denied==="access")f.s.access=false;if(denied==="version")c.expectedSensitivityVersion=2;if(denied==="unknownColumn")c.grants=[{columnName:"UNKNOWN",permitted:true}];await assert.rejects(f.store.save(1,f.actor,c));assert.equal(f.s.audits,0);assert.equal(f.s.row,null);});
test("sensitivity ABA advances version, old confirmation becomes stale and re-confirmable",async()=>{const f=fixture();await f.store.save(1,f.actor,f.command());f.s.version=3;assert.equal((await f.store.get(1,f.actor)).status,"STALE");const c={...f.command(),expectedSensitivityVersion:3,expectedVersion:rv.toString("hex")};assert.equal((await f.store.save(1,f.actor,c)).status,"CONFIRMED");});
