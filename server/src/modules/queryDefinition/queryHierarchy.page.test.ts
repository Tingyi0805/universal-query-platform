import test from "node:test";
import assert from "node:assert/strict";
import {createHierarchyPageDelivery,createHierarchyMetadataDelivery} from "./queryHierarchy.page.js";
const plan={page:2,pageSize:10,orderBy:["ID"],search:null,sort:null};
function fixture(){
 let audited=0,validations=0;const context={query:{id:1,datasetId:2},actor:{userId:8},dataset:{dataSourceId:9},snapshot:{patientAudit:{enabled:true},policy:{state:"CONFIRMED",version:"1",patientAuditOnlyColumns:["MRN"],rules:[{columnName:"ID",mode:"NONE"},{columnName:"NAME",mode:"CUSTOM",customMask:{prefix:1,suffix:0,symbol:"○"}},{columnName:"MRN",mode:"OMIT"}]}},
  reports:["ID","NAME","MRN"].map((columnName,i)=>({columnName,displayLabel:columnName,displayOrder:i,isVisible:true,groupOrder:null,aggregateType:"NONE"})),revalidate:async()=>{validations++;}} as any;
 const deps={execute:async()=>({result:{columns:[{name:"ID"},{name:"NAME"},{name:"MRN"}],rows:[{ID:11,NAME:"王小明",MRN:"SYNTHETIC_RAW_KEY"}],rowCount:1,truncated:false,elapsedMs:1},pagination:{page:2,pageSize:10,totalRows:20,totalPages:2,capped:false}}),
  auditPatient:async(input:any)=>{audited++;assert.equal(input.deliveryType,"PAGE");assert.equal(input.pageNumber,2);assert.equal(input.rows.length,1);assert.equal(input.rows[0].MRN,"SYNTHETIC_RAW_KEY");return 70;}};
 return {context,deps,counts:()=>({audited,validations})};
}
test("only the actual page is disclosed, audited before masking, with omitted keys absent from output",async()=>{
 const f=fixture(),r=await createHierarchyPageDelivery(f.deps)(f.context,{},plan);const body=JSON.stringify(r);
 assert(!body.includes("SYNTHETIC_RAW_KEY"));assert(!body.includes("王小明"));assert(!r.result.columns.some(c=>c.name==="MRN"));assert.equal(r.result.rows.length,1);
 assert.deepEqual(f.counts(),{audited:1,validations:2});
});
test("missing patient receipt, patient Audit failure and final revocation reject the page",async()=>{
 for(const fail of ["receipt","audit","revoke"]){const f=fixture();let calls=0;
  if(fail==="receipt")f.deps.auditPatient=async()=>0;if(fail==="audit")f.deps.auditPatient=async()=>{throw Error("AUDIT_FAILED");};
  if(fail==="revoke")f.context.revalidate=async()=>{if(++calls===2)throw Error("TOKEN_REVOKED");};
  await assert.rejects(createHierarchyPageDelivery(f.deps)(f.context,{},plan));
 }
});

test("patient-contract UPDLOCK reads and all metadata inspections reuse the owner transaction",async()=>{
 const {defaultQueryDeliveryDependencies}=await import("./queryDelivery.js");const owner={} as any,seen:string[]=[];
 const check=(name:string,t:unknown)=>{assert.equal(t,owner);seen.push(name);};
 const snapshot={datasetId:2,definitionVersion:"1".repeat(16),sensitivityVersion:"1",patientAuditVersion:"1",policy:{state:"CONFIRMED",version:"1",rules:[{columnName:"ID",mode:"NONE"}]},patientAudit:{configured:true,enabled:true,patientKeyColumn:"ID"}} as any;
 const delivery=createHierarchyMetadataDelivery(owner,{...defaultQueryDeliveryDependencies,
  access:async(_u,_q,tx)=>{check("access",tx);return {id:1,datasetId:2,canView:true,canExecute:true,isPublished:true,isActive:true,isArchived:false} as any;},
  accessRevision:async(_q,tx)=>{check("acl",tx);return "acl1";},snapshot:async(_d,_v,tx)=>{check("snapshot",tx);return snapshot;},
  dataset:async(_d,tx)=>{check("dataset",tx);return {id:2,dataSourceId:9,isActive:true,isArchived:false} as any;},
  patientState:async(_d,tx)=>{check("patient-UPDLOCK",tx);return {status:"CONFIRMED",fingerprint:"p1"} as any;},
  reports:async(_q,tx)=>{check("reports",tx);return []},
 });
 const context=await delivery.open(1,"EXECUTE",async()=>({userId:8,tokenVersion:1,permissions:["VIEW_QUERY","EXECUTE_QUERY"]}));
 await context.revalidate(owner);assert(seen.includes("patient-UPDLOCK"));assert(seen.includes("snapshot"));assert(seen.includes("acl"));
 await assert.rejects(context.revalidate({} as any),/HIERARCHY_TRANSACTION_OWNER_MISMATCH/);
});
