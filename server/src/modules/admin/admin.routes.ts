import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { authenticateJwt, requirePermission } from "../auth/auth.middleware.js";
import {
  countUsers,
  createInitialAdmin,
  createRole,
  createUser,
  listPermissions,
  listRoles,
  listUsers,
  resetUserPassword,
  updateRole,
  updateUser,
} from "./admin.repository.js";

const bootstrapSchema = z.object({
  bootstrapToken: z.string().min(1),
  username: z.string().trim().min(3).max(100),
  displayName: z.string().trim().min(1).max(200),
  password: z.string().min(10).max(200),
});

const roleCodesSchema = z.array(z.string().trim().min(1).max(100)).max(100).default([]);

const createUserSchema = z.object({
  username: z.string().trim().min(3).max(100),
  displayName: z.string().trim().min(1).max(200),
  password: z.string().min(10).max(200),
  roleCodes: roleCodesSchema,
});

const updateUserSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  isActive: z.boolean(),
  roleCodes: roleCodesSchema,
});

const resetPasswordSchema = z.object({
  password: z.string().min(10).max(200),
});

const permissionCodesSchema = z.array(z.string().trim().min(1).max(100)).max(100).default([]);

const createRoleSchema = z.object({
  code: z.string().trim().min(3).max(100).regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).nullable().optional(),
  permissionCodes: permissionCodesSchema,
});

const updateRoleSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean(),
  permissionCodes: permissionCodesSchema,
});

const idSchema = z.coerce.number().int().positive();

export const adminRouter = Router();

adminRouter.get("/bootstrap/status", async (_req, res, next) => {
  try {
    const count = await countUsers();
    if (count === undefined) {
      res.status(503).json({ error: { code: "PLATFORM_DB_NOT_CONFIGURED", message: "平台資料庫尚未設定。" } });
      return;
    }
    res.json({ bootstrapRequired: count === 0, bootstrapEnabled: Boolean(env.BOOTSTRAP_ADMIN_TOKEN) });
  } catch (error) { next(error); }
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
    await createInitialAdmin({ username: parsed.data.username, displayName: parsed.data.displayName, passwordHash });
    res.status(201).json({ status: "OK" });
  } catch (error) {
    if (error instanceof Error && error.message === "BOOTSTRAP_ALREADY_COMPLETED") {
      res.status(409).json({ error: { code: error.message, message: "系統管理員初始化已完成。" } });
      return;
    }
    next(error);
  }
});

adminRouter.use(authenticateJwt, requirePermission("MANAGE_USERS"));

adminRouter.get("/users", async (_req, res, next) => {
  try {
    const users = await listUsers();
    if (!users) {
      res.status(503).json({ error: { code: "PLATFORM_DB_NOT_CONFIGURED", message: "平台資料庫尚未設定。" } });
      return;
    }
    res.json({ users });
  } catch (error) { next(error); }
});

adminRouter.post("/users", async (req, res, next) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "使用者資料格式不正確。" } });
      return;
    }
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const id = await createUser({ ...parsed.data, passwordHash });
    res.status(201).json({ id });
  } catch (error) {
    if ((error as { number?: number })?.number === 2627 || (error as { number?: number })?.number === 2601) {
      res.status(409).json({ error: { code: "USERNAME_EXISTS", message: "帳號已存在。" } });
      return;
    }
    next(error);
  }
});

adminRouter.put("/users/:id", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const body = updateUserSchema.safeParse(req.body);
    if (!id.success || !body.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "使用者資料格式不正確。" } });
      return;
    }
    await updateUser(id.data, body.data);
    res.json({ status: "OK" });
  } catch (error) {
    if (error instanceof Error && error.message === "LAST_SYSTEM_ADMIN") {
      res.status(409).json({ error: { code: error.message, message: "不可停用或移除最後一位系統管理員的管理角色。" } });
      return;
    }
    if (error instanceof Error && error.message === "USER_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到使用者。" } });
      return;
    }
    next(error);
  }
});

adminRouter.post("/users/:id/reset-password", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const body = resetPasswordSchema.safeParse(req.body);
    if (!id.success || !body.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "密碼格式不正確。" } });
      return;
    }
    await resetUserPassword(id.data, await bcrypt.hash(body.data.password, 12));
    res.json({ status: "OK" });
  } catch (error) {
    if (error instanceof Error && error.message === "USER_NOT_FOUND_OR_NOT_LOCAL") {
      res.status(404).json({ error: { code: error.message, message: "找不到本機帳號，或此帳號不使用本機密碼。" } });
      return;
    }
    next(error);
  }
});

adminRouter.get("/roles", async (_req, res, next) => {
  try {
    const roles = await listRoles();
    if (!roles) {
      res.status(503).json({ error: { code: "PLATFORM_DB_NOT_CONFIGURED", message: "平台資料庫尚未設定。" } });
      return;
    }
    res.json({ roles });
  } catch (error) { next(error); }
});

adminRouter.get("/permissions", async (_req, res, next) => {
  try { res.json({ permissions: await listPermissions() }); } catch (error) { next(error); }
});

adminRouter.post("/roles", async (req, res, next) => {
  try {
    const parsed = createRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "角色資料格式不正確。" } });
      return;
    }
    const id = await createRole(parsed.data);
    res.status(201).json({ id });
  } catch (error) {
    if ((error as { number?: number })?.number === 2627 || (error as { number?: number })?.number === 2601) {
      res.status(409).json({ error: { code: "ROLE_CODE_EXISTS", message: "角色代碼已存在。" } });
      return;
    }
    next(error);
  }
});

adminRouter.put("/roles/:id", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const body = updateRoleSchema.safeParse(req.body);
    if (!id.success || !body.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "角色資料格式不正確。" } });
      return;
    }
    await updateRole(id.data, body.data);
    res.json({ status: "OK" });
  } catch (error) {
    if (error instanceof Error && error.message === "SYSTEM_ROLE_PROTECTED") {
      res.status(409).json({ error: { code: error.message, message: "SYSTEM_ADMIN 角色不可停用。" } });
      return;
    }
    if (error instanceof Error && error.message === "ROLE_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到角色。" } });
      return;
    }
    next(error);
  }
});
