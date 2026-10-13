import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { getTokenSessionState } from "../auth/auth.repository.js";
import { writeAuditEvent } from "../audit/audit.repository.js";
import { createQuerySourceStore, defaultQuerySourceDependencies } from "./dashboardQuerySources.repository.js";
import { QuerySourceError } from "./dashboardQuerySources.service.js";
import type { ModeTransaction } from "./dashboardQueryMode.service.js";
import { parsePatientAuditKeyring } from "../audit/patientAuditKeyring.js";
import { isIP } from "node:net";
import { isValidIpOrCidr } from "./dashboardDeviceIp.js";

export async function readDashboardQueryMode(id: number) {
  const pool = await getPlatformDbPool();
  if (!pool) throw new QuerySourceError("QUERY_SOURCE_STORAGE_UNAVAILABLE", 503);
  const columns = (await pool.request().query("SELECT COL_LENGTH('uqp.Dashboard','QueryMode') AS Mode, COL_LENGTH('uqp.Dashboard','QueryModeVersion') AS Version")).recordset[0];
  if (columns?.Mode == null && columns?.Version == null) return { mode: "LEGACY", version: 0 };
  if (columns?.Mode == null || columns?.Version == null) throw new QuerySourceError("QUERY_MODE_SCHEMA_REQUIRED", 503);
  const row = (await pool.request().input("id", sql.BigInt, id).query("SELECT QueryMode,QueryModeVersion FROM uqp.Dashboard WHERE Id=@id")).recordset[0];
  if (!row) throw new QuerySourceError("DASHBOARD_NOT_FOUND", 404);
  if (!["LEGACY", "QUERY_ONLY", "QUERY_ONLY_DISABLED"].includes(String(row.QueryMode))) throw new QuerySourceError("QUERY_MODE_INVALID", 503);
  return { mode: String(row.QueryMode), version: Number(row.QueryModeVersion) };
}
export const queryModeStore = createQuerySourceStore({ ...defaultQuerySourceDependencies,
  extend(transaction, base) {
    const request = () => new sql.Request(transaction);
    const scoped = (id: number) => request().input("id", sql.BigInt, id);
    return Object.assign(base, {
      async modeReady() {
        const result = await request().query(`SELECT CASE WHEN COL_LENGTH('uqp.Dashboard','QueryMode') IS NOT NULL
          AND COL_LENGTH('uqp.Dashboard','QueryModeVersion') IS NOT NULL AND EXISTS
          (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('uqp.Dashboard') AND name='CK_Dashboard_QueryMode' AND is_disabled=0 AND is_not_trusted=0)
          AND COL_LENGTH('uqp.DashboardDisplayDevice','DelegatorTokenVersion') IS NOT NULL
          AND COL_LENGTH('uqp.DashboardDisplayDevice','QueryModeGrantVersion') IS NOT NULL
          AND EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('uqp.DashboardDisplayDevice') AND name='CK_DashboardDevice_QueryModeGrant' AND is_disabled=0 AND is_not_trusted=0)
          THEN 1 ELSE 0 END AS Ready`);
        return Boolean(result.recordset[0]?.Ready);
      },
      async actor(userId, tokenVersion) {
        const session = await getTokenSessionState(userId, transaction);
        if (!session?.isActive || session.tokenVersion !== tokenVersion) throw new QuerySourceError("TOKEN_REVOKED", 401);
        if (!session.permissions.includes("DESIGN_QUERY")) throw new QuerySourceError("FORBIDDEN", 403);
      },
      async devices(id) {
        const rows = (await scoped(id).query(`SELECT * FROM uqp.DashboardDisplayDevice WITH (UPDLOCK,HOLDLOCK)
          WHERE DashboardId=@id AND IsActive=1 AND RevokedAtUtc IS NULL AND ArchivedAtUtc IS NULL ORDER BY Id`)).recordset;
        return rows.map(row => ({ id: Number(row.Id), ownerId: Number(row.CreatedByUserId),
          enforceIpRestriction: Boolean(row.EnforceIpRestriction), allowedIp: row.AllowedIp == null ? null : String(row.AllowedIp),
          allowedCidr: row.AllowedCidr == null ? null : String(row.AllowedCidr),
          workstationId: row.SharedWorkstationId == null ? null : Number(row.SharedWorkstationId),
          expiresAt: row.ExpiresAtUtc == null ? null : new Date(row.ExpiresAtUtc).toISOString() }));
      },
      async delegation(device) {
        if (device.enforceIpRestriction && ((!device.allowedIp && !device.allowedCidr) ||
          (device.allowedIp && !isIP(device.allowedIp)) || (device.allowedCidr && !isValidIpOrCidr(device.allowedCidr))))
          throw new QuerySourceError("QUERY_DEVICE_IP_BINDING_INVALID");
        const session = await getTokenSessionState(device.ownerId, transaction);
        if (!session?.isActive || !session.permissions.includes("DESIGN_QUERY") || !session.permissions.includes("EXECUTE_QUERY") ||
          (device.expiresAt !== null && Date.parse(device.expiresAt) <= Date.now())) throw new QuerySourceError("QUERY_DEVICE_DELEGATION_INVALID", 403);
        if (device.workstationId !== null) {
          const station = (await scoped(device.workstationId).query("SELECT * FROM uqp.SharedWorkstation WHERE Id=@id")).recordset[0];
          if (!station?.IsActive || station.RetiredAtUtc || station.PurposeCode !== "DASHBOARD") throw new QuerySourceError("QUERY_DEVICE_WORKSTATION_INVALID");
        }
      },
      async policy(datasetId) {
        const result = await scoped(datasetId).query(`SELECT VersionNumber FROM uqp.DatasetSensitivePolicyVersion WHERE DatasetId=@id;
          SELECT ColumnName FROM uqp.DatasetSensitiveColumn WHERE DatasetId=@id;
          SELECT IsEnabled,PatientKeyColumn FROM uqp.DatasetPatientAuditConfig WHERE DatasetId=@id`);
        const recordsets = result.recordsets as unknown as Record<string, unknown>[][];
        if (!recordsets[0]?.length || Number(recordsets[0][0]!.VersionNumber) < 1 || !recordsets[1]?.length)
          throw new QuerySourceError("QUERY_SOURCE_SENSITIVITY_NOT_READY");
        if (!recordsets[2]?.[0]?.IsEnabled || !recordsets[2][0].PatientKeyColumn) throw new QuerySourceError("PATIENT_AUDIT_NOT_CONFIGURED", 503);
        try { parsePatientAuditKeyring(process.env.PATIENT_AUDIT_ACTIVE_KEY_VERSION, process.env.PATIENT_AUDIT_HMAC_KEYRING_JSON); }
        catch { throw new QuerySourceError("PATIENT_AUDIT_NOT_CONFIGURED", 503); }
      },
      async switchMode(id, enabled) {
        await scoped(id).input("mode", sql.VarChar(24), enabled ? "QUERY_ONLY" : "QUERY_ONLY_DISABLED").input("active", sql.Bit, enabled).query(`
          UPDATE uqp.Dashboard SET QueryMode=@mode,QueryModeVersion=QueryModeVersion+1,IsActive=@active,
            QuerySourceMaxRows=COALESCE(QuerySourceMaxRows,1000),UpdatedAtUtc=SYSUTCDATETIME() WHERE Id=@id;
          UPDATE uqp.DashboardDisplayDevice SET TokenHash=CONVERT(CHAR(64),HASHBYTES('SHA2_256',CRYPT_GEN_RANDOM(32)),2),LastUsedAtUtc=NULL,
            QueryModeGrantVersion=NULL,DelegatorTokenVersion=NULL
            WHERE DashboardId=@id;`);
      },
      async issueDevice(id, device, hash) {
        const session = await getTokenSessionState(device.ownerId, transaction);
        if (!session?.isActive) throw new QuerySourceError("QUERY_DEVICE_DELEGATION_INVALID", 403);
        const result = await scoped(id).input("deviceId", sql.BigInt, device.id).input("hash", sql.Char(64), hash)
          .input("version", sql.BigInt, session.tokenVersion).query(`UPDATE v SET TokenHash=@hash,DelegatorTokenVersion=@version,
            QueryModeGrantVersion=d.QueryModeVersion,LastUsedAtUtc=NULL FROM uqp.DashboardDisplayDevice v
            INNER JOIN uqp.Dashboard d ON d.Id=v.DashboardId WHERE d.Id=@id AND v.Id=@deviceId AND v.IsActive=1 AND d.QueryMode='QUERY_ONLY'`);
        if (result.rowsAffected[0] !== 1) throw new QuerySourceError("QUERY_DEVICE_CREDENTIAL_CONFLICT");
      },
      async issueAudit(userId, id, deviceId) {
        const grant = (await scoped(id).input("deviceId", sql.BigInt, deviceId).query(
          "SELECT QueryModeGrantVersion,CreatedByUserId FROM uqp.DashboardDisplayDevice WHERE DashboardId=@id AND Id=@deviceId")).recordset[0];
        await writeAuditEvent({ eventType: "DASHBOARD_QUERY_DEVICE_ISSUED", userId,
          parameters: { dashboardId: id, deviceId, modeVersion: Number(grant?.QueryModeGrantVersion), delegatorUserId: Number(grant?.CreatedByUserId) } }, transaction);
      },
      async modeAudit(userId, id, enabled) {
        const mode = (await scoped(id).query("SELECT QueryMode,QueryModeVersion FROM uqp.Dashboard WHERE Id=@id")).recordset[0];
        await writeAuditEvent({ eventType: enabled ? "DASHBOARD_QUERY_MODE_ENABLED" : "DASHBOARD_QUERY_MODE_DISABLED",
          userId, parameters: { dashboardId: id, mode: String(mode?.QueryMode), modeVersion: Number(mode?.QueryModeVersion), credentialsInvalidated: true } }, transaction);
      },
    } satisfies Partial<ModeTransaction>);
  },
});
