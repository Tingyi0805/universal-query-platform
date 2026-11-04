// 2B-15C: identity binding for a future dedicated CHART write route.
// IMPORTANT: no route uses this module yet; no SQL execution or permission
// grant occurs. Body is a strict data-only draft, not an actor certificate.
import type {Request} from "express";
import sql from "mssql";
import {readVerifiedJwtActor} from "../auth/auth.middleware.js";
import {getTokenSessionState} from "../auth/auth.repository.js";
import {
  planDormantChartCreate,type DormantChartCreatePlan,
} from "./dashboardChartAtomicCreate.contract.js";

export function planVerifiedChartCreateRequest(
 req:Request,dashboardId:number,raw:unknown,
):DormantChartCreatePlan|null {
 const actor=readVerifiedJwtActor(req);
 if(!actor||!Number.isSafeInteger(dashboardId)||dashboardId<=0||
    !raw||typeof raw!=="object"||Array.isArray(raw))return null;
 const body=raw as Record<string,unknown>;
 // Reject even harmless-looking actor, jwt, user, device and approved keys.
 if(Object.keys(body).sort().join("|")!==
    "config|placement|profileId|requestId")return null;
 return planDormantChartCreate({
   dashboardId,actorId:actor.userId,tokenVersion:actor.tokenVersion,
   profileId:body.profileId,requestId:body.requestId,
   config:body.config,placement:body.placement,
 });
}

/** Must run in the SAME SERIALIZABLE transaction as trusted Writer's DML;
 * this is a second check after JWT middleware to catch revocations,
 * TokenVersion updates and RBAC removals in the time between requests.
 * The SQL Server login/proc boundary must be verified separately.
 */
export async function recheckChartActorInTransaction(
 tx:sql.Transaction, plan:DormantChartCreatePlan,
 loadSession:typeof getTokenSessionState=getTokenSessionState,
):Promise<boolean> {
 if(!Number.isSafeInteger(plan?.actorId)||plan.actorId<=0||
    !Number.isSafeInteger(plan?.tokenVersion)||plan.tokenVersion<1)return false;
 try{
   const live=await loadSession(plan.actorId,tx);
   return !!live&&live.isActive===true&&
     live.tokenVersion===plan.tokenVersion&&
     live.permissions.includes("DESIGN_QUERY");
 }catch{return false;}
}
