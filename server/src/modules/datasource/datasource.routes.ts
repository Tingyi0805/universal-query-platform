import { Router } from "express";
import { z } from "zod";
import { authenticateJwt, requirePermission } from "../auth/auth.middleware.js";
import {
  createDataSource,
  deleteDataSource,
  listDataSources,
  updateDataSource,
} from "./datasource.repository.js";
import { testDataSourceConfig, testSavedDataSource } from "./datasource.service.js";

const idSchema = z.coerce.number().int().positive();

const baseSchema = z.object({
  code: z.string().trim().min(2).max(100).regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(1).max(200),
  type: z.enum(["SQLSERVER", "ORACLE"]),
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535),
  databaseName: z.string().trim().max(255).nullable().optional().default(null),
  oracleServiceName: z.string().trim().max(255).nullable().optional().default(null),
  oracleConnectionMode: z.enum(["SERVICE_NAME", "SID"]).nullable().optional().default(null),
  username: z.string().trim().min(1).max(200),
  connectionTimeoutSec: z.coerce.number().int().min(1).max(300).default(10),
  queryTimeoutSec: z.coerce.number().int().min(1).max(3600).default(30),
  encryptConnection: z.boolean().default(false),
  trustServerCertificate: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

const createSchema = baseSchema.extend({
  password: z.string().min(1).max(500),
}).superRefine((value, ctx) => {
  if (value.type === "SQLSERVER" && !value.databaseName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["databaseName"], message: "SQL Server Database 必填。" });
  }
  if (value.type === "ORACLE" && (!value.oracleServiceName || !value.oracleConnectionMode)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["oracleServiceName"], message: "Oracle Service Name/SID 必填。" });
  }
});

const updateSchema = baseSchema.extend({
  password: z.string().min(1).max(500).optional(),
}).superRefine((value, ctx) => {
  if (value.type === "SQLSERVER" && !value.databaseName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["databaseName"], message: "SQL Server Database 必填。" });
  }
  if (value.type === "ORACLE" && (!value.oracleServiceName || !value.oracleConnectionMode)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["oracleServiceName"], message: "Oracle Service Name/SID 必填。" });
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
    res.json({ status: "OK" });
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
    res.json({ status: "OK" });
  } catch (error) {
    if (error instanceof Error && error.message === "DATASOURCE_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到資料來源。" } });
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
