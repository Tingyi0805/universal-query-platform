import test from "node:test";
import assert from "node:assert/strict";
import {graph,hierarchyFixture} from "./queryHierarchy.testFixture.js";
import {parseHierarchyGraph,hierarchyPageSchema} from "./queryHierarchy.contract.js";
test("bounded graph rejects cycles, duplicates, unknown fields, ambiguous row triggers and unsafe column names",()=>{
 for(const edit of [(g:any)=>g.nodes.push(g.nodes[0]),(g:any)=>g.edges.push({...g.edges[0],id:"loop",from:"detail",to:"root"}),
  (g:any)=>g.extra=true,(g:any)=>g.nodes[0].orderBy=["ID;DROP"],(g:any)=>g.edges.push({...g.edges[0],id:"second"})]){
  const g=graph();edit(g);assert.throws(()=>parseHierarchyGraph(g));}
 assert.throws(()=>hierarchyPageSchema.parse({page:1,sort:{column:"NAME",direction:"ASC"}}));
});
test("root, child, real page controls and back use server-owned values and new row references",async()=>{
 const f=hierarchyFixture(),r:any=await f.service.create(1,"owner",{},f.identity,f.meta);
 assert.equal(r.result.rows[0].NAME,"王○");assert.equal(r.actions[0].columnKey,null);assert(!JSON.stringify(r).includes('"bindings"'));
 const child:any=await f.service.act(1,r.contextId,"owner",f.identity,{kind:"NAVIGATE",edge:"open",rowRef:r.rowRefs[0]},f.meta);
 assert.equal(child.query.name,"子層");assert.equal(child.layout,"CARDS");assert.equal(f.state.pages[1]!.values.KEY,11);assert.deepEqual(Object.keys(f.state.pages[1]!.values),["KEY"]);
 const page:any=await f.service.act(1,r.contextId,"owner",f.identity,{kind:"PAGE",controls:hierarchyPageSchema.parse({page:2})},f.meta);assert.equal(page.pagination.page,2);
 const back:any=await f.service.act(1,r.contextId,"owner",f.identity,{kind:"BACK"},f.meta);assert.equal(back.depth,1);assert.equal(back.pagination.page,1);assert.notEqual(back.rowRefs[0],r.rowRefs[0]);
 assert.equal(f.state.successes,4);assert.equal(f.state.pages.length,4);
});
test("unauthorized child never inherits parent access and its SQL is never executed",async()=>{
 const f=hierarchyFixture(),r:any=await f.service.create(1,"a",{},f.identity,f.meta);f.state.denied=2;
 await assert.rejects(f.service.act(1,r.contextId,"a",f.identity,{kind:"NAVIGATE",edge:"open",rowRef:r.rowRefs[0]},f.meta));assert.equal(f.state.pages.length,1);
 await assert.rejects(f.service.act(1,r.contextId,"a",f.identity,{kind:"BACK"},f.meta),/HIERARCHY_CONTEXT_NOT_FOUND/);
});
for(const kind of ["revision","definition","configuration","queryRevision","tokenVersion"] as const)test(`${kind} drift rejects saved contexts before additional delivery`,async()=>{
 const f=hierarchyFixture(),r:any=await f.service.create(1,"a",{},f.identity,f.meta);
 if(kind==="tokenVersion")f.state.tokenVersion++;else f.state[kind]+="changed";
 await assert.rejects(f.service.act(1,r.contextId,"a",f.identity,{kind:"PAGE",controls:hierarchyPageSchema.parse({})},f.meta));assert.equal(f.state.pages.length,1);
});
test("masked/hidden mappings, incomplete child bindings and PIN assurance are rejected",async()=>{
 for(const flag of ["masked","hidden","pin"] as const){const f=hierarchyFixture();f.state[flag]=true;await assert.rejects(f.service.validate(1,graph(),f.identity));assert.equal(f.state.pages.length,0);}
 const f=hierarchyFixture(),g=graph();g.edges[0]!.bindings=[];await assert.rejects(f.service.validate(1,g,f.identity),/HIERARCHY_PARAMETER_MAPPING_INVALID/);
});
test("foreign owner/root and old-page or forged row references cannot navigate",async()=>{
 const f=hierarchyFixture(),r:any=await f.service.create(1,"a",{},f.identity,f.meta);
 for(const [root,owner] of [[1,"b"],[2,"a"]] as const)await assert.rejects(f.service.act(root,r.contextId,owner,f.identity,{kind:"BACK"},f.meta),/NOT_FOUND/);
 await f.service.act(1,r.contextId,"a",f.identity,{kind:"PAGE",controls:hierarchyPageSchema.parse({page:2})},f.meta);
 await assert.rejects(f.service.act(1,r.contextId,"a",f.identity,{kind:"NAVIGATE",edge:"open",rowRef:r.rowRefs[0]},f.meta),/ROW_REFERENCE_INVALID/);
});
test("expired context, database failure, Audit failure and final revoke do not return data",async()=>{
 for(const failure of ["expiry","db","audit","revoke"]){const f=hierarchyFixture(),r:any=await f.service.create(1,"a",{},f.identity,f.meta);
  if(failure==="expiry")f.state.now+=120001;if(failure==="db")f.state.dbFail=true;if(failure==="audit")f.state.auditFail=true;if(failure==="revoke")f.state.afterPage=()=>{f.state.denied=1;};
  await assert.rejects(f.service.act(1,r.contextId,"a",f.identity,{kind:"PAGE",controls:hierarchyPageSchema.parse({})},f.meta));assert.equal(f.state.successes,1);
 }
});
test("parallel navigation fails closed; DELETE tombstones an in-flight response",async()=>{
 const f=hierarchyFixture(),r:any=await f.service.create(1,"a",{},f.identity,f.meta);let release!:()=>void,started!:()=>void;
 const ready=new Promise<void>(r=>{started=r;});f.state.hold=()=>{started();return new Promise<void>(r=>{release=r;});};
 const pending=f.service.act(1,r.contextId,"a",f.identity,{kind:"PAGE",controls:hierarchyPageSchema.parse({})},f.meta);await ready;
 await assert.rejects(f.service.act(1,r.contextId,"a",f.identity,{kind:"BACK"},f.meta),/CONTEXT_BUSY/);
 await f.service.act(1,r.contextId,"a",f.identity,{kind:"DELETE"},f.meta);release();await assert.rejects(pending);assert.equal(f.state.successes,1);
});
test("three levels are independently opened and audited; back re-fetches each layer",async()=>{
 const f=hierarchyFixture();f.state.graph.nodes.push({...f.state.graph.nodes[1]!,id:"leaf",queryId:3});f.state.graph.edges.push({...f.state.graph.edges[0]!,id:"leafOpen",from:"detail",to:"leaf"});
 const root:any=await f.service.create(1,"a",{},f.identity,f.meta);
 const child:any=await f.service.act(1,root.contextId,"a",f.identity,{kind:"NAVIGATE",edge:"open",rowRef:root.rowRefs[0]},f.meta);
 const leaf:any=await f.service.act(1,root.contextId,"a",f.identity,{kind:"NAVIGATE",edge:"leafOpen",rowRef:child.rowRefs[0]},f.meta);
 assert.equal(leaf.depth,3);assert.equal(f.state.pages[2]!.queryId,3);
 const back:any=await f.service.act(1,root.contextId,"a",f.identity,{kind:"BACK"},f.meta);assert.equal(back.depth,2);assert.equal(f.state.pages[3]!.queryId,2);assert.equal(f.state.successes,4);
});
test("restored graph content cannot revive a context after its ROWVERSION advanced",async()=>{
 const f=hierarchyFixture(),r:any=await f.service.create(1,"a",{},f.identity,f.meta);
 f.state.revision="2".repeat(16);f.state.graph.edges[0]!.label="B";f.state.revision="3".repeat(16);f.state.graph.edges[0]!.label="明細";
 await assert.rejects(f.service.act(1,r.contextId,"a",f.identity,{kind:"PAGE",controls:hierarchyPageSchema.parse({})},f.meta));
});

test("an unvisited child's changed parameter contract cannot be silently coerced on first navigation",async()=>{
 const f=hierarchyFixture(),root:any=await f.service.create(1,"a",{},f.identity,f.meta);f.state.parameterType="STRING";
 await assert.rejects(f.service.act(1,root.contextId,"a",f.identity,{kind:"NAVIGATE",edge:"open",rowRef:root.rowRefs[0]},f.meta),/HIERARCHY_AUTHORIZATION_CHANGED/);
 assert.equal(f.state.pages.length,1);
});

test("masked column keys cannot become a SQL filter or sort even when the browser knows the ordinal",async()=>{
 const f=hierarchyFixture(),r:any=await f.service.create(1,"a",{},f.identity,f.meta);
 await assert.rejects(f.service.act(1,r.contextId,"a",f.identity,{kind:"PAGE",controls:hierarchyPageSchema.parse({page:1,sort:{column:"c1",direction:"ASC"}})},f.meta),/HIERARCHY_COLUMN_KEY_INVALID/);
 assert.equal(f.state.pages.length,1);
});

test("derived numeric keys reject floating/unsafe values; exact BIGINT STRING keys are never Number-repaired",async()=>{
 for(const key of [0.1,9007199254740992]){const f=hierarchyFixture();f.state.parentKey=key;const r:any=await f.service.create(1,"a",{},f.identity,f.meta);
  await assert.rejects(f.service.act(1,r.contextId,"a",f.identity,{kind:"NAVIGATE",edge:"open",rowRef:r.rowRefs[0]},f.meta),/BINDING_PRECISION/);assert.equal(f.state.pages.length,1);}
 const f=hierarchyFixture();f.state.parentKey="9007199254740993";f.state.parameterType="STRING";f.state.graph.edges[0]!.bindings[0]!.type="STRING";
 const r:any=await f.service.create(1,"a",{},f.identity,f.meta);await f.service.act(1,r.contextId,"a",f.identity,{kind:"NAVIGATE",edge:"open",rowRef:r.rowRefs[0]},f.meta);
 assert.equal(f.state.pages[1]!.values.KEY,"9007199254740993");
});
