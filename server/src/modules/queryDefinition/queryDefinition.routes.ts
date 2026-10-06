import { Router } from "express";
import { z } from "zod";
import { authenticateJwt, requirePermission } from "../auth/auth.middleware.js";
import {
  createQueryDefinition,
  deleteQueryDefinition,
  getQueryDefinition,
  getQueryDefinitionDeleteImpact,
  listQueryDefinitions,
  publishQueryDefinition,
  unpublishQueryDefinition,
  updateQueryDefinition,
} from "./queryDefinition.repository.js";
import {
  getQueryAccessConfiguration,
  replaceQueryAccess,
  searchQueryAccessUsers,
} from "./queryAccess.repository.js";
import { listReportColumns, replaceReportColumns } from "./reportColumn.repository.js";

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

const reportColumnsSchema = z.object({
  columns: z.array(z.object({
    columnName: z.string().min(1).max(256),
    displayLabel: z.string().min(1).max(256),
    displayOrder: z.coerce.number().int().min(0).max(10000),
    isVisible: z.boolean(),
    width: z.coerce.number().int().min(40).max(1000).nullable(),
    displayFormat: z.string().max(100).nullable(),
    alignment: z.enum(["LEFT","CENTER","RIGHT"]),
    groupOrder: z.coerce.number().int().min(0).max(100).nullable(),
    aggregateType: z.enum(["NONE","SUM","AVG","MIN","MAX","COUNT"]),
  })).max(500),
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

queryDefinitionRouter.get("/:id/delete-impact", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Query ID 不正確。" } });
      return;
    }
    res.json(await getQueryDefinitionDeleteImpact(id.data));
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
    if ((error as { number?: number })?.number === 547) {
      res.status(409).json({
        error: {
          code: "QUERY_HAS_HISTORY",
          message: "此 Query 已有歷史或關聯資料，請改用停用或取消發布，不可刪除。",
        },
      });
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

queryDefinitionRouter.get("/:id/report-columns", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Query ID 不正確。" } });
      return;
    }
    res.json({ columns: await listReportColumns(id.data) });
  } catch (error) {
    if (error instanceof Error && error.message === "QUERY_DEFINITION_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到 Query Definition。" } });
      return;
    }
    next(error);
  }
});

queryDefinitionRouter.put("/:id/report-columns", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const parsed = reportColumnsSchema.safeParse(req.body);
    if (!id.success || !parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Report 欄位設定格式不正確。" } });
      return;
    }
    await replaceReportColumns(id.data, parsed.data.columns);
    res.json({ status: "OK" });
  } catch (error) {
    if (error instanceof Error && error.message === "REPORT_COLUMN_NOT_IN_DATASET") {
      res.status(409).json({ error: { code: error.message, message: "Report 欄位與目前 Dataset 欄位不一致，請重新同步。" } });
      return;
    }
    next(error);
  }
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

queryDefinitionRouter.get("/:id/access/users", requirePermission("MANAGE_USERS"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const parsed = z.object({
      q: z.string().trim().min(1).max(100),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }).safeParse(req.query);

    if (!id.success || !parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "使用者搜尋條件格式不正確。" } });
      return;
    }

    res.json({ users: await searchQueryAccessUsers(parsed.data.q, parsed.data.limit) });
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
