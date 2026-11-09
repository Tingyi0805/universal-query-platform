// Issue #89: native CHART CREATE HTTP boundary. This only defines the
// transport contract; the production SQL Issuer, Writer and 928 adoption are
// NOT approved or wired. A disabled request must never touch a database.
import { Router } from "express";
import { z } from "zod";
import { readVerifiedChartExecuteActor } from "../auth/auth.middleware.js";
import {
  planVerifiedChartCreateRequest,
} from "./dashboardChartAuthenticatedCreate.js";
import type { DormantChartCreatePlan } from "./dashboardChartAtomicCreate.contract.js";

// Never sourced from .env, a browser parameter, request headers or a JWT.
// No release is possible until independent Signer + Issuer + Writer + 928
// and public privacy controls are separately approved.
export const CHART_CREATE_HTTP_RELEASE_APPROVED = false as const;

const positiveId = z.string().regex(/^[1-9][0-9]{0,14}$/)
  .transform(value => Number(value))
  .refine(value => Number.isSafeInteger(value) && value > 0);
const receiptSchema = z.object({
  widgetId: z.number().int().positive().safe(),
  sealRevision: z.string().regex(/^[a-f0-9]{16}$/),
  auditLogId: z.string().regex(/^[1-9][0-9]{0,19}$/),
}).strict();

export type ChartCreateRouterDependencies = Readonly<{
  approved: () => boolean;
  // This dependency MUST in the future execute only the independently
  // approved, SQL-owned, SERIALIZABLE grant-consumption + Widget/Seal/Audit
  // stored procedure, after independent Signer/Issuer preflight. The
  // production application currently injects a function that always throws.
  // A future independently authenticated mTLS signer MUST reverify this
  // exact original JWT. Never use req.headers or a browser-provided actor.
  create: (plan: DormantChartCreatePlan, originalBearerHeader:string) => Promise<unknown>;
}>;

export function createChartCreateRouter(deps: ChartCreateRouterDependencies) {
  const router = Router();
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
        const receipt = receiptSchema.safeParse(
          await deps.create(plan,actor.originalBearerHeader));
        if (!receipt.success) throw Error("CHART_CREATE_RECEIPT_INVALID");
        // No ConfigJson, actor, SQL text, signatures, patient data, keys,
        // grant or internal approval claims are ever returned over HTTP.
        res.status(201).json(receipt.data);
      } catch {
        res.status(503).json({
          error: { code: "CHART_TRUSTED_CREATE_REQUIRED" },
        });
      }
    },
  );
  return router;
}
