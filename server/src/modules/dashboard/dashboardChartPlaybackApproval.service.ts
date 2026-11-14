// Gate 3: dormant transaction-bound administrator approval / revocation service.
// No HTTP route or release switch is enabled by this module.
import { createHash } from "node:crypto";
import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { writeAuditEvent } from "../audit/audit.repository.js";
import { getTokenSessionState } from "../auth/auth.repository.js";
import { chartWidgetConfigSchema } from "./dashboardChartWidget.contract.js";

export type ChartPlaybackDecisionAction = "APPROVE" | "REVOKE";
export type ChartPlaybackDecisionInput = Readonly<{
  dashboardId: number; widgetId: number; actorUserId: number;
  tokenVersion: number; action: ChartPlaybackDecisionAction;
}>;
const positive = (n: number) => Number.isSafeInteger(n) && n > 0;

/** The caller must be a verified JWT actor; this service independently rechecks
 * the actor and SYSTEM_ADMIN membership inside the same SERIALIZABLE transaction.
 * No browser-provided reviewer, revision, digest or audit receipt is accepted.
 */
export async function decideChartPlaybackApproval(
  input: ChartPlaybackDecisionInput,
  getPool: typeof getPlatformDbPool = getPlatformDbPool,
): Promise<boolean> {
  if (!positive(input.dashboardId) || !positive(input.widgetId) ||
      !positive(input.actorUserId) || !positive(input.tokenVersion) ||
      !["APPROVE", "REVOKE"].includes(input.action)) return false;
  let tx: sql.Transaction | undefined;
  try {
    const pool = await getPool();
    if (!pool) return false;
    tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const live = await getTokenSessionState(input.actorUserId, tx);
    if (!live?.isActive || live.tokenVersion !== input.tokenVersion ||
        !live.permissions.includes("MANAGE_USERS")) throw Error("SESSION_REVOKED");
    const role = await new sql.Request(tx)
      .input("actorId", sql.BigInt, input.actorUserId)
      .query("SELECT u.Id FROM uqp.AppUser u WITH (UPDLOCK,HOLDLOCK) " +
        "JOIN uqp.UserRole ur WITH (HOLDLOCK) ON ur.UserId=u.Id " +
        "JOIN uqp.Role r WITH (HOLDLOCK) ON r.Id=ur.RoleId " +
        "WHERE u.Id=@actorId AND u.IsActive=1 AND r.Code=N'SYSTEM_ADMIN' AND r.IsActive=1");
    if (role.recordset.length !== 1) throw Error("ADMIN_REQUIRED");

    const result = await new sql.Request(tx)
      .input("dashboardId", sql.BigInt, input.dashboardId)
      .input("widgetId", sql.BigInt, input.widgetId)
      .query("SELECT w.ConfigJson,s.SealRowVersion,s.ConfigDigest,s.SealedBy,s.AuditLogId " +
        "FROM uqp.DashboardWidget w WITH (UPDLOCK,HOLDLOCK) " +
        "JOIN uqp.DashboardDisplayProfile p WITH (HOLDLOCK) ON p.Id=w.ProfileId " +
        "JOIN uqp.DashboardChartWidgetSeal s WITH (HOLDLOCK) ON s.WidgetId=w.Id " +
        "WHERE w.Id=@widgetId AND p.DashboardId=@dashboardId " +
        "AND w.WidgetType=N'CHART' AND s.IsActive=1");
    if (result.recordset.length !== 1) throw Error("CHART_NOT_ATTESTED");
    const row = result.recordset[0] as { ConfigJson: unknown; SealRowVersion: unknown; ConfigDigest: unknown; SealedBy: unknown; AuditLogId: unknown };
    if (typeof row.ConfigJson !== "string" || row.ConfigJson.length > 8192 ||
        !Buffer.isBuffer(row.SealRowVersion) || row.SealRowVersion.length !== 8)
      throw Error("INVALID_SEAL");
    const sealDigest = createHash("sha256").update(row.ConfigJson).digest("hex");
    if (row.ConfigDigest !== sealDigest) throw Error("INVALID_SEAL_DIGEST");
    const sealReceipt = await new sql.Request(tx)
      .input("sealAuditId", sql.BigInt, row.AuditLogId)
      .input("sealedBy", sql.BigInt, row.SealedBy)
      .query(`SELECT Id FROM uqp.AuditLog WITH (HOLDLOCK)
        WHERE Id=@sealAuditId AND UserId=@sealedBy AND IsImportant=1
        AND Status=N'SUCCESS' AND EventType=N'CHART_SEAL_WIDGET'
        UNION ALL SELECT Id FROM uqp.AuditLogArchive WITH (HOLDLOCK)
        WHERE Id=@sealAuditId AND UserId=@sealedBy AND IsImportant=1
        AND Status=N'SUCCESS' AND EventType=N'CHART_SEAL_WIDGET'`);
    if (sealReceipt.recordset.length !== 1) throw Error("INVALID_SEAL_AUDIT");
    const parsed = chartWidgetConfigSchema.safeParse(JSON.parse(row.ConfigJson));
    if (!parsed.success) throw Error("INVALID_CHART_CONFIG");
    const digest = createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");
    const receipt = await writeAuditEvent({
      eventType: input.action === "APPROVE" ? "CHART_APPROVE_PLAYBACK" : "CHART_REVOKE_PLAYBACK",
      userId: input.actorUserId, status: "SUCCESS",
      parameters: { dashboardId: input.dashboardId, widgetId: input.widgetId,
        revision: row.SealRowVersion.toString("hex"), digest },
    }, tx);
    const status = input.action === "APPROVE" ? "APPROVED" : "REVOKED";
    const update = await new sql.Request(tx)
      .input("dashboardId", sql.BigInt, input.dashboardId)
      .input("widgetId", sql.BigInt, input.widgetId)
      .input("revision", sql.Binary(8), row.SealRowVersion)
      .input("digest", sql.Char(64), digest)
      .input("actorId", sql.BigInt, input.actorUserId)
      .input("auditId", sql.BigInt, receipt)
      .input("status", sql.VarChar(20), status)
      .query("UPDATE uqp.DashboardChartPlaybackApproval WITH (UPDLOCK,SERIALIZABLE) " +
        "SET WidgetRevision=@revision,ConfigDigest=@digest,Status=@status, " +
        "ReviewerUserId=@actorId,AuditLogId=@auditId,ReviewedAtUtc=SYSUTCDATETIME() " +
        "WHERE DashboardId=@dashboardId AND WidgetId=@widgetId");
    if ((update.rowsAffected[0] ?? 0) === 0) {
      if (input.action === "REVOKE") throw Error("NO_APPROVAL_TO_REVOKE");
      await new sql.Request(tx)
        .input("dashboardId", sql.BigInt, input.dashboardId)
        .input("widgetId", sql.BigInt, input.widgetId)
        .input("revision", sql.Binary(8), row.SealRowVersion)
        .input("digest", sql.Char(64), digest)
        .input("actorId", sql.BigInt, input.actorUserId)
        .input("auditId", sql.BigInt, receipt)
        .query("INSERT INTO uqp.DashboardChartPlaybackApproval " +
          "(DashboardId,WidgetId,WidgetRevision,ConfigDigest,Status,ReviewerUserId,AuditLogId) " +
          "VALUES (@dashboardId,@widgetId,@revision,@digest,'APPROVED',@actorId,@auditId)");
    }
    await tx.commit();
    return true;
  } catch {
    if (tx) { try { await tx.rollback(); } catch { /* fail closed */ } }
    return false;
  }
}
