import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { requirePermission } from "../auth/auth.middleware.js";
import { auditRequestContext } from "../audit/auditContext.js";
import { dashboardMaskModes } from "./dashboardDeviceMasking.js";
import { createDashboardApprovalService, DashboardApprovalError } from "./dashboardApproval.service.js";

export const approvalPatchSchema = z.object({ expectedVersion: z.string(), sourceKey: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),
  upsert: z.record(z.string(), z.enum(dashboardMaskModes)).refine(value => Object.keys(value).length <= 300).default({}),
  remove: z.array(z.string().min(1).max(256)).max(300).default([]) }).strict()
  .refine(value => Object.keys(value.upsert).length + value.remove.length > 0);
export function createDashboardApprovalRouter(service: ReturnType<typeof createDashboardApprovalService>) {
  const router = Router();
  for (const method of ["get", "patch"] as const) router[method]("/:id/column-approvals", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const id = z.coerce.number().int().positive().safe().safeParse(req.params.id);
      if (!id.success) throw new DashboardApprovalError("VALIDATION_ERROR", 400);
      const token = jwt.decode(req.header("Authorization")?.slice(7) ?? "");
      if (!req.authUser || !token || typeof token === "string" || Number(token.sub) !== req.authUser.id || !Number.isSafeInteger(token.tokenVersion))
        throw new DashboardApprovalError("INVALID_TOKEN", 401);
      const actor = { userId: req.authUser.id, tokenVersion: Number(token.tokenVersion) };
      if (method === "get") { res.json(await service.get(id.data, actor)); return; }
      const patch = approvalPatchSchema.safeParse(req.body);
      if (!patch.success) throw new DashboardApprovalError("VALIDATION_ERROR", 400);
      res.json(await service.patch(id.data, actor, patch.data, auditRequestContext(req)));
    } catch (error) { next(error); }
  });
  return router;
}
