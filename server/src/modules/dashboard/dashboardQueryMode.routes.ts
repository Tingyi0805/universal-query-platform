import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { requirePermission } from "../auth/auth.middleware.js";
import { QuerySourceError } from "./dashboardQuerySources.service.js";
import { failure } from "./dashboardQuerySources.routes.js";
import type { createQueryModeService } from "./dashboardQueryMode.service.js";

export function createQueryModeRouter(service: ReturnType<typeof createQueryModeService>) {
  const router = Router(), idSchema = z.coerce.number().int().positive().safe();
  router.use("/:id/query-mode/v1", requirePermission("DESIGN_QUERY"));
  router.use("/:id/query-mode/v1", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  const context = (req: import("express").Request) => {
    const id = idSchema.safeParse(req.params.id), payload = jwt.decode(req.header("Authorization")?.slice(7) ?? "");
    if (!id.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
    if (!payload || typeof payload === "string" || Number(payload.sub) !== req.authUser!.id || !Number.isSafeInteger(payload.tokenVersion)) throw new QuerySourceError("INVALID_TOKEN", 401);
    return { id: id.data, user: req.authUser!.id, version: Number(payload.tokenVersion) };
  };
  router.get("/:id/query-mode/v1", async (req, res) => {
    try { const c = context(req); res.json(await service.read(c.id, c.user, c.version)); }
    catch (error) { failure(error, res, req.id); }
  });
  router.post("/:id/query-mode/v1", async (req, res) => {
    try {
      const c = context(req), body = z.object({ expectedVersion: z.string().regex(/^[a-f0-9]{64}$/), activate: z.boolean() }).strict().safeParse(req.body);
      if (!body.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
      res.json(await service.change(c.id, c.user, c.version, body.data.expectedVersion, body.data.activate));
    } catch (error) { failure(error, res, req.id); }
  });
  router.post("/:id/query-mode/v1/devices/:deviceId/credential", async (req, res) => {
    try {
      const c = context(req), device = idSchema.safeParse(req.params.deviceId);
      const body = z.object({ expectedVersion: z.string().regex(/^[a-f0-9]{64}$/) }).strict().safeParse(req.body);
      if (!body.success || !device.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
      res.json(await service.issue(c.id, device.data, c.user, c.version, body.data.expectedVersion));
    } catch (error) { failure(error, res, req.id); }
  });
  return router;
}
