import type sql from "mssql";
import {executeSavedDatasetPage,type SavedPagePlan} from "../dataset/datasetPaging.service.js";
import {applyDatasetDeliveryPolicy} from "../dataset/datasetDeliveryPolicy.js";
import {auditDashboardPatientList} from "../audit/patientDisclosure.service.js";
import {createQueryDelivery,defaultQueryDeliveryDependencies,deliveryReportColumns,QueryDeliveryError} from "./queryDelivery.js";
import {createManagerApprovedQueryDelivery,defaultManagerApprovedQueryDependencies} from "./queryManagerApprovedDelivery.js";
import {DatasetDeliverySnapshotError} from "../dataset/datasetDeliveryPolicy.repository.js";
import {assertWholeResultShape,WholeResultApprovalError} from "../dataset/datasetWholeResultApproval.js";

type LegacyOpen=Awaited<ReturnType<ReturnType<typeof createQueryDelivery>["open"]>>;
type ManagerOpen=Awaited<ReturnType<ReturnType<typeof createManagerApprovedQueryDelivery>["open"]>>;
export type HierarchyOpen=LegacyOpen|ManagerOpen;

/** Each node independently requires its own current publication approval and
 * effective access. Never use an absent policy as an authorization receipt. */
export function createHierarchyApprovalDelivery(legacy=createQueryDelivery(),manager=createManagerApprovedQueryDelivery()){
 return {...legacy,async open(...args:Parameters<typeof legacy.open>):Promise<HierarchyOpen>{
  try{return await legacy.open(...args);}catch(error){
   if(!(error instanceof DatasetDeliverySnapshotError)||error.code!=="DATASET_DELIVERY_POLICY_UNCONFIRMED")throw error;
   return manager.open(...args);
  }
 }};
}
export const hierarchyPageDependencies={execute:executeSavedDatasetPage,auditPatient:auditDashboardPatientList};
export function createHierarchyPageDelivery(deps=hierarchyPageDependencies){return async(context:HierarchyOpen,values:Record<string,unknown>,plan:SavedPagePlan)=>{
 await context.revalidate();
 const raw=await deps.execute(context.query.datasetId,values,plan);await context.revalidate();
 if("receipt" in context){
  if(context.actor.pinSession||context.action!=="EXECUTE")throw new QueryDeliveryError("FORBIDDEN",403);
  try{assertWholeResultShape(context.receipt.approval,raw.result.columns,raw.result.rows);}
  catch(e){if(e instanceof WholeResultApprovalError)throw new QueryDeliveryError(e.code);throw e;}
  await context.revalidate();
  return {...raw,reportColumns:context.reports,disclosureId:null};
 }
 let disclosureId:number|null=null;
 if(context.snapshot.patientAudit.enabled){disclosureId=await deps.auditPatient({datasetId:context.query.datasetId,queryDefinitionId:context.query.id,userId:context.actor.userId,
  sourceScope:`datasource:${context.dataset.dataSourceId}`,deliveryType:"PAGE",pageNumber:plan.page,masked:true,rows:raw.result.rows});
  if(raw.result.rows.length&&(!Number.isSafeInteger(disclosureId)||!disclosureId||disclosureId<=0))throw new QueryDeliveryError("PATIENT_DISCLOSURE_REQUIRED",503);
 }
 await context.revalidate();
 const safe=applyDatasetDeliveryPolicy({policy:context.snapshot.policy,columns:raw.result.columns,rows:raw.result.rows});
 const result={...raw.result,columns:safe.columns,rows:safe.rows};
 return {result,pagination:raw.pagination,sourceWitness:raw.sourceWitness,reportColumns:deliveryReportColumns(context.snapshot.policy,context.reports,result),disclosureId};
};}

/** Metadata reads that acquire UPDLOCK (patient contract) MUST reuse the owner
 * transaction, including QueryDelivery.open's initial inspection. No nested pool. */
export function createHierarchyMetadataDelivery(tx:sql.Transaction,deps=defaultQueryDeliveryDependencies,managerDeps=defaultManagerApprovedQueryDependencies){
 const own=(provided?:sql.Transaction)=>{if(provided&&provided!==tx)throw new QueryDeliveryError("HIERARCHY_TRANSACTION_OWNER_MISMATCH",503);return tx;};
 const legacy=createQueryDelivery({...deps,
  access:(u,q,t)=>deps.access(u,q,own(t)),accessRevision:(q,t)=>deps.accessRevision(q,own(t)),
  snapshot:(d,v,t)=>deps.snapshot(d,v,own(t)),dataset:(d,t)=>deps.dataset(d,own(t)),
  patientState:(d,t)=>deps.patientState(d,own(t)),reports:(q,t)=>deps.reports(q,own(t)),pinPolicy:(d,t)=>deps.pinPolicy(d,own(t)),
 });
 const manager=createManagerApprovedQueryDelivery({...managerDeps,
  access:(u,q,t)=>managerDeps.access(u,q,own(t)),accessRevision:(q,t)=>managerDeps.accessRevision(q,own(t)),
  dataset:(d,t)=>managerDeps.dataset(d,own(t)),reports:(q,t)=>managerDeps.reports(q,own(t)),
  approval:(q,d,t)=>managerDeps.approval(q,d,own(t)),
 });
 return createHierarchyApprovalDelivery(legacy,manager);
}
