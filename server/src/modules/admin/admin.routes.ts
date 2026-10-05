import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { authenticateJwt, requirePermission } from "../auth/auth.middleware.js";
import { countUsers, createInitialAdmin, listRoles, listUsers } from "./admin.repository.js";

const bootstrapSchema = z.object({
  bootstrapToken: z.string().min(1),
  username: z.string().trim().min(3).max(100),
  displayName: z.string().trim().min(1).max(200),
  password: z.string().min(10).max(200),
});

export const adminRouter = Router();

adminRouter.get("/bootstrap/status", async (_req, res, next) => {
  try {
    const count = await countUsers();
    if (count === undefined) {
      res.status(503).json({ error: { code: "PLATFORM_DB_NOT_CONFIGURED", message: "平台資料庫尚未設定。" } });
      return;
    }

    res.json({
      bootstrapRequired: count === 0,
      bootstrapEnabled: Boolean(env.BOOTSTRAP_ADMIN_TOKEN),
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/bootstrap", async (req, res, next) => {
  try {
    const parsed = bootstrapSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "初始化資料格式不正確。" } });
      return;
    }

    if (!env.BOOTSTRAP_ADMIN_TOKEN || parsed.data.bootstrapToken !== env.BOOTSTRAP_ADMIN_TOKEN) {
      res.status(403).json({ error: { code: "INVALID_BOOTSTRAP_TOKEN", message: "初始化權杖不正確。" } });
      return;
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    await createInitialAdmin({
      username: parsed.data.username,
      displayName: parsed.data.displayName,
      passwordHash,
    });

    res.status(201).json({ status: "OK" });
  } catch (error) {
    if (error instanceof Error && error.message === "BOOTSTRAP_ALREADY_COMPLETED") {
      res.status(409).json({ error: { code: error.message, message: "系統管理員初始化已完成。" } });
      return;
    }
    next(error);
  }
});

adminRouter.get(
  "/users",
  authenticateJwt,
  requirePermission("MANAGE_USERS"),
  async (_req, res, next) => {
    try {
      const users = await listUsers();
      if (!users) {
        res.status(503).json({ error: { code: "PLATFORM_DB_NOT_CONFIGURED", message: "平台資料庫尚未設定。" } });
        return;
      }
      res.json({ users });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.get(
  "/roles",
  authenticateJwt,
  requirePermission("MANAGE_USERS"),
  async (_req, res, next) => {
    try {
      const roles = await listRoles();
      if (!roles) {
        res.status(503).json({ error: { code: "PLATFORM_DB_NOT_CONFIGURED", message: "平台資料庫尚未設定。" } });
        return;
      }
      res.json({ roles });
    } catch (error) {
      next(error);
    }
  },
);
