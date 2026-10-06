import { Router } from "express";
import { z } from "zod";
import { authenticateJwt, requirePermission } from "../auth/auth.middleware.js";
import { executeSavedDataset, getParameterOptions } from "../dataset/dataset.service.js";
import { listDatasetParameters } from "../dataset/parameter.repository.js";
import {
  getEffectiveQueryAccess,
  listAccessibleQueries,
} from "./queryDefinition.repository.js";
import {
  completeAuditFailure,
  completeAuditSuccess,
  startAudit,
} from "../audit/audit.repository.js";
import {
  buildExcelFilename,
  createQueryExcel,
} from "../export/excelExport.service.js";
import { listReportColumns } from "./reportColumn.repository.js";

const idSchema = z.coerce.number().int().positive();
const executeBodySchema = z.object({
  values: z.record(z.unknown()).default({}),
});

function sendRuntimeError(res: any, error: unknown): boolean {
  if (error instanceof Error && error.message.startsWith("PARAMETER_REQUIRED:")) {
    const name = error.message.split(":")[1];
    res.status(400).json({ error: { code: "PARAMETER_REQUIRED", message: `參數 ${name} 為必填。` } });
    return true;
  }
  if (error instanceof Error && error.message.startsWith("PARAMETER_")) {
    res.status(400).json({ error: { code: error.message.split(":")[0], message: "查詢參數格式不正確。" } });
    return true;
  }
  return false;
}

export const queryRuntimeRouter = Router();
queryRuntimeRouter.use(authenticateJwt);

queryRuntimeRouter.get("/", requirePermission("VIEW_QUERY"), async (req, res, next) => {
  try {
    res.json({ queries: await listAccessibleQueries(req.authUser!.id) });
  } catch (error) { next(error); }
});

queryRuntimeRouter.get("/:id", requirePermission("VIEW_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Query ID 不正確。" } });
      return;
    }

    const query = await getEffectiveQueryAccess(req.authUser!.id, id.data);
    if (!query?.canView) {
      res.status(404).json({ error: { code: "QUERY_NOT_FOUND", message: "找不到可使用的查詢。" } });
      return;
    }

    const parameters = await listDatasetParameters(query.datasetId);
    const reportColumns = await listReportColumns(query.id);
    res.json({
      query,
      reportColumns,
      parameters: parameters.map((parameter) => ({
        name: parameter.name,
        label: parameter.label,
        dataType: parameter.dataType,
        controlType: parameter.controlType,
        isRequired: parameter.isRequired,
        defaultValue: parameter.defaultValue,
        displayOrder: parameter.displayOrder,
        placeholder: parameter.placeholder,
        helpText: parameter.helpText,
        optionMode: parameter.optionMode,
      })),
    });
  } catch (error) { next(error); }
});

queryRuntimeRouter.get("/:id/parameters/:name/options", requirePermission("VIEW_QUERY"), async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const name = z.string().regex(/^[A-Z][A-Z0-9_]*$/).safeParse(req.params.name);
    if (!id.success || !name.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "參數識別資料不正確。" } });
      return;
    }

    const query = await getEffectiveQueryAccess(req.authUser!.id, id.data);
    if (!query?.canView) {
      res.status(404).json({ error: { code: "QUERY_NOT_FOUND", message: "找不到可使用的查詢。" } });
      return;
    }

    res.json({ options: await getParameterOptions(query.datasetId, name.data) });
  } catch (error) { next(error); }
});

queryRuntimeRouter.post("/:id/execute", requirePermission("EXECUTE_QUERY"), async (req, res, next) => {
  let auditId: number | null = null;
  let started = Date.now();

  try {
    const id = idSchema.safeParse(req.params.id);
    const body = executeBodySchema.safeParse(req.body);

    if (!id.success || !body.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "查詢參數格式不正確。" } });
      return;
    }

    const query = await getEffectiveQueryAccess(req.authUser!.id, id.data);
    if (!query?.canExecute) {
      res.status(403).json({ error: { code: "QUERY_EXECUTE_FORBIDDEN", message: "沒有執行此查詢的權限。" } });
      return;
    }

    started = Date.now();
    auditId = await startAudit({
      eventType: "QUERY_EXECUTE",
      userId: req.authUser!.id,
      queryDefinitionId: query.id,
      datasetId: query.datasetId,
      parameters: body.data.values,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") ?? null,
    });

    const result = await executeSavedDataset(query.datasetId, body.data.values);

    await completeAuditSuccess(auditId, {
      rowCount: result.rowCount,
      durationMs: Date.now() - started,
    }).catch(() => undefined);

    res.json({ result });
  } catch (error) {
    if (auditId) {
      await completeAuditFailure(auditId, {
        errorCode: error instanceof Error ? error.message : "UNKNOWN_ERROR",
        durationMs: Date.now() - started,
      }).catch(() => undefined);
    }

    if (sendRuntimeError(res, error)) return;
    next(error);
  }
});

queryRuntimeRouter.post("/:id/export/excel", requirePermission("EXPORT_QUERY"), async (req, res, next) => {
  let auditId: number | null = null;
  let started = Date.now();

  try {
    const id = idSchema.safeParse(req.params.id);
    const body = executeBodySchema.safeParse(req.body);

    if (!id.success || !body.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "匯出參數格式不正確。" } });
      return;
    }

    const query = await getEffectiveQueryAccess(req.authUser!.id, id.data);
    if (!query?.canExport) {
      res.status(403).json({ error: { code: "QUERY_EXPORT_FORBIDDEN", message: "沒有匯出此查詢的權限。" } });
      return;
    }

    started = Date.now();
    auditId = await startAudit({
      eventType: "QUERY_EXPORT_EXCEL",
      userId: req.authUser!.id,
      queryDefinitionId: query.id,
      datasetId: query.datasetId,
      parameters: body.data.values,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") ?? null,
    });

    const result = await executeSavedDataset(query.datasetId, body.data.values);
    const reportColumns = await listReportColumns(query.id);
    const buffer = await createQueryExcel(query.name, result, reportColumns);
    const filename = buildExcelFilename(query.code);

    await completeAuditSuccess(auditId, {
      rowCount: result.rowCount,
      durationMs: Date.now() - started,
    }).catch(() => undefined);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    if (auditId) {
      await completeAuditFailure(auditId, {
        errorCode: error instanceof Error ? error.message : "UNKNOWN_ERROR",
        durationMs: Date.now() - started,
      }).catch(() => undefined);
    }

    if (sendRuntimeError(res, error)) return;
    next(error);
  }
});
