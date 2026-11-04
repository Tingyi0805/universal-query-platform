// 2B-8: dormant read-only trust store for future CHART Widgets and
// independently approved public grouped-count privacy reviews.
// No SQL migration, writer, HTTP route or production coordinator registration.
// Production still rejects CHART because its existing WidgetType CHECK disallows it
// and the two seal/review catalog tables are intentionally not installed.
import { createHash, timingSafeEqual } from "node:crypto";
import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { chartWidgetConfigSchema } from "./dashboardChartWidget.contract.js";
import type { TrustedSavedChartWidget } from "./dashboardChartDelivery.coordinator.js";
import type { PublicCountReview, PublicCountScope } from "./dashboardChartPublicCountPrivacy.js";
import type { ExecutionSubject } from "./dashboardQuerySourceExecution.js";

type WidgetRow = {
  Id?: unknown; DashboardId?: unknown; WidgetType?: unknown; SourceKey?: unknown;
  ConfigJson?: unknown; SealRowVersion?: unknown; ConfigDigest?: unknown;
  SealActive?: unknown; SealedBy?: unknown; AuditReceiptVerified?: unknown;
};
type ReviewRow = {
  Id?: unknown; DashboardId?: unknown; QueryId?: unknown; DatasetId?: unknown;
  SourceKey?: unknown; CategoryColumn?: unknown; ValueColumn?: unknown;
  QueryRevision?: unknown; DatasetRevision?: unknown; PolicyRevision?: unknown;
  Status?: unknown; MinimumCellCount?: unknown;
  CategoryPrivacyReviewed?: unknown; DifferencingRiskReviewed?: unknown;
  ReviewerUserId?: unknown; AuditLogId?: unknown; ReviewedAtUtc?: unknown;
  ValidUntilUtc?: unknown; ReviewRowVersion?: unknown; AuditReceiptVerified?: unknown;
};

function exactPositive(value: unknown): number | null {
  const t = typeof value === "bigint" ? String(value) : String(value ?? "");
  if (!/^[1-9][0-9]{0,14}$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
const revision = (value: unknown): string | null =>
  Buffer.isBuffer(value) && value.length === 8 ? value.toString("hex") : null;
const fingerprint = (...parts: unknown[]) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const secureDigest = (original: string, expected: unknown) => {
  if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(
    Buffer.from(createHash("sha256").update(original).digest("hex"), "hex"),
    Buffer.from(expected, "hex"),
  );
};
function currentSignedReview(row: ReviewRow, now: Date): boolean {
  const signed = row.ReviewedAtUtc instanceof Date ? row.ReviewedAtUtc.getTime() : NaN;
  const expiry = row.ValidUntilUtc instanceof Date ? row.ValidUntilUtc.getTime() : NaN;
  return Number.isFinite(signed) && Number.isFinite(expiry) &&
    signed <= now.getTime() && expiry > now.getTime() &&
    expiry > signed && expiry - signed <= 90 * 86400000;
}

export function validateSealedChartWidget(
  row: WidgetRow | null, dashboardId: number, widgetId: number,
): TrustedSavedChartWidget | null {
  if (!row || exactPositive(row.Id) !== widgetId ||
      exactPositive(row.DashboardId) !== dashboardId ||
      row.WidgetType !== "CHART" || row.SealActive !== true ||
      row.AuditReceiptVerified !== true ||
      !exactPositive(row.SealedBy) ||
      typeof row.ConfigJson !== "string" || row.ConfigJson.length > 8192)
    return null;
  const rv = revision(row.SealRowVersion);
  if (!rv || !secureDigest(row.ConfigJson, row.ConfigDigest)) return null;
  try {
    const parsed = chartWidgetConfigSchema.safeParse(JSON.parse(row.ConfigJson));
    if (!parsed.success || parsed.data.dataSourceKey !== row.SourceKey) return null;
    return {
      id: widgetId, dashboardId, widgetType: "CHART", revision: rv,
      config: parsed.data,
    };
  } catch { return null; }
}

export function validateSignedPublicChartReview(
  row: ReviewRow | null, scope: PublicCountScope,
  subject: ExecutionSubject, now = new Date(),
): PublicCountReview | null {
  if (!row || row.Status !== "APPROVED" || row.AuditReceiptVerified !== true ||
      !exactPositive(row.Id) || !exactPositive(row.ReviewerUserId) ||
      !exactPositive(row.AuditLogId) ||
      exactPositive(row.ReviewerUserId) === subject.userId ||
      !currentSignedReview(row, now) ||
      row.CategoryPrivacyReviewed !== true ||
      row.DifferencingRiskReviewed !== true)
    return null;
  const rv = revision(row.ReviewRowVersion);
  if (!rv) return null;
  const mapping = {
    dashboardId: exactPositive(row.DashboardId),
    queryId: exactPositive(row.QueryId),
    datasetId: exactPositive(row.DatasetId),
    sourceKey: row.SourceKey,
    categoryColumn: row.CategoryColumn,
    valueColumn: row.ValueColumn,
    queryRevision: revision(row.QueryRevision),
    datasetRevision: revision(row.DatasetRevision),
    policyRevision: row.PolicyRevision,
  };
  for (const key of Object.keys(scope) as Array<keyof PublicCountScope>) {
    if (mapping[key] !== scope[key]) return null;
  }
  const count = Number(row.MinimumCellCount);
  if (!Number.isSafeInteger(count) || count < 5 || count > 1000 ||
      !/^[a-f0-9]{64}$/.test(scope.policyRevision) ||
      !/^[a-f0-9]{16}$/.test(scope.queryRevision) ||
      !/^[a-f0-9]{16}$/.test(scope.datasetRevision))
    return null;
  return {
    ...scope, status: "APPROVED",
    minimumCellCount: count,
    categoryPrivacyReviewed: true,
    differencingRiskReviewed: true,
    reviewRevision: fingerprint("CHART_REVIEW_2B8_V1", row.Id, rv,
      row.ReviewerUserId, row.AuditLogId, (row.ReviewedAtUtc as Date).toISOString(),
      (row.ValidUntilUtc as Date).toISOString(), scope),
  };
}

/** Exactly one atomic SQL statement per read; missing tables, ambiguous rows,
 * incompatible schemas or any storage error fail closed. These statements
 * intentionally target *future* sidecar catalog tables, not existing 927.
 */
export function createDormantChartTrustReaders(
  getPool: typeof getPlatformDbPool = getPlatformDbPool,
) {
  const readSavedWidget = async (
    dashboardId: number, widgetId: number,
  ): Promise<TrustedSavedChartWidget | null> => {
    if (!exactPositive(dashboardId) || !exactPositive(widgetId)) return null;
    try {
      const pool = await getPool();
      if (!pool) return null;
      const rows = (await pool.request()
        .input("dashboardId", sql.BigInt, dashboardId)
        .input("widgetId", sql.BigInt, widgetId)
        .query("SELECT w.Id, p.DashboardId, w.WidgetType, w.SourceKey, w.ConfigJson, " +
          "s.SealRowVersion, s.ConfigDigest, s.IsActive AS SealActive, s.SealedBy, " +
          "CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM uqp.AuditLog a WITH(HOLDLOCK) " +
          "WHERE a.Id=s.AuditLogId AND a.UserId=s.SealedBy AND a.IsImportant=1 " +
          "AND a.Status=N'SUCCESS' AND a.EventType=N'CHART_SEAL_WIDGET') " +
          "OR EXISTS(SELECT 1 FROM uqp.AuditLogArchive ar WITH(HOLDLOCK) " +
          "WHERE ar.Id=s.AuditLogId AND ar.UserId=s.SealedBy AND ar.IsImportant=1 " +
          "AND ar.Status=N'SUCCESS' AND ar.EventType=N'CHART_SEAL_WIDGET') " +
          "THEN 1 ELSE 0 END) AS AuditReceiptVerified " +
          "FROM uqp.DashboardWidget w WITH (HOLDLOCK) " +
          "JOIN uqp.DashboardDisplayProfile p WITH (HOLDLOCK) ON p.Id=w.ProfileId " +
          "JOIN uqp.DashboardChartWidgetSeal s WITH (HOLDLOCK) ON s.WidgetId=w.Id " +
          "WHERE w.Id=@widgetId AND p.DashboardId=@dashboardId " +
          "AND w.WidgetType='CHART' AND s.IsActive=1")).recordset;
      return rows.length === 1 ? validateSealedChartWidget(rows[0], dashboardId, widgetId) : null;
    } catch { return null; }
  };
  const readPublicReview = async (
    scope: PublicCountScope, subject: ExecutionSubject,
  ): Promise<PublicCountReview | null> => {
    if (!exactPositive(scope.dashboardId) || !exactPositive(scope.queryId) ||
        !exactPositive(scope.datasetId) ||
        !/^(?:PRIMARY|[A-Za-z][A-Za-z0-9_]{0,63})$/.test(scope.sourceKey) ||
        !exactPositive(subject.userId) || !exactPositive(subject.tokenVersion) ||
        !/^[a-f0-9]{16}$/.test(scope.queryRevision) ||
        !/^[a-f0-9]{16}$/.test(scope.datasetRevision) ||
        !/^[a-f0-9]{64}$/.test(scope.policyRevision)) return null;
    try {
      const pool = await getPool();
      if (!pool) return null;
      // The review table is write-protected, audit-backed and revisioned by
      // a future independent approval service. This read cannot create grants.
      const rows = (await pool.request()
        .input("dashboardId", sql.BigInt, scope.dashboardId)
        .input("queryId", sql.BigInt, scope.queryId)
        .input("datasetId", sql.BigInt, scope.datasetId)
        .input("sourceKey", sql.NVarChar(64), scope.sourceKey)
        .input("category", sql.NVarChar(128), scope.categoryColumn)
        .input("value", sql.NVarChar(128), scope.valueColumn)
        .input("queryRev", sql.Binary, Buffer.from(scope.queryRevision, "hex"))
        .input("datasetRev", sql.Binary, Buffer.from(scope.datasetRevision, "hex"))
        .input("policyRev", sql.Char(64), scope.policyRevision)
        .query("SELECT r.Id,r.DashboardId,r.QueryId,r.DatasetId,r.SourceKey, " +
          "r.CategoryColumn,r.ValueColumn,r.QueryRevision,r.DatasetRevision, " +
          "r.PolicyRevision,r.Status,r.MinimumCellCount,r.CategoryPrivacyReviewed, " +
          "r.DifferencingRiskReviewed,r.ReviewerUserId,r.AuditLogId, " +
          "r.ReviewedAtUtc,r.ValidUntilUtc,r.ReviewRowVersion, " +
          "CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM uqp.AuditLog a WITH(HOLDLOCK) " +
          "WHERE a.Id=r.AuditLogId AND a.UserId=r.ReviewerUserId AND a.IsImportant=1 " +
          "AND a.Status=N'SUCCESS' AND a.EventType=N'CHART_APPROVE_REVIEW') " +
          "OR EXISTS(SELECT 1 FROM uqp.AuditLogArchive ar WITH(HOLDLOCK) " +
          "WHERE ar.Id=r.AuditLogId AND ar.UserId=r.ReviewerUserId AND ar.IsImportant=1 " +
          "AND ar.Status=N'SUCCESS' AND ar.EventType=N'CHART_APPROVE_REVIEW') " +
          "THEN 1 ELSE 0 END) AS AuditReceiptVerified " +
          "FROM uqp.DashboardChartPrivacyReview r WITH (HOLDLOCK) " +
          "WHERE r.DashboardId=@dashboardId AND r.QueryId=@queryId " +
          "AND r.DatasetId=@datasetId AND r.SourceKey=@sourceKey " +
          "AND r.CategoryColumn=@category AND r.ValueColumn=@value " +
          "AND r.QueryRevision=@queryRev AND r.DatasetRevision=@datasetRev " +
          "AND r.PolicyRevision=@policyRev AND r.Status='APPROVED' " +
          "AND r.ValidUntilUtc>SYSUTCDATETIME()")).recordset;
      return rows.length === 1
        ? validateSignedPublicChartReview(rows[0], scope, subject)
        : null;
    } catch { return null; }
  };
  return { readSavedWidget, readPublicReview };
}
// No default registration: the production chart coordinator gate remains off.
