import type sql from "mssql";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { extractParameterNames } from "../../query/queryCompiler.js";
import { safeAuditErrorCode } from "../../middleware/safeErrorDiagnostic.js";
import { requirePermission } from "../auth/auth.middleware.js";
import { startAudit, completeAuditFailure } from "../audit/audit.repository.js";
import { finalizeDeliveryAudit } from "../audit/deliveryAudit.repository.js";
import { createRuntimeIdentityVerifier, QueryDeliveryError } from "../queryDefinition/queryDelivery.js";
import { DatasetDeliveryPolicyError } from "./datasetDeliveryPolicy.js";
import { DatasetDeliverySnapshotError } from "./datasetDeliveryPolicy.repository.js";
import { createDatasetDataDelivery } from "./datasetDataDelivery.js";
import { createPatientAuditPreview } from "./patientAuditPreview.js";

export const defaultDatasetDataRouteDependencies = {
  delivery: createDatasetDataDelivery(), identity: createRuntimeIdentityVerifier(),
  startAudit, completeAuditFailure, finalizeDeliveryAudit,
};
const idSchema = z.coerce.number().int().positive().safe();
const valuesSchema = { values: z.record(z.unknown()).default({}), maxRows: z.number().int().min(1).max(10000).optional() };
const savedSchema = z.object(valuesSchema).strict();
const rawSchema = savedSchema.extend({ expectedDefinitionVersion: z.string().regex(/^[0-9a-f]{16}$/) });
const candidateSchema = z.object({ ...valuesSchema, datasetId: idSchema.optional(), dataSourceId: idSchema,
  sqlText: z.string().min(1).max(200000), expectedDefinitionVersion: z.string().optional(),
  queryTimeoutSec: z.number().int().min(1).max(300).nullable().optional() }).strict();

export function createDatasetDataRouter(deps = defaultDatasetDataRouteDependencies) {
  const router = Router();
  const identity = (req: Request) => (transaction?: sql.Transaction) => deps.identity(req.headers.authorization, transaction);
  const preparePreview = createPatientAuditPreview(deps.delivery);
  type Validation = { revalidate: (transaction?: sql.Transaction) => Promise<void> };

  async function audited(req: Request, res: Response, context: Validation, datasetId: number, eventType: string,
    parameters: Record<string, unknown>, run: () => Promise<{ payload: unknown; rowCount: number }>) {
    let auditId: number | null = null;
    const started = Date.now();
    try {
      const actor = await deps.identity(req.headers.authorization);
      auditId = await deps.startAudit({ eventType, datasetId, userId: actor.userId, parameters,
        ipAddress: req.ip, userAgent: req.get("user-agent") ?? null });
      if (!Number.isSafeInteger(auditId) || Number(auditId) <= 0) throw new QueryDeliveryError("DELIVERY_AUDIT_REQUIRED", 503);
      await context.revalidate();
      const { payload, rowCount } = await run();
      const json = JSON.stringify(payload);
      await context.revalidate();
      await deps.finalizeDeliveryAudit(auditId, { rowCount, durationMs: Date.now() - started }, context.revalidate);
      res.type("json").send(json);
    } catch (error) {
      if (auditId) await deps.completeAuditFailure(auditId, { errorCode: safeAuditErrorCode(error), durationMs: Date.now() - started }).catch(() => undefined);
      throw error;
    }
  }
  const guard = [requirePermission("DESIGN_QUERY"), requirePermission("EXECUTE_QUERY")];
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

  router.get("/:id/design-preview/context", ...guard, async (req, res, next) => {
    try {
      const id = idSchema.parse(req.params.id);
      const context = await deps.delivery.open(id, identity(req));
      await context.revalidate();
      res.json({ datasetId: id, definitionVersion: context.snapshot.definitionVersion,
        sensitivityVersion: context.snapshot.sensitivityVersion, patientAuditVersion: context.snapshot.patientAuditVersion });
    } catch (error) { next(error); }
  });

  router.post("/preview/run", ...guard, async (req, res, next) => {
    try {
      const input = candidateSchema.parse(req.body);
      const context = await preparePreview(input, identity(req));
      await audited(req, res, context, context.dataset.id, "DATASET_DESIGN_PREVIEW", {
        purpose: "RAW_DESIGN", definitionVersion: context.snapshot.definitionVersion,
      }, async () => {
        const result = await deps.delivery.execute(context, input.values, input.maxRows);
        return { payload: { ...result, parameterNames: extractParameterNames(context.dataset.sqlText) }, rowCount: result.result.rowCount };
      });
    } catch (error) { next(error); }
  });

  for (const raw of [false, true]) router.post(raw ? "/:id/design-preview" : "/:id/execute", ...guard, async (req, res, next) => {
    try {
      const id = idSchema.parse(req.params.id);
      const input = raw ? rawSchema.parse(req.body) : savedSchema.parse(req.body);
      const context = await deps.delivery.open(id, identity(req), raw ? "RAW_DESIGN" : "STANDARD",
        "expectedDefinitionVersion" in input && typeof input.expectedDefinitionVersion === "string" ? input.expectedDefinitionVersion : undefined);
      await audited(req, res, context, id, raw ? "DATASET_DESIGN_PREVIEW" : "DATASET_EXECUTE", {
        purpose: context.purpose, definitionVersion: context.snapshot.definitionVersion,
      }, async () => {
        const result = await deps.delivery.execute(context, input.values, input.maxRows);
        return { payload: result, rowCount: result.result.rowCount };
      });
    } catch (error) { next(error); }
  });

  router.get("/:id/parameters/:name/options", ...guard, async (req, res, next) => {
    try {
      const id = idSchema.parse(req.params.id), name = z.string().regex(/^[A-Z][A-Z0-9_]*$/).parse(req.params.name);
      const parent = await deps.delivery.open(id, identity(req));
      const plan = await deps.delivery.prepareOptions(parent, name);
      await audited(req, res, plan, plan.source?.dataset.id ?? id, "DATASET_PARAMETER_LOOKUP", {
        parentDatasetId: id, sourceDatasetId: plan.source?.dataset.id ?? null, parameterName: name,
      }, async () => {
        const options = await deps.delivery.options(plan);
        return { payload: { options }, rowCount: options.length };
      });
    } catch (error) { next(error); }
  });

  router.use(((error, _req, res, next) => {
    if (error instanceof z.ZodError || error instanceof QueryDeliveryError || error instanceof DatasetDeliveryPolicyError || error instanceof DatasetDeliverySnapshotError) {
      const status = error instanceof z.ZodError ? 400 : error instanceof QueryDeliveryError ? error.status
        : error instanceof DatasetDeliverySnapshotError && error.code === "DATASET_DELIVERY_SCHEMA_REQUIRED" ? 503 : 409;
      res.status(status).json({ error: { code: error instanceof z.ZodError ? "VALIDATION_ERROR" : error.code,
        message: "Dataset 資料交付安全檢查未通過。", requestId: _req.id } });
      return;
    }
    next(error);
  }) satisfies import("express").ErrorRequestHandler);
  return router;
}
