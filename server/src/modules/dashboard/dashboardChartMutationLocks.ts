// 2B-11. All application CHART mutation writers lock their parent first:
// Dashboard -> Profile(s) -> Widget(s) -> optional Seal(s).
// The caller owns one SERIALIZABLE SQL transaction. This cannot prevent
// direct SQL or writers not following the same contract.
import sql from "mssql";
export type ChartLockRequestFactory = (tx: sql.Transaction) => sql.Request;
export type LockedChartWidget = Readonly<{
  id: number; profileId: number; widgetType: string; sourceKey: string | null;
}>;
const requestDefault: ChartLockRequestFactory = tx => new sql.Request(tx);
const validId = (id: number) => Number.isSafeInteger(id) && id > 0;

export async function lockChartDashboardParent(
  tx: sql.Transaction, id: number, request: ChartLockRequestFactory = requestDefault,
): Promise<boolean> {
  if (!validId(id)) return false;
  const rows = (await request(tx).input("dashboardId",sql.BigInt,id)
    .query("SELECT Id FROM uqp.Dashboard WITH (UPDLOCK,HOLDLOCK) WHERE Id=@dashboardId")).recordset;
  return rows.length === 1 && Number(rows[0].Id) === id;
}
export async function lockChartDashboardProfiles(
  tx: sql.Transaction, id: number, request: ChartLockRequestFactory = requestDefault,
): Promise<number[] | null> {
  if (!validId(id)) return null;
  const rows = (await request(tx).input("dashboardId",sql.BigInt,id)
    .query("SELECT Id FROM uqp.DashboardDisplayProfile WITH (UPDLOCK,HOLDLOCK) " +
      "WHERE DashboardId=@dashboardId ORDER BY Id")).recordset;
  const ids: number[] = rows.map((row: {Id: unknown}) => Number(row.Id));
  return ids.every(validId) && new Set(ids).size === ids.length ? ids : null;
}
export async function lockChartDashboardWidgets(
  tx: sql.Transaction, id: number, request: ChartLockRequestFactory = requestDefault,
): Promise<LockedChartWidget[] | null> {
  if (!validId(id)) return null;
  const rows = (await request(tx).input("dashboardId",sql.BigInt,id)
    .query("SELECT w.Id,w.ProfileId,w.WidgetType,w.SourceKey " +
      "FROM uqp.DashboardWidget w WITH (UPDLOCK,HOLDLOCK) " +
      "JOIN uqp.DashboardDisplayProfile p WITH (HOLDLOCK) ON p.Id=w.ProfileId " +
      "WHERE p.DashboardId=@dashboardId ORDER BY w.Id")).recordset;
  const widgets = rows.map((row: {
    Id: unknown; ProfileId: unknown; WidgetType: unknown; SourceKey: unknown;
  }) => ({
    id: Number(row.Id), profileId: Number(row.ProfileId),
    widgetType: row.WidgetType, sourceKey: row.SourceKey,
  }));
  if (widgets.some(w => !validId(w.id) || !validId(w.profileId) ||
      typeof w.widgetType !== "string" ||
      (w.sourceKey !== null && typeof w.sourceKey !== "string")) ||
      new Set(widgets.map(w => w.id)).size !== widgets.length) return null;
  return widgets as LockedChartWidget[];
}
