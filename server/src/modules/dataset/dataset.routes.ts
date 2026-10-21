import { createPatientAuditPreview } from "./patientAuditPreview.js";
import { Router, type RequestHandler } from "express";
import { auditPatientListIfConfigured } from "../audit/patientDisclosure.service.js";
import { getDatasetSensitivitySnapshot, listDatasetSensitiveColumns, replaceDatasetSensitiveColumns } from "./datasetSensitiveColumn.repository.js";
import { patientAuditService } from "./patientAuditContract.repository.js";
import { createPatientAuditConfigRouter } from "./patientAuditConfig.routes.js";
import { z } from "zod";
import { assertSelectOnlySql } from "../../query/selectOnlySql.js";
import { extractParameterNames } from "../../query/queryCompiler.js";
import { authenticateJwt, requirePermission } from "../auth/auth.middleware.js";
import { auditRequestContext } from "../audit/auditContext.js";
import { tryWriteAuditEvent } from "../audit/audit.repository.js";
import {
  archiveDataset,
  createDataset,
  deleteDataset,
  getDataset,
  getDatasetDeleteImpact,
  listDatasets,
  listDatasetsPaged,
  listDesignerDataSources,
  restoreDataset,
  updateDataset,
} from "./dataset.repository.js";
import { executeSavedDataset, getParameterOptions, previewDataset } from "./dataset.service.js";
import { syncDatasetColumns } from "./column.repository.js";
import {
  listDatasetParameters,
  saveDatasetParameters,
} from "./parameter.repository.js";
import { createDatasetParameterRouter } from "./parameter.routes.js";
import { withErrorModule } from "../../middleware/safeErrorDiagnostic.js";
import { isDynamicDateExpression } from "./dateParameter.js";
import {
  listDatasetVersions,
  restoreDatasetVersion,
  setDatasetVersionPinned,
} from "../version/version.repository.js";

const idSchema = z.coerce.number().int().positive().safe();

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
  dateOutputMode: z.enum(["NATIVE","STRING"]).default("NATIVE"),
  dateCalendar: z.enum(["GREGORIAN","ROC"]).default("GREGORIAN"),
  dateFormat: z.string().max(100).nullable().default(null),
  displayOrder: z.coerce.number().int().min(0).max(10000),
  placeholder: z.string().max(200).nullable(),
  helpText: z.string().max(500).nullable(),
  optionMode: z.enum(["NONE","FIXED","DATASET"]),
  fixedOptionsJson: z.string().max(50000).nullable(),
  lookupDatasetId: z.coerce.number().int().positive().nullable(),
  lookupValueField: z.string().max(128).nullable(),
  lookupLabelField: z.string().max(128).nullable(),
});

const saveParametersSchema = z.object({
  parameters: z.array(parameterSchema).max(100),
  previewToken: z.string().regex(/^[a-f0-9]{64}$/),
});

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
        const dynamic = isDynamicDateExpression(defaultValue);
        if (!dynamic && (!/^\d{4}-\d{2}-\d{2}$/.test(defaultValue) || Number.isNaN(new Date(`${defaultValue}T00:00:00Z`).getTime()))) {
          return `${parameter.name} 的日期預設值必須使用 YYYY-MM-DD 或動態日期。`;
        }
        if (dynamic && ["$NOW", "$TODAY_START", "$TODAY_END"].includes(defaultValue)) {
          return `${parameter.name} 為 DATE，請使用 $TODAY 或 $TODAY±N。`;
        }
      }

      if (parameter.dataType === "DATETIME") {
        const dynamic = isDynamicDateExpression(defaultValue);
        if (!dynamic && Number.isNaN(new Date(defaultValue).getTime())) {
          return `${parameter.name} 的日期時間預設值格式不正確。`;
        }
      }

      if (parameter.dataType === "BOOLEAN" && !["true","false","1","0","yes","no","y","n"].includes(defaultValue.toLowerCase())) {
        return `${parameter.name} 的布林預設值必須為 true/false 或 1/0。`;
      }
    }
    if (["DATE","DATETIME"].includes(parameter.dataType)) {
      if (parameter.dateOutputMode === "STRING" && !(parameter.dateFormat?.trim())) {
        return `${parameter.name} 選擇格式化字串時必須設定日期格式。`;
      }
      if (parameter.dateFormat && !/^[yMdHhms/:. _-]+$/.test(parameter.dateFormat)) {
        return `${parameter.name} 的日期格式包含不支援的字元。`;
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
  if (["PARAMETER_DEFINITION_MISMATCH", "PARAMETER_PARSE_FAILED", "MISSING_QUERY_PARAMETER"].includes(error.message.split(":")[0]!)) {
    res.status(409).json({ error: { code: error.message.split(":")[0], message: "查詢參數設定不完整，請由設計者檢視參數差異並明確同步。", requestId: res.req?.id } });
    return true;
  }

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
datasetRouter.use(createDatasetParameterRouter());

datasetRouter.get("/datasource-options", async (_req, res, next) => {
  try { res.json({ dataSources: await listDesignerDataSources() }); }
  catch (error) { next(error); }
});

datasetRouter.get("/", async (req, res, next) => {
  try {
    if (Object.keys(req.query).length === 0) {
      res.json({ datasets: await listDatasets() });
      return;
    }

    const parsed = z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
      search: z.string().trim().max(200).optional(),
      status: z.enum(["ACTIVE","INACTIVE","ARCHIVED","ALL"]).default("ACTIVE"),
      dataSourceId: z.coerce.number().int().positive().optional(),
    }).safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dataset 清單查詢條件不正確。" } });
      return;
    }

    const result = await listDatasetsPaged(parsed.data);
    res.json({
      datasets: result.items,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / parsed.data.pageSize)),
    });
  } catch (error) { next(error); }
});

const runPatientAuditPreview = createPatientAuditPreview({ execute: previewDataset, sync: syncDatasetColumns, record: patientAuditService.recordPreview });

datasetRouter.post("/preview/run", async (req, res, next) => {
  try {
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "預覽參數格式不正確。" } });
      return;
    }
    const result = await runPatientAuditPreview(parsed.data, req.authUser!.id, auditRequestContext(req));
    res.json({
      parameterNames: extractParameterNames(parsed.data.sqlText),
      result,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "DATASET_SENSITIVITY_COLUMNS_STALE") {
      res.status(409).json({ error: { code: "DATASET_SENSITIVITY_COLUMNS_STALE", message: "查詢欄位已異動，現有敏感資料規則無法對應；請先調整欄位別名或更新敏感資料設定。" } });
      return;
    }
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
    const dataset = await getDataset(id.data);
    if (!dataset) throw new Error("DATASET_NOT_FOUND");
    // Audit the exact rows returned, before delivering them to the caller.
    // This route is authenticated by DESIGN_QUERY; user identity comes from JWT.
    const disclosureId = await withErrorModule("query.patient.disclosure", () => auditPatientListIfConfigured({
      datasetId: id.data,
      userId: req.authUser?.id ?? null,
      sourceScope: `datasource:${dataset.dataSourceId}`,
      deliveryType: "MANUAL",
      masked: false,
      rows: result.rows,
    }));
    await withErrorModule("dataset.columns.sync", () => syncDatasetColumns(id.data, result.columns));
    res.setHeader("Cache-Control", "no-store");
    res.json({ result, disclosureId });
  } catch (error) {
    if (error instanceof Error && error.message === "DATASET_SENSITIVITY_COLUMNS_STALE") {
      res.status(409).json({ error: { code: "DATASET_SENSITIVITY_COLUMNS_STALE", message: "查詢欄位已異動，現有敏感資料規則無法對應；請先調整欄位別名或更新敏感資料設定。" } });
      return;
    }
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

datasetRouter.put("/:id/parameters", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const parsed = saveParametersSchema.safeParse(req.body);
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

    const optionError = validateParameterOptions(parsed.data.parameters);
    if (optionError) {
      res.status(400).json({ error: { code: "PARAMETER_OPTION_INVALID", message: optionError } });
      return;
    }

    await withErrorModule("dataset.parameters.save", () => saveDatasetParameters(id.data, parsed.data.parameters, req.authUser!.id, parsed.data.previewToken));
    res.json({ status: "OK" });
  } catch (error) {
    if (error instanceof Error && ["PARAMETER_PREVIEW_STALE", "PARAMETER_DEFINITION_MISMATCH"].includes(error.message)) {
      res.status(409).json({ error: { code: error.message, message: "參數設定已變更，請重新載入；新增與移除請使用明確同步。", requestId: req.id } });
      return;
    }
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
    res.json({ status: "OK", parameterNames });
  } catch (error) {
    if (error instanceof Error && error.message === "DATASET_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到 Dataset。" } });
      return;
    }
    if (error instanceof Error && error.message === "DATASET_SENSITIVITY_REVIEW_REQUIRED") {
      res.status(409).json({ error: { code: "DATASET_SENSITIVITY_REVIEW_REQUIRED", message: "SQL／資料來源未儲存：此 Dataset 有敏感欄位規則，目前無法可靠驗證變更後的欄位語意與遮蔽適用性。請具備 DESIGN_QUERY 權限的管理者審查資料來源、欄位語意、遮蔽及相關 Dashboard；不可只確認同名別名或清空規則來放行。現有設定已保留。" } });
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
    await tryWriteAuditEvent({
      eventType: "VERSION_DATASET_PIN_CHANGED",
      userId: req.authUser?.id ?? null,
      parameters: { versionNo: versionNo.data, isPinned: body.data.isPinned },
      ...auditRequestContext(req),
    });
    res.json({ status: "OK" });
  } catch (error) {
    if (error instanceof Error && error.message === "DATASET_VERSION_NOT_FOUND") {
      res.status(404).json({ error: { code: error.message, message: "找不到指定的 Dataset 版本。" } });
      return;
    }
    next(error);
  }
});

export const createDatasetVersionRestoreHandler = (deps = {
  restoreDatasetVersion, getDataset,
}): RequestHandler =>
async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const versionNo = z.coerce.number().int().positive().safeParse(req.params.versionNo);
    if (!id.success || !versionNo.success || !req.authUser) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dataset 版本資料不正確。" } });
      return;
    }

    await deps.restoreDatasetVersion(id.data, versionNo.data, req.authUser.id, auditRequestContext(req));
    res.json({ status: "OK", dataset: await deps.getDataset(id.data) });
  } catch (error) {
    if (error instanceof Error && error.message === "DATASET_SENSITIVITY_REVIEW_REQUIRED") {
      res.status(409).json({ error: { code: error.message, message: "版本未還原：此 Dataset 有敏感欄位規則，SQL／資料來源異動須完成安全審查。現有設定已保留。" } });
      return;
    }
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
};

datasetRouter.post("/:id/versions/:versionNo/restore", createDatasetVersionRestoreHandler());

datasetRouter.post("/:id/archive", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dataset ID 不正確。" } });
      return;
    }

    await archiveDataset(id.data, req.authUser!.id);
    await tryWriteAuditEvent({
      eventType: "DATASET_ARCHIVED",
      userId: req.authUser?.id ?? null,
      parameters: { datasetId: id.data },
      ...auditRequestContext(req),
    });
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
    await tryWriteAuditEvent({
      eventType: "DATASET_RESTORED",
      userId: req.authUser?.id ?? null,
      parameters: { datasetId: id.data },
      ...auditRequestContext(req),
    });
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
          message: "此 Dataset 仍有 Query、參數選項來源或稽核紀錄關聯，不能永久刪除，請改用「封存」。",
        },
      });
      return;
    }
    if ((error as { number?: number })?.number === 547) {
      res.status(409).json({
        error: {
          code: "DATASET_IN_USE",
          message: "此 Dataset 仍有資料或稽核紀錄關聯，不能永久刪除，請改用「封存」。",
        },
      });
      return;
    }
    next(error);
  }
});

datasetRouter.use(createPatientAuditConfigRouter(patientAuditService));

const sensitiveColumnSchema = z.object({
  columnName: z.string().trim().min(1).max(256),
  sensitivityType: z.string().regex(/^[A-Z0-9_]{1,64}$/),
  deviceMaskMode: z.enum(["NONE", "NAME", "MRN", "PHONE", "GENERIC", "FULL", "OMIT", "CUSTOM"]),
  customMask: z.object({
    prefix: z.number().int().min(0).max(100),
    suffix: z.number().int().min(0).max(100),
    symbol: z.string().min(1).max(2).refine((v) => Array.from(v).length === 1 && !/[\r\n\t]/u.test(v)),
  }).nullable().optional(),
}).refine((rule) => rule.sensitivityType === "OTHER" || rule.deviceMaskMode !== "NONE", "敏感欄位不可原樣顯示")
  .refine((rule) => rule.deviceMaskMode !== "CUSTOM" || !!rule.customMask, "自訂遮蔽必須提供合法的保留碼數及遮蔽符號");

datasetRouter.get("/:id/sensitive-columns", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) { res.status(400).json({ error: { code: "VALIDATION_ERROR" } }); return; }
    if (!await getDataset(id.data)) { res.status(404).json({ error: { code: "DATASET_NOT_FOUND" } }); return; }
    res.json(await getDatasetSensitivitySnapshot(id.data));
  } catch (error) { next(error); }
});

datasetRouter.put("/:id/sensitive-columns", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const parsed = z.object({ columns: z.array(sensitiveColumnSchema).max(300), expectedVersion: z.number().int().nonnegative().safe() }).safeParse(req.body);
    if (!id.success || !parsed.success || !req.authUser) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "敏感欄位設定格式不正確。" } }); return;
    }
    const names = parsed.data.columns.map((column) => column.columnName);
    if (new Set(names.map((name) => name.toUpperCase())).size !== names.length) {
      res.status(400).json({ error: { code: "DUPLICATE_SENSITIVE_COLUMN", message: "欄位名稱不可重複。" } }); return;
    }
    const version = await replaceDatasetSensitiveColumns(id.data, parsed.data.columns, req.authUser.id, auditRequestContext(req), parsed.data.expectedVersion);
    res.json({ status: "OK", version, columns: parsed.data.columns });
  } catch (error) {
    if (error instanceof Error && error.message === "SENSITIVITY_ACTIVE_DASHBOARD") {
      res.status(409).json({ error: { code: "SENSITIVITY_ACTIVE_DASHBOARD", message: "此 Dataset 仍有啟用中的 Dashboard，不能清空敏感欄位規則；請先停用相關 Dashboard，再進行規則調整。" } });
      return;
    }
    if (error instanceof Error && error.message === "SENSITIVITY_COLUMN_NOT_FOUND") {
      res.status(400).json({ error: { code: "SENSITIVITY_COLUMN_NOT_FOUND", message: "敏感欄位不在目前 Dataset 的已同步欄位清單中，請先執行查詢預覽同步欄位，再重新設定。" } });
      return;
    }
    if (error instanceof Error && error.message === "SENSITIVITY_AUDIT_TOO_LARGE") {
      res.status(400).json({ error: { code: "SENSITIVITY_AUDIT_TOO_LARGE", message: "敏感欄位規則異動內容超過稽核紀錄上限，請減少單次修改的欄位數量或縮短欄位名稱。" } });
      return;
    }
    if (error instanceof Error && error.message === "SENSITIVITY_VERSION_CONFLICT") {
      res.status(409).json({ error: { code: "SENSITIVITY_VERSION_CONFLICT", message: "其他管理者已更新敏感欄位規則，請重新載入後再修改。" } });
      return;
    }
    next(error);
  }
});
