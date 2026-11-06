import { Router, type RequestHandler } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import { authenticateJwt } from "../auth/auth.middleware.js";
import { createRuntimeIdentityVerifier, QueryDeliveryError } from "../queryDefinition/queryDelivery.js";
import { getClientIp } from "../../utils/clientIp.js";
import { createDrilldownService } from "./dashboardDrilldown.service.js";
const id = z.coerce.number().int().positive().safe();
const ref = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const drilldownService = createDrilldownService();
export function createDrilldownRouter(service = drilldownService, authenticate: RequestHandler = authenticateJwt, identity = createRuntimeIdentityVerifier()) {
  const router = Router();
  router.use("/:id/interactive/v1", (_req,res,next) => { res.setHeader("Cache-Control","no-store"); next(); }, authenticate);
  for (const kind of ["CREATE","NAVIGATE","BACK","DELETE"] as const) {
    const path = "/:id/interactive/v1/contexts" + (kind === "CREATE" ? "" : "/:contextId" + (kind === "DELETE" ? "" : "/" + kind.toLowerCase()));
    router[kind === "DELETE" ? "delete" : "post"](path, async (req,res) => {
      try {
        const dashboard = id.parse(req.params.id);
        const token = req.headers.authorization;
        const actor = (tx?: import("mssql").Transaction) => identity(token, tx);
        await actor(); // Never accept device credentials, including on delete.
        const owner = createHash("sha256").update(token ?? "").digest("hex");
        const meta = {ipAddress:getClientIp(req),userAgent:req.get("user-agent") ?? null};
        if (kind === "CREATE") {
          const body = z.object({profileId:id}).strict().parse(req.body);
          res.json(await service.create(dashboard,body.profileId,owner,actor,meta));
        } else {
          const contextId = ref.parse(req.params.contextId);
          const body = (kind === "NAVIGATE" ? z.object({edge:z.string().min(1).max(64),rowRef:ref}).strict() : z.object({}).strict()).parse(req.body ?? {});
          res.json(await service.act(dashboard,contextId,owner,actor,{kind,...body},meta));
        }
      } catch (error) {
        const known = error instanceof QueryDeliveryError;
        res.status(known ? error.status : error instanceof z.ZodError ? 400 : 503).json({error:{code:known ? error.code : error instanceof z.ZodError ? "VALIDATION_ERROR" : "DRILL_DELIVERY_REJECTED",message:"互動查詢未完成，請重新確認授權與設定。"}});
      }
    });
  }
  return router;
}
/** Uses existing versioned Layout CAS; this middleware never writes anything. */
export const validateDrillLayout: RequestHandler = async (req,res,next) => {
  if (req.method !== "PUT") { next(); return; }
  try {
    if (!Array.isArray(req.body?.profiles)) { next(); return; }
    for (const profile of req.body.profiles) {
      if (profile?.config && Object.hasOwn(profile.config,"interactiveDrilldown"))
        await drilldownService.validate(profile.config.interactiveDrilldown, () => createRuntimeIdentityVerifier()(req.headers.authorization));
    }
    next();
  } catch(error) { res.status(error instanceof QueryDeliveryError ? error.status : 503).json({error:{code:error instanceof QueryDeliveryError ? error.code : "DRILL_GRAPH_REJECTED",message:"下鑽設定安全檢查未通過。"}}); }
};
