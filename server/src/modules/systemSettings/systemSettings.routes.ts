import { Router } from "express";
import { z } from "zod";
import { authenticateJwt, requirePermission } from "../auth/auth.middleware.js";
import { auditRequestContext } from "../audit/auditContext.js";
import { tryWriteAuditEvent } from "../audit/audit.repository.js";
import {
  getAuditRetentionSettings,
  getBrandingSettings,
  getVersionRetentionSettings,
  updateAuditRetentionSettings,
  updateBrandingSettings,
  updateVersionRetentionSettings,
} from "./systemSettings.repository.js";
import {
  cleanupOldVersions,
  previewVersionCleanup,
} from "../version/version.repository.js";
import {
  archiveOldAuditLogs,
  cleanupAuditArchive,
  previewAuditLifecycle,
} from "../audit/audit.repository.js";

const auditRetentionSchema = z.object({
  onlineRetentionDays: z.coerce.number().int().min(30).max(3650),
  archiveRetentionDays: z.coerce.number().int().min(365).max(7300),
  importantPermanent: z.boolean(),
});

const versionRetentionSchema = z.object({
  retentionCount: z.coerce.number().int().min(5).max(500),
  retentionDays: z.coerce.number().int().min(30).max(3650),
});

const brandingSchema = z.object({
  organizationName: z.string().trim().max(200),
  platformName: z.string().trim().min(1).max(200),
  platformTitle: z.string().trim().min(1).max(200),
  platformSubtitle: z.string().trim().max(500),
});

export const systemSettingsRouter = Router();

systemSettingsRouter.get("/public-branding", async (_req, res, next) => {
  try {
    res.json(await getBrandingSettings());
  } catch (error) { next(error); }
});

systemSettingsRouter.use(authenticateJwt);

systemSettingsRouter.get("/branding", async (_req, res, next) => {
  try {
    res.json(await getBrandingSettings());
  } catch (error) { next(error); }
});

systemSettingsRouter.put("/branding", requirePermission("MANAGE_SETTINGS"), async (req, res, next) => {
  try {
    const parsed = brandingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "系統品牌設定格式不正確。",
        },
      });
      return;
    }

    await updateBrandingSettings(parsed.data);
    await tryWriteAuditEvent({
      eventType: "SETTING_BRANDING_UPDATED",
      userId: req.authUser?.id ?? null,
      parameters: {
        organizationName: parsed.data.organizationName,
        platformName: parsed.data.platformName,
        platformTitle: parsed.data.platformTitle,
      },
      ...auditRequestContext(req),
    });
    res.json({ status: "OK" });
  } catch (error) { next(error); }
});


systemSettingsRouter.get("/version-retention", requirePermission("MANAGE_SETTINGS"), async (_req, res, next) => {
  try {
    res.json(await getVersionRetentionSettings());
  } catch (error) { next(error); }
});

systemSettingsRouter.put("/version-retention", requirePermission("MANAGE_SETTINGS"), async (req, res, next) => {
  try {
    const parsed = versionRetentionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "版本保留設定格式不正確。",
        },
      });
      return;
    }

    await updateVersionRetentionSettings(parsed.data);
    await tryWriteAuditEvent({
      eventType: "SETTING_VERSION_RETENTION_UPDATED",
      userId: req.authUser?.id ?? null,
      parameters: parsed.data,
      ...auditRequestContext(req),
    });
    res.json({ status: "OK" });
  } catch (error) { next(error); }
});

systemSettingsRouter.get("/version-retention/cleanup-preview", requirePermission("MANAGE_SETTINGS"), async (_req, res, next) => {
  try {
    res.json(await previewVersionCleanup());
  } catch (error) { next(error); }
});

systemSettingsRouter.post("/version-retention/cleanup", requirePermission("MANAGE_SETTINGS"), async (req, res, next) => {
  try {
    const result = await cleanupOldVersions();
    await tryWriteAuditEvent({
      eventType: "VERSION_CLEANUP_EXECUTED",
      userId: req.authUser?.id ?? null,
      parameters: result,
      ...auditRequestContext(req),
    });
    res.json(result);
  } catch (error) { next(error); }
});


systemSettingsRouter.get("/audit-retention", requirePermission("MANAGE_SETTINGS"), async (_req, res, next) => {
  try {
    res.json(await getAuditRetentionSettings());
  } catch (error) { next(error); }
});

systemSettingsRouter.put("/audit-retention", requirePermission("MANAGE_SETTINGS"), async (req, res, next) => {
  try {
    const parsed = auditRetentionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Audit 保留設定格式不正確。",
        },
      });
      return;
    }

    await updateAuditRetentionSettings(parsed.data);
    await tryWriteAuditEvent({
      eventType: "SETTING_AUDIT_RETENTION_UPDATED",
      userId: req.authUser?.id ?? null,
      parameters: parsed.data,
      ...auditRequestContext(req),
    });
    res.json({ status: "OK" });
  } catch (error) { next(error); }
});


systemSettingsRouter.get("/audit-retention/lifecycle-preview", requirePermission("MANAGE_SETTINGS"), async (_req, res, next) => {
  try {
    res.json(await previewAuditLifecycle());
  } catch (error) { next(error); }
});

systemSettingsRouter.post("/audit-retention/archive", requirePermission("MANAGE_SETTINGS"), async (req, res, next) => {
  try {
    const result = await archiveOldAuditLogs();
    await tryWriteAuditEvent({
      eventType: "AUDIT_ARCHIVE_EXECUTED",
      userId: req.authUser?.id ?? null,
      parameters: result,
      ...auditRequestContext(req),
    });
    res.json(result);
  } catch (error) { next(error); }
});

systemSettingsRouter.post("/audit-retention/archive/cleanup", requirePermission("MANAGE_SETTINGS"), async (req, res, next) => {
  try {
    const result = await cleanupAuditArchive();
    await tryWriteAuditEvent({
      eventType: "AUDIT_ARCHIVE_CLEANUP_EXECUTED",
      userId: req.authUser?.id ?? null,
      parameters: result,
      ...auditRequestContext(req),
    });
    res.json(result);
  } catch (error) { next(error); }
});
