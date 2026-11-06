// 2B-5: dormant PUBLIC grouped-count chart privacy boundary.
// This is necessary, not sufficient, for release: a separate authoritative
// server-side review record and the original Query Disclosure Audit remain
// mandatory. Never read a review record from the browser or Widget ConfigJson.
import type { ChartPoint } from "./dashboardChartWidget.contract.js";

export type PublicCountReview = Readonly<{
  status: "APPROVED";
  dashboardId: number;
  queryId: number;
  datasetId: number;
  sourceKey: string;
  categoryColumn: string;
  valueColumn: string;
  queryRevision: string;
  datasetRevision: string;
  policyRevision: string;
  reviewRevision: string;
  minimumCellCount: number;
  // Review is about actual source fields, cohort/category privacy and the
  // effects of comparing repeated screens/time windows, not merely SQL syntax.
  categoryPrivacyReviewed: true;
  differencingRiskReviewed: true;
}>;

export type PublicCountScope = Readonly<Pick<PublicCountReview,
  "dashboardId" | "queryId" | "datasetId" | "sourceKey" |
  "categoryColumn" | "valueColumn" | "queryRevision" |
  "datasetRevision" | "policyRevision">>;

const hex16 = /^[a-f0-9]{16}$/;
const hex64 = /^[a-f0-9]{64}$/;

export function permitPublicGroupedCount(
  points: readonly ChartPoint[], scope: PublicCountScope,
  review: PublicCountReview | null,
): ChartPoint[] | null {
  if (!review || review.status !== "APPROVED" ||
      review.categoryPrivacyReviewed !== true ||
      review.differencingRiskReviewed !== true ||
      !hex64.test(review.reviewRevision) ||
      !hex64.test(scope.policyRevision) ||
      !hex16.test(scope.queryRevision) || !hex16.test(scope.datasetRevision) ||
      !Number.isSafeInteger(review.minimumCellCount) ||
      review.minimumCellCount < 5 || review.minimumCellCount > 1000 ||
      !Number.isSafeInteger(scope.dashboardId) || scope.dashboardId < 1 ||
      !Number.isSafeInteger(scope.queryId) || scope.queryId < 1 ||
      !Number.isSafeInteger(scope.datasetId) || scope.datasetId < 1 ||
      !/^(?:PRIMARY|[A-Za-z][A-Za-z0-9_]{0,63})$/.test(scope.sourceKey))
    return null;
  for (const key of ["dashboardId", "queryId", "datasetId",
    "sourceKey", "categoryColumn", "valueColumn", "queryRevision",
    "datasetRevision", "policyRevision"] as const)
    if (review[key] !== scope[key]) return null;
  if (!Array.isArray(points) || points.length < 1 || points.length > 50) return null;
  const seen = new Set<string>();
  for (const point of points) {
    if (!point || typeof point.label !== "string" ||
        !point.label.length || point.label.length > 100 ||
        seen.has(point.label) || !Number.isSafeInteger(point.value) ||
        point.value < review.minimumCellCount)
      return null; // Reject the entire chart: no partial/silent suppression.
    seen.add(point.label);
  }
  // Still requires trusted review provenance, current Query/Device authority,
  // source completeness and irreversible disclosure audit before delivery.
  return points.map(p => ({ label: p.label, value: p.value }));
}
