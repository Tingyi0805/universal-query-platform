import { Router } from "express";
import { z } from "zod";
import { authenticateJwt, requirePermission } from "../auth/auth.middleware.js";
import { getBrandingSettings, updateBrandingSettings } from "./systemSettings.repository.js";

const brandingSchema = z.object({
  organizationName: z.string().trim().max(200),
  platformName: z.string().trim().min(1).max(200),
  platformTitle: z.string().trim().min(1).max(200),
  platformSubtitle: z.string().trim().max(500),
});

export const systemSettingsRouter = Router();
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
