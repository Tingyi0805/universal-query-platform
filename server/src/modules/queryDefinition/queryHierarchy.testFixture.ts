// Synthetic fixtures only. No SQL connection, patient data or durable proof.
import {createQueryHierarchyService,hierarchyServiceDependencies} from "./queryHierarchy.service.js";
import {parseHierarchyGraph} from "./queryHierarchy.contract.js";
export function graph(){return parseHierarchyGraph({version:1,root:"root",nodes:[{id:"root",queryId:1,layout:"TABLE",pageSize:2,orderBy:["ID"]},{id:"detail",queryId:2,layout:"CARDS",pageSize:1,orderBy:["ID"]}],edges:[{id:"open",from:"root",to:"detail",label:"明細",trigger:"ROW",display:"PANEL",bindings:[{field:"ID",parameter:"KEY",type:"NUMBER"}]}]});}
export function hierarchyFixture(){
 const state={parentKey:11 as unknown,parameterType:"NUMBER" as "NUMBER"|"STRING",now:Date.now(),revision:"1".repeat(16),definition:"d1",configuration:"s1",queryRevision:"q1",denied:0,tokenVersion:1,pin:false,managerApproved:false,masked:false,hidden:false,auditFail:false,dbFail:false,
  starts:0,successes:0,failures:0,pages:[] as {queryId:number;values:Record<string,unknown>;plan:unknown}[],graph:graph(),hold:null as null|(()=>Promise<void>),afterPage:null as null|(()=>void)};
 const identity=async()=>({userId:8,tokenVersion:state.tokenVersion,permissions:["VIEW_QUERY","EXECUTE_QUERY","PUBLISH_QUERY"],...(state.pin?{pinSession:{sessionId:"s",generation:"1",credentialVersion:1,pinVersion:1}}:{})});
 const open=async(queryId:number)=>{if(queryId===state.denied)throw Error("PRIVATE_DENIED");const token=state.tokenVersion;
  const reports=[{columnName:"ID",displayLabel:"識別",displayOrder:0,isVisible:!state.hidden,groupOrder:null,aggregateType:"NONE"},
   {columnName:"NAME",displayLabel:"顯示",displayOrder:1,isVisible:true,groupOrder:null,aggregateType:"NONE"}];
  return {actor:await identity(),query:{id:queryId,datasetId:queryId,name:queryId===1?"主層":"子層",code:`Q${queryId}`},
   dataset:{sqlText:queryId===1?"SELECT ID, NAME FROM t":"SELECT ID, NAME FROM t WHERE ID={{KEY}}",dataSourceId:9},reports,
   ...(state.managerApproved?{action:"EXECUTE",receipt:{approval:{columns:["ID","NAME"]},publicationStamp:state.definition,datasetDecisionId:`${queryId}:approved`}}:{snapshot:{policy:{state:"CONFIRMED",version:"1",rules:[{columnName:"ID",mode:state.masked?"FULL":"NONE"},{columnName:"NAME",mode:"CUSTOM",customMask:{prefix:1,suffix:0,symbol:"○"}}]}}}),
   fingerprint:`${queryId}:${token}:${state.definition}`,revalidate:async()=>{if(state.tokenVersion!==token||state.denied===queryId)throw Error("PRIVATE_REVOKED");}} as any;};
 let pinned:Record<string,string>|null=null;
 const deps={...hierarchyServiceDependencies,transactionDelivery:()=>({...hierarchyServiceDependencies.delivery,open}),now:()=>state.now,delivery:{...hierarchyServiceDependencies.delivery,open},
  store:{...hierarchyServiceDependencies.store,read:async(_root:number)=>({graph:structuredClone(state.graph),revision:state.revision,bindings:pinned??(pinned=await service.bindingEvidence(1,state.graph,identity))})},
  parameters:async(datasetId:number)=>datasetId===1?[]:[{name:"KEY",dataType:state.parameterType,controlType:state.parameterType==="NUMBER"?"NUMBER":"TEXT",isRequired:true}] as any,
  revision:async()=>`${state.definition}:${state.configuration}:${state.queryRevision}`,
  page:async(c:any,values:Record<string,unknown>,plan:any)=>{state.pages.push({queryId:c.query.id,values,plan});await state.hold?.();if(state.dbFail)throw Error("PRIVATE_SQL");state.afterPage?.();return {sourceWitness:"4:"+"f".repeat(64),result:{columns:[{name:"ID"},{name:"NAME"}],rows:[{ID:c.query.id===1?state.parentKey:values.KEY,NAME:"王○"}],rowCount:1,truncated:false,elapsedMs:1},
   pagination:{page:plan.page,pageSize:plan.pageSize,totalRows:4,totalPages:Math.ceil(4/plan.pageSize),capped:false},reportColumns:c.reports,disclosureId:91};},
  startAudit:async()=>{state.starts++;return 80;},finalizeDeliveryAudit:async(_id:number,_stats:unknown,validate:any)=>{await validate();if(state.auditFail)throw Error("PRIVATE_AUDIT");state.successes++;},completeAuditFailure:async()=>{state.failures++;},
 };
 const service=createQueryHierarchyService(deps);
 return {state,identity,service,deps,meta:{ipAddress:"127.0.0.1",userAgent:"synthetic"}};
}
