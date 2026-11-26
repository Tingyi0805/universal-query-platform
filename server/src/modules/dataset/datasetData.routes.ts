import { getClientIp } from "../../utils/clientIp.js";
import { syncDatasetColumns, DatasetColumnSyncError } from "./column.repository.js";
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
import { datasetColumnCandidate, DatasetColumnCandidateError } from "./datasetColumnCandidate.js";

export const defaultDatasetDataRouteDependencies = {
  delivery: createDatasetDataDelivery(), identity: createRuntimeIdentityVerifier(),
  startAudit, completeAuditFailure, finalizeDeliveryAudit,
  candidate: datasetColumnCandidate, syncColumns: syncDatasetColumns,
};
const idSchema = z.coerce.number().int().positive().safe();
const valuesSchema = { values: z.record(z.string(), z.unknown()).default({}), maxRows: z.number().int().min(1).max(10000).optional() };
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
        ipAddress: getClientIp(req), userAgent: req.get("user-agent") ?? null });
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

  // Metadata-only design aid. This is never an initialized or trusted field snapshot.
  router.get("/:id/column-candidates", ...guard, async (req, res, next) => {
    let auditId: number | null = null;
    const started = Date.now();
    try {
      const datasetId = idSchema.parse(req.params.id);
      const context = await deps.candidate.open(datasetId);
      // Revalidate caller token/role before and after the external describe.
      const actor = await deps.identity(req.headers.authorization);
      auditId = await deps.startAudit({ eventType: "DATASET_COLUMN_CANDIDATE_DESCRIPTION",
        datasetId, userId: actor.userId,
        parameters: { purpose: "METADATA_ONLY_UNBOUND_CANDIDATE",
          definitionVersion: context.definitionVersion, configurationVersion: context.configurationVersion },
        ipAddress: getClientIp(req), userAgent: req.get("user-agent") ?? null });
      if (!Number.isSafeInteger(auditId) || auditId <= 0)
        throw new DatasetColumnCandidateError("DATASET_COLUMN_DESCRIPTION_FAILED", 503);
      await context.revalidate();
      const candidate = await context.describe();
      await context.revalidate();
      const actorAfter = await deps.identity(req.headers.authorization);
      if (actorAfter.userId !== actor.userId || actorAfter.tokenVersion !== actor.tokenVersion
        || !["DESIGN_QUERY", "EXECUTE_QUERY"].every(p => actorAfter.permissions.includes(p)))
        throw new DatasetColumnCandidateError("DATASET_COLUMN_DESCRIPTION_CONFLICT");
      await deps.finalizeDeliveryAudit(auditId, { rowCount: 0, durationMs: Date.now() - started },
        async () => { await context.revalidate(); const again = await deps.identity(req.headers.authorization);
          if (again.userId !== actor.userId || again.tokenVersion !== actor.tokenVersion
            || !["DESIGN_QUERY", "EXECUTE_QUERY"].every(p => again.permissions.includes(p)))
            throw new DatasetColumnCandidateError("DATASET_COLUMN_DESCRIPTION_CONFLICT"); });
      res.json({ ...candidate, definitionVersion: context.definitionVersion,
        configurationVersion: context.configurationVersion, metadataState: "NOT_INITIALIZED",
        deliveryAllowed: false });
    } catch (error) {
      if (auditId !== null) await deps.completeAuditFailure(auditId,
        { errorCode: error instanceof DatasetColumnCandidateError ? error.code : safeAuditErrorCode(error),
          durationMs: Date.now() - started }).catch(() => undefined);
      next(error);
    }
  });

  // Persist metadata solely as field choices for explicit Dataset rules. It
  // never creates patient metadata, 923 evidence, a policy or delivery authority.
  router.post("/:id/columns/sync", ...guard, async (req, res, next) => {
    let auditId: number | null = null;
    let descriptionAudited = false;
    const started = Date.now();
    try {
      const id = idSchema.parse(req.params.id);
      z.object({}).strict().parse(req.body);
      const actor = await deps.identity(req.headers.authorization);
      const authorize = async (transaction?: sql.Transaction) => {
        const current = await deps.identity(req.headers.authorization, transaction);
        if (current.userId !== actor.userId || current.tokenVersion !== actor.tokenVersion
          || !["DESIGN_QUERY", "EXECUTE_QUERY"].every(p => current.permissions.includes(p)))
          throw new QueryDeliveryError("FORBIDDEN", 403);
      };
      await authorize();
      const context = await deps.candidate.open(id);
      auditId = await deps.startAudit({ eventType: "DATASET_COLUMN_CANDIDATE_DESCRIPTION", datasetId: id, userId: actor.userId,
        parameters: { purpose: "DISPLAY_COLUMN_OPTIONS_ONLY", definitionVersion: context.definitionVersion,
          configurationVersion: context.configurationVersion }, ipAddress: getClientIp(req), userAgent: req.get("user-agent") ?? null });
      if (!Number.isSafeInteger(auditId) || auditId <= 0) { auditId = null; throw new DatasetColumnSyncError("DATASET_COLUMN_SYNC_FAILED"); }
      const description = await context.describe();
      await context.revalidate();
      await authorize();
      await deps.finalizeDeliveryAudit(auditId, { rowCount: 0, durationMs: Date.now() - started }, async () => {
        await context.revalidate(); await authorize();
      });
      descriptionAudited = true;
      await deps.syncColumns(id, [...description.columns], { dataSourceId: context.dataSourceId,
        definitionVersion: context.definitionVersion, configurationVersion: context.configurationVersion,
        userId: actor.userId, reauthorize: authorize, revalidateParameters: context.revalidateParameters });
      res.json({ columns: description.columns, trust: "UNBOUND_CANDIDATE", purpose: "DISPLAY_COLUMN_OPTIONS_ONLY",
        deliveryAllowed: false });
    } catch (error) {
      if (auditId !== null && !descriptionAudited) await deps.completeAuditFailure(auditId,
        { errorCode: safeAuditErrorCode(error), durationMs: Date.now() - started }).catch(() => undefined);
      next(error);
    }
  });

  router.get("/:id/design-preview/context", ...guard, async (req, res, next) => {
    try {
      const id = idSchema.parse(req.params.id);
      const context = await deps.delivery.open(id, identity(req), "DESIGN_CONTEXT");
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
        purpose: context.purpose, definitionVersion: context.snapshot.definitionVersion,
        sensitivityVersion: context.snapshot.sensitivityVersion, patientAuditVersion: context.snapshot.patientAuditVersion,
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
    if (error instanceof z.ZodError || error instanceof QueryDeliveryError || error instanceof DatasetDeliveryPolicyError || error instanceof DatasetDeliverySnapshotError || error instanceof DatasetColumnCandidateError || error instanceof DatasetColumnSyncError) {
      const status = error instanceof z.ZodError ? 400 : error instanceof QueryDeliveryError ? error.status
        : error instanceof DatasetColumnSyncError ? 409
        : error instanceof DatasetColumnCandidateError ? error.status
        : error instanceof DatasetDeliverySnapshotError && error.code === "DATASET_DELIVERY_SCHEMA_REQUIRED" ? 503 : 409;
      res.status(status).json({ error: { code: error instanceof z.ZodError ? "VALIDATION_ERROR" : error.code,
        message: datasetPreviewGuidance(error instanceof z.ZodError ? "VALIDATION_ERROR" : error.code), requestId: _req.id } });
      return;
    }
    next(error);
  }) satisfies import("express").ErrorRequestHandler);
  return router;
}

// Fixed messages only: never expose candidate SQL, driver errors or policy values.
export function datasetPreviewGuidance(code: string): string {
  const messages: Record<string, string> = {
    DATASET_COLUMN_PARAMETERS_NOT_SYNCED: "SQL 參數尚未同步至已儲存定義，請先在參數設定中同步並儲存，再取得欄位；不需要先確認敏感政策。",
    DATASET_COLUMN_DESCRIPTION_LIST_UNSUPPORTED: "MULTISELECT 缺少固定展開長度契約，無法安全探索欄位；請先以標量參數查詢設定欄位，不會猜測清單長度或執行資料查詢。",
    DATASET_COLUMN_DESCRIPTION_INVALID_COLUMNS: "結果欄位需有唯一且非空白的別名、連續順序及可支援型別。請用 AS 設定不同欄名（最多 256 字元）後儲存再同步。",
    DATASET_COLUMN_SYNC_CONFLICT: "Dataset、來源或參數已變更，請重新儲存並取得欄位。",
    DATASET_SENSITIVITY_COLUMNS_STALE: "同步將移除既有規則的欄位，已停止同步並保留設定，請檢查 SQL 別名。",
    DATASET_COLUMN_SYNC_FAILED: "欄位同步、授權重驗或稽核失敗；未回報成功，請重新載入確認。",
    DATASET_COLUMN_DESCRIPTION_UNSUPPORTED: "無法安全解析 SQL 或參數型別。請先儲存 SQL、同步參數定義，並確認使用標量 {{參數}}；SQL Server 必須能推導型別，Oracle 必須支援 statement-info。請為未知型別加上明確 CAST；不會執行資料查詢補救。",
    DATASET_COLUMN_DESCRIPTION_CONFLICT: "欄位描述期間 Dataset、來源或權限發生變更，請重新載入再試。",
    DATASET_COLUMN_DESCRIPTION_FAILED: "無法取得欄位候選描述，請管理者檢查來源與稽核服務；未執行資料列查詢。",
    DATASET_COLUMN_DESCRIPTION_SNAPSHOT_FAILED: "無法讀取或重新驗證 Dataset／來源版本，欄位探索未完成；請依 Request ID 查核平台資料庫及版本狀態。",
    DATASET_COLUMN_DESCRIPTION_SOURCE_FAILED: "無法取得資料來源設定，欄位探索未完成；請依 Request ID 查核來源設定服務。",
    DATASET_COLUMN_DESCRIPTION_DRIVER_FAILED: "Metadata Describe 未完成；請依 Request ID 檢查來源連線與描述程序，未執行資料列查詢。",
    DATASET_COLUMN_DESCRIPTION_CONNECT_FAILED: "無法連接 SQL Server 資料來源；請確認資料來源主機、連接埠、TLS 設定與測試連線。未執行資料列查詢。",
    DATASET_COLUMN_DESCRIPTION_INFERENCE_FAILED: "SQL Server 無法推導查詢參數型別；請確認來源權限與標量參數。未執行資料列查詢。",
    DATASET_COLUMN_DESCRIPTION_RPC_FAILED: "SQL Server 的 sp_describe_first_result_set 欄位描述程序未成功；請用同一資料來源帳號檢查 Describe 權限、SQL Server 版本與 SQL 語法。未執行資料列查詢。",
    DATASET_COLUMN_DESCRIPTION_CLEANUP_FAILED: "SQL Server Metadata Describe 連線清理失敗，操作未完成；請依 Request ID 查核來源連線服務。",
    DATASET_CANDIDATE_PREVIEW_UNAVAILABLE: "請先儲存 Dataset；SQL／資料來源有修改時，須儲存後才可預覽。",
    MANAGER_PREVIEW_APPROVAL_REQUIRED: "管理者須重新核准目前已儲存的 SQL 與資料來源版本，才能執行管理者預覽。",
    MANAGER_PREVIEW_APPROVAL_UNAVAILABLE: "無法讀取管理者核准紀錄，請依 Request ID 檢查平台資料庫。",
    MANAGER_PREVIEW_LEGACY_PROTECTION_REQUIRED: "此 Dataset 仍有既有欄位或患者設定，尚未完成轉換，不會自動解除既有保護。",
    DATASET_PREVIEW_VERSION_REQUIRED: "缺少預覽定義版本，請重新載入 Dataset 後重試。",
    DATASET_DELIVERY_VERSION_CONFLICT: "Dataset 定義、來源或安全設定已變更，請重新載入並確認後再預覽。",
    DATASET_DELIVERY_POLICY_UNCONFIRMED: "此 Dataset 尚無系統已確認的資料保護政策，預覽維持禁止。管理者只核准是否可使用，不需逐欄設定；系統安全條件尚未就緒，不會自動交付資料。",
    DATASET_DELIVERY_POLICY_REQUIRED: "Dataset 缺少有效的資料保護政策，預覽不會交付資料；管理者使用核准不能解除原有遮蔽與患者稽核要求。",
    DATASET_DELIVERY_POLICY_INVALID: "欄位保護政策或遮蔽規則無效，預覽已拒絕。請管理者重新查核可信欄位與保護規則，不可解除遮蔽繞過。",
    DATASET_DELIVERY_POLICY_UNAVAILABLE: "無法讀取安全政策，請管理者檢查服務狀態後重試；資料不會交付。",
    PATIENT_AUDIT_NOT_CONFIRMED: "患者稽核尚未確認。請檢查可信欄位、患者識別欄位與 HMAC 金鑰；新 Dataset 缺少可信 metadata 時須由管理者安排初始化，不可停用稽核繞過。",
    DATASET_PREVIEW_INITIALIZATION_REQUIRED: "Dataset 系統安全初始化尚未完成，預覽維持拒絕；即使管理者已核准使用，也不能直接放行未確認的敏感或患者資料。患者 Dataset 仍須符合可信欄位、患者識別及揭露稽核。",
    FORBIDDEN: "預覽需要 DESIGN_QUERY 與 EXECUTE_QUERY 權限，請管理者確認授權。",
    DATASET_NOT_AVAILABLE: "Dataset 已停用或封存，請確認狀態後再預覽。",
    DATASOURCE_NOT_AVAILABLE: "資料來源不可用，請管理者確認來源狀態。",
    DATASET_DELIVERY_SCHEMA_REQUIRED: "安全 Schema 尚未就緒，請聯絡管理者；不可略過檢查。",
    VALIDATION_ERROR: "預覽請求格式不正確，請重新載入並確認設定。",
  };
  return messages[code] ?? "Dataset 安全檢查未通過，請管理者依錯誤代碼與 Request ID 檢查設定及稽核服務。";
}
