import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { requirePermission } from "../auth/auth.middleware.js";
import { auditRequestContext } from "../audit/auditContext.js";
import { deviceExpectedVersion, deviceMetadataSchema, devicePlacementSchema } from "./dashboardDeviceManagement.schema.js";
import { QuerySourceError } from "./dashboardQuerySources.service.js";
import { failure } from "./dashboardQuerySources.routes.js";
import type { createDeviceManagementService } from "./dashboardDeviceManagement.service.js";

export function createDeviceManagementRouter(service: ReturnType<typeof createDeviceManagementService>) {
  const router = Router(), idSchema = z.coerce.number().int().positive().safe();
  const confirmed = { expectedVersion: deviceExpectedVersion, confirmed: z.literal(true) };
  router.use("/:id/device-management/v1", requirePermission("DESIGN_QUERY"));
  router.use("/:id/device-management/v1", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  const context = (req: import("express").Request) => {
    const id = idSchema.safeParse(req.params.id), payload = jwt.decode(req.header("Authorization")?.slice(7) ?? "");
    if (!id.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
    if (!payload || typeof payload === "string" || Number(payload.sub) !== req.authUser!.id || !Number.isSafeInteger(payload.tokenVersion) || payload.tokenVersion < 1) throw new QuerySourceError("INVALID_TOKEN", 401);
    return { id: id.data, actor: { userId: req.authUser!.id, tokenVersion: Number(payload.tokenVersion), ...auditRequestContext(req) } };
  };
  router.get("/:id/device-management/v1", async (req, res) => {
    try { const c = context(req); res.json(await service.read(c.id, c.actor)); }
    catch (error) { failure(error, res, req.id); }
  });
  router.post("/:id/device-management/v1", async (req, res) => {
    try {
      const c = context(req), input = z.object({ ...confirmed, metadata: deviceMetadataSchema }).strict().safeParse(req.body);
      if (!input.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
      res.status(201).json(await service.create(c.id, c.actor, input.data));
    } catch (error) { failure(error, res, req.id); }
  });
  for (const operation of ["metadata", "placement"] as const) router.put(`/:id/device-management/v1/:deviceId/${operation}`, async (req, res) => {
    try {
      const c = context(req), device = idSchema.safeParse(req.params.deviceId);
      if (!device.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
      if (operation === "metadata") {
        const input = z.object({ ...confirmed, metadata: deviceMetadataSchema }).strict().safeParse(req.body);
        if (!input.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
        res.json(await service.metadata(c.id, device.data, c.actor, input.data));
      } else {
        const input = z.object({ ...confirmed, placement: devicePlacementSchema }).strict().safeParse(req.body);
        if (!input.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
        res.json(await service.placement(c.id, device.data, c.actor, input.data));
      }
    } catch (error) { failure(error, res, req.id); }
  });
  return router;
}

/** Retain Legacy endpoints, but never allow unversioned writers to bypass managed contracts. */
export function legacyDeviceWriteGuard(managed: () => boolean, mode: (id: number) => Promise<{ mode: string }>): import("express").RequestHandler {
  return async (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) { next(); return; }
    try {
      if (managed()) throw new QuerySourceError("DASHBOARD_DEVICE_VERSIONED_API_REQUIRED");
      const id = z.coerce.number().int().positive().safe().safeParse(req.params.id);
      if (!id.success) throw new QuerySourceError("VALIDATION_ERROR", 400);
      if ((await mode(id.data)).mode !== "LEGACY") throw new QuerySourceError("DASHBOARD_DEVICE_VERSIONED_API_REQUIRED");
      next();
    } catch (error) { failure(error, res, req.id); }
  };
}
