// 2B-2: read-only, dormant chart facts reader from the existing UQP stores.
// This is NOT a proof of SQL aggregation: default aggregate evidence is null.
// It is not mounted as a route or registered as a CHART Widget provider.
import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { getTokenSessionState } from "../auth/auth.repository.js";
import { getQueryDefinition, getEffectiveQueryAccess } from "../queryDefinition/queryDefinition.repository.js";
import { getQueryAccessRevision } from "../queryDefinition/queryAccess.repository.js";
import { listReportColumns } from "../queryDefinition/reportColumn.repository.js";
import { getDataset } from "../dataset/dataset.repository.js";
import { getDatasetSensitivitySnapshot } from "../dataset/datasetSensitiveColumn.repository.js";
import { getDatasetPublicDisplay } from "../dataset/datasetPublicDisplay.repository.js";
import { getDataSourcePlaybackState } from "../datasource/datasource.repository.js";
import { getDashboardApprovalEvidence } from "./dashboardApproval.repository.js";
import { loadQueryExecutionBinding } from "./dashboardQuerySourceExecution.repository.js";
import type { ExecutionSubject } from "./dashboardQuerySourceExecution.js";
import type { ServerChartFacts, VerifiedQueryAggregate } from "./dashboardChartApproval.policy.js";

async function readImmutableChartRevisions(queryId: number, datasetId: number): Promise<{
  query: string; dataset: string;
} | null> {
  const pool = await getPlatformDbPool();
  if (!pool) return null;
  // Never use UpdatedAtUtc (not a monotonic version) or a SQL text hash (ABA).
  // Existing append-only QueryDefinitionVersion and Dataset DefinitionRowVersion
  // are read-only; missing schema, publication snapshots or invalid revisions
  // cause a denial, never a synthetic placeholder version.
  const row = (await pool.request()
    .input("queryId", sql.BigInt, queryId)
    .input("datasetId", sql.BigInt, datasetId)
    .query("SELECT d.DefinitionRowVersion AS DatasetRevision, " +
      "(SELECT MAX(qv.VersionNo) FROM uqp.QueryDefinitionVersion qv " +
      "WHERE qv.QueryDefinitionId=@queryId) AS QueryVersion " +
      "FROM uqp.Dataset d WHERE d.Id=@datasetId")).recordset[0];
  const number = row?.QueryVersion;
  if (!Number.isSafeInteger(number) || number < 1 ||
      !Buffer.isBuffer(row?.DatasetRevision) || row.DatasetRevision.length !== 8) return null;
  return { query: BigInt(number).toString(16).padStart(16, "0"),
    dataset: row.DatasetRevision.toString("hex") };
}

export type ChartFactsDependencies = {
  loadBinding: typeof loadQueryExecutionBinding;
  getSession: typeof getTokenSessionState;
  getQuery: typeof getQueryDefinition;
  getAccess: typeof getEffectiveQueryAccess;
  getAccessRevision: typeof getQueryAccessRevision;
  getDataset: typeof getDataset;
  getDataSource: typeof getDataSourcePlaybackState;
  getSensitivity: typeof getDatasetSensitivitySnapshot;
  getPublicDisplay: typeof getDatasetPublicDisplay;
  getReportColumns: typeof listReportColumns;
  getDashboardEvidence: typeof getDashboardApprovalEvidence;
  getRevisions: typeof readImmutableChartRevisions;
  // This must eventually be an independently reviewed, dialect-aware
  // SQL aggregation verifier. There is intentionally no implementation.
  getVerifiedAggregate: (
    queryId: number, datasetId: number, queryRevision: string,
    datasetRevision: string,
  ) => Promise<VerifiedQueryAggregate | null>;
};

export const chartFactsDefaults: ChartFactsDependencies = {
  loadBinding: loadQueryExecutionBinding,
  getSession: getTokenSessionState,
  getQuery: getQueryDefinition,
  getAccess: getEffectiveQueryAccess,
  getAccessRevision: getQueryAccessRevision,
  getDataset: getDataset,
  getDataSource: getDataSourcePlaybackState,
  getSensitivity: getDatasetSensitivitySnapshot,
  getPublicDisplay: getDatasetPublicDisplay,
  getReportColumns: listReportColumns,
  getDashboardEvidence: getDashboardApprovalEvidence,
  getRevisions: readImmutableChartRevisions,
  getVerifiedAggregate: async () => null,
};

const keyPattern = /^(?:PRIMARY|[A-Za-z][A-Za-z0-9_]{0,63})$/;

/** Reads candidate facts only. It does not issue authority; the downstream
 * policy must also reject unless a trustworthy aggregate certificate exists.
 * Catch errors to fail closed; never return credentials, patient rows or SQL.
 */
export function createSqlChartFactsReader(deps: ChartFactsDependencies = chartFactsDefaults) {
  return async (dashboardId: number, sourceKey: string, subject: ExecutionSubject): Promise<ServerChartFacts | null> => {
    if (!Number.isSafeInteger(dashboardId) || dashboardId <= 0 ||
        !keyPattern.test(sourceKey) || !Number.isSafeInteger(subject.userId) || subject.userId <= 0 ||
        !Number.isSafeInteger(subject.tokenVersion) || subject.tokenVersion <= 0) return null;
    const context = subject.context ?? (subject.deviceId !== undefined ? "device" : "designer");
    if ((context === "device") !== (subject.deviceId !== undefined)) return null;
    try {
      // The existing device router verifies the token/IP/session separately;
      // this read-only helper must also reject absent or stale device proof.
      if (context === "device") {
        const proof = await subject.verifyDevice?.();
        if (!proof || proof.deviceId !== subject.deviceId ||
            proof.userId !== subject.userId || proof.tokenVersion !== subject.tokenVersion) return null;
      }
      const [binding, session, evidenceBefore] = await Promise.all([
        deps.loadBinding(dashboardId, sourceKey),
        deps.getSession(subject.userId),
        deps.getDashboardEvidence(dashboardId),
      ]);
      if (!session?.isActive || session.tokenVersion !== subject.tokenVersion ||
          !binding || binding.dashboardId !== dashboardId || binding.sourceKey !== sourceKey ||
          binding.queryDefinitionId === null || !binding.enabled || !binding.managed) return null;
      const query = await deps.getQuery(binding.queryDefinitionId);
      if (!query?.isActive || !query.isPublished || query.isArchived) return null;
      const [access, dataset, accessRevision] = await Promise.all([
        deps.getAccess(subject.userId, query.id, undefined, false),
        deps.getDataset(query.datasetId),
        deps.getAccessRevision(query.id),
      ]);
      if (!access?.canView || !access.canExecute ||
          !dataset?.isActive || dataset.isArchived || dataset.id !== query.datasetId) return null;
      const datasource = await deps.getDataSource(dataset.dataSourceId);
      if (!datasource?.isActive) return null;
      const [sensitivity, reportColumns, revisions] = await Promise.all([
        deps.getSensitivity(dataset.id), deps.getReportColumns(query.id),
        deps.getRevisions(query.id, dataset.id),
      ]);
      if (!revisions || !sensitivity || sensitivity.version < 1 ||
          !Array.isArray(reportColumns)) return null;
      const publicPlayback = context === "device" || context === "user" ||
        context === "admin-preview" && binding.dashboardActive;
      const publicDisplay = publicPlayback ? await deps.getPublicDisplay(dataset.id) : null;
      const verifiedAggregate = await deps.getVerifiedAggregate(query.id, dataset.id,
        revisions.query, revisions.dataset);
      if (evidenceBefore !== await deps.getDashboardEvidence(dashboardId) ||
          accessRevision !== await deps.getAccessRevision(query.id)) return null;
      return {
        dashboardId, sourceKey,
        source: {
          queryId: query.id, bindingRevision: binding.bindingRevision, enabled: binding.enabled,
          managed: binding.managed, referenced: sourceKey === "PRIMARY" || binding.referenced === true,
          activeDashboard: binding.dashboardActive, mode: binding.mode ?? "LEGACY",
        },
        actor: {
          userId: subject.userId, tokenVersion: session.tokenVersion,
          active: session.isActive, permissions: session.permissions,
          canView: Boolean(access.canView), canExecute: Boolean(access.canExecute),
        },
        query: { id: query.id, datasetId: query.datasetId, active: query.isActive,
          published: query.isPublished, archived: query.isArchived },
        dataset: { id: dataset.id, active: dataset.isActive, archived: dataset.isArchived },
        revisions: { dashboardApproval: evidenceBefore, access: accessRevision,
          query: revisions.query, dataset: revisions.dataset },
        sensitivity, publicDisplay: publicDisplay ? {
          status: publicDisplay.status, version: publicDisplay.version,
          policy: publicDisplay.policy,
        } : null,
        reportColumns, verifiedAggregate,
      };
    } catch {
      return null;
    }
  };
}

// The production default is deliberately a candidate-only reader. No verified
// aggregate source is registered, so it cannot authorize CHART playback.
export const readSqlChartCandidateFacts = createSqlChartFactsReader();
