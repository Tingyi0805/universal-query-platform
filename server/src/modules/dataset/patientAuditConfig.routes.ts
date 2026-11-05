import { Router } from "express";
import { z } from "zod";
import { auditRequestContext } from "../audit/auditContext.js";
import { requirePermission } from "../auth/auth.middleware.js";
import type { createPatientAuditService } from "./patientAuditConfig.service.js";
import { PatientAuditError } from "./patientAuditConfig.service.js";
import { SecurityContractError } from "../securityContract/securityContract.js";

const inputSchema = z.object({ expectedVersion: z.string(), isEnabled: z.literal(true),
  patientKeyColumn: z.string().min(1).max(128), identifierConfirmed: z.literal(true) }).strict();
export function createPatientAuditConfigRouter(service: ReturnType<typeof createPatientAuditService>) {
  const router = Router();
  // Mounted after the existing JWT/TokenVersion and DESIGN_QUERY middleware.
  router.use("/:id/patient-audit-config", requirePermission("DESIGN_QUERY"));
  for (const method of ["get", "put"] as const) router[method]("/:id/patient-audit-config", async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const id = z.coerce.number().int().positive().safe().safeParse(req.params.id);
      if (!id.success) throw new PatientAuditError("VALIDATION_ERROR", 400);
      if (!req.authUser) throw new PatientAuditError("UNAUTHORIZED", 401);
      if (method === "get") { res.json(await service.get(id.data)); return; }
      const input = inputSchema.safeParse(req.body);
      if (!input.success) throw new PatientAuditError("VALIDATION_ERROR", 400);
      res.json(await service.put(id.data, input.data, req.authUser.id, auditRequestContext(req)));
    } catch (error) {
      if (error instanceof PatientAuditError || error instanceof SecurityContractError) {
        res.status(error.status).json({ error: { code: error.code, message: "患者稽核設定未通過安全驗證。", requestId: req.id } }); return;
      }
      next(error);
    }
  });
  return router;
}
