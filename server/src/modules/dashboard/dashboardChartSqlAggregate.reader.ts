// 2B-4: dormant, version-bound SQL aggregate proof reader.
// A single serializable read binds the currently published QueryDefinition,
// live Dataset SQL, datasource dialect and existing immutable revisions.
// No chart route, UI, migration, patient row or raw SQL leaves this module.
import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { chartWidgetConfigSchema } from "./dashboardChartWidget.contract.js";
import type { VerifiedQueryAggregate } from "./dashboardChartApproval.policy.js";
import { proveSimpleGroupedCount } from "./dashboardChartSqlAggregate.proof.js";

type Dialect = "SQLSERVER" | "ORACLE";
export type PublishedCountSqlSnapshot = Readonly<{
  queryId: number;
  datasetId: number;
  queryRevision: string;
  datasetRevision: string;
  dialect: Dialect;
  sqlText: string;
}>;

export async function readPublishedCountSqlSnapshot(
  queryId: number, datasetId: number,
): Promise<PublishedCountSqlSnapshot | null> {
  if (!Number.isSafeInteger(queryId) || queryId < 1 ||
      !Number.isSafeInteger(datasetId) || datasetId < 1) return null;
  const pool = await getPlatformDbPool();
  if (!pool) return null;
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    // All current identifiers, SQL text, status, source dialect and revisions
    // are read together. No SQL text is interpolated into the catalog query.
    // HOLDLOCK prevents a concurrent writer from changing these rows before
    // we have completed the read. QueryDefinitionVersion is append-only.
    const records = (await new sql.Request(tx)
      .input("queryId", sql.BigInt, queryId)
      .input("datasetId", sql.BigInt, datasetId)
      .query("SELECT q.Id AS QueryId, d.Id AS DatasetId, d.SqlText, " +
        "d.DefinitionRowVersion AS DatasetRevision, s.Type AS SourceDialect, " +
        "v.QueryVersion FROM uqp.QueryDefinition q WITH (HOLDLOCK) " +
        "INNER JOIN uqp.Dataset d WITH (HOLDLOCK) ON d.Id=q.DatasetId " +
        "INNER JOIN uqp.DataSource s WITH (HOLDLOCK) ON s.Id=d.DataSourceId " +
        "OUTER APPLY (SELECT MAX(qv.VersionNo) AS QueryVersion " +
        " FROM uqp.QueryDefinitionVersion qv WITH (HOLDLOCK) " +
        " WHERE qv.QueryDefinitionId=q.Id) v " +
        "WHERE q.Id=@queryId AND d.Id=@datasetId " +
        "AND q.IsPublished=1 AND q.IsActive=1 AND q.IsArchived=0 " +
        "AND d.IsActive=1 AND d.IsArchived=0 AND s.IsActive=1")).recordset;
    const row = records.length === 1 ? records[0] : null;
    if (!row || !Number.isSafeInteger(row.QueryVersion) || row.QueryVersion < 1 ||
        !Buffer.isBuffer(row.DatasetRevision) || row.DatasetRevision.length !== 8 ||
        !["SQLSERVER", "ORACLE"].includes(row.SourceDialect) ||
        typeof row.SqlText !== "string" ||
        row.QueryId !== queryId || row.DatasetId !== datasetId) {
      await tx.commit();
      return null;
    }
    const result: PublishedCountSqlSnapshot = {
      queryId, datasetId,
      queryRevision: BigInt(row.QueryVersion).toString(16).padStart(16, "0"),
      datasetRevision: row.DatasetRevision.toString("hex"),
      dialect: row.SourceDialect as Dialect, sqlText: row.SqlText,
    };
    await tx.commit();
    return result;
  } catch {
    try { await tx.rollback(); } catch { /* retain fail-closed behavior */ }
    return null;
  }
}

export type PublishedSqlReader = (
  queryId: number, datasetId: number,
) => Promise<PublishedCountSqlSnapshot | null>;

/** A narrowly scoped adapter for the dormant ChartFactsDependencies contract.
 * A future production caller MUST NOT pass user-authored config directly here:
 * chart config first needs verified saved Widget ownership and authorization.
 * Nothing in the current production graph invokes this factory.
 */
export function createVersionBoundCountProofReader(
  rawConfig: unknown, readSnapshot: PublishedSqlReader = readPublishedCountSqlSnapshot,
): (queryId: number, datasetId: number, queryRevision: string,
    datasetRevision: string) => Promise<VerifiedQueryAggregate | null> {
  const parsed = chartWidgetConfigSchema.safeParse(rawConfig);
  const config = parsed.success ? parsed.data : null;
  return async (queryId, datasetId, queryRevision, datasetRevision) => {
    if (!config || !Number.isSafeInteger(queryId) || queryId < 1 ||
        !Number.isSafeInteger(datasetId) || datasetId < 1 ||
        !/^[0-9a-f]{16}$/.test(queryRevision) ||
        !/^[0-9a-f]{16}$/.test(datasetRevision)) return null;
    try {
      const snapshot = await readSnapshot(queryId, datasetId);
      if (!snapshot || snapshot.queryId !== queryId || snapshot.datasetId !== datasetId ||
          snapshot.queryRevision !== queryRevision ||
          snapshot.datasetRevision !== datasetRevision ||
          (snapshot.dialect !== "SQLSERVER" && snapshot.dialect !== "ORACLE")) return null;
      return proveSimpleGroupedCount({
        dialect: snapshot.dialect, sqlText: snapshot.sqlText,
        queryId, datasetId, queryRevision, datasetRevision,
        categoryColumn: config.categoryColumn, valueColumn: config.valueColumn,
      });
    } catch {
      return null;
    }
  };
}
// Deliberately no default export instance wired to chartFactsDefaults.
// Existing default evidence remains null and chart playback remains closed.
