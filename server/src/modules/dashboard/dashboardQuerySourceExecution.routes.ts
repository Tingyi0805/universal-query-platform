import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { Router } from "express";
import { z } from "zod";
import { requirePermission } from "../auth/auth.middleware.js";
import { QuerySourceError } from "./dashboardQuerySources.service.js";
import { failure } from "./dashboardQuerySources.routes.js";
import type { createQuerySourceExecution } from "./dashboardQuerySourceExecution.js";

export function createQuerySourceExecutionRouter(service: ReturnType<typeof createQuerySourceExecution>) {
  const router = Router();
  // Mounted after authenticateJwt. Decode only the already-verified token's version;
  // the execution service rechecks the current account version before/after delivery.
  router.post(["/:id/query-sources/v1/:sourceKey/page", "/:id/query-sources/v1/:sourceKey/preview"], (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); }, requirePermission("DESIGN_QUERY"), requirePermission("EXECUTE_QUERY"), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const id = z.coerce.number().int().positive().safe().safeParse(req.params.id);
      const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/).safeParse(req.params.sourceKey);
      const input = z.object({ page: z.number().int().min(1).max(100000), snapshotId: z.string().uuid().optional() }).strict().safeParse(req.body);
      if (!id.success || !key.success || !input.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
      const adminPreview = req.path.endsWith("/preview");
      if (adminPreview && (input.data.page !== 1 || input.data.snapshotId !== undefined)) throw new QuerySourceError("VALIDATION_ERROR", 400);
      const token = req.header("Authorization")?.slice(7) ?? "";
      const payload = jwt.decode(token);
      if (!payload || typeof payload === "string" || Number(payload.sub) !== req.authUser!.id || !Number.isSafeInteger(payload.tokenVersion) || adminPreview && !Number.isSafeInteger(payload.exp))
        throw new QuerySourceError("INVALID_TOKEN", 401);
      res.json(await service.page(id.data, key.data, { userId: req.authUser!.id, tokenVersion: Number(payload.tokenVersion),
        tokenHash: createHash("sha256").update(token).digest("hex"),
        ...(adminPreview ? { context: "admin-preview" as const, expiresAt: Number(payload.exp) } : {}) }, input.data));
    } catch (error) {
      const codes: Record<string, number> = { DASHBOARD_QUERY_BUSY: 429, DASHBOARD_QUERY_TIMEOUT: 504, DASHBOARD_SNAPSHOT_TOO_LARGE: 413 };
      const code = error instanceof Error ? error.message : "";
      const status = Object.hasOwn(codes, code) ? codes[code] : undefined;
      failure(error instanceof QuerySourceError ? error : new QuerySourceError(
        status !== undefined ? code : "QUERY_SOURCE_EXECUTION_FAILED", status ?? 503), res, req.id);
    }
  });
  return router;
}
