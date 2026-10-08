import { Router } from "express";
import { z } from "zod";
import { authenticateJwt, requirePermission } from "../auth/auth.middleware.js";
import {
  archiveOldAuditLogs,
  cleanupAuditArchive,
  listAuditLogs,
  previewAuditLifecycle,
} from "./audit.repository.js";

export const auditRouter = Router();
auditRouter.use(authenticateJwt, requirePermission("VIEW_AUDIT"));

auditRouter.get("/", async (req, res, next) => {
  try {
    const parsed = z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(50),
      eventType: z.string().trim().max(50).optional(),
      eventCategory: z.enum(["SECURITY","CONFIG","USAGE","SYSTEM"]).optional(),
      username: z.string().trim().max(100).optional(),
      source: z.enum(["LIVE","ARCHIVE"]).default("LIVE"),
    }).safeParse(req.query);

    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Audit 查詢條件格式不正確。" } });
      return;
    }

    res.json(await listAuditLogs(parsed.data));
  } catch (error) { next(error); }
});


auditRouter.get("/lifecycle-preview", requirePermission("MANAGE_SETTINGS"), async (_req, res, next) => {
  try {
    res.json(await previewAuditLifecycle());
  } catch (error) { next(error); }
});

auditRouter.post("/archive", requirePermission("MANAGE_SETTINGS"), async (_req, res, next) => {
  try {
    res.json(await archiveOldAuditLogs());
  } catch (error) { next(error); }
});

auditRouter.post("/archive/cleanup", requirePermission("MANAGE_SETTINGS"), async (_req, res, next) => {
  try {
    res.json(await cleanupAuditArchive());
  } catch (error) { next(error); }
});
