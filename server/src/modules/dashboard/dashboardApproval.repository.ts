import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { requireSecuritySchema } from "../securityContract/securityContract.repository.js";
import { getTokenSessionState } from "../auth/auth.repository.js";
import { getEffectiveQueryAccess } from "../queryDefinition/queryDefinition.repository.js";
import { writeAuditEvent } from "../audit/audit.repository.js";
import { lockLegacyBindings, prepareLegacyLocks } from "./dashboardLegacyLocks.js";
import { approvalObject, approvalVersion, createDashboardApprovalService, DashboardApprovalError, type ApprovalStore, type ApprovalState } from "./dashboardApproval.service.js";
import type { DatasetSensitiveColumn } from "../dataset/datasetSensitiveColumn.repository.js";

export function parseApprovalParameters(value: unknown): Record<string, unknown> {
  try { return approvalObject(JSON.parse(String(value))); }
  catch { throw new DashboardApprovalError("DASHBOARD_APPROVAL_CONFIG_INVALID"); }
}
const rowVersion = (value: unknown) => {
  if (!Buffer.isBuffer(value) || value.length !== 8) throw new DashboardApprovalError("SECURITY_SCHEMA_REQUIRED", 503);
  return value.toString("hex");
};
export const defaultApprovalDependencies = { getPool: getPlatformDbPool, createTransaction: (pool: sql.ConnectionPool) => new sql.Transaction(pool),
  createRequest: (tx: sql.Transaction) => new sql.Request(tx), schema: requireSecuritySchema,
  prepare: prepareLegacyLocks, lock: lockLegacyBindings, session: getTokenSessionState, access: getEffectiveQueryAccess, audit: writeAuditEvent };
export function createDashboardApprovalStore(deps = defaultApprovalDependencies): ApprovalStore {
  return { async transaction(id, run) {
    const pool = await deps.getPool(); if (!pool) throw new DashboardApprovalError("SECURITY_SCHEMA_REQUIRED", 503);
    const seed = await deps.prepare(pool, id);
    const tx = deps.createTransaction(pool); const request = () => deps.createRequest(tx);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      await request().query("SET XACT_ABORT ON"); await deps.schema(request());
      const locked = await deps.lock(tx, id, seed, deps.createRequest);
      // Existing ACL helper reads related lookup/role rows. Never wait for a late
      // lock after owning Dashboard/source locks; contention aborts the whole edit.
      await request().query("SET LOCK_TIMEOUT 0");
      let state: ApprovalState | undefined;
      const result = await run({
        async read(dashboardId, actor) {
          if (dashboardId !== id) throw new DashboardApprovalError("DASHBOARD_APPROVAL_BINDING_CHANGED");
          const session = await deps.session(actor.userId, tx);
          if (!session?.isActive || session.tokenVersion !== actor.tokenVersion) throw new DashboardApprovalError("TOKEN_REVOKED", 401);
          if (!session.permissions.includes("DESIGN_QUERY")) throw new DashboardApprovalError("FORBIDDEN", 403);
          const access = await deps.access(actor.userId, Number(locked.parent.QueryDefinitionId), tx);
          if (!access?.canView || !access.canExecute) throw new DashboardApprovalError("DASHBOARD_APPROVAL_QUERY_FORBIDDEN", 403);
          const parent = (await request().input("id", sql.BigInt, id).query("SELECT ParametersJson,ApprovalRowVersion,IsActive FROM uqp.Dashboard WHERE Id=@id")).recordset[0];
          const sources = [{ Id: id, SourceKey: "PRIMARY", DatasetId: locked.parent.PrimaryDatasetId, ApprovalRowVersion: parent?.ApprovalRowVersion }, ...locked.sources];
          const policies = new Map<number, { version: number; columns: DatasetSensitiveColumn[] }>();
          for (const source of sources) {
            const datasetId = Number(source.DatasetId);
            if (policies.has(datasetId)) continue;
            const dataset = (await request().input("id", sql.BigInt, datasetId).query(`SELECT d.Id FROM uqp.Dataset d
              INNER JOIN uqp.DataSource s ON s.Id=d.DataSourceId AND s.IsActive=1 WHERE d.Id=@id AND d.IsActive=1 AND d.IsArchived=0`)).recordset[0];
            if (!dataset) throw new DashboardApprovalError("DATASET_NOT_AVAILABLE");
            const revision = (await request().input("id", sql.BigInt, datasetId).query("SELECT VersionNumber FROM uqp.DatasetSensitivePolicyVersion WHERE DatasetId=@id")).recordset[0];
            const rows = (await request().input("id", sql.BigInt, datasetId).query("SELECT ColumnName,SensitivityType,DeviceMaskMode,CustomMaskJson FROM uqp.DatasetSensitiveColumn WHERE DatasetId=@id ORDER BY ColumnName")).recordset;
            const columns = rows.map(r => { let customMask = null;
              if (r.CustomMaskJson) { try { customMask = JSON.parse(String(r.CustomMaskJson)); } catch { throw new DashboardApprovalError("DASHBOARD_SENSITIVITY_POLICY_INVALID", 503); } }
              return { columnName: String(r.ColumnName), sensitivityType: String(r.SensitivityType), deviceMaskMode: r.DeviceMaskMode, customMask } as DatasetSensitiveColumn;
            });
            policies.set(datasetId, { version: Number(revision?.VersionNumber ?? 0), columns });
          }
          if (!parent || sources.some(s => s.SourceKey !== "PRIMARY" && String(s.SourceKey).toUpperCase() === "PRIMARY") ||
            new Set(sources.map(s => String(s.SourceKey).toUpperCase())).size !== sources.length) throw new DashboardApprovalError("DASHBOARD_APPROVAL_CONFIG_INVALID");
          state = { dashboardId: id, queryId: Number(locked.parent.QueryDefinitionId), isActive: Boolean(parent.IsActive), rowVersion: rowVersion(parent.ApprovalRowVersion),
            parameters: parseApprovalParameters(parent.ParametersJson), sources: sources.map(s => ({ id: Number(s.Id), sourceKey: String(s.SourceKey), datasetId: Number(s.DatasetId), rowVersion: rowVersion(s.ApprovalRowVersion), policy: policies.get(Number(s.DatasetId))! })) };
          approvalVersion(state); return state;
        },
        async update(dashboardId, parameters) {
          if (!state || dashboardId !== id) throw new DashboardApprovalError("DASHBOARD_APPROVAL_BINDING_CHANGED");
          await request().input("id", sql.BigInt, id).input("parameters", sql.NVarChar(sql.MAX), JSON.stringify(parameters)).query(
            "UPDATE uqp.Dashboard SET ParametersJson=@parameters,UpdatedAtUtc=SYSUTCDATETIME() WHERE Id=@id");
        },
        async audit(dashboardId, userId, sourceKey, context) {
          await deps.audit({ eventType: "DASHBOARD_COLUMN_APPROVAL_UPDATED", userId, parameters: { dashboardId, sourceKey }, ...context }, tx);
        },
      });
      await request().query("SET LOCK_TIMEOUT -1"); await tx.commit(); return result;
    } catch (error) {
      try { await request().query("SET LOCK_TIMEOUT -1"); } catch { /* transaction may be aborted */ }
      try { await tx.rollback(); } catch { /* keep original failure */ }
      const number = (error as { number?: number })?.number;
      if (number === 1205 || number === 1222) throw new DashboardApprovalError("DASHBOARD_APPROVAL_VERSION_CONFLICT");
      throw error;
    }
  } };
}
export const dashboardApprovalService = createDashboardApprovalService(createDashboardApprovalStore());

/** Independent read-only evidence: it does not require Legacy writer permission or enable flags. */
export function createDashboardApprovalEvidenceReader(deps: Pick<typeof defaultApprovalDependencies, "getPool" | "createTransaction" | "createRequest" | "schema"> = defaultApprovalDependencies) {
 return async (id: number): Promise<string> => {
  const pool = await deps.getPool(); if (!pool) throw new DashboardApprovalError("SECURITY_SCHEMA_REQUIRED", 503);
  const tx = deps.createTransaction(pool); await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    await deps.schema(deps.createRequest(tx));
    const parent = (await deps.createRequest(tx).input("id", sql.BigInt, id).query(
      "SELECT QueryDefinitionId,ApprovalRowVersion FROM uqp.Dashboard WITH (HOLDLOCK) WHERE Id=@id")).recordset[0];
    if (!parent) throw new DashboardApprovalError("DASHBOARD_NOT_FOUND", 404);
    const sources = (await deps.createRequest(tx).input("id", sql.BigInt, id).query(
      "SELECT Id,SourceKey,DatasetId,ApprovalRowVersion FROM uqp.DashboardDataSource WITH (HOLDLOCK) WHERE DashboardId=@id ORDER BY Id")).recordset;
    const digest = approvalVersion({ dashboardId: id, queryId: Number(parent.QueryDefinitionId), rowVersion: rowVersion(parent.ApprovalRowVersion),
      sources: sources.map(s => ({ id: Number(s.Id), sourceKey: String(s.SourceKey), datasetId: Number(s.DatasetId), rowVersion: rowVersion(s.ApprovalRowVersion) })) });
    await tx.commit(); return digest;
  } catch (error) { try { await tx.rollback(); } catch { /* no success */ } throw error; }
 };
}
export const getDashboardApprovalEvidence = createDashboardApprovalEvidenceReader();
