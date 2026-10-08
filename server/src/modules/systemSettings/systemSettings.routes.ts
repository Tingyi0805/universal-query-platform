import { Router } from "express";
import { z } from "zod";
import { authenticateJwt, requirePermission } from "../auth/auth.middleware.js";
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
    res.json({ status: "OK" });
  } catch (error) { next(error); }
});

systemSettingsRouter.get("/version-retention/cleanup-preview", requirePermission("MANAGE_SETTINGS"), async (_req, res, next) => {
  try {
    res.json(await previewVersionCleanup());
  } catch (error) { next(error); }
});

systemSettingsRouter.post("/version-retention/cleanup", requirePermission("MANAGE_SETTINGS"), async (_req, res, next) => {
  try {
    res.json(await cleanupOldVersions());
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
    res.json({ status: "OK" });
  } catch (error) { next(error); }
});
