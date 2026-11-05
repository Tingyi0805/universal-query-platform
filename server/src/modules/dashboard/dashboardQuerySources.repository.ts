import { createHash } from "node:crypto";
import { writeDashboardLayout } from "./dashboardLayout.repository.js";
import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { getEffectiveQueryAccess } from "../queryDefinition/queryDefinition.repository.js";
import { getDataset } from "../dataset/dataset.repository.js";
import { listDatasetParameters } from "../dataset/parameter.repository.js";
import { runtimeParameterDefinitions } from "../dataset/parameterSync.js";
import { coerceRuntimeParameters } from "../dataset/parameter.service.js";
import { writeAuditEvent } from "../audit/audit.repository.js";
import { QuerySourceError, type SourceState, type SourceStore, type SourceTransaction } from "./dashboardQuerySources.service.js";

const parameters = (raw: unknown): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(String(raw ?? "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* fail closed without including persisted values */ }
  throw new QuerySourceError("QUERY_SOURCE_SAVED_CONFIG_INVALID");
};
const parameterCodes = new Set(["PARAMETER_REQUIRED", "PARAMETER_NUMBER_INVALID", "PARAMETER_BOOLEAN_INVALID",
  "PARAMETER_DATE_INVALID", "PARAMETER_DATETIME_INVALID", "PARAMETER_PARSE_FAILED", "PARAMETER_DEFINITION_MISMATCH"]);
export function safeParameterFailure(error: unknown): never {
  const code = error instanceof Error ? error.message.split(":")[0]! : "";
  if (parameterCodes.has(code)) throw new QuerySourceError(code, code === "PARAMETER_DEFINITION_MISMATCH" || code === "PARAMETER_PARSE_FAILED" ? 409 : 400);
  throw new QuerySourceError("QUERY_SOURCE_PARAMETER_VALIDATION_FAILED", 400);
}

export async function querySourceSchemaReady(request: sql.Request) {
  const result = await request.query(`
    SELECT CASE WHEN
      COL_LENGTH('uqp.Dashboard','QuerySourceMaxRows') IS NOT NULL
      AND COL_LENGTH('uqp.DashboardDataSource','QueryDefinitionId') IS NOT NULL
      AND COL_LENGTH('uqp.DashboardDataSource','QueryBindingRevision') IS NOT NULL
      AND COL_LENGTH('uqp.DashboardDataSource','MaxRows') IS NOT NULL
      AND EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('uqp.DashboardDataSource') AND name='QueryBindingState' AND is_computed=1)
      AND EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID('uqp.DashboardDataSource') AND name='FK_DashboardDataSource_QueryDefinition' AND is_disabled=0 AND is_not_trusted=0)
      AND (SELECT COUNT(*) FROM sys.check_constraints WHERE is_disabled=0 AND is_not_trusted=0 AND
        ((parent_object_id=OBJECT_ID('uqp.DashboardDataSource') AND name IN ('CK_DashboardDataSource_QueryBindingRevision','CK_DashboardDataSource_MaxRows','CK_DashboardDataSource_QueryBoundLimit'))
        OR (parent_object_id=OBJECT_ID('uqp.Dashboard') AND name='CK_Dashboard_QuerySourceMaxRows'))) = 4
    THEN 1 ELSE 0 END AS Ready`);
  return Boolean(result.recordset[0]?.Ready);
}

export const defaultQuerySourceDependencies = {
  getPool: getPlatformDbPool,
  createTransaction: (pool: sql.ConnectionPool) => new sql.Transaction(pool),
  createRequest: (transaction: sql.Transaction) => new sql.Request(transaction),
  getEffectiveQueryAccess, getDataset, listDatasetParameters, writeAuditEvent,
};
export function createQuerySourceStore(deps: typeof defaultQuerySourceDependencies & {
  extend?: (transaction: sql.Transaction, base: SourceTransaction) => SourceTransaction;
} = defaultQuerySourceDependencies): SourceStore {
return {
  async transaction(work) {
    const pool = await deps.getPool();
    if (!pool) throw new QuerySourceError("QUERY_SOURCE_STORAGE_UNAVAILABLE", 503);
    const transaction = deps.createTransaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const request = () => deps.createRequest(transaction);
    const scoped = (id: number) => request().input("dashboardId", sql.BigInt, id);
    const tx: SourceTransaction = {
      schemaReady: () => querySourceSchemaReady(request()),
      async readState(id) {
        const dashboard = (await scoped(id).query("SELECT * FROM uqp.Dashboard WITH (UPDLOCK,HOLDLOCK) WHERE Id=@dashboardId")).recordset[0];
        if (!dashboard) throw new QuerySourceError("DASHBOARD_NOT_FOUND", 404);
        const sources = (await scoped(id).query("SELECT * FROM uqp.DashboardDataSource WITH (UPDLOCK,HOLDLOCK) WHERE DashboardId=@dashboardId ORDER BY Id")).recordset;
        const widgets = (await scoped(id).query(`SELECT w.ConfigJson,w.Id AS WidgetId,w.WidgetType,w.Title,w.SourceKey,w.StaticText,
          w.X,w.Y,w.Width,w.Height,w.FontSize,w.Alignment,w.SortOrder AS WidgetOrder,
          p.Id AS ProfileId,p.Name AS ProfileName,p.CanvasWidth,p.CanvasHeight,p.IsDefault,
          p.SortOrder AS ProfileOrder,p.ConfigJson AS ProfileConfig
          FROM uqp.DashboardDisplayProfile p WITH (UPDLOCK,HOLDLOCK)
          LEFT JOIN uqp.DashboardWidget w WITH (UPDLOCK,HOLDLOCK) ON w.ProfileId=p.Id
          WHERE p.DashboardId=@dashboardId ORDER BY p.Id,w.Id`)).recordset;
        return {
          dashboard: { id, queryDefinitionId: Number(dashboard.QueryDefinitionId), isActive: Boolean(dashboard.IsActive),
            mode: String(dashboard.QueryMode ?? "LEGACY"), modeVersion: Number(dashboard.QueryModeVersion ?? 0),
            parameters: parameters(dashboard.ParametersJson), updatedAtUtc: new Date(dashboard.UpdatedAtUtc).toISOString(),
            maxRows: dashboard.QuerySourceMaxRows == null ? null : Number(dashboard.QuerySourceMaxRows),
            refreshSeconds: Number(dashboard.RefreshSeconds), pageSize: Number(dashboard.PageSize), pageSeconds: Number(dashboard.PageSeconds) },
          sources: sources.map(s => ({ id: Number(s.Id), sourceKey: String(s.SourceKey), datasetId: Number(s.DatasetId),
            queryDefinitionId: s.QueryDefinitionId == null ? null : Number(s.QueryDefinitionId), queryBindingRevision: Number(s.QueryBindingRevision),
            parameters: parameters(s.ParametersJson), refreshSeconds: Number(s.RefreshSeconds), pageSize: Number(s.PageSize),
            pageSeconds: Number(s.PageSeconds), isEnabled: Boolean(s.IsEnabled), maxRows: s.MaxRows == null ? null : Number(s.MaxRows) })),
          layoutFingerprint: createHash("sha256").update(JSON.stringify(widgets)).digest("hex"),
          references: widgets.filter(w => w.WidgetType === "FIELD" || w.WidgetType === "TABLE").map(w => {
            const key = parameters(w.ConfigJson).dataSourceKey;
            if (key !== undefined && typeof key !== "string") throw new QuerySourceError("QUERY_SOURCE_SAVED_CONFIG_INVALID");
            return key as string | undefined ?? "PRIMARY";
          }),
        } satisfies SourceState;
      },
      async validateQuery(userId, queryId, values) {
        const query = (await request().input("id", sql.BigInt, queryId)
          .query("SELECT Id,DatasetId,IsPublished,IsActive,IsArchived FROM uqp.QueryDefinition WHERE Id=@id")).recordset[0];
        if (!query?.IsPublished || !query.IsActive || query.IsArchived) throw new QuerySourceError("QUERY_SOURCE_QUERY_NOT_AVAILABLE");
        // Reuse the existing role/user ACL union inside this SERIALIZABLE transaction.
        const access = await deps.getEffectiveQueryAccess(userId, queryId, transaction);
        if (!access?.canView || !access.canExecute) throw new QuerySourceError("QUERY_SOURCE_QUERY_FORBIDDEN", 403);
        const dataset = await deps.getDataset(Number(query.DatasetId), transaction);
        if (!dataset?.isActive || dataset.isArchived) throw new QuerySourceError("QUERY_SOURCE_DATASET_NOT_AVAILABLE");
        const definitions = await deps.listDatasetParameters(dataset.id, transaction);
        try { coerceRuntimeParameters(runtimeParameterDefinitions(dataset.sqlText, definitions), values); }
        catch (error) { safeParameterFailure(error); }
        return dataset.id;
      },
      async upsert(id, source) {
        const query = scoped(id).input("id", sql.BigInt, source.id).input("sourceKey", sql.NVarChar(64), source.sourceKey)
          .input("datasetId", sql.BigInt, source.datasetId).input("queryId", sql.BigInt, source.queryDefinitionId)
          .input("revision", sql.BigInt, source.queryBindingRevision).input("maxRows", sql.Int, source.maxRows)
          .input("refreshSeconds", sql.Int, source.refreshSeconds).input("pageSize", sql.Int, source.pageSize)
          .input("pageSeconds", sql.Int, source.pageSeconds).input("parameters", sql.NVarChar(sql.MAX), JSON.stringify(source.parameters))
          .input("enabled", sql.Bit, source.isEnabled);
        if (source.id === null) await query.query(`INSERT INTO uqp.DashboardDataSource
          (DashboardId,SourceKey,DatasetId,QueryDefinitionId,QueryBindingRevision,MaxRows,RefreshSeconds,PageSize,PageSeconds,ParametersJson,IsEnabled)
          VALUES (@dashboardId,@sourceKey,@datasetId,@queryId,@revision,@maxRows,@refreshSeconds,@pageSize,@pageSeconds,@parameters,@enabled)`);
        else await query.query(`UPDATE uqp.DashboardDataSource SET QueryDefinitionId=@queryId,QueryBindingRevision=@revision,MaxRows=@maxRows,
          RefreshSeconds=@refreshSeconds,PageSize=@pageSize,PageSeconds=@pageSeconds,ParametersJson=@parameters,IsEnabled=@enabled,UpdatedAtUtc=SYSUTCDATETIME()
          WHERE Id=@id AND DashboardId=@dashboardId AND SourceKey=@sourceKey`);
      },
      writeLayout: (id, profiles) => writeDashboardLayout(transaction, id, profiles, deps.createRequest),
      async updatePrimary(id, source) {
        await scoped(id).input("queryId", sql.BigInt, source.queryDefinitionId)
          .input("parameters", sql.NVarChar(sql.MAX), JSON.stringify(source.parameters))
          .input("refreshSeconds", sql.Int, source.refreshSeconds).input("pageSize", sql.Int, source.pageSize)
          .input("pageSeconds", sql.Int, source.pageSeconds).input("maxRows", sql.Int, source.maxRows)
          .query(`UPDATE uqp.Dashboard SET QueryDefinitionId=@queryId,ParametersJson=@parameters,
            RefreshSeconds=@refreshSeconds,PageSize=@pageSize,PageSeconds=@pageSeconds,
            QuerySourceMaxRows=@maxRows,UpdatedAtUtc=SYSUTCDATETIME() WHERE Id=@dashboardId`);
      },
      async remove(id, sourceId) { await scoped(id).input("id", sql.BigInt, sourceId)
        .query("DELETE FROM uqp.DashboardDataSource WHERE DashboardId=@dashboardId AND Id=@id"); },
      async markManaged(id) { await scoped(id).query("UPDATE uqp.Dashboard SET QuerySourceMaxRows=COALESCE(QuerySourceMaxRows,1000),UpdatedAtUtc=SYSUTCDATETIME() WHERE Id=@dashboardId"); },
      async audit(userId, dashboardId, changes) {
        await deps.writeAuditEvent({ eventType: "DASHBOARD_QUERY_SOURCES_UPDATED", userId,
          parameters: { dashboardId, changes } }, transaction);
      },
    };
    try { const result = await work(deps.extend?.(transaction, tx) ?? tx); await transaction.commit(); return result; }
    catch (error) { await transaction.rollback().catch(() => undefined); throw error; }
  },
};
}
export const querySourceStore = createQuerySourceStore();
