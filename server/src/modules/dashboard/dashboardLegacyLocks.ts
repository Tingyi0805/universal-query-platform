import sql from "mssql";
import { assertLegacyDashboardWriter } from "./dashboardSourceWriteGuard.js";
import { DashboardApprovalError } from "./dashboardApproval.service.js";
import { env } from "../../config/env.js";

type Row = Record<string, any>;
export type LegacyLockSeed = { signature: string; datasetIds: number[]; extraQueries: Array<{ id: number; datasetId: number }> };
const signature = (parent: Row, sources: Row[]) => JSON.stringify([Number(parent.QueryDefinitionId), Number(parent.PrimaryDatasetId),
  sources.map(s => [Number(s.Id), String(s.SourceKey), Number(s.DatasetId), s.QueryDefinitionId ?? null])]);
const safeId = (id: number) => { if (!Number.isSafeInteger(id) || id < 1) throw new DashboardApprovalError("DASHBOARD_APPROVAL_BINDING_CHANGED"); return id; };
const parentSql = `SELECT d.*,q.DatasetId AS PrimaryDatasetId FROM uqp.Dashboard d
  INNER JOIN uqp.QueryDefinition q ON q.Id=d.QueryDefinitionId WHERE d.Id=@id`;
const sourcesSql = "SELECT * FROM uqp.DashboardDataSource WHERE DashboardId=@id ORDER BY Id";
/** Untrusted discovery only: never authorizes a mutation. All bindings are re-read under locks. */
export async function prepareLegacyLocks(pool: sql.ConnectionPool, id: number, extraQueryId?: number, extraDatasetIds: number[] = []): Promise<LegacyLockSeed> {
  const parent = (await pool.request().input("id", sql.BigInt, id).query(parentSql)).recordset[0];
  if (!parent) throw new DashboardApprovalError("DASHBOARD_NOT_FOUND", 404);
  const sources = (await pool.request().input("id", sql.BigInt, id).query(sourcesSql)).recordset;
  const extraQueries: LegacyLockSeed["extraQueries"] = [];
  if (extraQueryId !== undefined) {
    const query = (await pool.request().input("id", sql.BigInt, extraQueryId).query("SELECT Id,DatasetId FROM uqp.QueryDefinition WHERE Id=@id")).recordset[0];
    if (!query) throw new DashboardApprovalError("DASHBOARD_QUERY_NOT_AVAILABLE");
    extraQueries.push({ id: extraQueryId, datasetId: Number(query.DatasetId) });
  }
  return { signature: signature(parent, sources), extraQueries,
    datasetIds: [...new Set([Number(parent.PrimaryDatasetId), ...sources.map(s => Number(s.DatasetId)), ...extraQueries.map(q => q.datasetId), ...extraDatasetIds].map(safeId))].sort((a, b) => a - b) };
}
/** Lock order shared with sensitivity writers: Dataset IDs ascending → Dashboard → source range.
 * A changed binding aborts instead of taking an additional Dataset lock out of order.
 */
export async function lockLegacyBindings(tx: sql.Transaction, id: number, seed: LegacyLockSeed,
  request = (transaction: sql.Transaction) => new sql.Request(transaction), enabled?: boolean): Promise<{ parent: Row; sources: Row[] }> {
  if (enabled ?? env.DASHBOARD_QUERY_SOURCE_MANAGEMENT) throw new DashboardApprovalError("QUERY_SOURCE_LEGACY_WRITER_DISABLED");
  for (const datasetId of seed.datasetIds) {
    const row = (await request(tx).input("datasetId", sql.BigInt, datasetId)
      .query("SELECT Id FROM uqp.Dataset WITH (UPDLOCK,HOLDLOCK) WHERE Id=@datasetId")).recordset[0];
    if (!row) throw new DashboardApprovalError("DATASET_NOT_AVAILABLE");
  }
  await assertLegacyDashboardWriter(tx, id, request, enabled);
  const parent = (await request(tx).input("id", sql.BigInt, id).query(parentSql)).recordset[0];
  const sources = (await request(tx).input("id", sql.BigInt, id).query(sourcesSql.replace("uqp.DashboardDataSource", "uqp.DashboardDataSource WITH (UPDLOCK,HOLDLOCK)"))).recordset;
  if (!parent || signature(parent, sources) !== seed.signature) throw new DashboardApprovalError("DASHBOARD_APPROVAL_BINDING_CHANGED");
  for (const extra of seed.extraQueries) {
    const row = (await request(tx).input("id", sql.BigInt, extra.id).query("SELECT DatasetId FROM uqp.QueryDefinition WHERE Id=@id")).recordset[0];
    if (!row || Number(row.DatasetId) !== extra.datasetId) throw new DashboardApprovalError("DASHBOARD_APPROVAL_BINDING_CHANGED");
  }
  return { parent, sources };
}
