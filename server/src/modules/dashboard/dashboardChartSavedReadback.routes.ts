// Issue #89: designer-only persisted CHART readback by saved Widget ID.
// Never reads raw Query rows. This is NOT a create, signer or activation API.
import {Router} from "express";
import jwt from "jsonwebtoken";
import {z} from "zod";
import {env} from "../../config/env.js";
import {readVerifiedChartExecuteActor} from "../auth/auth.middleware.js";
import type {getTokenSessionState} from "../auth/auth.repository.js";
import type {TrustedSavedChartWidget} from "./dashboardChartDelivery.coordinator.js";
import {chartWidgetConfigSchema} from "./dashboardChartWidget.contract.js";

export const CHART_SAVED_READBACK_HTTP_RELEASE_APPROVED=false as const;
const positiveId=z.string().regex(/^[1-9][0-9]{0,14}$/)
  .transform(Number).refine(n=>Number.isSafeInteger(n)&&n>0);
export type ChartSavedReadbackDependencies=Readonly<{
  approved:()=>boolean;
  readSavedWidget:(dashboardId:number,widgetId:number)=>
    Promise<TrustedSavedChartWidget|null>;
  readSession:typeof getTokenSessionState;
}>;

export function createChartSavedReadbackRouter(deps:ChartSavedReadbackDependencies){
  const router=Router();
  router.get("/:id/charts/v1/:widgetId/readback",async(req,res)=>{
    res.setHeader("Cache-Control","no-store, max-age=0");
    res.setHeader("Pragma","no-cache");
    // No SQL access, metadata oracle or release check via an env switch.
    if(!deps.approved()){
      res.status(404).json({error:{code:"CHART_NOT_AVAILABLE"}});return;
    }
    const actor=readVerifiedChartExecuteActor(req);
    if(!actor){
      res.status(403).json({error:{code:"FORBIDDEN"}});return;
    }
    const dashboardId=positiveId.safeParse(req.params.id);
    const widgetId=positiveId.safeParse(req.params.widgetId);
    if(!dashboardId.success||!widgetId.success||
       Object.keys(req.query).length!==0){
      res.status(400).json({error:{code:"VALIDATION_ERROR"}});return;
    }
    try{
      // readSavedWidget validates DB-owned seal, Widget/Seal/Audit receipt,
      // strict ConfigJson digest and exact one-row Dashboard ownership.
      const saved=await deps.readSavedWidget(dashboardId.data,widgetId.data);
      if(!saved||saved.widgetType!=="CHART"||
         saved.id!==widgetId.data||saved.dashboardId!==dashboardId.data||
         !/^[a-f0-9]{16}$/.test(saved.revision))throw Error("NOT_ATTESTED");
      const parsed=chartWidgetConfigSchema.safeParse(saved.config);
      if(!parsed.success)throw Error("NOT_ATTESTED");
      // The request can be revoked while the SQL seal is read. Reconfirm
      // its original immutable authenticated caller, live DB permissions,
      // TokenVersion and JWT expiry before disclosing chart metadata.
      const session=await deps.readSession(actor.userId);
      if(!session?.isActive||session.tokenVersion!==actor.tokenVersion||
         !session.permissions.includes("DESIGN_QUERY")||
         !session.permissions.includes("EXECUTE_QUERY")||
         !env.JWT_SECRET)throw Error("SESSION_REVOKED");
      const claims=jwt.verify(actor.originalBearerHeader.slice(7),env.JWT_SECRET);
      if(typeof claims==="string"||
         !Number.isSafeInteger(claims.exp)||claims.exp!*1000<=Date.now()||
         Number(claims.sub)!==actor.userId||
         Number(claims.tokenVersion)!==actor.tokenVersion)
        throw Error("JWT_REVOKED");
      // Column names/config are disclosed only to this verified designer.
      // No SQL, patient row, private grant, actor, audit ID or seal digest.
      res.json({widgetId:saved.id,sealRevision:saved.revision,
        config:parsed.data});
    }catch{
      res.status(503).json({error:{code:"CHART_SAVED_READBACK_REQUIRED"}});
    }
  });
  return router;
}
