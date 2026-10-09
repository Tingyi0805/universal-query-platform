import { Router } from "express";
import { z } from "zod";
import { authenticateJwt, requirePermission } from "../auth/auth.middleware.js";
import { auditRequestContext } from "../audit/auditContext.js";
import { tryWriteAuditEvent } from "../audit/audit.repository.js";
import {
  createDataSource,
  deleteDataSource,
  getDataSourceDeleteImpact,
  listDataSources,
  updateDataSource,
} from "./datasource.repository.js";
import { testDataSourceConfig, testSavedDataSource } from "./datasource.service.js";

const idSchema = z.coerce.number().int().positive();

const baseSchema = z.object({
  code: z.string().trim().min(2).max(100).regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(1).max(200),
  type: z.enum(["SQLSERVER", "ORACLE", "MYSQL", "POSTGRESQL", "ODBC"]),
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535),
  databaseName: z.string().trim().max(255).nullable().optional().default(null),
  oracleServiceName: z.string().trim().max(255).nullable().optional().default(null),
  oracleConnectionMode: z.enum(["SERVICE_NAME", "SID"]).nullable().optional().default(null),
  odbcConnectionMode: z.enum(["DSN", "CONNECTION_STRING"]).nullable().optional().default(null),
  odbcDsn: z.string().trim().max(255).nullable().optional().default(null),
  odbcConnectionString: z.string().trim().max(4000).nullable().optional().default(null),
  username: z.string().trim().max(200),
  connectionTimeoutSec: z.coerce.number().int().min(1).max(300).default(10),
  queryTimeoutSec: z.coerce.number().int().min(1).max(3600).default(30),
  encryptConnection: z.boolean().default(false),
  trustServerCertificate: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

const createSchema = baseSchema.extend({
  password: z.string().max(500).default(""),
}).superRefine((value, ctx) => {
  if (["SQLSERVER","MYSQL","POSTGRESQL"].includes(value.type) && !value.databaseName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["databaseName"], message: "Database 必填。" });
  }
  if (value.type === "ORACLE" && (!value.oracleServiceName || !value.oracleConnectionMode)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["oracleServiceName"], message: "Oracle Service Name/SID 必填。" });
  }
  if (value.type !== "ODBC" && !value.username) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["username"], message: "Username 必填。" });
  }
  if (value.type !== "ODBC" && !value.password) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["password"], message: "Password 必填。" });
  }
  if (value.type === "ODBC") {
    if (!value.odbcConnectionMode) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["odbcConnectionMode"], message: "ODBC 連線模式必填。" });
    }
    if (value.odbcConnectionMode === "DSN" && !value.odbcDsn) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["odbcDsn"], message: "ODBC DSN 必填。" });
    }
    if (value.odbcConnectionMode === "CONNECTION_STRING" && !value.odbcConnectionString) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["odbcConnectionString"], message: "ODBC Connection String 必填。" });
    }
  }
});

const updateSchema = baseSchema.extend({
  password: z.string().min(1).max(500).optional(),
}).superRefine((value, ctx) => {
  if (["SQLSERVER","MYSQL","POSTGRESQL"].includes(value.type) && !value.databaseName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["databaseName"], message: "Database 必填。" });
  }
  if (value.type === "ORACLE" && (!value.oracleServiceName || !value.oracleConnectionMode)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["oracleServiceName"], message: "Oracle Service Name/SID 必填。" });
  }
  if (value.type !== "ODBC" && !value.username) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["username"], message: "Username 必填。" });
  }
  if (value.type === "ODBC") {
    if (!value.odbcConnectionMode) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["odbcConnectionMode"], message: "ODBC 連線模式必填。" });
    }
    if (value.odbcConnectionMode === "DSN" && !value.odbcDsn) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["odbcDsn"], message: "ODBC DSN 必填。" });
    }
  }
});

export const dataSourceRouter = Router();
dataSourceRouter.use(authenticateJwt, requirePermission("MANAGE_DATASOURCE"));

dataSourceRouter.get("/", async (_req, res, next) => {
  try {
    res.json({ dataSources: await listDataSources() });
  } catch (error) { next(error); }
});

dataSourceRouter.post("/", async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "資料來源設定格式不正確。" } });
      return;
    }
    const id = await createDataSource(parsed.data);
    await tryWriteAuditEvent({
      eventType: "DATASOURCE_CREATED",
      userId: req.authUser?.id ?? null,
      parameters: {
        dataSourceId: id,
        code: parsed.data.code,
        name: parsed.data.name,
        type: parsed.data.type,
        isActive: parsed.data.isActive,
      },
      ...auditRequestContext(req),
    });
    res.status(201).json({ id });
  } catch (error) {
    const number = (error as { number?: number })?.number;
    if (number === 2627 || number === 2601) {
      res.status(409).json({ error: { code: "DATASOURCE_CODE_EXISTS", message: "資料來源代碼已存在。" } });
      return;
    }
    next(error);
  }
});

dataSourceRouter.put("/:id", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const parsed = updateSchema.safeParse(req.body);
    if (!id.success || !parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "資料來源設定格式不正確。" } });
      return;
    }
    await updateDataSource(id.data, parsed.data);
    await tryWriteAuditEvent({
      eventType: "DATASOURCE_UPDATED",
      userId: req.authUser?.id ?? null,
      parameters: {
        dataSourceId: id.data,
        code: parsed.data.code,
        name: parsed.data.name,
        type: parsed.data.type,
        isActive: parsed.data.isActive,
      },
      ...auditRequestContext(req),
    });
    res.json({ status: "OK" });
  } catch (error) {
    if (error instanceof Error && error.message === "DATASOURCE_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到資料來源。" } });
      return;
    }
    if (error instanceof Error && error.message === "ODBC_CONNECTION_STRING_REQUIRED") {
      res.status(400).json({
        error: {
          code: error.message,
          message: "ODBC Connection String 模式尚未設定連線字串。",
        },
      });
      return;
    }
    next(error);
  }
});

dataSourceRouter.get("/:id/delete-impact", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "資料來源 ID 不正確。" } });
      return;
    }
    res.json(await getDataSourceDeleteImpact(id.data));
  } catch (error) {
    if (error instanceof Error && error.message === "DATASOURCE_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到資料來源。" } });
      return;
    }
    next(error);
  }
});

dataSourceRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "資料來源 ID 不正確。" } });
      return;
    }
    await deleteDataSource(id.data);
    await tryWriteAuditEvent({
      eventType: "DATASOURCE_DELETED",
      userId: req.authUser?.id ?? null,
      parameters: { dataSourceId: id.data },
      ...auditRequestContext(req),
    });
    res.json({ status: "OK" });
  } catch (error) {
    if (error instanceof Error && error.message === "DATASOURCE_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到資料來源。" } });
      return;
    }
    if ((error as { number?: number })?.number === 547) {
      res.status(409).json({
        error: {
          code: "DATASOURCE_IN_USE",
          message: "此資料來源已被 Dataset 使用，請先移除相關 Dataset。",
        },
      });
      return;
    }
    next(error);
  }
});

dataSourceRouter.post("/test", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "資料來源設定格式不正確。" } });
    return;
  }
  res.json(await testDataSourceConfig(parsed.data));
});

dataSourceRouter.post("/:id/test", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "資料來源 ID 不正確。" } });
      return;
    }
    res.json(await testSavedDataSource(id.data));
  } catch (error) {
    if (error instanceof Error && error.message === "DATASOURCE_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到資料來源。" } });
      return;
    }
    next(error);
  }
});
