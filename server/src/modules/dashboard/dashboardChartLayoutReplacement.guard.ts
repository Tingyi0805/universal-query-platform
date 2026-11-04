// 2B-10: fail-closed fence for the *existing* delete-and-recreate
// Dashboard layout writer. CHART cannot be silently replaced by old writers.
// This does NOT activate a chart, add schema or replace the future database
// trigger/lock contract required for all chart mutation writers.
import sql from "mssql";
import { QuerySourceError } from "./dashboardQuerySources.service.js";
import type { DashboardProfileInput } from "./dashboardLayout.repository.js";
import {
  lockChartDashboardParent, lockChartDashboardProfiles, lockChartDashboardWidgets,
  type ChartLockRequestFactory,
} from "./dashboardChartMutationLocks.js";

const legacyTypes = new Set([
  "TEXT", "PARAMETER", "FIELD", "CLOCK", "PAGE_INFO",
  "COUNTDOWN", "TABLE", "CONTAINER",
]);
const blocked = (): never => {
  throw new QuerySourceError("CHART_LAYOUT_ATOMIC_WRITER_REQUIRED", 409);
};

/** Must run before any DELETE, within the caller's SERIALIZABLE transaction.
 * The Dashboard parent lock is taken first, matching existing writer order.
 * Queries lock both existing rows and their serializable key ranges.
 * Future CHART creators must take the same Dashboard parent lock and must
 * use independent DB integrity enforcement before this is production-ready.
 */
export async function assertChartLayoutReplacementSafe(
  tx: sql.Transaction, dashboardId: number,
  profiles: readonly DashboardProfileInput[],
  request: ChartLockRequestFactory = t => new sql.Request(t),
): Promise<void> {
  if (!Number.isSafeInteger(dashboardId) || dashboardId < 1 ||
      !Array.isArray(profiles) || profiles.some(profile =>
        !profile || !Array.isArray(profile.widgets) ||
        profile.widgets.some((widget: DashboardProfileInput["widgets"][number]) =>
          !widget || !legacyTypes.has(widget.widgetType))))
    return blocked();

  if (!await lockChartDashboardParent(tx,dashboardId,request)) return blocked();
  const profiles = await lockChartDashboardProfiles(tx,dashboardId,request);
  const widgets = await lockChartDashboardWidgets(tx,dashboardId,request);
  if (!profiles || !widgets || widgets.some(w =>
      !profiles.includes(w.profileId) || w.widgetType === "CHART"))
    return blocked();

  // Check the optional sidecar separately. SQL Server may compile references
  // to an absent table even inside an IF branch, so do not use a single batch.
  const catalog = (await request(tx).query(
    "SELECT OBJECT_ID(N'uqp.DashboardChartWidgetSeal',N'U') AS SealTableId")).recordset;
  if (catalog.length !== 1) return blocked();
  const sidecarId = catalog[0]?.SealTableId;
  if (sidecarId === null) return;
  if (!Number.isSafeInteger(Number(sidecarId)) || Number(sidecarId) <= 0) return blocked();
  // Even a sidecar row attached to a non-CHART widget is a protected
  // inconsistency; never discard it to make the layout replacement succeed.
  const sealed = (await request(tx).input("dashboardId", sql.BigInt, dashboardId)
    .query("SELECT TOP (1) s.WidgetId FROM uqp.DashboardDisplayProfile p WITH (UPDLOCK,HOLDLOCK) " +
      "JOIN uqp.DashboardWidget w WITH (UPDLOCK,HOLDLOCK) ON w.ProfileId=p.Id " +
      "JOIN uqp.DashboardChartWidgetSeal s WITH (UPDLOCK,HOLDLOCK) ON s.WidgetId=w.Id " +
      "WHERE p.DashboardId=@dashboardId")).recordset;
  if (sealed.length) return blocked();
}
