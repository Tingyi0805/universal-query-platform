import {createHash,randomBytes} from "node:crypto";
import type sql from "mssql";
import {deliveryReportColumns,QueryDeliveryError} from "./queryDelivery.js";
import {listDatasetParameters} from "../dataset/parameter.repository.js";
import {runtimeParameterDefinitions} from "../dataset/parameterSync.js";
import {typedDrillValue} from "../dashboard/dashboardDrilldown.schema.js";
import {startAudit,completeAuditFailure} from "../audit/audit.repository.js";
import {finalizeDeliveryAudit} from "../audit/deliveryAudit.repository.js";
import {parseHierarchyGraph,hierarchyPageSchema,type HierarchyGraph,type HierarchyPage} from "./queryHierarchy.contract.js";
import {queryHierarchyRepository,readHierarchyQueryRevision,type HierarchyIdentity} from "./queryHierarchy.repository.js";
import {createHierarchyApprovalDelivery,createHierarchyPageDelivery,createHierarchyMetadataDelivery,type HierarchyOpen} from "./queryHierarchy.page.js";
const hash=(x:unknown)=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
const opaque=()=>randomBytes(32).toString("base64url");
export const hierarchyServiceDependencies={delivery:createHierarchyApprovalDelivery(),transactionDelivery:createHierarchyMetadataDelivery,parameters:listDatasetParameters,revision:readHierarchyQueryRevision,
 store:queryHierarchyRepository,page:createHierarchyPageDelivery(),startAudit,finalizeDeliveryAudit,completeAuditFailure,now:Date.now};
type Frame={node:string;values:Record<string,unknown>;controls:HierarchyPage;witness?:{controls:string;source:string}};
type Context={root:number;owner:string;savedRevision:string;graph:HierarchyGraph;expires:number;stack:Frame[];rows:Map<string,Record<string,unknown>>;
 bindings:Record<string,string>;evidence:Map<string,string>;busy:boolean;bytes:number};
type Meta={ipAddress:string|null;userAgent:string|null};
export function hierarchyVisibleColumns(c:HierarchyOpen){
 const reports=("receipt" in c?c.reports:deliveryReportColumns(c.snapshot.policy,c.reports)).filter(r=>r.isVisible).sort((a,b)=>a.displayOrder-b.displayOrder);
 if(!reports.length||reports.some(r=>r.groupOrder!==null||r.aggregateType!=="NONE"))throw new QueryDeliveryError("HIERARCHY_REPORT_REQUIRES_FLAT_COLUMNS");
 return reports.map((r,i)=>({...r,key:`c${i}`,canFilter:"receipt" in c?c.receipt.approval.columns.includes(r.columnName):c.snapshot.policy.rules.some(p=>p.columnName===r.columnName&&p.mode==="NONE")}));
}
export function createQueryHierarchyService(deps=hierarchyServiceDependencies){
 const contexts=new Map<string,Context>();const sweep=()=>{for(const [id,c] of contexts)if(c.expires<=deps.now())contexts.delete(id);};
 const timer=setInterval(sweep,10000);timer.unref();
 const requireIdentity=async(identity:HierarchyIdentity,tx?:sql.Transaction)=>{const a=await identity(tx);if(a.pinSession)throw new QueryDeliveryError("PIN_HIERARCHY_NOT_VERIFIED",403);return a;};
 async function inspect(node:HierarchyGraph["nodes"][number],graph:HierarchyGraph,identity:HierarchyIdentity,tx?:sql.Transaction){
  await requireIdentity(identity,tx);
  const c=await (tx?deps.transactionDelivery(tx):deps.delivery).open(node.queryId,"EXECUTE",()=>requireIdentity(identity,tx));await c.revalidate(tx);
  const columns=hierarchyVisibleColumns(c),clear=new Set(columns.filter(r=>r.canFilter).map(r=>r.columnName));
  for(const field of [...node.orderBy,...graph.edges.filter(e=>e.from===node.id).flatMap(e=>[...e.bindings.map(b=>b.field),...(e.column?[e.column]:[])])])
   if(!clear.has(field))throw new QueryDeliveryError("HIERARCHY_MASKED_OR_HIDDEN_KEY",403);
  const parameters=runtimeParameterDefinitions(c.dataset.sqlText,await deps.parameters(c.query.datasetId,tx));
  const revision=await deps.revision(node.queryId,tx);
  return {c,columns,parameters,binding:hash([node.queryId,c.query.datasetId,revision,parameters,"receipt" in c?c.receipt:c.snapshot,c.reports]),evidence:hash([c.fingerprint,revision,parameters])};
 }
 async function inspectGraph(root:number,input:unknown,identity:HierarchyIdentity,tx?:sql.Transaction){
  const graph=parseHierarchyGraph(input);if(graph.nodes.find(n=>n.id===graph.root)!.queryId!==root)throw new QueryDeliveryError("HIERARCHY_ROOT_MISMATCH",400);
  const states=new Map<string,Awaited<ReturnType<typeof inspect>>>();
  for(const n of graph.nodes)states.set(n.id,await inspect(n,graph,identity,tx));
  for(const e of graph.edges){const definitions=states.get(e.to)!.parameters;
   if(definitions.some(p=>!e.bindings.some(b=>b.parameter===p.name))||e.bindings.some(b=>!definitions.some(p=>p.name===b.parameter&&p.dataType===b.type&&p.controlType!=="MULTISELECT")))
    throw new QueryDeliveryError("HIERARCHY_PARAMETER_MAPPING_INVALID",400);
  }
  return {graph,states};
 }
 async function validate(root:number,input:unknown,identity:HierarchyIdentity,tx?:sql.Transaction){return (await inspectGraph(root,input,identity,tx)).graph;}
 async function bindingEvidence(root:number,input:unknown,identity:HierarchyIdentity,tx?:sql.Transaction){const x=await inspectGraph(root,input,identity,tx);return Object.fromEntries([...x.states].map(([id,state])=>[id,state.binding]));}
 async function check(id:string,c:Context,identity:HierarchyIdentity,tx?:sql.Transaction){
  sweep();if(contexts.get(id)!==c||c.expires<=deps.now())throw new QueryDeliveryError("HIERARCHY_CONTEXT_EXPIRED",410);
  await requireIdentity(identity,tx);const saved=await deps.store.read(c.root);
  if(!saved||saved.revision!==c.savedRevision||hash(saved.graph)!==hash(c.graph))throw new QueryDeliveryError("HIERARCHY_CONFIGURATION_CHANGED");
  const states=new Map<string,Awaited<ReturnType<typeof inspect>>>();
  for(const f of c.stack){const n=c.graph.nodes.find(n=>n.id===f.node)!;const state=await inspect(n,c.graph,identity,tx);
   if(c.bindings[n.id]!==state.binding||c.evidence.get(n.id)!==state.evidence)throw new QueryDeliveryError("HIERARCHY_AUTHORIZATION_CHANGED",403);states.set(n.id,state);}
  return states;
 }
 async function deliver(id:string,c:Context,stack:Frame[],identity:HierarchyIdentity,meta:Meta){
  let audit:number|null=null;const started=deps.now();
  try{
   const checked=await check(id,c,identity);const frame=stack.at(-1)!,node=c.graph.nodes.find(n=>n.id===frame.node)!;
   const state=await inspect(node,c.graph,identity);
   if(c.bindings[node.id]!==state.binding||c.evidence.has(node.id)&&c.evidence.get(node.id)!==state.evidence)throw new QueryDeliveryError("HIERARCHY_AUTHORIZATION_CHANGED",403);
   if(stack.length>1){const edge=c.graph.edges.find(e=>e.from===stack.at(-2)!.node&&e.to===node.id);
    if(!edge||state.parameters.some(p=>!Object.hasOwn(frame.values,p.name))||Object.keys(frame.values).some(k=>!state.parameters.some(p=>p.name===k)))throw new QueryDeliveryError("HIERARCHY_PARAMETER_MAPPING_INVALID",400);}
   c.evidence.set(node.id,state.evidence);
   const select=(key:string)=>{const column=state.columns.find(r=>r.key===key&&r.canFilter);if(!column)throw new QueryDeliveryError("HIERARCHY_COLUMN_KEY_INVALID",400);return column.columnName;};
   const search=frame.controls.search?{column:select(frame.controls.search.column),text:frame.controls.search.text}:null;
   const sort=frame.controls.sort?{column:select(frame.controls.sort.column),direction:frame.controls.sort.direction}:null;
   audit=await deps.startAudit({eventType:"QUERY_EXECUTE",userId:state.c.actor.userId,queryDefinitionId:state.c.query.id,datasetId:state.c.query.datasetId,parameters:null,...meta});
   if(!audit||!Number.isSafeInteger(audit)||audit<=0)throw new QueryDeliveryError("QUERY_AUDIT_REQUIRED",503);
   const controlKey=hash([search,sort]),expectedWitness=frame.witness?.controls===controlKey?frame.witness.source:undefined;
   const output=await deps.page(state.c,frame.values,{...frame.controls,pageSize:node.pageSize,orderBy:node.orderBy,search,sort,expectedWitness});
   if(typeof output.sourceWitness!=="string"||!/^(0|[1-9][0-9]*):[a-f0-9]{64}$/.test(output.sourceWitness))throw new QueryDeliveryError("HIERARCHY_PAGING_WITNESS_REQUIRED",503);
   if(expectedWitness&&expectedWitness!==output.sourceWitness)throw new QueryDeliveryError("HIERARCHY_SOURCE_PAGE_CHANGED");
   stack=stack.map((f,i)=>i===stack.length-1?{...f,witness:{controls:controlKey,source:output.sourceWitness!}}:f);
   const visible=new Set(state.columns.map(r=>r.columnName));
   const result={...output.result,columns:output.result.columns.filter(col=>visible.has(col.name)),rows:output.result.rows.map(row=>Object.fromEntries(Object.entries(row).filter(([k])=>visible.has(k))))};
   const refs=new Map<string,Record<string,unknown>>(),fields=new Set(c.graph.edges.filter(e=>e.from===node.id).flatMap(e=>e.bindings.map(b=>b.field)));
   const rowRefs=result.rows.map(row=>{const ref=opaque(),values:Record<string,unknown>=Object.create(null);for(const f of fields){if(!Object.hasOwn(row,f))throw new QueryDeliveryError("HIERARCHY_FIELD_MISSING");values[f]=row[f];}refs.set(ref,values);return ref;});
   const bytes=Buffer.byteLength(JSON.stringify([stack,[...refs]]));
   if(bytes>2000000||[...contexts.values()].reduce((n,v)=>n+v.bytes,bytes)>20000000)throw new QueryDeliveryError("HIERARCHY_CAPACITY",503);
   const final=async(tx?:sql.Transaction)=>{
    await check(id,c,identity,tx);const now=await inspect(node,c.graph,identity,tx);
    if(now.binding!==c.bindings[node.id]||now.evidence!==state.evidence)throw new QueryDeliveryError("HIERARCHY_AUTHORIZATION_CHANGED",403);
    await state.c.revalidate(tx);
   };
   await deps.finalizeDeliveryAudit(audit,{rowCount:result.rows.length,durationMs:deps.now()-started},final);await final();
   c.stack=stack;c.rows=refs;c.bytes=bytes;
   return {contextId:id,expiresAtUtc:new Date(c.expires).toISOString(),depth:stack.length,trail:stack.map(f=>f.node===node.id?state.c.query.name:checked.get(f.node)!.c.query.name),
    controls:frame.controls,query:{name:state.c.query.name,code:state.c.query.code},layout:node.layout,result,pagination:output.pagination,columns:state.columns.map(r=>({key:r.key,name:r.columnName,label:r.displayLabel,canFilter:r.canFilter,alignment:r.alignment})),rowRefs,
    actions:c.graph.edges.filter(e=>e.from===node.id).map(e=>({id:e.id,label:e.label,trigger:e.trigger,display:e.display,columnKey:e.column?state.columns.find(r=>r.columnName===e.column)!.key:null})),disclosureId:output.disclosureId};
  }catch(e){contexts.delete(id);if(audit)await deps.completeAuditFailure(audit,{errorCode:"HIERARCHY_DELIVERY_REJECTED"}).catch(()=>undefined);throw e;}
 }
 return {validate,bindingEvidence,async options(queryId:number,identity:HierarchyIdentity){
  const c=await deps.delivery.open(queryId,"EXECUTE",()=>requireIdentity(identity));const columns=hierarchyVisibleColumns(c);
  const parameters=runtimeParameterDefinitions(c.dataset.sqlText,await deps.parameters(c.query.datasetId));await c.revalidate();
  return {columns:columns.map(r=>({name:r.columnName,label:r.displayLabel,canBind:r.canFilter})),parameters:parameters.map(p=>({name:p.name,dataType:p.dataType,controlType:p.controlType}))};
 },async create(root:number,owner:string,values:Record<string,unknown>,identity:HierarchyIdentity,meta:Meta){
  sweep();await requireIdentity(identity);if(contexts.size>=100)throw new QueryDeliveryError("HIERARCHY_CAPACITY",503);
  const saved=await deps.store.read(root);if(!saved)throw new QueryDeliveryError("HIERARCHY_NOT_CONFIGURED",404);
  const g=parseHierarchyGraph(saved.graph);if(g.nodes.find(n=>n.id===g.root)!.queryId!==root)throw new QueryDeliveryError("HIERARCHY_ROOT_MISMATCH",400);
  const state=await inspect(g.nodes.find(n=>n.id===g.root)!,g,identity);
  if(saved.bindings[g.root]!==state.binding)throw new QueryDeliveryError("HIERARCHY_SAVED_BINDING_STALE");
  if(Object.keys(values).some(k=>!state.parameters.some(p=>p.name===k)))throw new QueryDeliveryError("HIERARCHY_PARAMETERS_INVALID",400);
  if(contexts.size>=100)throw new QueryDeliveryError("HIERARCHY_CAPACITY",503);
  const id=opaque(),c:Context={root,owner,savedRevision:saved.revision,graph:g,expires:deps.now()+120000,stack:[],rows:new Map(),bindings:saved.bindings,evidence:new Map([[g.root,state.evidence]]),busy:true,bytes:0};
  contexts.set(id,c);try{return await deliver(id,c,[{node:g.root,values,controls:hierarchyPageSchema.parse({})}],identity,meta);}finally{c.busy=false;}
 },async act(root:number,id:string,owner:string,identity:HierarchyIdentity,action:{kind:"PAGE"|"NAVIGATE"|"BACK"|"DELETE";edge?:string;rowRef?:string;controls?:HierarchyPage},meta:Meta){
  sweep();const c=contexts.get(id);if(!c||c.root!==root||c.owner!==owner)throw new QueryDeliveryError("HIERARCHY_CONTEXT_NOT_FOUND",404);
  await requireIdentity(identity);
  if(action.kind==="DELETE"){contexts.delete(id);return {status:"OK"};}
  if(c.busy)throw new QueryDeliveryError("HIERARCHY_CONTEXT_BUSY");c.busy=true;
  try{await check(id,c,identity);const stack=c.stack.map(f=>({...f}));
   if(action.kind==="BACK"){if(stack.length<2)throw new QueryDeliveryError("HIERARCHY_NO_PARENT",400);stack.pop();}
   else if(action.kind==="PAGE")stack[stack.length-1]={...stack.at(-1)!,controls:hierarchyPageSchema.parse(action.controls)};
   else{const edge=c.graph.edges.find(e=>e.id===action.edge&&e.from===stack.at(-1)!.node),row=c.rows.get(action.rowRef??"");
    if(!edge||!row)throw new QueryDeliveryError("HIERARCHY_ROW_REFERENCE_INVALID",403);
    const values:Record<string,unknown>=Object.create(null);for(const b of edge.bindings){const v=typedDrillValue(row[b.field],b.type);if(typeof v==="number"&&!Number.isSafeInteger(v))throw new QueryDeliveryError("HIERARCHY_BINDING_PRECISION",400);values[b.parameter]=v;}
    stack.push({node:edge.to,values,controls:hierarchyPageSchema.parse({})});}
   return await deliver(id,c,stack,identity,meta);
  }catch(e){contexts.delete(id);throw e;}finally{c.busy=false;}
 }};
}
export const queryHierarchyService=createQueryHierarchyService();
