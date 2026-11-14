// Gate 3: read-only, fail-closed SQL adapter for exact-version playback approval.
// The 928 playback-approval table is not yet installed; no production activation.
// Never infer approval from Widget ConfigJson, a client payload or a privacy review.
import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import type { ChartPlaybackApproval } from "./dashboardChartPlaybackApproval.policy.js";

type ApprovalRow = {
  DashboardId?: unknown; WidgetId?: unknown; WidgetRevision?: unknown; ConfigDigest?: unknown;
  ReviewerUserId?: unknown; AuditLogId?: unknown; Status?: unknown;
  ReviewerIsActiveAdmin?: unknown; AuditReceiptVerified?: unknown;
};
const positive = (v: unknown): number | null => {
  const s = typeof v === "bigint" ? String(v) : String(v ?? "");
  if (!/^[1-9][0-9]{0,14}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const auditId = (v: unknown): string | null => {
  const s = typeof v === "bigint" ? String(v) : String(v ?? "");
  return /^[1-9][0-9]{0,18}$/.test(s) ? s : null;
};
export function validatePlaybackApprovalRow(
  row: ApprovalRow | null, expectedDashboardId?: number, expectedWidgetId?: number,
): ChartPlaybackApproval | null {
  if (!row ||
      (expectedDashboardId !== undefined && positive(row.DashboardId) !== expectedDashboardId) ||
      (expectedWidgetId !== undefined && positive(row.WidgetId) !== expectedWidgetId) ||
      row.Status !== "APPROVED" ||
      row.ReviewerIsActiveAdmin !== true || row.AuditReceiptVerified !== true ||
      !positive(row.WidgetId) || !positive(row.ReviewerUserId) || !auditId(row.AuditLogId))
    return null;
  const revision = Buffer.isBuffer(row.WidgetRevision) && row.WidgetRevision.length === 8
    ? row.WidgetRevision.toString("hex") : null;
  if (!revision || typeof row.ConfigDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.ConfigDigest)) return null;
  return {
    widgetId: positive(row.WidgetId)!,
    widgetRevision: revision,
    configDigest: row.ConfigDigest,
    reviewerUserId: positive(row.ReviewerUserId)!,
    auditLogId: auditId(row.AuditLogId)!,
    reviewerIsActiveAdmin: true,
    auditReceiptVerified: true,
    status: "APPROVED",
  };
}

/** Deliberately dormant until an approved schema and admin role predicate exist.
 * The SQL query returns no approval if the table, columns or evidence are absent.
 * Administrator role joins below are provisional until checked against the
 * existing 927 schema; the production CHART gate must remain disabled.
 */
export function createDormantPlaybackApprovalReader(
  getPool: typeof getPlatformDbPool = getPlatformDbPool,
) {
  return async (dashboardId: number, widgetId: number): Promise<ChartPlaybackApproval | null> => {
    if (!positive(dashboardId) || !positive(widgetId)) return null;
    try {
      const pool = await getPool();
      if (!pool) return null;
      const rows = (await pool.request()
        .input("dashboardId", sql.BigInt, dashboardId)
        .input("widgetId", sql.BigInt, widgetId)
        .query("SELECT p.DashboardId,p.WidgetId,p.WidgetRevision,p.ConfigDigest,p.ReviewerUserId," +
          "p.AuditLogId,p.Status," +
          "CONVERT(bit,CASE WHEN EXISTS (SELECT 1 FROM uqp.AppUser u WITH (HOLDLOCK) " +
          "WHERE u.Id=p.ReviewerUserId AND u.IsActive=1 AND EXISTS " +
          "(SELECT 1 FROM uqp.UserRole ur WITH (HOLDLOCK) JOIN uqp.Role r WITH (HOLDLOCK) " +
          "ON r.Id=ur.RoleId WHERE ur.UserId=u.Id AND r.Name=N'ADMIN')) " +
          "THEN 1 ELSE 0 END) AS ReviewerIsActiveAdmin," +
          "CONVERT(bit,CASE WHEN EXISTS (SELECT 1 FROM uqp.AuditLog a WITH (HOLDLOCK) " +
          "WHERE a.Id=p.AuditLogId AND a.UserId=p.ReviewerUserId AND a.IsImportant=1 " +
          "AND a.Status=N'SUCCESS' AND a.EventType=N'CHART_APPROVE_PLAYBACK') " +
          "OR EXISTS (SELECT 1 FROM uqp.AuditLogArchive ar WITH (HOLDLOCK) " +
          "WHERE ar.Id=p.AuditLogId AND ar.UserId=p.ReviewerUserId AND ar.IsImportant=1 " +
          "AND ar.Status=N'SUCCESS' AND ar.EventType=N'CHART_APPROVE_PLAYBACK') " +
          "THEN 1 ELSE 0 END) AS AuditReceiptVerified " +
          "FROM uqp.DashboardChartPlaybackApproval p WITH (HOLDLOCK) " +
          "WHERE p.DashboardId=@dashboardId AND p.WidgetId=@widgetId " +
          "AND p.Status='APPROVED'")).recordset as ApprovalRow[];
      // An ambiguous row set is not a valid authorization decision.
      return rows.length === 1 && positive(rows[0].DashboardId) === dashboardId &&
        positive(rows[0].WidgetId) === widgetId
        ? validatePlaybackApprovalRow(rows[0], dashboardId, widgetId) : null;
    } catch { return null; }
  };
}
