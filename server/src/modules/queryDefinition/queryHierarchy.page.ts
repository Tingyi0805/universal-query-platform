import type sql from "mssql";
import {executeSavedDatasetPage,type SavedPagePlan} from "../dataset/datasetPaging.service.js";
import {applyDatasetDeliveryPolicy} from "../dataset/datasetDeliveryPolicy.js";
import {auditDashboardPatientList} from "../audit/patientDisclosure.service.js";
import {createQueryDelivery,defaultQueryDeliveryDependencies,deliveryReportColumns,QueryDeliveryError} from "./queryDelivery.js";
export type HierarchyOpen=Awaited<ReturnType<ReturnType<typeof createQueryDelivery>["open"]>>;
export const hierarchyPageDependencies={execute:executeSavedDatasetPage,auditPatient:auditDashboardPatientList};
export function createHierarchyPageDelivery(deps=hierarchyPageDependencies){return async(context:HierarchyOpen,values:Record<string,unknown>,plan:SavedPagePlan)=>{
 const raw=await deps.execute(context.query.datasetId,values,plan);await context.revalidate();
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
export function createHierarchyMetadataDelivery(tx:sql.Transaction,deps=defaultQueryDeliveryDependencies){
 const own=(provided?:sql.Transaction)=>{if(provided&&provided!==tx)throw new QueryDeliveryError("HIERARCHY_TRANSACTION_OWNER_MISMATCH",503);return tx;};
 return createQueryDelivery({...deps,
  access:(u,q,t)=>deps.access(u,q,own(t)),accessRevision:(q,t)=>deps.accessRevision(q,own(t)),
  snapshot:(d,v,t)=>deps.snapshot(d,v,own(t)),dataset:(d,t)=>deps.dataset(d,own(t)),
  patientState:(d,t)=>deps.patientState(d,own(t)),reports:(q,t)=>deps.reports(q,own(t)),pinPolicy:(d,t)=>deps.pinPolicy(d,own(t)),
 });
}
