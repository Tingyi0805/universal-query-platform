// 2B-5: dormant read-only, cross-repository revision fence.
// Use only around the existing audited Query Delivery. This is NOT a chart
// authorization decision and is deliberately not connected to public routes.
import { createHash } from "node:crypto";
import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { getTokenSessionState } from "../auth/auth.repository.js";
import { getEffectiveQueryAccess } from "../queryDefinition/queryDefinition.repository.js";
import { getQueryAccessRevision } from "../queryDefinition/queryAccess.repository.js";
import type { ExecutionSubject } from "./dashboardQuerySourceExecution.js";

export type ChartRevisionFence = Readonly<{
  dashboardId: number; sourceKey: string; queryId: number; datasetId: number;
  userId: number; tokenVersion: number; version: string;
}>;
const revision = (value: unknown): string | null =>
  Buffer.isBuffer(value) && value.length === 8 ? value.toString("hex") : null;

export type ChartRevisionFenceDependencies = {
  getPool: typeof getPlatformDbPool;
  getSession: typeof getTokenSessionState;
  getAccess: typeof getEffectiveQueryAccess;
  getAcl: typeof getQueryAccessRevision;
};
export const chartRevisionFenceDefaults: ChartRevisionFenceDependencies = {
  getPool: getPlatformDbPool,
  getSession: getTokenSessionState,
  getAccess: getEffectiveQueryAccess,
  getAcl: getQueryAccessRevision,
};
/** The connection pool must be trusted and database-scoped. The factory is
 * intended for isolated SQL engine acceptance and is not an API entrypoint. */
export function createChartRevisionFenceReader(
  deps: ChartRevisionFenceDependencies = chartRevisionFenceDefaults,
) {
return async function readChartRevisionFence(
  dashboardId: number, sourceKey: string, queryId: number,
  datasetId: number, subject: ExecutionSubject,
): Promise<ChartRevisionFence | null> {
  if (![dashboardId,queryId,datasetId,subject.userId,subject.tokenVersion].every(x =>
      Number.isSafeInteger(x) && x > 0) ||
      !/^(?:PRIMARY|[A-Za-z][A-Za-z0-9_]{0,63})$/.test(sourceKey))
    return null;
  const context = subject.context ?? (subject.deviceId === undefined ? "designer" : "device");
  if ((context === "device") !== (subject.deviceId !== undefined) ||
      !["designer", "user", "device", "admin-preview"].includes(context)) return null;
  const pool = await deps.getPool();
  if (!pool) return null;
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    // HOLDLOCK plus transaction-level isolation protects all catalog evidence
    // read here, including Query publication, Dataset and public policy.
    // No raw SQL, patient rows or credentials are returned.
    const rows = (await new sql.Request(tx)
      .input("dashboardId", sql.BigInt, dashboardId)
      .input("sourceKey", sql.NVarChar(64), sourceKey)
      .input("queryId", sql.BigInt, queryId)
      .input("datasetId", sql.BigInt, datasetId)
      .query("SELECT db.ApprovalRowVersion AS ParentRev, bs.ApprovalRowVersion AS BindingRev, " +
        "bs.DatasetId AS BindingDatasetId, bs.IsEnabled AS BindingEnabled, " +
        "d.DefinitionRowVersion AS DatasetRev, ds.ConfigurationRowVersion AS DataSourceRev, ds.Id AS DataSourceId, " +
        "v.QueryVersion, sp.VersionNumber AS SensitivityVersion, " +
        "pd.RowVersion AS PublicRev, pd.SensitivityVersion AS PublicSensitivityVersion, " +
        "pd.DefinitionVersion AS PublicDefinitionRev, " +
        "pd.ConfigurationVersion AS PublicConfigurationRev, pd.DataSourceId AS PublicSourceId, " +
        "db.QueryMode, db.IsActive AS DashboardActive " +
        "FROM uqp.Dashboard db WITH (HOLDLOCK) " +
        "LEFT JOIN uqp.DashboardDataSource bs WITH (HOLDLOCK) " +
        " ON bs.DashboardId=db.Id AND bs.SourceKey=@sourceKey " +
        "INNER JOIN uqp.QueryDefinition q WITH (HOLDLOCK) ON q.Id = " +
        " CASE WHEN @sourceKey='PRIMARY' THEN db.QueryDefinitionId ELSE bs.QueryDefinitionId END " +
        "INNER JOIN uqp.Dataset d WITH (HOLDLOCK) ON d.Id=q.DatasetId " +
        "INNER JOIN uqp.DataSource ds WITH (HOLDLOCK) ON ds.Id=d.DataSourceId " +
        "INNER JOIN uqp.DatasetSensitivePolicyVersion sp WITH (HOLDLOCK) ON sp.DatasetId=d.Id " +
        "LEFT JOIN uqp.DatasetPublicDisplayPolicy pd WITH (HOLDLOCK) ON pd.DatasetId=d.Id " +
        "OUTER APPLY (SELECT MAX(qv.VersionNo) AS QueryVersion FROM uqp.QueryDefinitionVersion qv WITH (HOLDLOCK) WHERE qv.QueryDefinitionId=q.Id) v " +
        "WHERE db.Id=@dashboardId AND q.Id=@queryId AND d.Id=@datasetId " +
        "AND q.IsPublished=1 AND q.IsActive=1 AND q.IsArchived=0 " +
        "AND d.IsActive=1 AND d.IsArchived=0 AND ds.IsActive=1")).recordset;
    const row = rows.length === 1 ? rows[0] : null;
    const parent = revision(row?.ParentRev);
    const binding = sourceKey === "PRIMARY" ? "PRIMARY" : revision(row?.BindingRev);
    const dataset = revision(row?.DatasetRev);
    const datasource = revision(row?.DataSourceRev);
    const publicRev = row?.PublicRev == null ? null : revision(row.PublicRev);
    // tedious may expose SQL BIGINT as either an integer or a decimal string.
    // Accept only an exact, bounded positive integer; never round revisions.
    const sensitivityText = String(row?.SensitivityVersion ?? "");
    const sensitivityVersion = /^[1-9][0-9]{0,15}$/.test(sensitivityText)
      ? Number(sensitivityText) : NaN;
    if (!row || !parent || !binding || !dataset || !datasource ||
        row.PublicRev != null && !publicRev ||
        !Number.isSafeInteger(row.QueryVersion) || row.QueryVersion <= 0 ||
        !Number.isSafeInteger(sensitivityVersion) || sensitivityVersion < 1 ||
        sourceKey !== "PRIMARY" &&
          (Number(row.BindingDatasetId) !== datasetId || row.BindingEnabled !== true))
      throw Error("CHART_FENCE_MISSING");
    const publicPlayback = context === "user" || context === "device" ||
      context === "admin-preview" && row.DashboardActive === true;
    if (publicPlayback &&
        (row.DashboardActive !== true || row.QueryMode !== "QUERY_ONLY" ||
        !publicRev || String(row.PublicSensitivityVersion) !== sensitivityText ||
        revision(row.PublicDefinitionRev) !== dataset ||
        revision(row.PublicConfigurationRev) !== datasource ||
        String(row.PublicSourceId) !== String(row.DataSourceId)))
      throw Error("CHART_PUBLIC_EVIDENCE_STALE");

    // Requests sharing one SQL transaction must be sequential, not Promise.all.
    const session = await deps.getSession(subject.userId, tx);
    const access = await deps.getAccess(subject.userId, queryId, tx, false);
    const acl = await deps.getAcl(queryId, tx);
    if (!session?.isActive || session.tokenVersion !== subject.tokenVersion ||
        !session.permissions.includes("EXECUTE_QUERY") ||
        !session.permissions.includes(context === "user" ? "VIEW_QUERY" : "DESIGN_QUERY") ||
        !access?.canView || !access.canExecute || !/^[a-f0-9]{64}$/.test(acl))
      throw Error("CHART_FENCE_ACCESS_DENIED");
    const version = createHash("sha256").update(JSON.stringify({
      dashboardId, sourceKey, queryId, datasetId, userId: subject.userId,
      tokenVersion: subject.tokenVersion, queryVersion: row.QueryVersion,
      mode: row.QueryMode, dashboardActive: row.DashboardActive,
      parent, binding, dataset, datasource,
      sensitivity: sensitivityVersion, publicRev, acl,
      permissions: [...session.permissions].sort(),
    })).digest("hex");
    await tx.commit();
    return { dashboardId, sourceKey, queryId, datasetId,
      userId: subject.userId, tokenVersion: subject.tokenVersion, version };
  } catch {
    try { await tx.rollback(); } catch { /* fail closed */ }
    return null;
  }
}

}
export const readChartRevisionFence = createChartRevisionFenceReader();
export type ChartFenceReader = typeof readChartRevisionFence;

/** Compare the same immutable evidence BEFORE and AFTER the existing audited
 * Query operation. A stable fence does not replace device verification,
 * disclosure audit, SQL semantics or public-display consent.
 */
export function createFencedChartOperation<T>(read: ChartFenceReader, operation: () => Promise<T>) {
  return async (dashboardId: number, sourceKey: string, queryId: number,
    datasetId: number, subject: ExecutionSubject): Promise<T | null> => {
    const before = await read(dashboardId, sourceKey, queryId, datasetId, subject);
    if (!before || !/^[a-f0-9]{64}$/.test(before.version)) return null;
    const value = await operation();
    const after = await read(dashboardId, sourceKey, queryId, datasetId, subject);
    if (!after || after.version !== before.version ||
        after.dashboardId !== before.dashboardId || after.sourceKey !== before.sourceKey ||
        after.queryId !== before.queryId || after.datasetId !== before.datasetId ||
        after.userId !== before.userId || after.tokenVersion !== before.tokenVersion) return null;
    return value;
  };
}
