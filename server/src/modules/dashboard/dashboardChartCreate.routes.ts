// Issue #89: native CHART CREATE HTTP boundary. This only defines the
// transport contract; Option A's LOCAL JWT Writer is wired but its
// production release remains hard-disabled. A disabled request never touches SQL.
import { Router } from "express";
import { z } from "zod";
import {parseChartCreateSqlReceipt} from "./dashboardChartCreateReceipt.js";
import { readVerifiedChartExecuteActor } from "../auth/auth.middleware.js";
import {
  planVerifiedChartCreateRequest,
} from "./dashboardChartAuthenticatedCreate.js";
import type { DormantChartCreatePlan } from "./dashboardChartAtomicCreate.contract.js";

// Never sourced from .env, a browser parameter, request headers or a JWT.
// Option A uses the verified local JWT actor, not a separate Signer/Issuer.
// The production 928/Writer and public privacy release gates remain OFF.
export const CHART_CREATE_HTTP_RELEASE_APPROVED = false as const;

const positiveId = z.string().regex(/^[1-9][0-9]{0,14}$/)
  .transform(value => Number(value))
  .refine(value => Number.isSafeInteger(value) && value > 0);
export type ChartCreateRouterDependencies = Readonly<{
  approved: () => boolean;
  // Option A receives only the server-derived canonical plan, not the
  // original Bearer credential. The SQL procedure must revalidate live RBAC,
  // token version and replay atomically with Widget/Seal/Audit.
  create: (plan: DormantChartCreatePlan) => Promise<unknown>;
}>;

export function createChartCreateRouter(deps: ChartCreateRouterDependencies) {
  const router = Router();
  // Read-only UI discovery; NEVER an authorization for the subsequent POST.
  // In production the immutable create gate stays OFF and this endpoint
  // always returns canCreate=false without entering SQL Writer or Signer.
  router.get("/:id/charts/v1/capabilities", (req,res) => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    const id=positiveId.safeParse(req.params.id);
    if(!id.success || Object.keys(req.query).length!==0) {
      res.status(400).json({error:{code:"VALIDATION_ERROR"}});
      return;
    }
    res.json({canCreate: deps.approved()===true &&
      readVerifiedChartExecuteActor(req)!==null});
  });
  router.post("/:id/charts/v1",
    (req, res, next) => {
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.setHeader("Pragma", "no-cache");
      next();
    },
    async (req, res) => {
      // Gate first: no body, permission, signer or SQL processing when OFF.
      if (!deps.approved()) {
        res.status(404).json({ error: { code: "CHART_NOT_AVAILABLE" } });
        return;
      }
      const actor = readVerifiedChartExecuteActor(req);
      if (!actor) {
        res.status(403).json({ error: { code: "FORBIDDEN" } });
        return;
      }
      const id = positiveId.safeParse(req.params.id);
      if (!id.success || Object.keys(req.query).length !== 0) {
        res.status(400).json({ error: { code: "VALIDATION_ERROR" } });
        return;
      }
      // Strictly data-only body. Never accept client ActorId, TokenVersion,
      // permission flags, sealed WidgetId, SQL grant, SID or signer receipts.
      const plan = planVerifiedChartCreateRequest(req, id.data, req.body);
      if (!plan) {
        res.status(400).json({ error: { code: "VALIDATION_ERROR" } });
        return;
      }
      try {
        const receipt = parseChartCreateSqlReceipt(
          await deps.create(plan),plan);
        if (!receipt) throw Error("CHART_CREATE_RECEIPT_INVALID");
        // No ConfigJson, actor, SQL text, signatures, patient data, keys,
        // grant or internal approval claims are ever returned over HTTP.
        res.status(201).json(receipt);
      } catch {
        res.status(503).json({
          error: { code: "CHART_TRUSTED_CREATE_REQUIRED" },
        });
      }
    },
  );
  return router;
}
