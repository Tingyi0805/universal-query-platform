// Issue #89: authenticated USER CHART projection distinct from designer
// and public-device transports. It requires a verified original JWT and
// live VIEW_QUERY + EXECUTE_QUERY, never DESIGN_QUERY or a device cookie.
// Production hard gate remains OFF; no 928 adoption or real public release.
import {createHash} from "node:crypto";
import jwt from "jsonwebtoken";
import {Router} from "express";
import {z} from "zod";
import {env} from "../../config/env.js";
import {readVerifiedChartPlaybackActor} from "../auth/auth.middleware.js";
import type {getTokenSessionState} from "../auth/auth.repository.js";
import type {ExecutionSubject} from "./dashboardQuerySourceExecution.js";
import {projectionSchema} from "./dashboardChartProjection.routes.js";

export const CHART_USER_PROJECTION_HTTP_RELEASE_APPROVED=false as const;
const positiveId=z.string().regex(/^[1-9][0-9]{0,14}$/)
  .transform(Number).refine(n=>Number.isSafeInteger(n)&&n>0);

export type ChartUserProjectionDependencies=Readonly<{
  approved:()=>boolean;
  readSession:typeof getTokenSessionState;
  project:(dashboardId:number,widgetId:number,subject:ExecutionSubject)=>Promise<unknown>;
}>;
export function createChartUserProjectionRouter(deps:ChartUserProjectionDependencies){
  const router=Router();
  router.post("/:id/playback/v1/charts/:widgetId/projection",async(req,res)=>{
    res.setHeader("Cache-Control","no-store, max-age=0");
    res.setHeader("Pragma","no-cache");
    // Hard release gate before any session or database query.
    if(!deps.approved()){
      res.status(404).json({error:{code:"CHART_NOT_AVAILABLE"}});return;
    }
    const actor=readVerifiedChartPlaybackActor(req);
    if(!actor){
      res.status(403).json({error:{code:"FORBIDDEN"}});return;
    }
    const dashboardId=positiveId.safeParse(req.params.id);
    const widgetId=positiveId.safeParse(req.params.widgetId);
    const empty=req.body===undefined||
      (req.body!==null&&typeof req.body==="object"&&
        !Array.isArray(req.body)&&Object.keys(req.body).length===0);
    if(!dashboardId.success||!widgetId.success||
       Object.keys(req.query).length!==0||!empty){
      res.status(400).json({error:{code:"VALIDATION_ERROR"}});return;
    }
    try{
      const bearer=actor.originalBearerHeader.slice(7);
      const subject:ExecutionSubject={
        context:"user",userId:actor.userId,
        tokenVersion:actor.tokenVersion,expiresAt:actor.expiresAt,
        tokenHash:createHash("sha256").update(bearer).digest("hex"),
      };
      // The coordinator performs Query-level RBAC/revision, audited delivery,
      // immutable Widget seal and independent grouped-count public privacy.
      const result=await deps.project(dashboardId.data,widgetId.data,subject);
      const validated=projectionSchema.safeParse(result);
      if(!validated.success)throw Error("CHART_USER_PROJECTION_INVALID");
      // A session or role may be revoked during a long patient disclosure
      // audit, after initial authentication and coordinator fences.
      const session=await deps.readSession(actor.userId);
      if(!session?.isActive||session.tokenVersion!==actor.tokenVersion||
         !session.permissions.includes("VIEW_QUERY")||
         !session.permissions.includes("EXECUTE_QUERY"))
        throw Error("CHART_USER_SESSION_REVOKED");
      // Revalidate the ORIGINAL, middleware-verified token (never a later
      // mutable Authorization header), including absolute expiry.
      if(!env.JWT_SECRET)throw Error("CHART_USER_JWT_REQUIRED");
      const claims=jwt.verify(bearer,env.JWT_SECRET);
      if(typeof claims==="string"||!Number.isSafeInteger(claims.exp)||
         claims.exp!==actor.expiresAt||
         claims.exp!*1000<=Date.now()||
         Number(claims.sub)!==actor.userId||
         Number(claims.tokenVersion)!==actor.tokenVersion)
        throw Error("CHART_USER_JWT_REVOKED");
      res.json(validated.data);
    }catch{
      res.status(503).json({error:{code:"CHART_TRUSTED_DELIVERY_REQUIRED"}});
    }
  });
  return router;
}
