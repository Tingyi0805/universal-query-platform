import sql from "mssql";
import { env } from "../../config/env.js";
import { QuerySourceError } from "./dashboardQuerySources.service.js";
import { getPlatformDbPool } from "../../config/database.js";

/** All legacy configuration writers take this same Dashboard lock before mutation. */
export async function assertLegacyDashboardWriter(tx: sql.Transaction, dashboardId: number,
  createRequest = (transaction: sql.Transaction) => new sql.Request(transaction), enabled = env.DASHBOARD_QUERY_SOURCE_MANAGEMENT) {
  if (enabled) throw new QuerySourceError("QUERY_SOURCE_LEGACY_WRITER_DISABLED");
  const request = createRequest(tx).input("dashboardId", sql.BigInt, dashboardId);
  const dashboard = await request.query("SELECT Id FROM uqp.Dashboard WITH (UPDLOCK,HOLDLOCK) WHERE Id=@dashboardId");
  if (!dashboard.recordset.length) throw new QuerySourceError("DASHBOARD_NOT_FOUND", 404);
  const modeSchema = await createRequest(tx).query("SELECT COL_LENGTH('uqp.Dashboard','QueryMode') AS Mode");
  if (modeSchema.recordset[0]?.Mode) {
    const mode = await createRequest(tx).input("dashboardId", sql.BigInt, dashboardId).query("SELECT QueryMode FROM uqp.Dashboard WHERE Id=@dashboardId");
    if (mode.recordset[0]?.QueryMode !== "LEGACY") throw new QuerySourceError("QUERY_SOURCE_LEGACY_WRITER_DISABLED");
  }
  // Safe before 917. Never compile statements using missing columns.
  const schema = await createRequest(tx).query("SELECT COL_LENGTH('uqp.Dashboard','QuerySourceMaxRows') AS Marker, COL_LENGTH('uqp.DashboardDataSource','QueryDefinitionId') AS Binding");
  const columns = schema.recordset[0];
  if (!columns?.Marker && !columns?.Binding) return;
  if (!columns?.Marker || !columns?.Binding) throw new QuerySourceError("QUERY_SOURCE_SCHEMA_REQUIRED", 503);
  const bound = await createRequest(tx).input("dashboardId", sql.BigInt, dashboardId).query(`
    SELECT Id FROM uqp.Dashboard WHERE Id=@dashboardId AND
      (QuerySourceMaxRows IS NOT NULL OR EXISTS (SELECT 1 FROM uqp.DashboardDataSource WHERE DashboardId=@dashboardId AND QueryDefinitionId IS NOT NULL))`);
  if (bound.recordset.length) throw new QuerySourceError("QUERY_SOURCE_LEGACY_WRITER_DISABLED");
}

/** Only the legacy supplemental preview boundary is guarded; no runtime is changed. */
export async function assertLegacySourcePreview(dashboardId: number) {
  const pool = await getPlatformDbPool();
  if (!pool) throw new QuerySourceError("QUERY_SOURCE_STORAGE_UNAVAILABLE", 503);
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try { await assertLegacyDashboardWriter(tx, dashboardId); await tx.commit(); }
  catch (error) { await tx.rollback().catch(() => undefined); throw error; }
}
