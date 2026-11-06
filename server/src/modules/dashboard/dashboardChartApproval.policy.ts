// Dashboard chart V1: internal server-owned approval policy only.
// This module deliberately has NO default fact reader and NO route. Source
// facts and verified SQL aggregation evidence must come from trusted
// repositories; client/Widget ConfigJson cannot supply them.
import { createHash } from "node:crypto";
import { chartWidgetConfigSchema } from "./dashboardChartWidget.contract.js";
import type { ServerChartApproval, ServerChartApprovalReader } from "./dashboardChartDeliveryBridge.js";
import type { ExecutionSubject } from "./dashboardQuerySourceExecution.js";
import type { ReportColumnRecord } from "../queryDefinition/reportColumn.repository.js";
import type { DatasetSensitiveColumn } from "../dataset/datasetSensitiveColumn.repository.js";
import type { PublicDisplayPolicy } from "../dataset/datasetPublicDisplayPolicy.js";

const hex16 = /^[a-f0-9]{16}$/;
const hex64 = /^[a-f0-9]{64}$/;
const sourcePattern = /^(?:PRIMARY|[A-Za-z][A-Za-z0-9_]{0,63})$/;
const numericType = /^(?:TINYINT|SMALLINT|INT|INTEGER|BIGINT|DECIMAL|NUMERIC|NUMBER|FLOAT|REAL|MONEY|SMALLMONEY)(?:\(\d+(?:,\d+)?\))?$/i;

/** Evidence that a trusted server-side Query definition inspector has proven
 * the saved Query already returns exactly one aggregate value per category.
 * No inspector has been implemented; until then the approval reader fails
 * closed rather than inferring grouping from ReportColumn metadata.
 */
export type VerifiedQueryAggregate = {
  verified: true;
  queryId: number;
  datasetId: number;
  queryRevision: string;
  datasetRevision: string;
  categoryColumn: string;
  valueColumn: string;
  evidenceVersion: string;
};

export type ServerChartFacts = {
  dashboardId: number;
  sourceKey: string;
  source: {
    queryId: number;
    bindingRevision: number;
    enabled: boolean;
    managed: boolean;
    referenced: boolean;
    activeDashboard: boolean;
    mode: string;
  };
  actor: {
    userId: number;
    tokenVersion: number;
    active: boolean;
    permissions: readonly string[];
    canView: boolean;
    canExecute: boolean;
  };
  query: { id: number; datasetId: number; active: boolean; published: boolean; archived: boolean };
  dataset: { id: number; active: boolean; archived: boolean };
  revisions: {
    dashboardApproval: string;
    access: string;
    query: string;
    dataset: string;
  };
  sensitivity: { version: number; columns: readonly DatasetSensitiveColumn[] };
  // This authorization is mandatory for any user/device public playback.
  publicDisplay: {
    status: "CONFIRMED" | "STALE" | "UNCONFIRMED";
    version: string | null;
    policy: PublicDisplayPolicy | null;
  } | null;
  reportColumns: readonly ReportColumnRecord[];
  verifiedAggregate: VerifiedQueryAggregate | null;
};

export type ChartSourceEvidenceReader = (
  dashboardId: number, sourceKey: string, actor: ExecutionSubject,
) => Promise<ServerChartFacts | null>;

function uniqueRule(facts: ServerChartFacts, column: string): DatasetSensitiveColumn | null {
  const matches = facts.sensitivity.columns.filter(x => x.columnName.toUpperCase() === column.toUpperCase());
  return matches.length === 1 ? matches[0]! : null;
}
function uniquelyVisibleReport(facts: ServerChartFacts, column: string): ReportColumnRecord | null {
  const matches = facts.reportColumns.filter(x => x.columnName.toUpperCase() === column.toUpperCase());
  return matches.length === 1 && matches[0]!.columnName === column && matches[0]!.isVisible ? matches[0]! : null;
}
function publicGrant(facts: ServerChartFacts, column: string): boolean {
  const display = facts.publicDisplay;
  if (!display || display.status !== "CONFIRMED" || !display.policy?.confirmed ||
      display.policy.sensitivityVersion !== facts.sensitivity.version ||
      !display.version || !hex16.test(display.version)) return false;
  const grants = display.policy.grants.filter(g => g.columnName.toUpperCase() === column.toUpperCase());
  return grants.length === 1 && grants[0]!.columnName === column && grants[0]!.permitted === true;
}

export function evaluateServerChartApproval(
  configInput: unknown, facts: ServerChartFacts | null, subject: ExecutionSubject,
): ServerChartApproval | null {
  const parsed = chartWidgetConfigSchema.safeParse(configInput);
  if (!parsed.success || !facts) return null;
  const config = parsed.data;
  const context = subject.context ?? (subject.deviceId !== undefined ? "device" : "designer");
  const publicPlayback = context === "device" || context === "user" || context === "admin-preview" && facts.source.activeDashboard;
  if (!Number.isSafeInteger(subject.userId) || subject.userId <= 0 ||
      !Number.isSafeInteger(subject.tokenVersion) || subject.tokenVersion <= 0 ||
      (context === "device") !== (subject.deviceId !== undefined) ||
      (context === "device" && (!Number.isSafeInteger(subject.deviceId) || subject.deviceId! < 1 || !facts.source.referenced)))
    return null;
  if (!Number.isSafeInteger(facts.dashboardId) || facts.dashboardId < 1 ||
      !sourcePattern.test(facts.sourceKey) || facts.sourceKey !== config.dataSourceKey ||
      !Number.isSafeInteger(facts.source.queryId) || facts.source.queryId < 1 ||
      !Number.isSafeInteger(facts.source.bindingRevision) || facts.source.bindingRevision < 1 ||
      !facts.source.enabled || !facts.source.managed ||
      (publicPlayback && (!facts.source.activeDashboard || facts.source.mode !== "QUERY_ONLY")) ||
      (!publicPlayback && facts.source.activeDashboard))
    return null;
  const actor = facts.actor;
  if (!actor.active || actor.userId !== subject.userId || actor.tokenVersion !== subject.tokenVersion ||
      !actor.canView || !actor.canExecute ||
      !actor.permissions.includes("EXECUTE_QUERY") ||
      !actor.permissions.includes(context === "user" ? "VIEW_QUERY" : "DESIGN_QUERY"))
    return null;
  if (!facts.query.active || !facts.query.published || facts.query.archived ||
      !facts.dataset.active || facts.dataset.archived ||
      facts.query.id !== facts.source.queryId || facts.query.datasetId !== facts.dataset.id)
    return null;

  const revisions = facts.revisions;
  if (!hex64.test(revisions.dashboardApproval) || !hex64.test(revisions.access) ||
      !hex16.test(revisions.query) || !hex16.test(revisions.dataset) ||
      !Number.isSafeInteger(facts.sensitivity.version) || facts.sensitivity.version < 1)
    return null;

  const summary = facts.verifiedAggregate;
  if (!summary?.verified || summary.queryId !== facts.query.id || summary.datasetId !== facts.dataset.id ||
      summary.queryRevision !== revisions.query || summary.datasetRevision !== revisions.dataset ||
      summary.categoryColumn !== config.categoryColumn || summary.valueColumn !== config.valueColumn ||
      !hex64.test(summary.evidenceVersion)) return null;

  const category = uniquelyVisibleReport(facts, config.categoryColumn);
  const value = uniquelyVisibleReport(facts, config.valueColumn);
  // ReportColumn metadata is an extra constraint, not sufficient proof that
  // the underlying SQL already returns the aggregate per category.
  if (!category || !value || !Number.isInteger(category.groupOrder) || category.groupOrder! < 1 ||
      category.aggregateType !== "NONE" ||
      !["SUM", "COUNT", "AVG", "MIN", "MAX"].includes(value.aggregateType) ||
      typeof value.dataType !== "string" || !numericType.test(value.dataType.trim()))
    return null;

  for (const column of [category.columnName, value.columnName]) {
    const rule = uniqueRule(facts, column);
    // Only explicitly classified OTHER, never an unclassified patient field.
    // Any masking or OMIT makes an aggregate axis unsafe to use raw.
    if (!rule || rule.sensitivityType !== "OTHER" || rule.deviceMaskMode !== "NONE")
      return null;
    if (publicPlayback && !publicGrant(facts, column)) return null;
  }
  // A public policy may have disappeared/reverted while reading facts; each
  // invocation is re-read before/after delivery by the audited-page bridge.
  const publicVersion = publicPlayback ? facts.publicDisplay?.version : null;
  if (publicPlayback && (!publicVersion || !hex16.test(publicVersion))) return null;

  const version = createHash("sha256").update(JSON.stringify({
    dashboardId: facts.dashboardId, sourceKey: facts.sourceKey,
    source: facts.source, actor: { userId: actor.userId, tokenVersion: actor.tokenVersion },
    revisions, queryId: facts.query.id, datasetId: facts.dataset.id,
    sensitivityVersion: facts.sensitivity.version,
    publicVersion, report: [category, value], summary,
    category: config.categoryColumn, value: config.valueColumn,
  })).digest("hex");
  return { dashboardId: facts.dashboardId, sourceKey: facts.sourceKey,
    queryId: facts.query.id, datasetId: facts.dataset.id,
    sensitivityVersion: facts.sensitivity.version, version,
    approvedCategoryColumns: [category.columnName],
    approvedNumericColumns: [value.columnName] };
}

/** NO production evidence reader is registered yet. The returned callback is
 * only used by tests; production must not mount an HTTP route or trust caller
 * supplied facts as if they were live SQL repository reads.
 */
export function createServerChartApprovalReader(
  config: unknown, readFacts: ChartSourceEvidenceReader,
): ServerChartApprovalReader {
  return async (dashboardId, sourceKey, subject) => {
    const parsed = chartWidgetConfigSchema.safeParse(config);
    if (!parsed.success || parsed.data.dataSourceKey !== sourceKey) return null;
    const facts = await readFacts(dashboardId, sourceKey, subject);
    if (facts?.dashboardId !== dashboardId) return null;
    return evaluateServerChartApproval(parsed.data, facts, subject);
  };
}
