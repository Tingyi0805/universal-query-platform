import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";

export type DashboardDataSource = {
  id: number;
  dashboardId: number;
  sourceKey: string;
  datasetId: number;
  refreshSeconds: number;
  parameters: Record<string, unknown>;
  isEnabled: boolean;
};

export type DashboardDataSourceInput = Omit<DashboardDataSource, "id" | "dashboardId">;

function parseParameters(raw: unknown): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(String(raw ?? "{}"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

export async function listDashboardDataSources(dashboardId: number): Promise<DashboardDataSource[]> {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  const result = await pool.request().input("dashboardId", sql.BigInt, dashboardId)
    .query("SELECT Id, DashboardId, SourceKey, DatasetId, RefreshSeconds, ParametersJson, IsEnabled FROM uqp.DashboardDataSource WHERE DashboardId=@dashboardId ORDER BY Id");
  return result.recordset.map((row) => ({
    id: Number(row.Id), dashboardId: Number(row.DashboardId), sourceKey: String(row.SourceKey),
    datasetId: Number(row.DatasetId), refreshSeconds: Number(row.RefreshSeconds),
    parameters: parseParameters(row.ParametersJson), isEnabled: Boolean(row.IsEnabled),
  }));
}

/** Atomic replacement, with row locking to prevent concurrent partial source configurations. */
export async function replaceDashboardDataSources(dashboardId: number, sources: DashboardDataSourceInput[]): Promise<DashboardDataSource[]> {
  const pool = await getPlatformDbPool();
  if (!pool) throw new Error("PLATFORM_DB_NOT_CONFIGURED");
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const dashboard = await new sql.Request(tx).input("dashboardId", sql.BigInt, dashboardId)
      .query("SELECT Id FROM uqp.Dashboard WITH (UPDLOCK, HOLDLOCK) WHERE Id=@dashboardId");
    if (!dashboard.recordset.length) throw new Error("DASHBOARD_NOT_FOUND");
    await new sql.Request(tx).input("dashboardId", sql.BigInt, dashboardId)
      .query("DELETE FROM uqp.DashboardDataSource WHERE DashboardId=@dashboardId");
    for (const source of sources) {
      const dataset = await new sql.Request(tx).input("datasetId", sql.BigInt, source.datasetId)
        .query("SELECT Id FROM uqp.Dataset WHERE Id=@datasetId AND IsActive=1 AND IsArchived=0");
      if (!dataset.recordset.length) throw new Error("DATASET_NOT_AVAILABLE");
      await new sql.Request(tx)
        .input("dashboardId", sql.BigInt, dashboardId)
        .input("sourceKey", sql.NVarChar(64), source.sourceKey)
        .input("datasetId", sql.BigInt, source.datasetId)
        .input("refreshSeconds", sql.Int, source.refreshSeconds)
        .input("parametersJson", sql.NVarChar(sql.MAX), JSON.stringify(source.parameters))
        .input("isEnabled", sql.Bit, source.isEnabled)
        .query("INSERT INTO uqp.DashboardDataSource (DashboardId,SourceKey,DatasetId,RefreshSeconds,ParametersJson,IsEnabled) VALUES (@dashboardId,@sourceKey,@datasetId,@refreshSeconds,@parametersJson,@isEnabled)");
    }
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
  return listDashboardDataSources(dashboardId);
}
