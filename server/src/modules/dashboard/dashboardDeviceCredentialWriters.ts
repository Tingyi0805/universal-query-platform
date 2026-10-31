import sql from "mssql";
import { requireDeviceLifecycleSchema } from "./dashboardDeviceLifecycleSchema.js";
import { QuerySourceError } from "./dashboardQuerySources.service.js";

/** Invalidating an explicitly managed credential always starts a new proof cycle.
 * NULL/absent markers retain their historical semantics; terminal markers stay NULL. */
export async function devicePendingInvalidationClause(request: sql.Request, terminal = false): Promise<string> {
  const row=(await request.query(`SELECT COL_LENGTH('uqp.DashboardDisplayDevice','SuspendedAtUtc') AS Suspended,
    COL_LENGTH('uqp.DashboardDisplayDevice','ReenrollmentRequired') AS Pending`)).recordset[0];
  if (row?.Suspended==null && row?.Pending==null) return "";
  await requireDeviceLifecycleSchema(request);
  if (terminal) return "SuspendedAtUtc=NULL,ReenrollmentRequired=NULL,QueryModeGrantVersion=NULL,DelegatorTokenVersion=NULL,";
  return "ReenrollmentRequired=CASE WHEN ReenrollmentRequired IS NOT NULL THEN 1 ELSE NULL END,";
}

/** Old issuance cannot mint an unversioned alternative for any managed proof cycle. */
export async function requireUnmanagedDeviceCredential(request: sql.Request, dashboardId:number, deviceId:number) {
  const row=(await request.input("credentialDashboardId",sql.BigInt,dashboardId).input("credentialDeviceId",sql.BigInt,deviceId)
    .query(`SELECT * FROM uqp.DashboardDisplayDevice WITH(UPDLOCK,HOLDLOCK)
      WHERE DashboardId=@credentialDashboardId AND Id=@credentialDeviceId`)).recordset[0];
  if (!row || row.SuspendedAtUtc!=null || row.ReenrollmentRequired!=null || row.RevokedAtUtc!=null || row.ArchivedAtUtc!=null)
    throw new QuerySourceError("DASHBOARD_DEVICE_VERSIONED_API_REQUIRED");
}
