import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { querySourceSchemaReady } from "./dashboardQuerySources.repository.js";
import { QuerySourceError } from "./dashboardQuerySources.service.js";
import type { ExecutionBinding } from "./dashboardQuerySourceExecution.js";
import { readDashboardQueryMode } from "./dashboardQueryMode.repository.js";
import { getDashboardLayout } from "./dashboardLayout.repository.js";

export async function loadQueryExecutionBinding(id: number, key: string): Promise<ExecutionBinding> {
  const pool = await getPlatformDbPool();
  if (!pool || !await querySourceSchemaReady(pool.request())) throw new QuerySourceError("QUERY_SOURCE_SCHEMA_REQUIRED", 503);
  const mode = await readDashboardQueryMode(id);
  if (key === "PRIMARY") {
    const row = (await pool.request().input("id", sql.BigInt, id).query("SELECT * FROM uqp.Dashboard WHERE Id=@id")).recordset[0];
    if (!row) throw new QuerySourceError("DASHBOARD_NOT_FOUND", 404);
    let values: Record<string, unknown>;
    try { values = JSON.parse(String(row.ParametersJson)); if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error(); }
    catch { throw new QuerySourceError("QUERY_SOURCE_SAVED_CONFIG_INVALID"); }
    const { snapshotKind: _kind, snapshotSeconds: _seconds, deviceColumnMasks: _masks, deviceColumnTypes: _types, ...parameters } = values;
    return { dashboardId: id, sourceId: id, sourceKey: "PRIMARY", queryDefinitionId: Number(row.QueryDefinitionId),
      bindingRevision: Math.max(1, mode.version), managed: row.QuerySourceMaxRows != null, mode: mode.mode, modeRevision: mode.version,
      dashboardActive: Boolean(row.IsActive), enabled: true, parameters, refreshSeconds: Number(row.RefreshSeconds),
      pageSeconds: Number(row.PageSeconds), pageSize: Number(row.PageSize), maxRows: row.QuerySourceMaxRows == null ? 1000 : Number(row.QuerySourceMaxRows) };
  }
  // Read only this source's parameters: an invalid sibling cannot break its execution.
  const result = await pool.request().input("dashboardId", sql.BigInt, id).input("key", sql.NVarChar(64), key).query(`
    SELECT d.IsActive AS DashboardActive,d.QuerySourceMaxRows,s.* FROM uqp.Dashboard d
    INNER JOIN uqp.DashboardDataSource s ON s.DashboardId=d.Id WHERE d.Id=@dashboardId AND s.SourceKey=@key`);
  const row = result.recordset[0];
  if (!row || String(row.SourceKey) !== key) throw new QuerySourceError("DASHBOARD_SOURCE_NOT_FOUND", 404);
  let parameters: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(String(row.ParametersJson));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    parameters = parsed as Record<string, unknown>;
  } catch { throw new QuerySourceError("QUERY_SOURCE_SAVED_CONFIG_INVALID"); }
  const layout = await getDashboardLayout(id);
  const referenced = layout.profiles.some(p => p.widgets.some(w => (w.widgetType === "FIELD" || w.widgetType === "TABLE") && w.config.dataSourceKey === key));
  return { dashboardId: id, sourceId: Number(row.Id), sourceKey: key, mode: mode.mode, modeRevision: mode.version, referenced,
    queryDefinitionId: row.QueryDefinitionId == null ? null : Number(row.QueryDefinitionId),
    bindingRevision: Number(row.QueryBindingRevision), managed: row.QuerySourceMaxRows != null,
    dashboardActive: Boolean(row.DashboardActive), enabled: Boolean(row.IsEnabled), parameters,
    refreshSeconds: Number(row.RefreshSeconds), pageSize: Number(row.PageSize), pageSeconds: Number(row.PageSeconds),
    maxRows: row.MaxRows == null ? null : Number(row.MaxRows) };
}

/** Old routes must never execute a converted source through historical DatasetId. */
export async function legacySourceIsQueryBound(id: number, key: string) {
  const pool = await getPlatformDbPool();
  if (!pool) throw new QuerySourceError("QUERY_SOURCE_STORAGE_UNAVAILABLE", 503);
  const schema = await pool.request().query("SELECT COL_LENGTH('uqp.DashboardDataSource','QueryDefinitionId') AS Binding, COL_LENGTH('uqp.Dashboard','QuerySourceMaxRows') AS Marker");
  const columns = schema.recordset[0];
  if (columns?.Binding == null && columns?.Marker == null) return false;
  if (columns?.Binding == null || columns?.Marker == null) throw new QuerySourceError("QUERY_SOURCE_SCHEMA_REQUIRED", 503);
  const result = await pool.request().input("id", sql.BigInt, id).input("key", sql.NVarChar(64), key)
    .query(`SELECT Id FROM uqp.Dashboard WHERE Id=@id AND (QuerySourceMaxRows IS NOT NULL OR
      EXISTS (SELECT 1 FROM uqp.DashboardDataSource WHERE DashboardId=@id AND SourceKey=@key AND QueryDefinitionId IS NOT NULL))`);
  return result.recordset.length > 0;
}
