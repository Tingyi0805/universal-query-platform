import { createHash } from "node:crypto";
import { QuerySourceError } from "./dashboardQuerySources.service.js";
import { safeParameterFailure } from "./dashboardQuerySources.repository.js";
import { runtimeParameterDefinitions } from "../dataset/parameterSync.js";
import { coerceRuntimeParameters } from "../dataset/parameter.service.js";
import { dashboardQueryExecutor } from "./dashboardQueryExecutor.js";
import { createDashboardPageSnapshot, getDashboardPageSnapshot } from "./dashboardPageSnapshot.js";
import { assertDatasetSensitivityPolicy, enforceClassifiedDeviceMasks, enforceDatasetDeviceMasks, maskDeviceRows, resolveConfiguredDeviceMasks, resolveDeviceColumnMask, resolveSupplementalDeviceRules } from "./dashboardDeviceMasking.js";

export type ExecutionBinding = {
  dashboardId: number; sourceId: number; sourceKey: string; queryDefinitionId: number | null; bindingRevision: number;
  deviceMasks?: unknown; deviceTypes?: unknown;
  managed: boolean; dashboardActive: boolean; enabled: boolean; parameters: Record<string, unknown>;
  mode?: string; modeRevision?: number; referenced?: boolean;
  refreshSeconds: number; pageSeconds: number; pageSize: number; maxRows: number | null;
};
export type ExecutionSubject = { userId: number; tokenVersion: number; tokenHash: string; deviceId?: number;
  verifyDevice?: () => Promise<{ deviceId: number; userId: number; tokenVersion: number; fingerprint: string }> };
export type ExecutionDependencies = {
  loadBinding: (dashboardId: number, sourceKey: string) => Promise<ExecutionBinding>;
  getSession: typeof import("../auth/auth.repository.js").getTokenSessionState;
  getQuery: typeof import("../queryDefinition/queryDefinition.repository.js").getQueryDefinition;
  getAccess: typeof import("../queryDefinition/queryDefinition.repository.js").getEffectiveQueryAccess;
  getAccessRevision: typeof import("../queryDefinition/queryAccess.repository.js").getQueryAccessRevision;
  getDataset: typeof import("../dataset/dataset.repository.js").getDataset;
  getParameters: typeof import("../dataset/parameter.repository.js").listDatasetParameters;
  getDataSource: typeof import("../datasource/datasource.repository.js").getDataSourcePlaybackState;
  getSensitivity: typeof import("../dataset/datasetSensitiveColumn.repository.js").getDatasetSensitivitySnapshot;
  execute: typeof import("../dataset/dataset.service.js").executeSavedDataset;
  audit: typeof import("../audit/patientDisclosure.service.js").auditPatientListIfConfigured;
};
export function createQuerySourceExecution(deps: ExecutionDependencies, enabled: (device?: boolean) => boolean) {
  const state = async (id: number, key: string, subject: ExecutionSubject) => {
    if (!enabled(subject.deviceId !== undefined)) throw new QuerySourceError("QUERY_SOURCE_EXECUTION_DISABLED", 404);
    const proof = subject.deviceId !== undefined ? await subject.verifyDevice?.() : undefined;
    if (subject.deviceId !== undefined && (!proof || proof.deviceId !== subject.deviceId || proof.userId !== subject.userId || proof.tokenVersion !== subject.tokenVersion))
      throw new QuerySourceError("DASHBOARD_DEVICE_UNAUTHORIZED", 401);
    const session = await deps.getSession(subject.userId);
    if (!session?.isActive || session.tokenVersion !== subject.tokenVersion) throw new QuerySourceError("TOKEN_REVOKED", 401);
    if (!session.permissions.includes("DESIGN_QUERY") || !session.permissions.includes("EXECUTE_QUERY"))
      throw new QuerySourceError(subject.deviceId !== undefined ? "DASHBOARD_DEVICE_UNAUTHORIZED" : "QUERY_SOURCE_PERMISSION_REVOKED", subject.deviceId !== undefined ? 401 : 403);
    const binding = await deps.loadBinding(id, key);
    if (subject.deviceId !== undefined) {
      if (binding.mode !== "QUERY_ONLY" || !binding.modeRevision || !binding.dashboardActive || !binding.managed)
        throw new QuerySourceError("QUERY_SOURCE_MODE_NOT_ACTIVATED");
      if (key !== "PRIMARY" && !binding.referenced) throw new QuerySourceError("DASHBOARD_SOURCE_NOT_IN_LAYOUT", 403);
    } else if (!binding.managed || binding.dashboardActive) throw new QuerySourceError("QUERY_SOURCE_PREVIEW_REQUIRES_STAGED_DASHBOARD");
    if (!binding.enabled) throw new QuerySourceError("QUERY_SOURCE_DISABLED");
    if (binding.queryDefinitionId === null) throw new QuerySourceError("QUERY_SOURCE_PENDING_CONVERSION");
    if (binding.dashboardId !== id || binding.sourceKey !== key || !Number.isSafeInteger(binding.sourceId) || binding.sourceId < 1 ||
        !Number.isSafeInteger(binding.bindingRevision) || binding.bindingRevision < 1 ||
        !Number.isInteger(binding.maxRows) || binding.maxRows! < 1 || binding.maxRows! > 10000 ||
        !Number.isInteger(binding.pageSize) || binding.pageSize < 1 || binding.pageSize > 100 ||
        !Number.isInteger(binding.refreshSeconds) || binding.refreshSeconds < 5 || binding.refreshSeconds > 3600 ||
        !Number.isInteger(binding.pageSeconds) || binding.pageSeconds < 5 || binding.pageSeconds > 3600)
      throw new QuerySourceError("QUERY_SOURCE_BINDING_INVALID");
    const query = await deps.getQuery(binding.queryDefinitionId);
    if (!query?.isActive || !query.isPublished || query.isArchived || query.id !== binding.queryDefinitionId) throw new QuerySourceError("QUERY_SOURCE_QUERY_NOT_AVAILABLE");
    const access = await deps.getAccess(subject.userId, query.id);
    if (!access?.canView || !access.canExecute) throw new QuerySourceError("QUERY_SOURCE_QUERY_FORBIDDEN", 403);
    const dataset = await deps.getDataset(query.datasetId); // Never read historical DatasetId.
    if (!dataset?.isActive || dataset.isArchived || dataset.id !== query.datasetId) throw new QuerySourceError("QUERY_SOURCE_DATASET_NOT_AVAILABLE");
    const source = await deps.getDataSource(dataset.dataSourceId);
    if (!source?.isActive) throw new QuerySourceError("QUERY_SOURCE_DATASOURCE_DISABLED");
    const definitions = await deps.getParameters(dataset.id);
    try { coerceRuntimeParameters(runtimeParameterDefinitions(dataset.sqlText, definitions), binding.parameters); }
    catch (error) { safeParameterFailure(error); }
    const sensitivity = await deps.getSensitivity(dataset.id);
    try { assertDatasetSensitivityPolicy(sensitivity); } catch (error) { throw new QuerySourceError(error instanceof Error && error.message === "DASHBOARD_SENSITIVITY_POLICY_REQUIRED"
      ? "QUERY_SOURCE_SENSITIVITY_POLICY_REQUIRED" : "QUERY_SOURCE_SENSITIVITY_POLICY_INVALID", 503); }
    const accessRevision = await deps.getAccessRevision(query.id);
    const modeVersion = subject.deviceId !== undefined ? `QUERY_ONLY_DEVICE_V1:${binding.modeRevision}` : "QUERY_ONLY_PREVIEW_V1";
    const fingerprint = createHash("sha256").update(JSON.stringify({ modeVersion, proof, subject, binding, query,
      session, access, accessRevision, dataset, source, definitions, sensitivity })).digest("hex");
    return { fingerprint, binding, query, dataset, sensitivity, accessRevision, modeVersion };
  };
  return {
    async page(id: number, key: string, subject: ExecutionSubject, input: { page: number; snapshotId?: string }) {
      const initial = await state(id, key, subject);
      const { binding, query, dataset, sensitivity, modeVersion } = initial;
      const ownerId = subject.deviceId ?? -subject.userId;
      let snapshot = input.snapshotId ? getDashboardPageSnapshot(input.snapshotId, ownerId, id) : null;
      if (input.snapshotId && (!snapshot || snapshot.sourceKey !== key || snapshot.modeVersion !== modeVersion ||
          snapshot.queryId !== query.id || snapshot.bindingRevision !== binding.bindingRevision ||
          snapshot.bindingFingerprint !== initial.fingerprint)) throw new QuerySourceError("DASHBOARD_SNAPSHOT_EXPIRED");
      const current = async () => {
        if ((await state(id, key, subject)).fingerprint !== initial.fingerprint) throw new QuerySourceError("DASHBOARD_SNAPSHOT_EXPIRED");
      };
      if (!snapshot) {
        const result = await dashboardQueryExecutor.run(`${modeVersion}:${id}:${key}:${initial.fingerprint}`,
          async () => {
            try { return await deps.execute(query.datasetId, binding.parameters, binding.maxRows!); }
            catch (error) {
              if (error instanceof Error && /^PARAMETER_[A-Z_]+(?::|$)/.test(error.message)) safeParameterFailure(error);
              throw error;
            }
          });
        await current();
        const maxRows = Math.min(binding.maxRows!, dataset.maxRows);
        if (result.rows.length > maxRows) throw new QuerySourceError("QUERY_SOURCE_ROW_LIMIT");
        snapshot = createDashboardPageSnapshot({ deviceId: ownerId, dashboardId: id, queryId: query.id, datasetId: dataset.id,
          sourceKey: key, sourceId: binding.sourceId, bindingRevision: binding.bindingRevision, accessRevision: initial.accessRevision,
          authorizationRevision: subject.tokenVersion, modeVersion, bindingFingerprint: initial.fingerprint,
          sensitivityVersion: sensitivity.version, sourceScope: `datasource:${dataset.dataSourceId}:dashboard:${id}:source:${key}`,
          ttlSeconds: binding.refreshSeconds, columns: result.columns, rows: result.rows });
      }
      const totalPages = Math.max(1, Math.ceil(snapshot.rows.length / binding.pageSize));
      if (input.page > totalPages) throw new QuerySourceError("DASHBOARD_PAGE_OUT_OF_RANGE", 400);
      const rawRows = snapshot.rows.slice((input.page - 1) * binding.pageSize, input.page * binding.pageSize);
      const allowed = resolveSupplementalDeviceRules(sensitivity.columns);
      // Dataset approvals remain the allowlist. PRIMARY's saved Dashboard policy
      // may strengthen or omit those fields; it cannot grant an unapproved field.
      const base = Object.fromEntries([...allowed.values()].map(rule => [rule.columnName, rule.deviceMaskMode]));
      if (key === "PRIMARY" && binding.deviceMasks !== undefined) {
        if (!binding.deviceMasks || typeof binding.deviceMasks !== "object" || Array.isArray(binding.deviceMasks))
          throw new QuerySourceError("QUERY_SOURCE_DASHBOARD_MASKS_INVALID", 503);
        const configured = enforceClassifiedDeviceMasks(resolveConfiguredDeviceMasks(binding.deviceMasks), binding.deviceTypes);
        if (Object.keys(configured).length !== Object.keys(binding.deviceMasks).length)
          throw new QuerySourceError("QUERY_SOURCE_DASHBOARD_MASKS_INVALID", 503);
        for (const name of Object.keys(base)) {
          if (Object.keys(configured).some(c => c.toUpperCase() === name.toUpperCase())) base[name] = resolveDeviceColumnMask(name, configured);
        }
      }
      const masks = enforceDatasetDeviceMasks(base, sensitivity.columns);
      const columns = snapshot.columns.filter(c => resolveDeviceColumnMask(c.name, masks) !== "OMIT");
      const rows = maskDeviceRows(rawRows, masks, sensitivity.columns);
      let disclosureId: number | null;
      try {
        disclosureId = await deps.audit({ datasetId: dataset.id, queryDefinitionId: query.id,
          userId: subject.deviceId === undefined ? subject.userId : null, dashboardDeviceId: subject.deviceId,
          sourceScope: snapshot.sourceScope, deliveryType: "PAGE", pageNumber: input.page,
          masked: true, rows: rawRows });
      } catch { throw new QuerySourceError("PATIENT_AUDIT_FAILED", 503); }
      if (rawRows.length && disclosureId === null) throw new QuerySourceError("PATIENT_AUDIT_NOT_CONFIGURED", 503);
      await current();
      if (!getDashboardPageSnapshot(snapshot.id, ownerId, id)) throw new QuerySourceError("DASHBOARD_SNAPSHOT_EXPIRED");
      return { sourceKey: key, modeVersion, query: { id: query.id, code: query.code, name: query.name }, refreshSeconds: binding.refreshSeconds, pageSeconds: binding.pageSeconds,
        pageSize: binding.pageSize, page: input.page, totalPages, totalRows: snapshot.rows.length,
        snapshotId: snapshot.id, disclosureId, result: { columns, rows } };
    },
  };
}
