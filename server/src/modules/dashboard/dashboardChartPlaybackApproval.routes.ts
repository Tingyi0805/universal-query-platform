// Gate 3: authenticated administrator decision API. Dormant by default.
// No client-supplied actor, digest, revision or audit receipt is trusted.
import { Router } from "express";
import { z } from "zod";
import { readVerifiedChartAdminActor } from "../auth/auth.middleware.js";
import { decideChartPlaybackApproval } from "./dashboardChartPlaybackApproval.service.js";

export const CHART_PLAYBACK_APPROVAL_HTTP_RELEASE_APPROVED = false as const;
const id = z.string().regex(/^[1-9][0-9]{0,14}$/).transform(Number)
  .refine(n => Number.isSafeInteger(n) && n > 0);
const decision = z.object({ action: z.enum(["APPROVE", "REVOKE"]) }).strict();
export function createChartPlaybackApprovalRouter(deps: {
  enabled: () => boolean;
  decide: typeof decideChartPlaybackApproval;
}) {
  const router = Router();
  router.post("/:id/charts/v1/:widgetId/playback-approval", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    if (!deps.enabled()) {
      res.status(404).json({error:{code:"CHART_NOT_AVAILABLE"}}); return;
    }
    const actor = readVerifiedChartAdminActor(req);
    if (!actor) {
      res.status(403).json({error:{code:"FORBIDDEN"}}); return;
    }
    const dashboard = id.safeParse(req.params.id);
    const widget = id.safeParse(req.params.widgetId);
    const body = decision.safeParse(req.body);
    if (!dashboard.success || !widget.success || !body.success ||
        Object.keys(req.query).length !== 0) {
      res.status(400).json({error:{code:"VALIDATION_ERROR"}}); return;
    }
    try {
      const success = await deps.decide({
        dashboardId: dashboard.data, widgetId: widget.data,
        actorUserId: actor.userId, tokenVersion: actor.tokenVersion,
        action: body.data.action,
      });
      if (!success) {
        res.status(403).json({error:{code:"CHART_APPROVAL_DENIED"}}); return;
      }
      res.status(200).json({status:body.data.action === "APPROVE" ? "APPROVED" : "REVOKED"});
    } catch {
      res.status(503).json({error:{code:"CHART_APPROVAL_UNAVAILABLE"}});
    }
  });
  return router;
}
