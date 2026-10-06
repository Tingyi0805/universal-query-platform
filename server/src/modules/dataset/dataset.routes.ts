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
import { executeSavedDataset, getParameterOptions, previewDataset } from "./dataset.service.js";
import {
  listDatasetParameters,
  replaceDatasetParameters,
  syncDatasetParameters,
} from "./parameter.repository.js";

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

const parameterSchema = z.object({
  name: z.string().trim().min(1).max(100).regex(/^[A-Z][A-Z0-9_]*$/),
  label: z.string().trim().min(1).max(200),
  dataType: z.enum(["STRING","NUMBER","DATE","DATETIME","BOOLEAN"]),
  controlType: z.enum(["TEXT","NUMBER","DATE","DATETIME","SELECT","MULTISELECT","CHECKBOX"]),
  isRequired: z.boolean(),
  defaultValue: z.string().max(1000).nullable(),
  displayOrder: z.coerce.number().int().min(0).max(10000),
  placeholder: z.string().max(200).nullable(),
  helpText: z.string().max(500).nullable(),
  optionMode: z.enum(["NONE","FIXED","DATASET"]),
  fixedOptionsJson: z.string().max(50000).nullable(),
  lookupDatasetId: z.coerce.number().int().positive().nullable(),
  lookupValueField: z.string().max(128).nullable(),
  lookupLabelField: z.string().max(128).nullable(),
});

const replaceParametersSchema = z.object({
  parameters: z.array(parameterSchema).max(100),
});

function sameNameSet(a: string[], b: string[]): boolean {
  const aa = [...new Set(a)].sort();
  const bb = [...new Set(b)].sort();
  return aa.length === bb.length && aa.every((value, index) => value === bb[index]);
}

function validateParameterOptions(parameters: z.infer<typeof parameterSchema>[]): string | null {
  for (const parameter of parameters) {
    if (parameter.optionMode === "FIXED") {
      if (!parameter.fixedOptionsJson) return `${parameter.name} 缺少固定選項。`;
      try {
        const parsed = JSON.parse(parameter.fixedOptionsJson);
        if (!Array.isArray(parsed)) return `${parameter.name} 固定選項必須為 JSON 陣列。`;
      } catch {
        return `${parameter.name} 固定選項 JSON 格式不正確。`;
      }
    }

    if (parameter.optionMode === "DATASET") {
      if (!parameter.lookupDatasetId || !parameter.lookupValueField || !parameter.lookupLabelField) {
        return `${parameter.name} 的 Dataset 選項來源設定不完整。`;
      }
    }
  }
  return null;
}

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

datasetRouter.post("/:id/execute", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const body = z.object({
      values: z.record(z.unknown()).default({}),
      maxRows: z.coerce.number().int().min(1).max(10000).optional(),
    }).safeParse(req.body);

    if (!id.success || !body.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dataset 執行參數格式不正確。" } });
      return;
    }

    res.json({ result: await executeSavedDataset(id.data, body.data.values, body.data.maxRows) });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PARAMETER_REQUIRED:")) {
      const name = error.message.split(":")[1];
      res.status(400).json({ error: { code: "PARAMETER_REQUIRED", message: `參數 ${name} 為必填。` } });
      return;
    }
    if (error instanceof Error && error.message.startsWith("PARAMETER_")) {
      res.status(400).json({ error: { code: error.message.split(":")[0], message: "查詢參數格式不正確。" } });
      return;
    }
    if (error instanceof Error && ["DATASET_NOT_FOUND","DATASET_DISABLED","DATASOURCE_NOT_FOUND","DATASOURCE_DISABLED"].includes(error.message)) {
      res.status(400).json({ error: { code: error.message, message: "Dataset 或資料來源不存在或已停用。" } });
      return;
    }
    next(error);
  }
});

datasetRouter.get("/:id/parameters/:name/options", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const name = z.string().regex(/^[A-Z][A-Z0-9_]*$/).safeParse(req.params.name);
    if (!id.success || !name.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "參數識別資料不正確。" } });
      return;
    }
    res.json({ options: await getParameterOptions(id.data, name.data) });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PARAMETER_")) {
      res.status(400).json({ error: { code: error.message, message: "無法取得參數選項。" } });
      return;
    }
    next(error);
  }
});

datasetRouter.get("/:id/parameters", async (req, res, next) => {
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
    await syncDatasetParameters(id.data, extractParameterNames(dataset.sqlText));
    res.json({ parameters: await listDatasetParameters(id.data) });
  } catch (error) { next(error); }
});

datasetRouter.put("/:id/parameters", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const parsed = replaceParametersSchema.safeParse(req.body);
    if (!id.success || !parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "參數設定格式不正確。" } });
      return;
    }

    const dataset = await getDataset(id.data);
    if (!dataset) {
      res.status(404).json({ error: { code: "DATASET_NOT_FOUND", message: "找不到 Dataset。" } });
      return;
    }

    const tokenNames = extractParameterNames(dataset.sqlText);
    const configuredNames = parsed.data.parameters.map((parameter) => parameter.name);
    if (!sameNameSet(tokenNames, configuredNames)) {
      res.status(409).json({
        error: {
          code: "PARAMETER_TOKEN_MISMATCH",
          message: "參數設定必須與 SQL 中的 {{PARAM}} 完全一致，請先重新同步。",
        },
      });
      return;
    }

    const optionError = validateParameterOptions(parsed.data.parameters);
    if (optionError) {
      res.status(400).json({ error: { code: "PARAMETER_OPTION_INVALID", message: optionError } });
      return;
    }

    await replaceDatasetParameters(id.data, parsed.data.parameters);
    res.json({ status: "OK" });
  } catch (error) { next(error); }
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
    const parameterNames = extractParameterNames(parsed.data.sqlText);
    await syncDatasetParameters(id, parameterNames);
    res.status(201).json({ id, parameterNames });
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
    const parameterNames = extractParameterNames(parsed.data.sqlText);
    await syncDatasetParameters(id.data, parameterNames);
    res.json({ status: "OK", parameterNames });
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
    if ((error as { number?: number })?.number === 547) {
      res.status(409).json({
        error: {
          code: "DATASET_IN_USE",
          message: "此 Dataset 已被其他設定使用，請先移除相關關聯。",
        },
      });
      return;
    }
    next(error);
  }
});
