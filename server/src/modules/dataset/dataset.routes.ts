import { Router } from "express";
import { z } from "zod";
import { assertSelectOnlySql } from "../../query/selectOnlySql.js";
import { extractParameterNames } from "../../query/queryCompiler.js";
import { authenticateJwt, requirePermission } from "../auth/auth.middleware.js";
import {
  createDataset,
  deleteDataset,
  getDataset,
  listDatasets,
  listDesignerDataSources,
  updateDataset,
} from "./dataset.repository.js";
import { previewDataset } from "./dataset.service.js";

const idSchema = z.coerce.number().int().positive();

const datasetSchema = z.object({
  code: z.string().trim().min(2).max(100).regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable().optional().default(null),
  dataSourceId: z.coerce.number().int().positive(),
  sqlText: z.string().trim().min(1).max(200000),
  maxRows: z.coerce.number().int().min(1).max(10000).default(500),
  queryTimeoutSec: z.coerce.number().int().min(1).max(3600).nullable().optional().default(null),
  isActive: z.boolean().default(true),
});

const previewSchema = z.object({
  dataSourceId: z.coerce.number().int().positive(),
  sqlText: z.string().trim().min(1).max(200000),
  values: z.record(z.unknown()).default({}),
  maxRows: z.coerce.number().int().min(1).max(1000).default(100),
  queryTimeoutSec: z.coerce.number().int().min(1).max(300).nullable().optional().default(null),
});

export const datasetRouter = Router();
datasetRouter.use(authenticateJwt, requirePermission("DESIGN_QUERY"));

datasetRouter.get("/datasource-options", async (_req, res, next) => {
  try { res.json({ dataSources: await listDesignerDataSources() }); }
  catch (error) { next(error); }
});

datasetRouter.get("/", async (_req, res, next) => {
  try { res.json({ datasets: await listDatasets() }); }
  catch (error) { next(error); }
});

datasetRouter.get("/:id", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dataset ID 不正確。" } });
      return;
    }
    const dataset = await getDataset(id.data);
    if (!dataset) {
      res.status(404).json({ error: { code: "DATASET_NOT_FOUND", message: "找不到 Dataset。" } });
      return;
    }
    res.json({ dataset });
  } catch (error) { next(error); }
});

datasetRouter.post("/", async (req, res, next) => {
  try {
    const parsed = datasetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dataset 設定格式不正確。" } });
      return;
    }
    assertSelectOnlySql(parsed.data.sqlText);
    const id = await createDataset(parsed.data);
    res.status(201).json({ id, parameterNames: extractParameterNames(parsed.data.sqlText) });
  } catch (error) {
    const number = (error as { number?: number })?.number;
    if (number === 2627 || number === 2601) {
      res.status(409).json({ error: { code: "DATASET_CODE_EXISTS", message: "Dataset 代碼已存在。" } });
      return;
    }
    if (error instanceof Error && error.message.startsWith("SQL_")) {
      res.status(400).json({ error: { code: error.message, message: "只允許單一 SELECT / WITH 查詢。" } });
      return;
    }
    next(error);
  }
});

datasetRouter.put("/:id", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const parsed = datasetSchema.safeParse(req.body);
    if (!id.success || !parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dataset 設定格式不正確。" } });
      return;
    }
    assertSelectOnlySql(parsed.data.sqlText);
    await updateDataset(id.data, parsed.data);
    res.json({ status: "OK", parameterNames: extractParameterNames(parsed.data.sqlText) });
  } catch (error) {
    if (error instanceof Error && error.message === "DATASET_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到 Dataset。" } });
      return;
    }
    if (error instanceof Error && error.message.startsWith("SQL_")) {
      res.status(400).json({ error: { code: error.message, message: "只允許單一 SELECT / WITH 查詢。" } });
      return;
    }
    next(error);
  }
});

datasetRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dataset ID 不正確。" } });
      return;
    }
    await deleteDataset(id.data);
    res.json({ status: "OK" });
  } catch (error) {
    if (error instanceof Error && error.message === "DATASET_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到 Dataset。" } });
      return;
    }
    next(error);
  }
});

datasetRouter.post("/preview/run", async (req, res, next) => {
  try {
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "預覽參數格式不正確。" } });
      return;
    }
    res.json({
      parameterNames: extractParameterNames(parsed.data.sqlText),
      result: await previewDataset(parsed.data),
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("MISSING_QUERY_PARAMETER:")) {
      const name = error.message.split(":")[1];
      res.status(400).json({ error: { code: "MISSING_QUERY_PARAMETER", message: `缺少查詢參數：${name}` } });
      return;
    }
    if (error instanceof Error && error.message.startsWith("SQL_")) {
      res.status(400).json({ error: { code: error.message, message: "只允許單一 SELECT / WITH 查詢。" } });
      return;
    }
    if (error instanceof Error && ["DATASOURCE_NOT_FOUND","DATASOURCE_DISABLED"].includes(error.message)) {
      res.status(400).json({ error: { code: error.message, message: "指定的資料來源不存在或已停用。" } });
      return;
    }
    next(error);
  }
});
