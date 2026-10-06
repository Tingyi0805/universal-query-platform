import { Router } from "express";
import { z } from "zod";
import { authenticateJwt, requirePermission } from "../auth/auth.middleware.js";
import { listAuditLogs } from "./audit.repository.js";

export const auditRouter = Router();
auditRouter.use(authenticateJwt, requirePermission("VIEW_AUDIT"));

auditRouter.get("/", async (req, res, next) => {
  try {
    const parsed = z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(50),
      eventType: z.string().trim().max(50).optional(),
      username: z.string().trim().max(100).optional(),
    }).safeParse(req.query);

    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Audit 查詢條件格式不正確。" } });
      return;
    }

    res.json(await listAuditLogs(parsed.data));
  } catch (error) { next(error); }
});
