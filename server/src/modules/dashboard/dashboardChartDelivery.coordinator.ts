// 2B-7: dormant, server-only coordinator. No route, WidgetType activation,
// persistence or public renderer is registered. All dependencies are explicit.
// Only an authoritative saved-widget reader may supply ConfigJson/rowversion.
import { chartWidgetConfigSchema, ChartContractError } from "./dashboardChartWidget.contract.js";
import type { ChartWidgetConfig } from "./dashboardChartWidget.contract.js";
import {
  projectChartFromAuditedDashboardPage, type AuditedPageProvider,
  type ServerChartApprovalReader,
} from "./dashboardChartDeliveryBridge.js";
import {
  evaluateServerChartApproval, type ChartSourceEvidenceReader,
  type ServerChartFacts,
} from "./dashboardChartApproval.policy.js";
import {
  chartFactsDefaults, createSqlChartFactsReader,
} from "./dashboardChartEvidence.reader.js";
import { createVersionBoundCountProofReader } from "./dashboardChartSqlAggregate.reader.js";
import {
  createFencedChartOperation, type ChartFenceReader,
} from "./dashboardChartRevisionFence.js";
import {
  permitPublicGroupedCount, type PublicCountReview, type PublicCountScope,
} from "./dashboardChartPublicCountPrivacy.js";
import type { ExecutionSubject } from "./dashboardQuerySourceExecution.js";

export type TrustedSavedChartWidget = Readonly<{
  id: number;
  dashboardId: number;
  widgetType: "CHART";
  // Server-owned ROWVERSION. A future trusted layout repository must supply it.
  revision: string;
  config: unknown;
}>;

export type ChartCoordinatorDependencies = {
  // No production CHART reader exists, so there is intentionally no default.
  readSavedWidget: (dashboardId: number, widgetId: number) => Promise<TrustedSavedChartWidget | null>;
  // The result must be assembled only from live server repositories, including
  // a version-bound SQL aggregate proof and current sensitivity/public policy.
  createFactsReader: (config: ChartWidgetConfig) => ChartSourceEvidenceReader;
  auditedPage: AuditedPageProvider;
  readFence: ChartFenceReader;
  // Must read a trusted, immutable-revision privacy decision; Widget ConfigJson
  // and HTTP bodies must never carry a review or an approval flag.
  readPublicReview: (scope: PublicCountScope, subject: ExecutionSubject) => Promise<PublicCountReview | null>;
  // The production gate is OFF. Test-only callers can explicitly turn it on
  // while supplying synthetic, isolated dependencies.
  enabled: () => boolean;
};

function deny(): never {
  throw new ChartContractError("CHART_TRUSTED_DELIVERY_REQUIRED");
}
function reviewedBeforeQuery(scope: PublicCountScope, review: PublicCountReview | null): boolean {
  if (!review || review.status !== "APPROVED" ||
      review.categoryPrivacyReviewed !== true ||
      review.differencingRiskReviewed !== true ||
      !/^[a-f0-9]{64}$/.test(review.reviewRevision) ||
      !Number.isSafeInteger(review.minimumCellCount) ||
      review.minimumCellCount < 5 || review.minimumCellCount > 1000)
    return false;
  return (Object.keys(scope) as Array<keyof PublicCountScope>)
    .every(key => review[key] === scope[key]);
}
function scopeOf(
  facts: ServerChartFacts,
  approvalVersion: string,
  config: ChartWidgetConfig,
): PublicCountScope {
  return {
    dashboardId: facts.dashboardId,
    queryId: facts.query.id,
    datasetId: facts.dataset.id,
    sourceKey: facts.sourceKey,
    categoryColumn: config.categoryColumn,
    valueColumn: config.valueColumn,
    queryRevision: facts.revisions.query,
    datasetRevision: facts.revisions.dataset,
    // This fingerprint includes the current public-display approval and
    // revision facts. It is NOT a substitute for an independent privacy review.
    policyRevision: approvalVersion,
  };
}

/** Wires the existing SQL facts repository to the narrow verified COUNT(*)
 * grammar. Deliberately no default activation or HTTP entrypoint.
 */
export function createDormantSqlChartFactsReader(config: ChartWidgetConfig): ChartSourceEvidenceReader {
  return createSqlChartFactsReader({
    ...chartFactsDefaults,
    getVerifiedAggregate: createVersionBoundCountProofReader(config),
  });
}

/** A pure orchestration seam, NOT a route handler.
 * The page provider must call the existing Query-only delivery after all
 * session/device/IP, source policy, masking and disclosure Audit checks.
 * Cross-process snapshots are not supported by the page bridge (fail closed).
 */
export function createDormantChartCoordinator(deps: ChartCoordinatorDependencies) {
  return async (dashboardId: number, widgetId: number, subject: ExecutionSubject) => {
    if (!deps.enabled() ||
        !Number.isSafeInteger(dashboardId) || dashboardId < 1 ||
        !Number.isSafeInteger(widgetId) || widgetId < 1 ||
        !Number.isSafeInteger(subject.userId) || subject.userId < 1 ||
        !Number.isSafeInteger(subject.tokenVersion) || subject.tokenVersion < 1)
      return deny();
    try {
      const context = subject.context ?? (subject.deviceId === undefined ? "designer" : "device");
      if (!["designer", "user", "device", "admin-preview"].includes(context) ||
          (context === "device") !== (subject.deviceId !== undefined))
        return deny();
      if (context === "user" || context === "admin-preview") {
        if (!Number.isSafeInteger(subject.expiresAt) ||
            subject.expiresAt! * 1000 <= Date.now()) return deny();
      }
      if (context === "device") {
        const proof = await subject.verifyDevice?.();
        if (!proof || proof.deviceId !== subject.deviceId ||
            proof.userId !== subject.userId ||
            proof.tokenVersion !== subject.tokenVersion)
          return deny();
      }
      const saved = await deps.readSavedWidget(dashboardId, widgetId);
      if (!saved || saved.widgetType !== "CHART" ||
          saved.dashboardId !== dashboardId || saved.id !== widgetId ||
          !/^[a-f0-9]{16}$/.test(saved.revision))
        return deny();
      const parsed = chartWidgetConfigSchema.safeParse(saved.config);
      if (!parsed.success) return deny();
      const config = parsed.data;
      const readFacts = deps.createFactsReader(config);
      const load = async () => {
        const facts = await readFacts(dashboardId, config.dataSourceKey, subject);
        if (!facts || facts.dashboardId !== dashboardId ||
            facts.sourceKey !== config.dataSourceKey) return deny();
        const approval = evaluateServerChartApproval(config, facts, subject);
        if (!approval) return deny();
        return { facts, approval };
      };
      // Only inactive-designer previews are internal. User, device and
      // admin-preview must all pass independent public aggregation review.
      const publicPlayback = context !== "designer";

      const initial = await load();
      const fenceOperation = createFencedChartOperation(deps.readFence, async () => {
        const current = await load();
        if (current.approval.version !== initial.approval.version) return deny();
        const scope = scopeOf(current.facts, current.approval.version, config);
        const reviewBefore = publicPlayback
          ? await deps.readPublicReview(scope, subject) : null;
        if (publicPlayback && !reviewedBeforeQuery(scope, reviewBefore))
          return deny();

        // Neither the page provider nor the approval reader accepts
        // authorization flags from the browser or from widget config.
        const readApproval: ServerChartApprovalReader = async (id, key, actor) => {
          if (id !== dashboardId || key !== config.dataSourceKey ||
              actor !== subject) return null;
          const latest = await load();
          return latest.approval;
        };
        const projected = await projectChartFromAuditedDashboardPage(
          config, dashboardId, subject, deps.auditedPage, readApproval,
        );
        const final = await load();
        if (final.approval.version !== current.approval.version) return deny();
        const lastSaved = await deps.readSavedWidget(dashboardId, widgetId);
        if (!lastSaved || lastSaved.dashboardId !== dashboardId ||
            lastSaved.id !== widgetId || lastSaved.widgetType !== "CHART" ||
            lastSaved.revision !== saved.revision ||
            JSON.stringify(lastSaved.config) !== JSON.stringify(saved.config))
          return deny();
        if (!publicPlayback) return projected;
        const finalScope = scopeOf(final.facts, final.approval.version, config);
        if (JSON.stringify(finalScope) !== JSON.stringify(scope)) return deny();
        const reviewAfter = await deps.readPublicReview(finalScope, subject);
        if (!reviewAfter ||
            reviewAfter.reviewRevision !== reviewBefore!.reviewRevision ||
            JSON.stringify(reviewAfter) !== JSON.stringify(reviewBefore))
          return deny();
        const allowed = permitPublicGroupedCount(projected.points, finalScope, reviewAfter);
        if (!allowed) return deny();
        return { ...projected, points: allowed };
      });
      const result = await fenceOperation(dashboardId, config.dataSourceKey,
        initial.approval.queryId, initial.approval.datasetId, subject);
      return result ?? deny();
    } catch {
      // No SQL, patient identifiers, credentials or internal error detail to
      // clients. Audit failure MUST NOT cause a fallback to unaudited data.
      return deny();
    }
  };
}
