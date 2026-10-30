import { getClientIp } from "../../utils/clientIp.js";
import { finalizeDeliveryAudit } from "../audit/deliveryAudit.repository.js";
import { safeAuditErrorCode, withErrorModule } from "../../middleware/safeErrorDiagnostic.js";
import { Router } from "express";
import { z } from "zod";
import { authenticateJwt, requirePermission } from "../auth/auth.middleware.js";
import { getParameterOptions } from "../dataset/dataset.service.js";
import { runtimeParameterDefinitions } from "../dataset/parameterSync.js";
import { listDatasetParameters } from "../dataset/parameter.repository.js";
import { resolveDateForRuntimeInput } from "../dataset/dateParameter.js";
import {
  listAccessibleQueries,
} from "./queryDefinition.repository.js";
import {
  completeAuditFailure,
  startAudit,
} from "../audit/audit.repository.js";
import {
  buildExcelFilename,
  createQueryExcel,
} from "../export/excelExport.service.js";
import {
  buildCsvFilename,
  createQueryCsv,
} from "../export/csvExport.service.js";
import { createQueryDelivery, createRuntimeIdentityVerifier, deliveryReportColumns, QueryDeliveryError } from "./queryDelivery.js";
import { DatasetDeliveryPolicyError } from "../dataset/datasetDeliveryPolicy.js";
import { DatasetDeliverySnapshotError } from "../dataset/datasetDeliveryPolicy.repository.js";
import { setQueryFavorite } from "./queryFavorite.repository.js";

const idSchema = z.coerce.number().int().positive().safe();
const executeBodySchema = z.object({
  values: z.record(z.string(), z.unknown()).default({}),
});

function sendRuntimeError(res: any, error: unknown): boolean {
  if (error instanceof QueryDeliveryError || error instanceof DatasetDeliveryPolicyError || error instanceof DatasetDeliverySnapshotError) {
    res.status(error instanceof QueryDeliveryError ? error.status : error instanceof DatasetDeliverySnapshotError && error.code === "DATASET_DELIVERY_SCHEMA_REQUIRED" ? 503 : 409)
      .json({ error: { code: error.code, message: "資料交付安全檢查未通過，請確認政策、版本及授權。", requestId: res.req?.id } });
    return true;
  }
  if (!(error instanceof Error)) return false;
  if (["PARAMETER_DEFINITION_MISMATCH", "PARAMETER_PARSE_FAILED", "MISSING_QUERY_PARAMETER"].includes(error.message.split(":")[0]!)) {
    res.status(409).json({ error: { code: error.message.split(":")[0], message: "查詢參數設定不完整，請通知報表設計者檢視參數差異。", requestId: res.req?.id } });
    return true;
  }

  if (error.message.startsWith("QUOTED_QUERY_PARAMETER:")) {
    const name = error.message.split(":")[1];
    res.status(400).json({
      error: {
        code: "QUOTED_QUERY_PARAMETER",
        message: `查詢設定錯誤：參數 {{${name}}} 外面不可加單引號，請通知報表設計者修正。`,
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
    res.status(400).json({ error: { code: "PARAMETER_DATE_INVALID", message: `參數 ${name} 必須是有效日期。` } });
    return true;
  }

  if (error.message.startsWith("PARAMETER_NUMBER_INVALID:")) {
    const name = error.message.split(":")[1];
    res.status(400).json({ error: { code: "PARAMETER_NUMBER_INVALID", message: `參數 ${name} 必須是有效數字。` } });
    return true;
  }

  if (error.message.startsWith("PARAMETER_")) {
    res.status(400).json({ error: { code: error.message.split(":")[0], message: "查詢參數格式不正確。" } });
    return true;
  }

  const dbError = error as Error & { code?: string; errorNum?: number };
  if (dbError.code === "ORA-01036" || dbError.errorNum === 1036) {
    res.status(400).json({
      error: {
        code: "ORACLE_BIND_INVALID",
        message: "查詢的 Oracle Bind Parameter 設定不正確，請通知報表設計者檢查 SQL 與參數設定。",
      },
    });
    return true;
  }

  if (dbError.code === "ORA-01861" || dbError.errorNum === 1861) {
    res.status(400).json({
      error: {
        code: "ORACLE_DATE_FORMAT_INVALID",
        message: "查詢日期格式與 Oracle 欄位型別不相符，請檢查日期參數設定。",
      },
    });
    return true;
  }

  return false;
}

export const defaultQueryRuntimeDependencies = {
  authenticate: authenticateJwt, identity: createRuntimeIdentityVerifier(), delivery: createQueryDelivery(),
  listAccessibleQueries, setQueryFavorite, listDatasetParameters, getParameterOptions,
  startAudit, finalizeDeliveryAudit, completeAuditFailure, createQueryCsv, createQueryExcel,
};
export function createQueryRuntimeRouter(deps = defaultQueryRuntimeDependencies) {
  const queryRuntimeRouter = Router();
  queryRuntimeRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  queryRuntimeRouter.use(deps.authenticate);

  queryRuntimeRouter.get("/", requirePermission("VIEW_QUERY"), async (req, res, next) => {
    try {
      res.json({ queries: await deps.listAccessibleQueries(req.authUser!.id) });
    } catch (error) { next(error); }
  });

  queryRuntimeRouter.put("/:id/favorite", requirePermission("VIEW_QUERY"), async (req, res, next) => {
    try {
      const id = idSchema.safeParse(req.params.id);
      const body = z.object({ isFavorite: z.boolean() }).safeParse(req.body);
      if (!id.success || !body.success) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "我的最愛設定格式不正確。",
          },
        });
        return;
      }

      await deps.setQueryFavorite(req.authUser!.id, id.data, body.data.isFavorite);
      res.json({ status: "OK", isFavorite: body.data.isFavorite });
    } catch (error) {
      if (error instanceof Error && error.message === "QUERY_NOT_FOUND") {
        res.status(404).json({
          error: {
            code: error.message,
            message: "找不到可加入我的最愛的查詢。",
          },
        });
        return;
      }
      next(error);
    }
  });

  queryRuntimeRouter.get("/:id", requirePermission("VIEW_QUERY"), async (req, res, next) => {
    try {
      const id = idSchema.safeParse(req.params.id);
      if (!id.success) {
        res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Query ID 不正確。" } });
        return;
      }

      const context = await deps.delivery.open(id.data, "VIEW", transaction => deps.identity(req.headers.authorization, transaction));
      const query = context.query, dataset = context.dataset;
      const savedParameters = await withErrorModule("dataset.parameters.load", () => deps.listDatasetParameters(query.datasetId));
      const parameters = await withErrorModule("dataset.parameters.validate", async () => runtimeParameterDefinitions(dataset.sqlText, savedParameters));
      const reportColumns = deliveryReportColumns(context.snapshot.policy, context.reports);
      await context.revalidate();
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
          runtimeDefaultValue: ["DATE","DATETIME"].includes(parameter.dataType)
            ? resolveDateForRuntimeInput(
                parameter.defaultValue,
                parameter.dataType as "DATE" | "DATETIME",
              )
            : parameter.defaultValue,
          dateOutputMode: parameter.dateOutputMode,
          dateCalendar: parameter.dateCalendar,
          dateFormat: parameter.dateFormat,
          displayOrder: parameter.displayOrder,
          placeholder: parameter.placeholder,
          helpText: parameter.helpText,
          optionMode: parameter.optionMode,
        })),
      });
    } catch (error) { if (sendRuntimeError(res, error)) return; next(error); }
  });

  queryRuntimeRouter.get("/:id/parameters/:name/options", requirePermission("VIEW_QUERY"), async (req, res, next) => {
    try {
      const id = idSchema.safeParse(req.params.id);
      const name = z.string().regex(/^[A-Z][A-Z0-9_]*$/).safeParse(req.params.name);
      if (!id.success || !name.success) {
        res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "參數識別資料不正確。" } });
        return;
      }

      const context = await deps.delivery.open(id.data, "VIEW", transaction => deps.identity(req.headers.authorization, transaction));
      const parameters = await deps.listDatasetParameters(context.query.datasetId);
      const parameter = parameters.find(p => p.name === name.data);
      if (!parameter) throw new QueryDeliveryError("PARAMETER_NOT_FOUND", 404);
      // Lookup Dataset delivery needs its own policy, auditing and provenance contract.
      if (!["NONE", "FIXED"].includes(parameter.optionMode)) throw new QueryDeliveryError("QUERY_LOOKUP_DELIVERY_NOT_READY", 503);
      const options = await deps.getParameterOptions(context.query.datasetId, name.data);
      await context.revalidate();
      res.json({ options });
    } catch (error) { if (sendRuntimeError(res, error)) return; next(error); }
  });

  for (const format of ["json", "csv", "excel"] as const) {
    const path = format === "json" ? "/:id/execute" : `/:id/export/${format}`;
    queryRuntimeRouter.post(path, requirePermission("VIEW_QUERY"), requirePermission("EXECUTE_QUERY"),
      ...(format === "json" ? [] : [requirePermission("EXPORT_QUERY")]), async (req, res, next) => {
      let auditId: number | null = null;
      const started = Date.now();
      try {
        const id = idSchema.safeParse(req.params.id), body = executeBodySchema.safeParse(req.body);
        if (!id.success || !body.success) throw new QueryDeliveryError("VALIDATION_ERROR", 400);
        const context = await deps.delivery.open(id.data, format === "json" ? "EXECUTE" : "EXPORT", transaction => deps.identity(req.headers.authorization, transaction));
        const query = context.query;
        auditId = await deps.startAudit({
          eventType: format === "json" ? "QUERY_EXECUTE" : format === "csv" ? "QUERY_EXPORT_CSV" : "QUERY_EXPORT_EXCEL",
          userId: context.actor.userId, queryDefinitionId: query.id, datasetId: query.datasetId,
          // Bind values can contain patient identifiers; standard usage audit stores no raw binds.
          parameters: null, ipAddress: getClientIp(req), userAgent: req.get("user-agent") ?? null,
        });
        if (!Number.isSafeInteger(auditId) || Number(auditId) <= 0) throw new QueryDeliveryError("QUERY_AUDIT_REQUIRED", 503);
        await context.revalidate();
        const delivery = await deps.delivery.execute(context, body.data.values);
        // Exporters only receive the policy-processed result and metadata.
        const payload = format === "csv" ? deps.createQueryCsv(delivery.result, delivery.reportColumns)
          : format === "excel" ? await deps.createQueryExcel(query.name, delivery.result, delivery.reportColumns)
          : JSON.stringify({ result: delivery.result, disclosureId: delivery.disclosureId });
        await context.revalidate();
        await deps.finalizeDeliveryAudit(auditId, { rowCount: delivery.result.rowCount, durationMs: Date.now() - started }, context.revalidate);
        if (format === "json") {
          res.type("json").send(payload);
        } else {
          const filename = format === "csv" ? buildCsvFilename(query.code) : buildExcelFilename(query.code);
          res.setHeader("Content-Type", format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
          res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
          res.send(payload);
        }
      } catch (error) {
        if (auditId) await deps.completeAuditFailure(auditId, {
          errorCode: safeAuditErrorCode(error), durationMs: Date.now() - started,
        }).catch(() => undefined);
        if (sendRuntimeError(res, error)) return;
        next(error);
      }
    });
  }
  return queryRuntimeRouter;
}
export const queryRuntimeRouter = createQueryRuntimeRouter();
