import { QuerySourceError } from "./dashboardQuerySources.service.js";
import { Router, type Request } from "express";
import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";
import { z } from "zod";
import { assertDatasetSensitivityPolicy, assertDashboardResultColumns, dashboardQueryParameters, resolveDashboardDisclosureMasks,
  maskDeviceRows, resolveDeviceColumnMask } from "./dashboardDeviceMasking.js";

type Repositories = typeof import("./dashboard.repository.js");
export type DashboardPreviewDependencies = {
  getDashboard: Repositories["getDashboard"];
  getSession: typeof import("../auth/auth.repository.js").getTokenSessionState;
  getQuery: typeof import("../queryDefinition/queryDefinition.repository.js").getQueryDefinition;
  getAccess: typeof import("../queryDefinition/queryDefinition.repository.js").getEffectiveQueryAccess;
  getDataset: typeof import("../dataset/dataset.repository.js").getDataset;
  getPolicy: typeof import("../dataset/datasetSensitiveColumn.repository.js").getDatasetSensitivitySnapshot;
  getSources: typeof import("./dashboardDataSource.repository.js").listDashboardDataSources;
  getReportColumns: typeof import("../queryDefinition/reportColumn.repository.js").listReportColumns;
  legacyGuard: (id: number) => Promise<void>;
  execute: typeof import("../dataset/dataset.service.js").executeSavedDataset;
  audit: typeof import("../audit/patientDisclosure.service.js").auditPatientListIfConfigured;
};
class PreviewFailure extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
/** Mounted after authenticateJwt; every disclosure rechecks the current session/ACL/policy. */
export function createDashboardPreviewRouter(deps: DashboardPreviewDependencies) {
  const router = Router();
  const readState = async (req: Request, id: number, key?: string) => {
    if (!req.authUser) throw new PreviewFailure("UNAUTHORIZED", 401);
    const payload = jwt.decode(req.header("Authorization")?.slice(7) ?? "");
    if (!payload || typeof payload === "string" || Number(payload.sub) !== req.authUser.id || !Number.isSafeInteger(payload.tokenVersion))
      throw new PreviewFailure("INVALID_TOKEN", 401);
    const session = await deps.getSession(req.authUser.id);
    if (!session?.isActive || session.tokenVersion !== payload.tokenVersion) throw new PreviewFailure("TOKEN_REVOKED", 401);
    const canDesign = session.permissions.includes("DESIGN_QUERY");
    if (!session.permissions.includes("EXECUTE_QUERY") || (key && !canDesign)) throw new PreviewFailure("FORBIDDEN", 403);
    const dashboard = await deps.getDashboard(id);
    if (!dashboard) throw new PreviewFailure("DASHBOARD_NOT_FOUND", 404);
    if (!canDesign && !dashboard.isActive) throw new PreviewFailure("DASHBOARD_NOT_AVAILABLE", 403);
    await deps.legacyGuard(id); // No Query-only binding may fall back to historical DatasetId.
    const query = await deps.getQuery(dashboard.queryDefinitionId);
    if (!query?.isPublished || !query.isActive || query.isArchived) throw new PreviewFailure("DASHBOARD_QUERY_NOT_AVAILABLE", 409);
    const access = await deps.getAccess(req.authUser.id, query.id);
    if (!access?.canView || !access.canExecute) throw new PreviewFailure("DASHBOARD_EXECUTE_FORBIDDEN", 403);
    const source = key ? (await deps.getSources(id)).find(s => s.sourceKey === key && s.isEnabled) : undefined;
    if (key && !source) throw new PreviewFailure("DASHBOARD_SOURCE_NOT_FOUND", 404);
    const dataset = await deps.getDataset(source?.datasetId ?? query.datasetId);
    if (!dataset?.isActive || dataset.isArchived) throw new PreviewFailure("DATASET_NOT_AVAILABLE", 409);
    const policy = await deps.getPolicy(dataset.id);
    assertDatasetSensitivityPolicy(policy);
    const reportColumns = key ? [] : await deps.getReportColumns(query.id);
    const fingerprint = createHash("sha256").update(JSON.stringify({ session, dashboard, query, access, source, dataset, policy, reportColumns })).digest("hex");
    return { fingerprint, dashboard, query, source, dataset, policy, reportColumns };
  };
  const deliver = async (req: Request, res: import("express").Response, key?: string) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const id = z.coerce.number().int().positive().safe().parse(req.params.id);
      const initial = await readState(req, id, key);
      const { dashboard, query, source, dataset, policy } = initial;
      const parameters = dashboardQueryParameters(dashboard.parameters);
      // No raw-result cache/fallback; shared paging runtime remains unchanged.
      const raw = await deps.execute(dataset.id, source?.parameters ?? parameters, source ? 100 : undefined);
      if ((await readState(req, id, key)).fingerprint !== initial.fingerprint) throw new PreviewFailure("DASHBOARD_PREVIEW_STATE_CHANGED", 409);
      assertDashboardResultColumns(raw.columns);
      const masks = resolveDashboardDisclosureMasks(dashboard.parameters, key ?? "PRIMARY", policy.columns);
      const columns = raw.columns.filter(c => resolveDeviceColumnMask(c.name, masks) !== "OMIT");
      const rows = maskDeviceRows(raw.rows, masks, policy.columns);
      let disclosureId: number | null;
      try { disclosureId = await deps.audit({ datasetId: dataset.id, queryDefinitionId: query.id, userId: req.authUser!.id,
        sourceScope: `datasource:${dataset.dataSourceId}`, deliveryType: "DASHBOARD", masked: true, rows: raw.rows }); }
      catch { throw new PreviewFailure("PATIENT_AUDIT_FAILED", 503); }
      if (raw.rows.length && disclosureId === null) throw new PreviewFailure("PATIENT_AUDIT_NOT_CONFIGURED", 503);
      if ((await readState(req, id, key)).fingerprint !== initial.fingerprint) throw new PreviewFailure("DASHBOARD_PREVIEW_STATE_CHANGED", 409);
      const result = { ...raw, columns, rows };
      if (source) res.json({ sourceKey: key, refreshSeconds: source.refreshSeconds, pageSize: source.pageSize,
        pageSeconds: source.pageSeconds, sensitivityVersion: policy.version, result, disclosureId });
      else {
        const { parameters: _private, ...safeDashboard } = dashboard;
        res.json({ dashboard: safeDashboard, query: { id: query.id, code: query.code, name: query.name },
          reportColumns: initial.reportColumns.filter(c => columns.some(column => column.name.toUpperCase() === c.columnName.toUpperCase())),
          result, disclosureId });
      }
    } catch (error) {
      const parameter = error instanceof Error && /^PARAMETER_[A-Z_]+(?::|$)/.test(error.message);
      const code = error instanceof PreviewFailure || error instanceof QuerySourceError ? error.code : parameter ? "DASHBOARD_PARAMETERS_INVALID" :
        error instanceof z.ZodError ? "VALIDATION_ERROR" : error instanceof Error && ["DASHBOARD_SENSITIVITY_POLICY_INVALID", "DASHBOARD_SENSITIVITY_POLICY_REQUIRED", "DASHBOARD_COLUMNS_AMBIGUOUS"].includes(error.message) ? error.message : "DASHBOARD_PREVIEW_FAILED";
      const status = error instanceof PreviewFailure || error instanceof QuerySourceError ? error.status : parameter || error instanceof z.ZodError ? 400 : 503;
      res.status(status).json({ error: { code, message: "Dashboard 來源預覽未完成；請檢查授權、參數與保護設定。", requestId: req.id } });
    }
  };
  router.post("/:id/preview", (req, res) => deliver(req, res));
  router.post("/:id/data-sources/:sourceKey/preview", (req, res) => {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(req.params.sourceKey ?? "")) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR" } }); return;
    }
    return deliver(req, res, req.params.sourceKey);
  });
  return router;
}
