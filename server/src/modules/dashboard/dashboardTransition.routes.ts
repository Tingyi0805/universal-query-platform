import { Router, type Request } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { requirePermission } from "../auth/auth.middleware.js";
import { deleteDashboard } from "./dashboard.repository.js";
import { dashboardSecurityFailure } from "./dashboardSecurityFailure.js";
import { QuerySourceError } from "./dashboardQuerySources.service.js";
import { failure } from "./dashboardQuerySources.routes.js";
import type { createDashboardTransitionService } from "./dashboardTransition.service.js";

export function createDashboardTransitionRouter(service: ReturnType<typeof createDashboardTransitionService>) {
  const router = Router();
  const id = z.coerce.number().int().positive().safe();
  const version = z.string().length(64).regex(/^[a-f0-9]{64}$/);
  const confirmation = z.object({ expectedVersion: version, confirmed: z.literal(true) }).strict();
  const context = (req: Request) => {
    const parsed = id.safeParse(req.params.id), token = jwt.decode(req.header("Authorization")?.slice(7) ?? "");
    if (!parsed.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
    if (!token || typeof token === "string" || Number(token.sub) !== req.authUser?.id || !Number.isSafeInteger(token.tokenVersion))
      throw new QuerySourceError("INVALID_TOKEN", 401);
    return { id: parsed.data, actor: { userId: req.authUser!.id, tokenVersion: Number(token.tokenVersion) } };
  };
  const boundary = (work: (req: Request) => Promise<unknown>): import("express").RequestHandler => async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try { res.json(await work(req)); }
    catch (error) {
      const safe = dashboardSecurityFailure(error);
      failure(safe ? new QuerySourceError(safe.code, safe.status) : error, res, req.id);
    }
  };
  // Mounted after the existing authenticateJwt middleware; no capability gate can
  // prevent a designer from safely stopping Legacy playback or rejecting deletion.
  const permission = requirePermission("DESIGN_QUERY");
  const disable = "/:id/legacy-disable/v1";
  router.get(disable, permission, boundary(req => { const c = context(req); return service.readDisable(c.id, c.actor); }));
  router.post(disable, permission, boundary(req => {
    const c = context(req), body = confirmation.safeParse(req.body);
    if (!body.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
    return service.disable(c.id, c.actor, body.data);
  }));
  const pending = "/:id/query-sources/v1/:sourceKey/pending-approvals";
  const key = (req: Request) => {
    const value = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/).safeParse(req.params.sourceKey);
    if (!value.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
    return value.data;
  };
  router.get(pending, permission, boundary(req => { const c = context(req); return service.readPending(c.id, key(req), c.actor); }));
  router.post(pending, permission, boundary(req => {
    const c = context(req), body = confirmation.extend({ sourceId: z.number().int().positive().safe() }).strict().safeParse(req.body);
    if (!body.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
    return service.revokePending(c.id, key(req), c.actor, body.data);
  }));
  router.delete("/:id", permission, boundary(req => deleteDashboard(context(req).id)));
  return router;
}
