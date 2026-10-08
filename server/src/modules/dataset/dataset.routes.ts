import { Router } from "express";
import { z } from "zod";
import { assertSelectOnlySql } from "../../query/selectOnlySql.js";
import { extractParameterNames } from "../../query/queryCompiler.js";
import { authenticateJwt, requirePermission } from "../auth/auth.middleware.js";
import {
  archiveDataset,
  createDataset,
  deleteDataset,
  getDataset,
  getDatasetDeleteImpact,
  listDatasets,
  listDesignerDataSources,
  restoreDataset,
  updateDataset,
} from "./dataset.repository.js";
import { executeSavedDataset, getParameterOptions, previewDataset } from "./dataset.service.js";
import { syncDatasetColumns } from "./column.repository.js";
import {
  listDatasetParameters,
  replaceDatasetParameters,
  syncDatasetParameters,
} from "./parameter.repository.js";
import {
  listDatasetVersions,
  restoreDatasetVersion,
  setDatasetVersionPinned,
} from "../version/version.repository.js";

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
  maxRows: z.coerce.number().int().min(1).max(10000).default(100),
  queryTimeoutSec: z.coerce.number().int().min(1).max(300).nullable().optional().default(null),
  datasetId: z.coerce.number().int().positive().optional(),
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
    const requiredTypeByControl: Partial<Record<typeof parameter.controlType, typeof parameter.dataType>> = {
      NUMBER: "NUMBER",
      DATE: "DATE",
      DATETIME: "DATETIME",
      CHECKBOX: "BOOLEAN",
    };
    const requiredType = requiredTypeByControl[parameter.controlType];
    if (requiredType && parameter.dataType !== requiredType) {
      return `${parameter.name} 的控制項 ${parameter.controlType} 必須搭配 ${requiredType} 資料型別。`;
    }

    const defaultValue = parameter.defaultValue?.trim() ?? "";

    if (defaultValue) {
      if (parameter.dataType === "NUMBER" && !Number.isFinite(Number(defaultValue))) {
        return `${parameter.name} 的預設值必須是有效數字。`;
      }

      if (parameter.dataType === "DATE") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(defaultValue) || Number.isNaN(new Date(`${defaultValue}T00:00:00Z`).getTime())) {
          return `${parameter.name} 的日期預設值必須使用 YYYY-MM-DD。`;
        }
      }

      if (parameter.dataType === "DATETIME" && Number.isNaN(new Date(defaultValue).getTime())) {
        return `${parameter.name} 的日期時間預設值格式不正確。`;
      }

      if (parameter.dataType === "BOOLEAN" && !["true","false","1","0","yes","no","y","n"].includes(defaultValue.toLowerCase())) {
        return `${parameter.name} 的布林預設值必須為 true/false 或 1/0。`;
      }
    }
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

function sendDatasetExecutionError(res: any, error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  if (error.message.startsWith("QUOTED_QUERY_PARAMETER:")) {
    const name = error.message.split(":")[1];
    res.status(400).json({
      error: {
        code: "QUOTED_QUERY_PARAMETER",
        message: `參數 {{${name}}} 外面不可加單引號，請直接使用 {{${name}}}。`,
      },
    });
    return true;
  }

  if (error.message.startsWith("PARAMETER_REQUIRED:")) {
    const name = error.message.split(":")[1];
    res.status(400).json({ error: { code: "PARAMETER_REQUIRED", message: `參數 ${name} 為必填。` } });
    return true;
  }

  if (error.message.startsWith("PARAMETER_DATE_INVALID:")) {
    const name = error.message.split(":")[1];
    res.status(400).json({ error: { code: "PARAMETER_DATE_INVALID", message: `參數 ${name} 必須是 YYYY-MM-DD 日期格式。` } });
    return true;
  }

  if (error.message.startsWith("PARAMETER_DATETIME_INVALID:")) {
    const name = error.message.split(":")[1];
    res.status(400).json({ error: { code: "PARAMETER_DATETIME_INVALID", message: `參數 ${name} 的日期時間格式不正確。` } });
    return true;
  }

  if (error.message.startsWith("PARAMETER_NUMBER_INVALID:")) {
    const name = error.message.split(":")[1];
    res.status(400).json({ error: { code: "PARAMETER_NUMBER_INVALID", message: `參數 ${name} 必須是有效數字。` } });
    return true;
  }

  if (error.message.startsWith("PARAMETER_BOOLEAN_INVALID")) {
    res.status(400).json({ error: { code: "PARAMETER_BOOLEAN_INVALID", message: "布林參數格式不正確。" } });
    return true;
  }

  const dbError = error as Error & { code?: string; errorNum?: number };
  if (dbError.code === "ORA-01036" || dbError.errorNum === 1036) {
    res.status(400).json({
      error: {
        code: "ORACLE_BIND_INVALID",
        message: "Oracle Bind Parameter 不正確。請確認 {{PARAM}} 外面沒有單引號，且 SQL 參數名稱與 Parameter Designer 一致。",
      },
    });
    return true;
  }

  if (dbError.code === "ORA-01861" || dbError.errorNum === 1861) {
    res.status(400).json({
      error: {
        code: "ORACLE_DATE_FORMAT_INVALID",
        message: "Oracle 日期格式不符合。若欄位為 DATE，建議直接使用 DATE 型別 Bind Parameter，不要自行加單引號。",
      },
    });
    return true;
  }

  return false;
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
    const result = await previewDataset(parsed.data);
    if (parsed.data.datasetId) {
      await syncDatasetColumns(parsed.data.datasetId, result.columns);
    }
    res.json({
      parameterNames: extractParameterNames(parsed.data.sqlText),
      result,
    });
  } catch (error) {
    if (sendDatasetExecutionError(res, error)) return;
    if (error instanceof Error && error.message.startsWith("MISSING_QUERY_PARAMETER:")) {
      const name = error.message.split(":")[1];
      res.status(400).json({ error: { code: "MISSING_QUERY_PARAMETER", message: `缺少查詢參數：${name}` } });
      return;
    }
    if (error instanceof Error && error.message.startsWith("SQL_")) {
      res.status(400).json({ error: { code: error.message, message: "只允許單一 SELECT / WITH 查詢。" } });
      return;
    }
    if (error instanceof Error && ["DATASET_NOT_FOUND","DATASET_ARCHIVED","DATASOURCE_NOT_FOUND","DATASOURCE_DISABLED"].includes(error.message)) {
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

    const result = await executeSavedDataset(id.data, body.data.values, body.data.maxRows);
    await syncDatasetColumns(id.data, result.columns);
    res.json({ result });
  } catch (error) {
    if (sendDatasetExecutionError(res, error)) return;
    if (error instanceof Error && error.message.startsWith("PARAMETER_")) {
      res.status(400).json({ error: { code: error.message.split(":")[0], message: "查詢參數格式不正確。" } });
      return;
    }
    if (error instanceof Error && ["DATASET_NOT_FOUND","DATASET_ARCHIVED","DATASET_DISABLED","DATASOURCE_NOT_FOUND","DATASOURCE_DISABLED"].includes(error.message)) {
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
    if (!dataset.isArchived) {
      await syncDatasetParameters(id.data, extractParameterNames(dataset.sqlText));
    }
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
    if (dataset.isArchived) {
      res.status(409).json({ error: { code: "DATASET_ARCHIVED", message: "此 Dataset 已封存，請先還原後再修改參數設定。" } });
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

    await replaceDatasetParameters(id.data, parsed.data.parameters, req.authUser!.id);
    res.json({ status: "OK" });
  } catch (error) {
    if (error instanceof Error && error.message === "PARAMETER_LOOKUP_DATASET_ARCHIVED") {
      res.status(409).json({
        error: {
          code: error.message,
          message: "參數選項來源 Dataset 已封存或不存在，請改選其他 Dataset。",
        },
      });
      return;
    }
    next(error);
  }
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
    await updateDataset(id.data, parsed.data, req.authUser!.id);
    const parameterNames = extractParameterNames(parsed.data.sqlText);
    await syncDatasetParameters(id.data, parameterNames);
    res.json({ status: "OK", parameterNames });
  } catch (error) {
    if (error instanceof Error && error.message === "DATASET_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到 Dataset。" } });
      return;
    }
    if (error instanceof Error && error.message === "DATASET_ARCHIVED") {
      res.status(409).json({ error: { code: error.message, message: "此 Dataset 已封存，請先還原後再修改。" } });
      return;
    }
    if (error instanceof Error && error.message.startsWith("SQL_")) {
      res.status(400).json({ error: { code: error.message, message: "只允許單一 SELECT / WITH 查詢。" } });
      return;
    }
    next(error);
  }
});

datasetRouter.get("/:id/versions", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dataset ID 不正確。" } });
      return;
    }
    res.json({ versions: await listDatasetVersions(id.data) });
  } catch (error) { next(error); }
});

datasetRouter.put("/:id/versions/:versionNo/pin", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const versionNo = z.coerce.number().int().positive().safeParse(req.params.versionNo);
    const body = z.object({ isPinned: z.boolean() }).safeParse(req.body);
    if (!id.success || !versionNo.success || !body.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dataset 版本保留設定不正確。" } });
      return;
    }

    await setDatasetVersionPinned(id.data, versionNo.data, body.data.isPinned);
    res.json({ status: "OK" });
  } catch (error) {
    if (error instanceof Error && error.message === "DATASET_VERSION_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到指定的 Dataset 版本。" } });
      return;
    }
    next(error);
  }
});

datasetRouter.post("/:id/versions/:versionNo/restore", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const versionNo = z.coerce.number().int().positive().safeParse(req.params.versionNo);
    if (!id.success || !versionNo.success || !req.authUser) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dataset 版本資料不正確。" } });
      return;
    }

    await restoreDatasetVersion(id.data, versionNo.data, req.authUser.id);
    res.json({ status: "OK", dataset: await getDataset(id.data) });
  } catch (error) {
    if (error instanceof Error && error.message === "DATASET_VERSION_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到指定的 Dataset 版本。" } });
      return;
    }
    if (error instanceof Error && error.message === "DATASET_ARCHIVED") {
      res.status(409).json({ error: { code: error.message, message: "已封存 Dataset 請先還原，再進行版本還原。" } });
      return;
    }
    if (error instanceof Error && error.message === "PARAMETER_LOOKUP_DATASET_ARCHIVED") {
      res.status(409).json({ error: { code: error.message, message: "該版本引用的 Lookup Dataset 已封存或不存在，無法還原。" } });
      return;
    }
    next(error);
  }
});

datasetRouter.post("/:id/archive", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dataset ID 不正確。" } });
      return;
    }

    await archiveDataset(id.data, req.authUser!.id);
    res.json({ status: "OK", dataset: await getDataset(id.data) });
  } catch (error) {
    if (error instanceof Error && error.message === "DATASET_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到 Dataset。" } });
      return;
    }
    if (error instanceof Error && error.message === "DATASET_ALREADY_ARCHIVED") {
      res.status(409).json({ error: { code: error.message, message: "Dataset 已經封存。" } });
      return;
    }
    next(error);
  }
});

datasetRouter.post("/:id/restore", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dataset ID 不正確。" } });
      return;
    }

    await restoreDataset(id.data);
    res.json({ status: "OK", dataset: await getDataset(id.data) });
  } catch (error) {
    if (error instanceof Error && error.message === "DATASET_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到 Dataset。" } });
      return;
    }
    if (error instanceof Error && error.message === "DATASET_NOT_ARCHIVED") {
      res.status(409).json({ error: { code: error.message, message: "Dataset 尚未封存。" } });
      return;
    }
    next(error);
  }
});

datasetRouter.get("/:id/delete-impact", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dataset ID 不正確。" } });
      return;
    }
    res.json(await getDatasetDeleteImpact(id.data));
  } catch (error) {
    if (error instanceof Error && error.message === "DATASET_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到 Dataset。" } });
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
    if (error instanceof Error && error.message === "DATASET_IN_USE") {
      res.status(409).json({
        error: {
          code: error.message,
          message: "此 Dataset 已被 Query 或參數選項來源使用，不能永久刪除，請改用「封存」。",
        },
      });
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
