import { dashboardSecurityFailure } from "./dashboardSecurityFailure.js";
import { getDatasetPatientAuditConfig } from "../dataset/patientAuditConfig.repository.js";
import { Router, type Request } from "express";
import { z } from "zod";
import { createHash } from "node:crypto";
import { getClientIp } from "../../utils/clientIp.js";
import { assertDatasetSensitivityPolicy, assertDashboardResultColumns, dashboardQueryParameters, resolveDashboardDisclosureMasks, maskDeviceRows, resolveDeviceColumnMask } from "./dashboardDeviceMasking.js";
import { createDashboardPageSnapshot, getDashboardPageSnapshot, resolveDashboardSnapshotSeconds, type DashboardSnapshotKind } from "./dashboardPageSnapshot.js";
import { dashboardQueryExecutor } from "./dashboardQueryExecutor.js";

export type DevicePageDependencies = {
  getApprovalEvidence: (id: number) => Promise<string>;
  legacySourceIsQueryBound?: (id: number, key: string) => Promise<boolean>;
  getQueryAccessRevision: typeof import("../queryDefinition/queryAccess.repository.js").getQueryAccessRevision;
  checkDashboardDisplayDevice: typeof import("./dashboardDevice.repository.js").checkDashboardDisplayDevice;
  getDashboard: typeof import("./dashboard.repository.js").getDashboard;
  getQueryDefinition: typeof import("../queryDefinition/queryDefinition.repository.js").getQueryDefinition;
  getDataset: typeof import("../dataset/dataset.repository.js").getDataset;
  getDatasetSensitivitySnapshot: typeof import("../dataset/datasetSensitiveColumn.repository.js").getDatasetSensitivitySnapshot;
  getDashboardLayout: typeof import("./dashboardLayout.repository.js").getDashboardLayout;
  listDashboardDataSources: typeof import("./dashboardDataSource.repository.js").listDashboardDataSources;
  executeSavedDataset: typeof import("../dataset/dataset.service.js").executeSavedDataset;
  auditPatientListIfConfigured: typeof import("../audit/patientDisclosure.service.js").auditPatientListIfConfigured;
  getPatientAuditConfig?: typeof getDatasetPatientAuditConfig;
  listReportColumns: typeof import("../queryDefinition/reportColumn.repository.js").listReportColumns;
  listDatasetParameters: typeof import("../dataset/parameter.repository.js").listDatasetParameters;
  getDataSourcePlaybackState: typeof import("../datasource/datasource.repository.js").getDataSourcePlaybackState;
};
const idSchema = z.coerce.number().int().positive();
const getDeviceToken = (req: Request) => req.header("X-Dashboard-Device-Token") ?? "";
const getRequestSourceIp = (req: Request) => getClientIp(req) ?? "";

/** Production handlers accept repositories as dependencies so HTTP tests exercise the real boundary. */
export function createDashboardDevicePageRouter(deps: DevicePageDependencies) {
  const { getQueryAccessRevision, checkDashboardDisplayDevice, getDashboard, getQueryDefinition, getDataset, getDatasetSensitivitySnapshot, getDashboardLayout, listDashboardDataSources, executeSavedDataset, auditPatientListIfConfigured, listReportColumns, listDatasetParameters, getDataSourcePlaybackState } = deps;
  const dashboardRouter = Router();
  const readState = async (dashboardId: number, token: string, ip: string, sourceKey?: string) => {
    if (!token) throw new DeliveryError(401, "DASHBOARD_DEVICE_UNAUTHORIZED");
    const verification = await checkDashboardDisplayDevice(dashboardId, token, ip);
    if (verification.status !== "VALID") throw new DeliveryError(401, "DASHBOARD_DEVICE_UNAUTHORIZED");
    const dashboard = await getDashboard(dashboardId);
    if (!dashboard?.isActive) throw new DeliveryError(409, "DASHBOARD_NOT_AVAILABLE");
    if (await deps.legacySourceIsQueryBound?.(dashboardId, sourceKey ?? "PRIMARY"))
      throw new DeliveryError(409, "QUERY_SOURCE_MODE_NOT_ACTIVATED");
    const query = await getQueryDefinition(dashboard.queryDefinitionId);
    if (!query?.isPublished || !query.isActive || query.isArchived) throw new DeliveryError(409, "DASHBOARD_QUERY_NOT_AVAILABLE");
    const layout = await getDashboardLayout(dashboardId);
    const source = sourceKey ? (await listDashboardDataSources(dashboardId)).find(s => s.sourceKey === sourceKey && s.isEnabled) : undefined;
    if (sourceKey && !source) throw new DeliveryError(404, "DASHBOARD_SOURCE_NOT_FOUND");
    if (sourceKey && !layout.profiles.some(p => p.widgets.some(w =>
      (w.widgetType === "TABLE" || w.widgetType === "FIELD") && w.config.dataSourceKey === sourceKey))) {
      throw new DeliveryError(403, "DASHBOARD_SOURCE_NOT_IN_LAYOUT");
    }
    const dataset = await getDataset(source?.datasetId ?? query.datasetId);
    if (!dataset?.isActive || dataset.isArchived) throw new DeliveryError(409, "DATASET_NOT_AVAILABLE");
    const dataSource = await getDataSourcePlaybackState(dataset.dataSourceId);
    if (!dataSource?.isActive) throw new DeliveryError(409, "DATASOURCE_DISABLED");
    const approvalEvidence = await deps.getApprovalEvidence(dashboardId);
    const sensitivity = await getDatasetSensitivitySnapshot(dataset.id);
    assertDatasetSensitivityPolicy(sensitivity);
    const definitions = await listDatasetParameters(dataset.id);
    const reportColumns = source ? [] : await listReportColumns(query.id);
    const accessRevision = await getQueryAccessRevision(query.id);
    // LastUsedAt changes on every check; it is deliberately not a configuration revision.
    const { lastUsedAtUtc: _lastUsed, ...device } = verification.device;
    const fingerprint = createHash("sha256").update(JSON.stringify({ approvalEvidence, dashboard, query, layout, source,
      dataset, dataSource, sensitivity, definitions, reportColumns, accessRevision, device,
      tokenHash: createHash("sha256").update(token).digest("hex") })).digest("hex");
    return { fingerprint, verification, dashboard, query, layout, source, dataset, sensitivity, reportColumns };
  };
  const stillCurrent = async (initial: Awaited<ReturnType<typeof readState>>, dashboardId: number, token: string, ip: string, sourceKey?: string) => {
    const current = await readState(dashboardId, token, ip, sourceKey);
    if (current.fingerprint !== initial.fingerprint) throw new DeliveryError(409, "DASHBOARD_SNAPSHOT_EXPIRED");
  };
  // Page-scoped device delivery: only the requested page leaves the server.
  // The existing preview endpoint remains for compatibility and is audited as full-result delivery.
  dashboardRouter.post("/device/:id/page", async (req, res, next) => {
    try {
      const id = idSchema.safeParse(req.params.id);
      const pageInput = z.object({ page: z.number().int().min(1).max(100000), snapshotId: z.string().uuid().optional() }).safeParse(req.body);
      if (!id.success || !pageInput.success) {
        res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dashboard ID 或頁碼不正確。" } });
        return;
      }
      const token = getDeviceToken(req);
      const state = await readState(id.data, token, getRequestSourceIp(req));
      const { verification, dashboard, query, sensitivity, dataset, layout } = state;
      let snapshot = pageInput.data.snapshotId
        ? getDashboardPageSnapshot(pageInput.data.snapshotId, verification.device.id, id.data)
        : null;
      if (pageInput.data.snapshotId && !snapshot) {
        res.status(409).json({ error: { code: "DASHBOARD_SNAPSHOT_EXPIRED", message: "資料版本已過期，請重新載入。" } });
        return;
      }
      if (snapshot && (snapshot.queryId !== query.id || snapshot.datasetId !== query.datasetId || snapshot.sensitivityVersion !== sensitivity.version || snapshot.bindingFingerprint !== state.fingerprint)) {
        res.status(409).json({ error: { code: "DASHBOARD_SNAPSHOT_EXPIRED", message: "資料版本已變更，請重新載入。" } });
        return;
      }
      if (!snapshot) {
        const queryParameters = dashboardQueryParameters(dashboard.parameters);
        const result = await dashboardQueryExecutor.run(`${verification.device.id}:PRIMARY:${state.fingerprint}`,
          () => executeSavedDataset(query.datasetId, queryParameters));
        await stillCurrent(state, id.data, token, getRequestSourceIp(req));
        const snapshotConfig = dashboard.parameters;
        const kindValue = snapshotConfig.snapshotKind;
        const kind: DashboardSnapshotKind = kindValue === "SURGERY" || kindValue === "OUTPATIENT" || kindValue === "EXAM" || kindValue === "STATISTICS"
          ? kindValue : "OTHER";
        const secondsValue = snapshotConfig.snapshotSeconds;
        const configuredSeconds = typeof secondsValue === "number" ? secondsValue : null;
        const totalPagesForSnapshot = Math.max(1, Math.ceil(result.rows.length / Math.max(1, dashboard.pageSize)));
        const cycleSeconds = totalPagesForSnapshot * Math.max(5, dashboard.pageSeconds);
        const minimumSnapshotSeconds = Math.ceil((cycleSeconds + Math.max(10, Math.ceil(cycleSeconds * 0.2))) / 10) * 10;
        if (minimumSnapshotSeconds > 3600) {
          res.status(409).json({ error: { code: "DASHBOARD_PLAYBACK_TOO_LONG", message: "完整輪播超過快照有效時間上限，請調整每頁筆數或換頁秒數。" } });
          return;
        }
        snapshot = createDashboardPageSnapshot({
          ttlSeconds: Math.max(resolveDashboardSnapshotSeconds(kind, configuredSeconds), minimumSnapshotSeconds),
          deviceId: verification.device.id, dashboardId: id.data,
          queryId: query.id, datasetId: query.datasetId,
          sensitivityVersion: sensitivity.version, bindingFingerprint: state.fingerprint,
          sourceScope: `datasource:${dataset.dataSourceId}`,
          columns: result.columns, rows: result.rows,
        });
      }
      const pageSize = Math.max(1, dashboard.pageSize);
      const totalPages = Math.max(1, Math.ceil(snapshot.rows.length / pageSize));
      if (pageInput.data.page > totalPages) {
        res.status(400).json({ error: { code: "DASHBOARD_PAGE_OUT_OF_RANGE", message: "頁碼超出資料範圍。" } });
        return;
      }
      assertDashboardResultColumns(snapshot.columns);
      const rawRows = snapshot.rows.slice((pageInput.data.page - 1) * pageSize, pageInput.data.page * pageSize);
      const masks = resolveDashboardDisclosureMasks(dashboard.parameters, "PRIMARY", sensitivity.columns);
      const rows = maskDeviceRows(rawRows, masks, sensitivity.columns);
      const masked = snapshot.columns.some((column) => resolveDeviceColumnMask(column.name, masks) !== "NONE");
      const disclosureId = await auditPatientListIfConfigured({
        datasetId: query.datasetId,
        queryDefinitionId: query.id,
        userId: null,
        dashboardDeviceId: verification.device.id,
        sourceScope: snapshot.sourceScope,
        deliveryType: "PAGE",
        pageNumber: pageInput.data.page,
        masked,
        rows: rawRows,
      });
      // A disabled/absent patient-audit configuration must not block ordinary
      // Dataset rows; a configured patient disclosure still requires a receipt.
      if (rawRows.length > 0 && disclosureId === null &&
        (await (deps.getPatientAuditConfig ?? getDatasetPatientAuditConfig)(dataset.id))?.isEnabled)
        throw new DeliveryError(503, "PATIENT_AUDIT_NOT_CONFIGURED");
      if (!getDashboardPageSnapshot(snapshot.id, verification.device.id, id.data)) throw new DeliveryError(409, "DASHBOARD_SNAPSHOT_EXPIRED");
      res.setHeader("Cache-Control", "no-store");
      const reportColumns = state.reportColumns.filter((column) => resolveDeviceColumnMask(column.columnName, masks) !== "OMIT");
      const columns = snapshot.columns.filter((column) => resolveDeviceColumnMask(column.name, masks) !== "OMIT");
      await stillCurrent(state, id.data, token, getRequestSourceIp(req));
      const { parameters: _privateParameters, ...safeDashboard } = dashboard;
      res.json({ dashboard: safeDashboard, query: { id: query.id, code: query.code, name: query.name },
        reportColumns,
        result: { columns, rows },
        page: pageInput.data.page, totalPages, totalRows: snapshot.rows.length, snapshotId: snapshot.id, disclosureId });
    } catch (error) {
      deliveryFailure(error, res, next);
    }
  });


  // Supplemental Dataset device delivery: per-source page request, never full-result.
  // Deliberately fail closed: only explicitly classified, masked columns may leave the server.
  dashboardRouter.post("/device/:id/data-sources/:sourceKey/page", async (req, res, next) => {
    try {
      const id = idSchema.safeParse(req.params.id);
      const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/).safeParse(req.params.sourceKey);
      const input = z.object({ page: z.number().int().min(1).max(100000), snapshotId: z.string().uuid().optional() }).safeParse(req.body);
      if (!id.success || !key.success || !input.success) {
        res.status(400).json({ error: { code: "VALIDATION_ERROR" } }); return;
      }
      const token = getDeviceToken(req);
      const state = await readState(id.data, token, getRequestSourceIp(req), key.data);
      const { verification, dataset, sensitivity: policy } = state;
      const source = state.source!;
      const masks = resolveDashboardDisclosureMasks(state.dashboard.parameters, source.sourceKey, policy.columns);
      const sourceScope = `datasource:${dataset.dataSourceId}:dashboard-source:${source.sourceKey}`;
      let snapshot = input.data.snapshotId
        ? getDashboardPageSnapshot(input.data.snapshotId, verification.device.id, id.data) : null;
      if (input.data.snapshotId && !snapshot) {
        res.status(409).json({ error: { code: "DASHBOARD_SNAPSHOT_EXPIRED" } }); return;
      }
      if (snapshot && (snapshot.datasetId !== source.datasetId || snapshot.sourceScope !== sourceScope ||
          snapshot.sensitivityVersion !== policy.version || snapshot.queryId !== source.id || snapshot.bindingFingerprint !== state.fingerprint)) {
        res.status(409).json({ error: { code: "DASHBOARD_SNAPSHOT_EXPIRED" } }); return;
      }
      if (!snapshot) {
        const result = await dashboardQueryExecutor.run(`${verification.device.id}:${source.sourceKey}:${state.fingerprint}`,
          () => executeSavedDataset(source.datasetId, source.parameters));
        await stillCurrent(state, id.data, token, getRequestSourceIp(req), key.data);
        const minimumSeconds = Math.min(3600, Math.max(source.refreshSeconds,
          Math.ceil(result.rows.length / source.pageSize) * source.pageSeconds + 10));
        snapshot = createDashboardPageSnapshot({
          ttlSeconds: minimumSeconds, deviceId: verification.device.id, dashboardId: id.data,
          queryId: source.id, datasetId: source.datasetId, sensitivityVersion: policy.version, bindingFingerprint: state.fingerprint,
          sourceScope, columns: result.columns, rows: result.rows,
        });
      }
      assertDashboardResultColumns(snapshot.columns);
      const columns = snapshot.columns.filter(column => resolveDeviceColumnMask(column.name, masks) !== "OMIT");
      const pageSize = source.pageSize;
      const totalPages = Math.max(1, Math.ceil(snapshot.rows.length / pageSize));
      if (input.data.page > totalPages) {
        res.status(400).json({ error: { code: "DASHBOARD_PAGE_OUT_OF_RANGE" } }); return;
      }
      const rawRows = snapshot.rows.slice((input.data.page - 1) * pageSize, input.data.page * pageSize);
      const rows = maskDeviceRows(rawRows, masks, policy.columns);
      const disclosureId = await auditPatientListIfConfigured({
        datasetId: source.datasetId, dashboardDeviceId: verification.device.id, userId: null,
        sourceScope, deliveryType: "PAGE",
        pageNumber: input.data.page, masked: true, rows: rawRows,
      });
      // A disabled/absent patient-audit configuration must not block ordinary
      // Dataset rows; a configured patient disclosure still requires a receipt.
      if (rawRows.length > 0 && disclosureId === null &&
        (await (deps.getPatientAuditConfig ?? getDatasetPatientAuditConfig)(dataset.id))?.isEnabled)
        throw new DeliveryError(503, "PATIENT_AUDIT_NOT_CONFIGURED");
      if (!getDashboardPageSnapshot(snapshot.id, verification.device.id, id.data)) throw new DeliveryError(409, "DASHBOARD_SNAPSHOT_EXPIRED");
      res.setHeader("Cache-Control", "no-store");
      await stillCurrent(state, id.data, token, getRequestSourceIp(req), key.data);
      res.json({ sourceKey: source.sourceKey, refreshSeconds: source.refreshSeconds, pageSize: source.pageSize, pageSeconds: source.pageSeconds,
        result: { columns, rows }, page: input.data.page,
        totalPages, totalRows: snapshot.rows.length, snapshotId: snapshot.id, sensitivityVersion: policy.version, disclosureId });
    } catch (error) { deliveryFailure(error, res, next); }
  });

  return dashboardRouter;
}
class DeliveryError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
function deliveryFailure(error: unknown, res: import("express").Response, _next: import("express").NextFunction) {
  // Database errors can contain SQL/bind values. Device responses and logs must never expose them.
  const safe = dashboardSecurityFailure(error);
  const code = error instanceof DeliveryError ? error.code
    : safe ? safe.code : error instanceof Error && ["DASHBOARD_QUERY_BUSY", "DASHBOARD_QUERY_TIMEOUT", "DASHBOARD_SNAPSHOT_TOO_LARGE", "DASHBOARD_SENSITIVITY_POLICY_INVALID", "DASHBOARD_SENSITIVITY_POLICY_REQUIRED", "DASHBOARD_COLUMNS_AMBIGUOUS"].includes(error.message)
      ? error.message : "DASHBOARD_DELIVERY_FAILED";
  const status = error instanceof DeliveryError ? error.status : safe ? safe.status : code === "DASHBOARD_QUERY_BUSY" ? 429 : code === "DASHBOARD_QUERY_TIMEOUT" ? 504 : 503;
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json({ error: { code, message: "播放資料暫時無法提供，請重新驗證或稍後重試。" } });
}
