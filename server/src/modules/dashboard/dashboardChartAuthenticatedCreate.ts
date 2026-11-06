// 2B-15C: identity binding for a future dedicated CHART write route.
// IMPORTANT: no route uses this module yet; no SQL execution or permission
// grant occurs. Body is a strict data-only draft, not an actor certificate.
import type {Request} from "express";
import sql from "mssql";
import {readVerifiedJwtActor} from "../auth/auth.middleware.js";
import {getTokenSessionState} from "../auth/auth.repository.js";
import {
  attestChartWriterSqlPools,CHART_WRITER_DB_ACTOR_BINDING_APPROVED,
} from "./dashboardChartWriterBoundary.js";
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

/** Only sufficient when the approved Writer and this check use the SAME
 * SERIALIZABLE SQL transaction. The isolated SQL procedure prototype owns
 * its own transaction and refuses an outer one: a separate Node-side check
 * can never substitute for a DB-owned Actor/TokenVersion/RBAC recheck within
 * that procedure's Widget/Seal/Audit transaction.
 * This helper is dormant and is not wired to any HTTP route.
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


/** FUTURE API preflight, NOT an authorization to write. Both a verified JWT
 * actor and two distinct low-rights SQL login identities are mandatory.
 * No route is registered; this function never executes a mutation.
 * The final stored procedure must independently recheck actor and RBAC inside
 * its own SERIALIZABLE transaction, not trust this time-of-check.
 */
export async function prepareDormantChartWriteRequest(
 req:Request,dashboardId:number,raw:unknown,
 platformPool:sql.ConnectionPool,chartWriterPool:sql.ConnectionPool,
):Promise<DormantChartCreatePlan|null> {
 // Independent of JWT and SQL login checks: the SQL procedure must have
 // approved same-transaction caller-to-ActorId binding. Never treat the
 // disposable prototype's @ActorId input as that proof.
 if(!CHART_WRITER_DB_ACTOR_BINDING_APPROVED)return null;
 const plan=planVerifiedChartCreateRequest(req,dashboardId,raw);
 if(!plan)return null;
 try{
   await attestChartWriterSqlPools(platformPool,chartWriterPool);
   return plan;
 }catch{return null;}
}
