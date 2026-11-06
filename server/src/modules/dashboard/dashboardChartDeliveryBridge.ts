// Dormant server-side bridge for V1 chart projections. No route or widget
// activation. Only the existing audited Query-only page execution may supply
// rows; server-controlled approval is mandatory and intentionally not wired yet.
import { chartWidgetConfigSchema, ChartContractError, projectAuthorizedChart } from "./dashboardChartWidget.contract.js";
import { getDashboardPageSnapshot } from "./dashboardPageSnapshot.js";
import type { ExecutionSubject } from "./dashboardQuerySourceExecution.js";

export type ServerChartPage = {
  sourceKey: string;
  modeVersion: string;
  query: { id: number };
  page: number;
  totalPages: number;
  totalRows: number;
  snapshotId: string;
  snapshotExpiresAt: number;
  result: { columns: Array<{ name: string }>; rows: Record<string, unknown>[] };
};

export type AuditedPageProvider = {
  page(id: number, sourceKey: string, subject: ExecutionSubject, input: { page: number; snapshotId?: string }): Promise<ServerChartPage>;
};

/** The future approval reader MUST verify current published Query grouping/
 * summary semantics and Dataset sensitivity/public-display policy on the server.
 * Never construct this object from browser payload or saved Widget ConfigJson.
 * No production implementation exists yet: fail closed until it is added.
 */
export type ServerChartApproval = {
  dashboardId: number;
  sourceKey: string;
  queryId: number;
  datasetId: number;
  sensitivityVersion: number;
  version: string; // a monotonic security revision fingerprint, not a timestamp
  approvedCategoryColumns: readonly string[];
  approvedNumericColumns: readonly string[];
};

export type ServerChartApprovalReader = (
  id: number, sourceKey: string, subject: ExecutionSubject,
) => Promise<ServerChartApproval | null>;

function denied(): never { throw new ChartContractError("CHART_TRUSTED_DELIVERY_REQUIRED"); }
function validNames(names: readonly string[]): boolean {
  return Array.isArray(names) && names.length <= 50 &&
    names.every(name => typeof name === "string" && name.length >= 1 &&
      name.length <= 128 && !/[\x00-\x1f\x7f]/u.test(name)) &&
    new Set(names.map(name => name.toUpperCase())).size === names.length;
}
function checkedApproval(value: ServerChartApproval | null, id: number, key: string): ServerChartApproval {
  if (!value || value.dashboardId !== id || value.sourceKey !== key ||
      !Number.isSafeInteger(value.queryId) || value.queryId <= 0 ||
      !Number.isSafeInteger(value.datasetId) || value.datasetId <= 0 ||
      !Number.isSafeInteger(value.sensitivityVersion) || value.sensitivityVersion <= 0 ||
      !/^[a-f0-9]{64}$/.test(value.version) ||
      !validNames(value.approvedCategoryColumns) || !validNames(value.approvedNumericColumns))
    return denied();
  return value;
}

/** This rejects paginated or truncated snapshot data, even when /page returns
 * a success response. It compares selected values against the original
 * process-local snapshot only to prove that masking did not alter chart fields.
 * Never return or log snapshot rows or use them as chart output.
 */
export async function projectChartFromAuditedDashboardPage(
  rawConfig: unknown,
  dashboardId: number,
  subject: ExecutionSubject,
  delivery: AuditedPageProvider,
  readApproval: ServerChartApprovalReader,
) {
  const parsed = chartWidgetConfigSchema.safeParse(rawConfig);
  if (!parsed.success || !Number.isSafeInteger(dashboardId) || dashboardId < 1) return denied();
  const config = parsed.data;
  const before = checkedApproval(await readApproval(dashboardId, config.dataSourceKey, subject),
    dashboardId, config.dataSourceKey);
  if (!before.approvedCategoryColumns.includes(config.categoryColumn) ||
      !before.approvedNumericColumns.includes(config.valueColumn)) return denied();

  // The original page() method performs Query access checks, source policy,
  // device or user auth, masking, patient disclosure Audit and final rechecks.
  const page = await delivery.page(dashboardId, config.dataSourceKey, subject, { page: 1 });
  const ownerId = subject.deviceId ?? -subject.userId;
  const snapshot = getDashboardPageSnapshot(page.snapshotId, ownerId, dashboardId);
  if (!snapshot || page.sourceKey !== config.dataSourceKey ||
      snapshot.sourceKey !== config.dataSourceKey ||
      snapshot.queryId !== page.query.id || snapshot.queryId !== before.queryId ||
      snapshot.datasetId !== before.datasetId ||
      snapshot.sensitivityVersion !== before.sensitivityVersion ||
      page.modeVersion !== snapshot.modeVersion ||
      page.snapshotExpiresAt !== snapshot.createdAt + snapshot.ttlMs ||
      page.page !== 1 || page.totalPages !== 1 ||
      page.totalRows !== snapshot.rows.length ||
      page.result.rows.length !== snapshot.rows.length ||
      snapshot.truncated !== false ||
      page.totalRows > config.maxPoints) return denied();

  const names = page.result.columns.map(c => c.name);
  if (!validNames(names) ||
      !names.includes(config.categoryColumn) || !names.includes(config.valueColumn)) return denied();

  // Non-omitted is not the same as non-masked. Both selected columns must
  // match original data exactly; partial masks and empty substitutions fail.
  for (let i = 0; i < page.result.rows.length; i++) {
    const delivered = page.result.rows[i];
    const original = snapshot.rows[i];
    if (!delivered || !original ||
        !Object.hasOwn(delivered, config.categoryColumn) ||
        !Object.hasOwn(delivered, config.valueColumn) ||
        !Object.hasOwn(original, config.categoryColumn) ||
        !Object.hasOwn(original, config.valueColumn) ||
        !Object.is(delivered[config.categoryColumn], original[config.categoryColumn]) ||
        !Object.is(delivered[config.valueColumn], original[config.valueColumn])) return denied();
  }

  // The authoritative source approval must remain stable across SQL delivery
  // and mandatory disclosure Audit; this additional check cannot replace the
  // security rechecks already inside page().
  const after = checkedApproval(await readApproval(dashboardId, config.dataSourceKey, subject),
    dashboardId, config.dataSourceKey);
  if (JSON.stringify(before) !== JSON.stringify(after) ||
      !getDashboardPageSnapshot(page.snapshotId, ownerId, dashboardId)) return denied();

  return projectAuthorizedChart(config, {
    sourceKey: page.sourceKey,
    authorized: true,
    maskedBeforeDelivery: true,
    complete: true,
    truncated: false,
    columns: names,
    approvedCategoryColumns: after.approvedCategoryColumns,
    approvedNumericColumns: after.approvedNumericColumns,
    rows: page.result.rows,
  });
}
