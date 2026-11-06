import test from "node:test";
import assert from "node:assert/strict";
import { permitPublicGroupedCount, type PublicCountReview, type PublicCountScope } from "./dashboardChartPublicCountPrivacy.js";

const scope: PublicCountScope = {
  dashboardId: 7, queryId: 9, datasetId: 10, sourceKey: "PRIMARY",
  categoryColumn: "ROOM", valueColumn: "TOTAL",
  queryRevision: "a".repeat(16), datasetRevision: "b".repeat(16),
  policyRevision: "c".repeat(64),
};
const review: PublicCountReview = {
  ...scope, status: "APPROVED", reviewRevision: "d".repeat(64),
  minimumCellCount: 5, categoryPrivacyReviewed: true, differencingRiskReviewed: true,
};
const points = [{ label: "OR-01", value: 7 }, { label: "OR-02", value: 10 }];
test("public count requires explicit current reviewed scope and sufficiently large groups", () => {
  assert.deepEqual(permitPublicGroupedCount(points, scope, review), points);
  assert.notEqual(permitPublicGroupedCount(points, scope, review), points);
});
test("unknown or unreviewed public count disclosure always fails closed", () => {
  assert.equal(permitPublicGroupedCount(points, scope, null), null);
  for (const changes of [
    { minimumCellCount: 0 }, { minimumCellCount: 4 },
    { categoryPrivacyReviewed: false }, { differencingRiskReviewed: false },
    { status: "PENDING" }, { reviewRevision: "bad" },
    { queryRevision: "e".repeat(16) }, { datasetRevision: "e".repeat(16) },
    { policyRevision: "e".repeat(64) }, { sourceKey: "EXTRA" },
    { categoryColumn: "PATIENT_ID" }, { valueColumn: "PATIENT_TOTAL" },
    { dashboardId: 99 }, { queryId: 99 }, { datasetId: 99 },
  ]) assert.equal(permitPublicGroupedCount(points, scope, { ...review, ...changes } as PublicCountReview), null);
});
test("small counts, zero, fraction, negatives, overflow, duplicates and empty data never render", () => {
  for (const data of [
    [], [{ label: "OR-01", value: 1 }], [{ label: "OR-01", value: 4 }],
    [{ label: "OR-01", value: 0 }], [{ label: "OR-01", value: -10 }],
    [{ label: "OR-01", value: 5.5 }],
    [{ label: "OR-01", value: Number.MAX_SAFE_INTEGER + 1 }],
    [{ label: "OR-01", value: 7 }, { label: "OR-01", value: 8 }],
    [{ label: "", value: 7 }],
    Array.from({ length: 51 }, (_, i) => ({ label: String(i), value: 10 })),
  ]) assert.equal(permitPublicGroupedCount(data, scope, review), null);
});
test("minimum count is a per-category gate, not a license to display all raw rows", () => {
  assert.equal(permitPublicGroupedCount([
    { label: "OR-01", value: 500 }, { label: "OR-02", value: 4 },
  ], scope, review), null);
});
