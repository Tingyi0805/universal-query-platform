// Issue #89: authenticated read-only CHART projection HTTP adapter.
// This is production-router wiring, NOT permission to activate CHART.
// A verified JWT actor, a server-owned sealed Widget, aggregate proof,
// Query disclosure audit, privacy review and revision fence are mandatory.
import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { readVerifiedJwtActor, requirePermission } from "../auth/auth.middleware.js";
import type { ExecutionSubject } from "./dashboardQuerySourceExecution.js";

// Independent, reviewed release approval must be committed explicitly.
// Neither an environment flag nor a browser request may change this constant.
// SQL Migration 928 / CHART writer are NOT approved as of this change.
export const CHART_PROJECTION_HTTP_RELEASE_APPROVED = false as const;

const positiveId = z.string().regex(/^[1-9][0-9]{0,14}$/)
  .transform(value => Number(value))
  .refine(value => Number.isSafeInteger(value) && value > 0);

const pointSchema = z.object({
  label: z.string().min(1).max(100),
  value: z.number().finite()
    .refine(n => Math.abs(n) <= 1_000_000_000_000 &&
      (!Number.isInteger(n) || Number.isSafeInteger(n))),
}).strict();
const projectionSchema = z.object({
  chartType: z.enum(["BAR", "LINE", "PIE"]),
  showLegend: z.boolean(),
  points: z.array(pointSchema).max(50),
}).strict().superRefine((value, ctx) => {
  const labels = new Set<string>();
  for (const point of value.points) {
    if (labels.has(point.label)) {
      ctx.addIssue({code:"custom", message:"CHART_DUPLICATE_CATEGORY"});
      break;
    }
    labels.add(point.label);
    if (value.chartType === "PIE" && point.value < 0) {
      ctx.addIssue({code:"custom", message:"CHART_PIE_NEGATIVE"});
      break;
    }
  }
  if (value.chartType === "PIE" && value.points.length > 0 &&
      !value.points.some(point => point.value > 0)) {
    ctx.addIssue({code:"custom", message:"CHART_PIE_EMPTY"});
  }
});

type Project = (dashboardId: number, widgetId: number,
  subject: ExecutionSubject) => Promise<unknown>;
export type ChartProjectionRouterDependencies = Readonly<{
  approved: () => boolean;
  project: Project;
}>;

// Mounted after authenticateJwt. Only an authenticated designer can enter.
// This route does NOT accept SQL, data rows, chart config, actor, policy flags,
// arbitrary Query parameters, or synthetic browser approvals.
export function createChartProjectionRouter(deps: ChartProjectionRouterDependencies) {
  const router = Router();
  router.post("/:id/charts/v1/:widgetId/projection",
    (req, res, next) => {
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.setHeader("Pragma", "no-cache");
      next();
    },
    async (req, res) => {
      // Production gate before parsing, SQL reads or any projector invocation.
      if (!deps.approved()) {
        res.status(404).json({error:{code:"CHART_NOT_AVAILABLE"}});
        return;
      }
      const actor = readVerifiedJwtActor(req);
      if (!actor || !req.authUser?.permissions.includes("EXECUTE_QUERY")) {
        res.status(403).json({error:{code:"FORBIDDEN"}});
        return;
      }
      const dashboardId = positiveId.safeParse(req.params.id);
      const widgetId = positiveId.safeParse(req.params.widgetId);
      const emptyBody = req.body === undefined ||
        (req.body !== null && typeof req.body === "object" &&
          !Array.isArray(req.body) && Object.keys(req.body).length === 0);
      if (!dashboardId.success || !widgetId.success ||
          Object.keys(req.query).length !== 0 || !emptyBody) {
        res.status(400).json({error:{code:"VALIDATION_ERROR"}});
        return;
      }
      try {
        const bearer = req.header("Authorization")?.slice(7) ?? "";
        const subject: ExecutionSubject = {
          context: "designer",
          userId: actor.userId,
          tokenVersion: actor.tokenVersion,
          tokenHash: createHash("sha256").update(bearer).digest("hex"),
        };
        // The coordinator must recheck current JWT/session, sealed Widget
        // revision, approved GROUP BY/COUNT proof, masking and disclosure audit.
        const projected = await deps.project(
          dashboardId.data, widgetId.data, subject);
        // Defence-in-depth: never forward any internal Query rows/metadata,
        // ConfigJson, audit receipt or patient identifiers from a bad provider.
        const validated = projectionSchema.safeParse(projected);
        if (!validated.success) throw Error("CHART_PROJECTION_INVALID");
        res.json(validated.data);
      } catch {
        // No raw rows, SQL errors, patient identifiers, SQL details or audits
        // in errors. There is deliberately no fallback to legacy preview.
        res.status(503).json({error:{code:"CHART_TRUSTED_DELIVERY_REQUIRED"}});
      }
    },
  );
  return router;
}
