/** PR #99: Dashboard-wide CHART playback control.
 * The ordinary Dashboard enable/disable and 919 approval/source revision are
 * the operator's playback decision: no second per-CHART approval workflow.
 * This is NOT a privacy review or a substitute for Query, Token/IP, masking,
 * public-display grants, small-cell/differencing controls or Audit.
 */
import {createHash} from "node:crypto";
import sql from "mssql";
import {getPlatformDbPool} from "../../config/database.js";
import {readDashboardApprovalEvidence} from "./dashboardApproval.repository.js";

export type DashboardChartPlaybackControl=Readonly<{
 dashboardId:number;approved:true;revision:string;
}>;
const revision=/^[a-f0-9]{64}$/;
export function validateDashboardChartPlaybackControl(
 result:unknown,dashboardId:number,
):result is DashboardChartPlaybackControl{
 if(!result||typeof result!=="object")return false;
 const r=result as Record<string,unknown>;
 return Number.isSafeInteger(dashboardId)&&dashboardId>0&&
   r.dashboardId===dashboardId&&r.approved===true&&
   typeof r.revision==="string"&&revision.test(r.revision)&&
   Object.keys(r).sort().join("|")==="approved|dashboardId|revision";
}
/** One SERIALIZABLE read captures dashboard activation and 919-backed
 * source/approval evidence in the same SQL transaction. Absent 919 fails closed.
 * It does not grant patients' summary values permission to be public.
 */
export async function readDashboardChartPlaybackControl(
 dashboardId:number,
 getPool:typeof getPlatformDbPool=getPlatformDbPool,
):Promise<DashboardChartPlaybackControl|null>{
 if(!Number.isSafeInteger(dashboardId)||dashboardId<=0)return null;
 let tx:sql.Transaction|undefined;
 try{
  const pool=await getPool();
  if(!pool)return null;
  tx=new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  const state=(await new sql.Request(tx)
   .input("dashboardId",sql.BigInt,dashboardId)
   .query("SELECT Id,IsActive,QueryMode,QueryModeVersion,ApprovalRowVersion "+
    "FROM uqp.Dashboard WITH(HOLDLOCK) WHERE Id=@dashboardId")).recordset;
  const r=state[0];
  if(state.length!==1||r.IsActive!==true||r.QueryMode!=="QUERY_ONLY"||
    !Number.isSafeInteger(r.QueryModeVersion)||r.QueryModeVersion<=0||
    !Buffer.isBuffer(r.ApprovalRowVersion)||r.ApprovalRowVersion.length!==8){
   await tx.commit();tx=undefined;return null;
  }
  const evidence=await readDashboardApprovalEvidence(
   dashboardId,()=>new sql.Request(tx!));
  if(!revision.test(evidence))throw Error("CHART_DASHBOARD_APPROVAL_REQUIRED");
  const digest=createHash("sha256").update(JSON.stringify({
   binding:"UQP_CHART_INHERITED_DASHBOARD_V1",
   dashboardId,approvalEvidence:evidence,
   dashboardRevision:r.ApprovalRowVersion.toString("hex"),
   queryMode:r.QueryMode,queryModeVersion:r.QueryModeVersion
  })).digest("hex");
  await tx.commit();tx=undefined;
  return {dashboardId,approved:true,revision:digest};
 }catch{
  if(tx)try{await tx.rollback();}catch{/* fail closed */}
  return null;
 }
}
