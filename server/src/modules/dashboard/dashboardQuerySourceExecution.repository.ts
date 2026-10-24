import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { querySourceSchemaReady, querySourceStore } from "./dashboardQuerySources.repository.js";
import { QuerySourceError, sourceVersion, type SourceStore } from "./dashboardQuerySources.service.js";
import type { ExecutionBinding } from "./dashboardQuerySourceExecution.js";
import { readDashboardQueryMode, queryModeSchemaReady } from "./dashboardQueryMode.repository.js";
import { dashboardQueryParameters } from "./dashboardDeviceMasking.js";
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
    const parameters = dashboardQueryParameters(values);
    return { dashboardId: id, sourceId: id, sourceKey: "PRIMARY", queryDefinitionId: Number(row.QueryDefinitionId),
      bindingRevision: Math.max(1, mode.version), managed: row.QuerySourceMaxRows != null, mode: mode.mode, modeRevision: mode.version,
      dashboardActive: Boolean(row.IsActive), enabled: true, parameters, deviceMasks: values.deviceColumnMasks, deviceTypes: values.deviceColumnTypes, refreshSeconds: Number(row.RefreshSeconds),
      pageSeconds: Number(row.PageSeconds), pageSize: Number(row.PageSize), maxRows: row.QuerySourceMaxRows == null ? 1000 : Number(row.QuerySourceMaxRows) };
  }
  // Read only this source's parameters: an invalid sibling cannot break its execution.
  const result = await pool.request().input("dashboardId", sql.BigInt, id).input("key", sql.NVarChar(64), key).query(`
    SELECT d.IsActive AS DashboardActive,d.QuerySourceMaxRows,d.ParametersJson AS DashboardParametersJson,s.* FROM uqp.Dashboard d
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
    dashboardActive: Boolean(row.DashboardActive), enabled: Boolean(row.IsEnabled), parameters, sourceMasks: (() => {
      try { const policies = JSON.parse(String(row.DashboardParametersJson)).deviceSourceColumnMasks;
        return { [key]: policies?.[key] }; }
      catch { throw new QuerySourceError("QUERY_SOURCE_SAVED_CONFIG_INVALID"); }
    })(),
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

/** Reuse the existing locked configuration reader; never execute historical Dataset bindings. */
export function createUserPlaybackSourcesReader(store: SourceStore = querySourceStore) {
 return async (id: number) => store.transaction(async tx => {
    if (!await tx.schemaReady()) throw new QuerySourceError("QUERY_SOURCE_SCHEMA_REQUIRED", 503);
    const state = await tx.readState(id);
    if (!state.dashboard.isActive || state.dashboard.mode !== "QUERY_ONLY" || !state.dashboard.modeVersion || state.dashboard.maxRows === null)
      throw new QuerySourceError("QUERY_SOURCE_MODE_NOT_ACTIVATED");
    if (state.sources.length > 7 || state.sources.some(s => s.queryDefinitionId === null || s.maxRows === null || s.queryBindingRevision < 1))
      throw new QuerySourceError("QUERY_SOURCE_PENDING_CONVERSION");
    const keys = ["PRIMARY", ...state.sources.filter(s => s.isEnabled).map(s => s.sourceKey)];
    if (new Set(keys.map(k => k.toUpperCase())).size !== keys.length || keys.some(k => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(k)) ||
      state.references.some(k => !keys.includes(k))) throw new QuerySourceError("QUERY_SOURCE_REFERENCE_INVALID");
    return { keys, references: state.references, version: sourceVersion(state) };
  });
}
const readUserSources = createUserPlaybackSourcesReader();
export async function loadUserPlaybackSources(id: number) {
  // Also enforce 918 for direct page POSTs; UI metadata validation is not authority.
  if ((await readUserPlaybackMode(id)).mode !== "QUERY_ONLY") throw new QuerySourceError("QUERY_SOURCE_MODE_NOT_ACTIVATED");
  return readUserSources(id);
}

export async function readUserPlaybackMode(id: number) {
  const pool = await getPlatformDbPool();
  if (!pool || !await queryModeSchemaReady(pool.request())) throw new QuerySourceError("QUERY_MODE_SCHEMA_REQUIRED", 503);
  return readDashboardQueryMode(id);
}
