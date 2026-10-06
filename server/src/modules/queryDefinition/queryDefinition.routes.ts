import { Router } from "express";
import { z } from "zod";
import { authenticateJwt, requirePermission } from "../auth/auth.middleware.js";
import {
  createQueryDefinition,
  deleteQueryDefinition,
  getQueryDefinition,
  listQueryDefinitions,
  publishQueryDefinition,
  unpublishQueryDefinition,
  updateQueryDefinition,
} from "./queryDefinition.repository.js";
import {
  getQueryAccessConfiguration,
  replaceQueryAccess,
} from "./queryAccess.repository.js";

const idSchema = z.coerce.number().int().positive();

const definitionSchema = z.object({
  code: z.string().trim().min(2).max(100).regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable().optional().default(null),
  category: z.string().trim().max(100).nullable().optional().default(null),
  icon: z.string().trim().min(1).max(100).default("Table2"),
  datasetId: z.coerce.number().int().positive(),
  sortOrder: z.coerce.number().int().min(-10000).max(10000).default(0),
  allowExcelExport: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

const accessSchema = z.object({
  roles: z.array(z.object({
    roleId: z.coerce.number().int().positive(),
    canView: z.boolean(),
    canExecute: z.boolean(),
    canExport: z.boolean(),
  })).max(500),
  users: z.array(z.object({
    userId: z.coerce.number().int().positive(),
    canView: z.boolean(),
    canExecute: z.boolean(),
    canExport: z.boolean(),
  })).max(5000),
});

export const queryDefinitionRouter = Router();
queryDefinitionRouter.use(authenticateJwt);

queryDefinitionRouter.get("/", requirePermission("DESIGN_QUERY"), async (_req, res, next) => {
  try { res.json({ queryDefinitions: await listQueryDefinitions() }); }
  catch (error) { next(error); }
});

queryDefinitionRouter.get("/:id", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Query ID 不正確。" } });
      return;
    }
    const queryDefinition = await getQueryDefinition(id.data);
    if (!queryDefinition) {
      res.status(404).json({ error: { code: "QUERY_DEFINITION_NOT_FOUND", message: "找不到 Query Definition。" } });
      return;
    }
    res.json({ queryDefinition });
  } catch (error) { next(error); }
});

queryDefinitionRouter.post("/", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const parsed = definitionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Query Definition 格式不正確。" } });
      return;
    }
    const id = await createQueryDefinition(parsed.data);
    res.status(201).json({ id });
  } catch (error) {
    const number = (error as { number?: number })?.number;
    if (number === 2627 || number === 2601) {
      res.status(409).json({ error: { code: "QUERY_CODE_EXISTS", message: "Query 代碼已存在。" } });
      return;
    }
    next(error);
  }
});

queryDefinitionRouter.put("/:id", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const parsed = definitionSchema.safeParse(req.body);
    if (!id.success || !parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Query Definition 格式不正確。" } });
      return;
    }
    await updateQueryDefinition(id.data, parsed.data);
    res.json({ status: "OK" });
  } catch (error) {
    if (error instanceof Error && error.message === "QUERY_DEFINITION_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到 Query Definition。" } });
      return;
    }
    next(error);
  }
});

queryDefinitionRouter.delete("/:id", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Query ID 不正確。" } });
      return;
    }
    await deleteQueryDefinition(id.data);
    res.json({ status: "OK" });
  } catch (error) {
    if (error instanceof Error && error.message === "QUERY_DEFINITION_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到 Query Definition。" } });
      return;
    }
    next(error);
  }
});

queryDefinitionRouter.post("/:id/publish", requirePermission("PUBLISH_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success || !req.authUser) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Query ID 不正確。" } });
      return;
    }
    await publishQueryDefinition(id.data, req.authUser.id);
    res.json({ status: "OK" });
  } catch (error) {
    if (error instanceof Error && error.message === "QUERY_NOT_PUBLISHABLE") {
      res.status(409).json({ error: { code: error.message, message: "Query、Dataset 或 DataSource 尚未啟用，無法發布。" } });
      return;
    }
    next(error);
  }
});

queryDefinitionRouter.post("/:id/unpublish", requirePermission("PUBLISH_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Query ID 不正確。" } });
      return;
    }
    await unpublishQueryDefinition(id.data);
    res.json({ status: "OK" });
  } catch (error) { next(error); }
});

queryDefinitionRouter.get("/:id/access", requirePermission("MANAGE_USERS"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Query ID 不正確。" } });
      return;
    }
    res.json(await getQueryAccessConfiguration(id.data));
  } catch (error) { next(error); }
});

queryDefinitionRouter.put("/:id/access", requirePermission("MANAGE_USERS"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const parsed = accessSchema.safeParse(req.body);
    if (!id.success || !parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Query 權限設定格式不正確。" } });
      return;
    }
    await replaceQueryAccess(id.data, parsed.data);
    res.json({ status: "OK" });
  } catch (error) { next(error); }
});
