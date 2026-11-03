import test from "node:test";
import assert from "node:assert/strict";
import { createDrilldownService, drilldownDependencies } from "./dashboardDrilldown.service.js";
import { parseDrillGraph, typedDrillValue } from "./dashboardDrilldown.schema.js";
import { QueryDeliveryError } from "../queryDefinition/queryDelivery.js";
const graph = () => ({version:1,root:"root",nodes:[{id:"root",queryId:1},{id:"child",queryId:2}],edges:[{id:"detail",from:"root",to:"child",trigger:"ROW",display:"PANEL",bindings:[{field:"ID",parameter:"ID",type:"NUMBER"}]}]});
const identity = async () => ({userId:1,tokenVersion:1,permissions:["VIEW_QUERY","EXECUTE_QUERY"]});
const meta = {ipAddress:null,userAgent:null};
function fixture() {
  let revision="v1", evidence="a", time=100, auditFail=false, revoked=false, mode="NONE", enabled=true;
  const seen: unknown[] = [], audits: unknown[] = [];
  const deps = {
    ...drilldownDependencies, enabled:()=>enabled, now:()=>time,
    load:async () => ({revision,rootQueryId:1,graph:graph(),rootValues:{}}),
    parameters:async (id:number) => id===2 ? [{name:"ID",dataType:"NUMBER"}] as any : [],
    delivery:{
      open:async (id:number,_action:any,verify:any) => {
        await verify(); if (revoked) throw new QueryDeliveryError("QUERY_DELIVERY_FORBIDDEN",403);
        return {actor:await identity(),query:{id,datasetId:id},dataset:{sqlText:id===2?"SELECT {{ID}}":"SELECT ID"},
          snapshot:{policy:{rules:[{columnName:"ID",mode}]}},fingerprint:evidence,
          revalidate:async()=>{await verify(); if(revoked) throw new QueryDeliveryError("TOKEN_REVOKED",401);} } as any;
      },
      execute:async (_c:any,values:any) => {seen.push(values); return {result:{columns:[{name:"ID"}],rows:[{ID:42}],rowCount:1,truncated:false,elapsedMs:1},reportColumns:[],disclosureId:1};},
    },
    startAudit:async (a:any)=>{audits.push(a);return 1;},
    finalizeDeliveryAudit:async (_id:any,_data:any,verify:any)=>{if(auditFail)throw new Error("sensitive driver detail");await verify();},
    completeAuditFailure:async()=>undefined,
  } as unknown as typeof drilldownDependencies;
  const service=createDrilldownService(deps);
  return {deps,service,seen,audits,change:(v:any)=>{revision=v.revision??revision;evidence=v.evidence??evidence;time=v.time??time;auditFail=v.auditFail??auditFail;revoked=v.revoked??revoked;mode=v.mode??mode;enabled=v.enabled??enabled;}};
}
for (const [name, mutate] of [
  ["cycle",(g:any)=>g.edges.push({...g.edges[0],id:"cycle",from:"child",to:"root"})],
  ["invalid reference",(g:any)=>g.edges[0].to="absent"],
  ["unknown SQL",(g:any)=>g.sql="DROP TABLE X"],
  ["duplicate node",(g:any)=>g.nodes.push(g.nodes[0])],
  ["duplicate bind",(g:any)=>g.edges[0].bindings.push(g.edges[0].bindings[0])],
  ["column trigger without column",(g:any)=>g.edges[0].trigger="COLUMN"],
  ["unreachable",(g:any)=>g.nodes.push({id:"orphan",queryId:3})],
] as const) test(`graph rejects ${name}`,()=>{const g=graph();mutate(g);assert.throws(()=>parseDrillGraph(g));});
test("column action and modal are accepted; depth capped at five",()=>{const g:any=graph();g.edges[0].trigger="COLUMN";g.edges[0].column="ID";g.edges[0].display="MODAL";assert.equal(parseDrillGraph(g).edges[0]!.column,"ID");for(let i=2;i<6;i++){g.nodes.push({id:`n${i}`,queryId:i+1});g.edges.push({...g.edges[0],id:`e${i}`,from:i===2?"child":`n${i-1}`,to:`n${i}`});}assert.throws(()=>parseDrillGraph(g));});
test("typed bindings reject SQL numeric injection, null, coercion and invalid leap day",()=>{for(const [v,t] of [["1 OR 1=1","NUMBER"],[null,"STRING"],["true","BOOLEAN"],["2025-02-29","DATE"],[Infinity,"NUMBER"]])assert.throws(()=>typedDrillValue(v,t as string));assert.equal(typedDrillValue("2024-02-29","DATE"),"2024-02-29");assert.equal(typedDrillValue("' OR 1=1 --","STRING"),"' OR 1=1 --");});
test("navigate binds only server row values; back reexecutes and reaudits; old refs cannot replay",async()=>{const f=fixture(),root=await f.service.create(1,10,"jwt",identity,meta);const child:any=await f.service.act(1,root.contextId,"jwt",identity,{kind:"NAVIGATE",edge:"detail",rowRef:root.rowRefs[0]},meta);assert.deepEqual({...f.seen[1] as any},{ID:42});assert.equal(child.depth,2);const back:any=await f.service.act(1,root.contextId,"jwt",identity,{kind:"BACK"},meta);assert.equal(back.depth,1);assert.equal(f.audits.length,3);assert.ok(f.audits.every((a:any)=>a.parameters===null));await assert.rejects(f.service.act(1,root.contextId,"jwt",identity,{kind:"NAVIGATE",edge:"detail",rowRef:root.rowRefs[0]},meta),/DRILL_ROW_REFERENCE_INVALID/);});
for(const [name,action] of [["forged ref",{edge:"detail",rowRef:"forged"}],["arbitrary query/action",{edge:"99",rowRef:"x"}]] as const)test(name,async()=>{const f=fixture(),r=await f.service.create(1,10,"jwt",identity,meta);await assert.rejects(f.service.act(1,r.contextId,"jwt",identity,{kind:"NAVIGATE",...action},meta),/DRILL_ROW_REFERENCE_INVALID/);assert.equal(f.seen.length,1);});
for(const [name,owner,dashboard] of [["other user","other",1],["other dashboard","jwt",2]] as const)test(name,async()=>{const f=fixture(),r=await f.service.create(1,10,"jwt",identity,meta);await assert.rejects(f.service.act(dashboard,r.contextId,owner,identity,{kind:"BACK"},meta),/NOT_FOUND/);});
for(const change of [{revision:"v2"},{evidence:"b"},{revoked:true},{time:120101}])test(`context invalidation ${JSON.stringify(change)}`,async()=>{const f=fixture(),r=await f.service.create(1,10,"jwt",identity,meta);f.change(change);await assert.rejects(f.service.act(1,r.contextId,"jwt",identity,{kind:"NAVIGATE",edge:"detail",rowRef:r.rowRefs[0]},meta));assert.equal(f.seen.length,1);});
for(const mode of ["OMIT","FULL","NAME","MRN"])test(`masked source ${mode} blocked before execution`,async()=>{const f=fixture();f.change({mode});await assert.rejects(f.service.create(1,10,"jwt",identity,meta),/MASKED_BINDING/);assert.equal(f.seen.length,0);});
test("audit failure delivers no context; single process gate fails closed",async()=>{const f=fixture();f.change({auditFail:true});await assert.rejects(f.service.create(1,10,"jwt",identity,meta));f.change({auditFail:false,enabled:false});await assert.rejects(f.service.create(1,10,"jwt",identity,meta),/SINGLE_PROCESS/);});
test("delete invalidates context, JWT invalidation prevents reads",async()=>{const f=fixture(),r=await f.service.create(1,10,"jwt",identity,meta);await assert.rejects(f.service.act(1,r.contextId,"jwt",async()=>{throw new QueryDeliveryError("TOKEN_REVOKED",401);},{kind:"BACK"},meta),/TOKEN_REVOKED/);const s=await f.service.create(1,10,"jwt",identity,meta);await f.service.act(1,s.contextId,"jwt",identity,{kind:"DELETE"},meta);await assert.rejects(f.service.act(1,s.contextId,"jwt",identity,{kind:"BACK"},meta),/NOT_FOUND/);});
test("invalid target parameter metadata and mismatched root query reject",async()=>{const f=fixture();f.deps.parameters=async()=>[];await assert.rejects(f.service.validate(graph(),identity),/PARAMETER/);const h=fixture();h.deps.load=async()=>({revision:"v",rootQueryId:99,graph:graph(),rootValues:{}});await assert.rejects(h.service.create(1,10,"jwt",identity,meta),/ROOT_QUERY/);});
test("concurrent navigation rejected and DELETE tombstones pending result",async()=>{
  const f=fixture(),r=await f.service.create(1,10,"jwt",identity,meta);
  let release!:()=>void, entered!:()=>void;
  const ready=new Promise<void>(resolve=>entered=resolve), wait=new Promise<void>(resolve=>release=resolve);
  const original=f.deps.delivery.execute;
  f.deps.delivery.execute=async(c,v)=>{entered();await wait;return original(c,v);};
  const pending=f.service.act(1,r.contextId,"jwt",identity,{kind:"NAVIGATE",edge:"detail",rowRef:r.rowRefs[0]},meta);
  await ready;
  await assert.rejects(f.service.act(1,r.contextId,"jwt",identity,{kind:"BACK"},meta),/BUSY/);
  await f.service.act(1,r.contextId,"jwt",identity,{kind:"DELETE"},meta);release();
  await assert.rejects(pending,/EXPIRED/);
});
test("equivalent JSON key order retains graph integrity; actual graph mutation rejects",async()=>{
  const f=fixture();f.deps.load=async()=>({revision:"v1",rootQueryId:1,rootValues:{},graph:{edges:graph().edges,nodes:graph().nodes,root:"root",version:1}});
  const r=await f.service.create(1,10,"jwt",identity,meta);assert.equal(r.depth,1);
  const g=graph();g.edges[0]!.display="MODAL";f.deps.load=async()=>({revision:"v1",rootQueryId:1,rootValues:{},graph:g});
  await assert.rejects(f.service.act(1,r.contextId,"jwt",identity,{kind:"BACK"},meta),/CONFIGURATION_CHANGED/);
});
test("saved root parameters remain server owned",async()=>{const f=fixture();f.deps.load=async()=>({revision:"v1",rootQueryId:1,rootValues:{WARD:"SYNTHETIC"},graph:graph()});await f.service.create(1,10,"jwt",identity,meta);assert.deepEqual(f.seen[0],{WARD:"SYNTHETIC"});});
test("result limits, missing parent columns and target datatype changes fail closed",async()=>{
  for(const mode of ["limit","missing","type"]){const f=fixture();if(mode==="type")f.deps.parameters=async(id)=>id===2?[{name:"ID",dataType:"STRING"}] as any:[];
    else f.deps.delivery.execute=async()=>({result:{columns:[{name:"OTHER"}],rows:mode==="limit"?Array.from({length:1001},()=>({ID:1})):[{OTHER:1}],rowCount:1,truncated:false,elapsedMs:1},reportColumns:[],disclosureId:1});
    await assert.rejects(f.service.create(1,10,"jwt",identity,meta));}
});

test("native SQL date fields use UTC typed bindings",()=>{assert.equal(typedDrillValue(new Date("2024-02-29T23:00:00Z"),"DATE"),"2024-02-29");assert.equal(typedDrillValue(new Date("2024-02-29T23:00:00Z"),"DATETIME"),"2024-02-29T23:00:00.000Z");});
test("production gate is default off and rejects known multiworker settings",()=>{
  const keys=["DASHBOARD_DRILLDOWN_CONTEXT_MODE","WEB_CONCURRENCY","NODE_UNIQUE_ID","pm_id"] as const;
  const prior=keys.map(k=>process.env[k]);
  try{for(const k of keys)delete process.env[k];assert.equal(drilldownDependencies.enabled(),false);process.env.DASHBOARD_DRILLDOWN_CONTEXT_MODE="SINGLE_PROCESS";assert.equal(drilldownDependencies.enabled(),true);
    for(const [key,value] of [["WEB_CONCURRENCY","2"],["NODE_UNIQUE_ID","1"],["pm_id","0"]]){process.env[key!]=value;assert.equal(drilldownDependencies.enabled(),false);delete process.env[key!];}}
  finally{keys.forEach((k,i)=>{if(prior[i]===undefined)delete process.env[k];else process.env[k]=prior[i];});}
});
