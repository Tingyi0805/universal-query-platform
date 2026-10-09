import { Router } from "express";
import { z } from "zod";
import { authenticateJwt, requirePermission } from "../auth/auth.middleware.js";
import { auditRequestContext } from "../audit/auditContext.js";
import { tryWriteAuditEvent } from "../audit/audit.repository.js";
import {
  archiveQueryDefinition,
  createQueryDefinition,
  deleteQueryDefinition,
  getQueryDefinition,
  getQueryDefinitionDeleteImpact,
  listQueryDefinitions,
  publishQueryDefinition,
  restoreQueryDefinition,
  unpublishQueryDefinition,
  updateQueryDefinition,
} from "./queryDefinition.repository.js";
import {
  getQueryAccessConfiguration,
  replaceQueryAccess,
  searchQueryAccessUsers,
} from "./queryAccess.repository.js";
import { listReportColumns, replaceReportColumns } from "./reportColumn.repository.js";
import {
  listQueryVersions,
  restoreQueryVersion,
  setQueryVersionPinned,
} from "../version/version.repository.js";

const idSchema = z.coerce.number().int().positive();

const definitionSchema = z.object({
  code: z.string().trim().min(2).max(100).regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable().optional().default(null),
  categoryId: z.coerce.number().int().positive().nullable().optional().default(null),
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
    if (error instanceof Error && ["DATASET_ARCHIVED","DATASET_ARCHIVED_OR_NOT_FOUND","DATASET_NOT_FOUND"].includes(error.message)) {
      res.status(409).json({ error: { code: error.message, message: "指定的 Dataset 已封存或不存在，請選擇可使用的 Dataset。" } });
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
    await updateQueryDefinition(id.data, parsed.data, req.authUser!.id);
    res.json({
      status: "OK",
      queryDefinition: await getQueryDefinition(id.data),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "QUERY_DEFINITION_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到 Query Definition。" } });
      return;
    }
    if (error instanceof Error && error.message === "QUERY_ARCHIVED") {
      res.status(409).json({ error: { code: error.message, message: "此 Query 已封存，請先還原後再修改。" } });
      return;
    }
    if (error instanceof Error && ["DATASET_ARCHIVED","DATASET_NOT_FOUND"].includes(error.message)) {
      res.status(409).json({
        error: {
          code: error.message,
          message: "指定的 Dataset 已封存或不存在，請選擇可使用的 Dataset。",
        },
      });
      return;
    }
    next(error);
  }
});

queryDefinitionRouter.get("/:id/versions", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Query ID 不正確。" } });
      return;
    }
    res.json({ versions: await listQueryVersions(id.data) });
  } catch (error) { next(error); }
});

queryDefinitionRouter.put("/:id/versions/:versionNo/pin", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const versionNo = z.coerce.number().int().positive().safeParse(req.params.versionNo);
    const body = z.object({ isPinned: z.boolean() }).safeParse(req.body);
    if (!id.success || !versionNo.success || !body.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Query 版本保留設定不正確。" } });
      return;
    }

    await setQueryVersionPinned(id.data, versionNo.data, body.data.isPinned);
    await tryWriteAuditEvent({
      eventType: "VERSION_QUERY_PIN_CHANGED",
      userId: req.authUser?.id ?? null,
      queryDefinitionId: id.data,
      parameters: { versionNo: versionNo.data, isPinned: body.data.isPinned },
      ...auditRequestContext(req),
    });
    res.json({ status: "OK" });
  } catch (error) {
    if (error instanceof Error && error.message === "QUERY_VERSION_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到指定的 Query 版本。" } });
      return;
    }
    next(error);
  }
});

queryDefinitionRouter.post("/:id/versions/:versionNo/restore", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const versionNo = z.coerce.number().int().positive().safeParse(req.params.versionNo);
    if (!id.success || !versionNo.success || !req.authUser) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Query 版本資料不正確。" } });
      return;
    }

    await restoreQueryVersion(id.data, versionNo.data, req.authUser.id);
    await tryWriteAuditEvent({
      eventType: "QUERY_VERSION_RESTORED",
      userId: req.authUser.id,
      queryDefinitionId: id.data,
      parameters: { versionNo: versionNo.data },
      ...auditRequestContext(req),
    });
    res.json({ status: "OK", queryDefinition: await getQueryDefinition(id.data) });
  } catch (error) {
    if (error instanceof Error && error.message === "QUERY_VERSION_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到指定的 Query 版本。" } });
      return;
    }
    if (error instanceof Error && error.message === "QUERY_ARCHIVED") {
      res.status(409).json({ error: { code: error.message, message: "已封存 Query 請先還原，再進行版本還原。" } });
      return;
    }
    if (error instanceof Error && error.message === "DATASET_ARCHIVED_OR_NOT_FOUND") {
      res.status(409).json({ error: { code: error.message, message: "該版本使用的 Dataset 已封存或不存在，無法還原。" } });
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
    if (error instanceof Error && error.message === "QUERY_HAS_HISTORY") {
      res.status(409).json({
        error: {
          code: error.message,
          message: "此 Query 已有 Audit 歷史，請改用封存，不可永久刪除。",
        },
      });
      return;
    }
    if ((error as { number?: number })?.number === 547) {
      res.status(409).json({
        error: {
          code: "QUERY_HAS_RELATION",
          message: "此 Query 仍有關聯資料，請改用封存。",
        },
      });
      return;
    }
    next(error);
  }
});

queryDefinitionRouter.post("/:id/archive", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success || !req.authUser) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Query ID 不正確。" } });
      return;
    }
    await archiveQueryDefinition(id.data, req.authUser.id);
    await tryWriteAuditEvent({
      eventType: "QUERY_ARCHIVED",
      userId: req.authUser.id,
      queryDefinitionId: id.data,
      parameters: { queryDefinitionId: id.data },
      ...auditRequestContext(req),
    });
    res.json({
      status: "OK",
      queryDefinition: await getQueryDefinition(id.data),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "QUERY_DEFINITION_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到 Query Definition。" } });
      return;
    }
    if (error instanceof Error && error.message === "QUERY_ALREADY_ARCHIVED") {
      res.status(409).json({ error: { code: error.message, message: "此 Query 已封存。" } });
      return;
    }
    next(error);
  }
});

queryDefinitionRouter.post("/:id/restore", requirePermission("DESIGN_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Query ID 不正確。" } });
      return;
    }
    await restoreQueryDefinition(id.data);
    await tryWriteAuditEvent({
      eventType: "QUERY_RESTORED",
      userId: req.authUser?.id ?? null,
      queryDefinitionId: id.data,
      parameters: { queryDefinitionId: id.data },
      ...auditRequestContext(req),
    });
    res.json({
      status: "OK",
      queryDefinition: await getQueryDefinition(id.data),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "QUERY_DEFINITION_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到 Query Definition。" } });
      return;
    }
    if (error instanceof Error && error.message === "QUERY_NOT_ARCHIVED") {
      res.status(409).json({ error: { code: error.message, message: "此 Query 目前不是封存狀態。" } });
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
    await tryWriteAuditEvent({
      eventType: "QUERY_PUBLISHED",
      userId: req.authUser.id,
      queryDefinitionId: id.data,
      parameters: { queryDefinitionId: id.data },
      ...auditRequestContext(req),
    });
    res.json({
      status: "OK",
      queryDefinition: await getQueryDefinition(id.data),
    });
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
    await tryWriteAuditEvent({
      eventType: "QUERY_UNPUBLISHED",
      userId: req.authUser?.id ?? null,
      queryDefinitionId: id.data,
      parameters: { queryDefinitionId: id.data },
      ...auditRequestContext(req),
    });
    res.json({
      status: "OK",
      queryDefinition: await getQueryDefinition(id.data),
    });
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
    const query = await getQueryDefinition(id.data);
    if (!query) {
      res.status(404).json({ error: { code: "QUERY_DEFINITION_NOT_FOUND", message: "找不到 Query Definition。" } });
      return;
    }
    if (query.isArchived) {
      res.status(409).json({ error: { code: "QUERY_ARCHIVED", message: "此 Query 已封存，請先還原後再修改 Report 設定。" } });
      return;
    }

    await replaceReportColumns(id.data, parsed.data.columns, req.authUser!.id);
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
    const query = await getQueryDefinition(id.data);
    if (!query) {
      res.status(404).json({ error: { code: "QUERY_DEFINITION_NOT_FOUND", message: "找不到 Query Definition。" } });
      return;
    }
    if (query.isArchived) {
      res.status(409).json({ error: { code: "QUERY_ARCHIVED", message: "此 Query 已封存，請先還原後再修改權限。" } });
      return;
    }

    await replaceQueryAccess(id.data, parsed.data);
    await tryWriteAuditEvent({
      eventType: "QUERY_ACCESS_UPDATED",
      userId: req.authUser?.id ?? null,
      queryDefinitionId: id.data,
      parameters: {
        roleCount: parsed.data.roles.length,
        userCount: parsed.data.users.length,
      },
      ...auditRequestContext(req),
    });
    res.json({ status: "OK" });
  } catch (error) { next(error); }
});
