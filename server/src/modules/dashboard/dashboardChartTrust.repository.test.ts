import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type sql from "mssql";
import {
  createDormantChartTrustReaders, validateSealedChartWidget,
  validateSignedPublicChartReview,
} from "./dashboardChartTrust.repository.js";
import type { PublicCountScope } from "./dashboardChartPublicCountPrivacy.js";
import type { ExecutionSubject } from "./dashboardQuerySourceExecution.js";

const config = {
  version: 1, chartType: "BAR", dataSourceKey: "PRIMARY",
  categoryColumn: "ROOM", valueColumn: "TOTAL",
  valueMode: "QUERY_RESULT", maxPoints: 30, showLegend: true,
};
const raw = JSON.stringify(config);
const rv = (n: number) => Buffer.from(n.toString(16).padStart(16, "0"), "hex");
const widget = () => ({
  Id: 88, DashboardId: 7, WidgetType: "CHART", SourceKey: "PRIMARY",
  ConfigJson: raw,
  SealRowVersion: rv(1),
  ConfigDigest: createHash("sha256").update(raw).digest("hex"),
  SealActive: true, SealedBy: 77, AuditReceiptVerified: true,
});
const subject: ExecutionSubject = {
  context: "user", userId: 8, tokenVersion: 1, tokenHash: "synthetic",
};
const scope: PublicCountScope = {
  dashboardId: 7, queryId: 9, datasetId: 10,
  sourceKey: "PRIMARY", categoryColumn: "ROOM", valueColumn: "TOTAL",
  queryRevision: "a".repeat(16),
  datasetRevision: "b".repeat(16),
  policyRevision: "c".repeat(64),
};
const now = new Date("2026-11-04T00:00:00.000Z");
const review = () => ({
  Id: 123, DashboardId: 7, QueryId: 9, DatasetId: 10,
  SourceKey: "PRIMARY", CategoryColumn: "ROOM", ValueColumn: "TOTAL",
  QueryRevision: Buffer.from(scope.queryRevision, "hex"),
  DatasetRevision: Buffer.from(scope.datasetRevision, "hex"),
  PolicyRevision: scope.policyRevision,
  Status: "APPROVED", MinimumCellCount: 5,
  CategoryPrivacyReviewed: true, DifferencingRiskReviewed: true,
  ReviewerUserId: 77, AuditLogId: 9876, AuditReceiptVerified: true,
  ReviewedAtUtc: new Date("2026-11-01T00:00:00.000Z"),
  ValidUntilUtc: new Date("2026-12-01T00:00:00.000Z"),
  ReviewRowVersion: rv(1),
});

test("only a sealed, bound, versioned CHART row is readable", () => {
  const valid = validateSealedChartWidget(widget(), 7, 88);
  assert(valid);
  assert.deepEqual(valid.config, config);
  assert.equal(valid.revision, "0000000000000001");
  for (const delta of [
    { DashboardId: 77 }, { Id: 777 }, { WidgetType: "TABLE" },
    { SourceKey: "OTHER" }, { SealActive: false }, { SealedBy: 0 },
    { AuditReceiptVerified: false },
    { ConfigDigest: "0".repeat(64) }, { ConfigJson: "{}" },
    { SealRowVersion: null }, { ConfigJson: '{"version":1,"chartType":"BAR","dataSourceKey":"PRIMARY","categoryColumn":"ROOM","valueColumn":"TOTAL","valueMode":"COUNT_ROWS","maxPoints":30,"showLegend":true}' },
  ]) assert.equal(validateSealedChartWidget({ ...widget(), ...delta }, 7, 88), null);
});
test("Widget A→B→A seal revisions differ even if ConfigJson returns to the same text", () => {
  const first = validateSealedChartWidget(widget(), 7, 88)!;
  const after = validateSealedChartWidget({ ...widget(), SealRowVersion: rv(4) }, 7, 88)!;
  assert.notEqual(first.revision, after.revision);
});
test("independent public reviewer, durable audit, current scope and valid time are mandatory", () => {
  const ok = validateSignedPublicChartReview(review(), scope, subject, now);
  assert(ok);
  assert.equal(ok.reviewRevision.length, 64);
  assert.equal(ok.reviewRevision, validateSignedPublicChartReview(review(), scope, subject, now)?.reviewRevision);
  for (const delta of [
    { Status: "PENDING" }, { ReviewerUserId: 8 }, { ReviewerUserId: null },
    { AuditLogId: 0 }, { AuditReceiptVerified: false }, { CategoryPrivacyReviewed: false },
    { DifferencingRiskReviewed: false }, { SourceKey: "OTHER" },
    { QueryRevision: rv(2) }, { DatasetRevision: rv(3) },
    { PolicyRevision: "f".repeat(64) }, { DashboardId: 9 },
    { MinimumCellCount: 1 }, { MinimumCellCount: 1001 },
    { ValidUntilUtc: new Date("2026-11-01T00:00:00.000Z") },
    { ValidUntilUtc: new Date("2027-11-01T00:00:00.000Z") },
    { ReviewRowVersion: null },
  ]) assert.equal(validateSignedPublicChartReview({ ...review(), ...delta }, scope, subject, now), null);
});
test("re-approval and retraction change the irreversible review fingerprint", () => {
  const first = validateSignedPublicChartReview(review(), scope, subject, now)!;
  const second = validateSignedPublicChartReview({ ...review(), ReviewRowVersion: rv(5) },
    scope, subject, now)!;
  assert.notEqual(first.reviewRevision, second.reviewRevision);
  assert.equal(validateSignedPublicChartReview({ ...review(), Status: "REVOKED" },
    scope, subject, now), null);
});
function mockPool(results: unknown[][]) {
  let reads = 0;
  const statements: string[] = [];
  const pool = {
    request: () => ({
      input() { return this; },
      async query(statement: string) {
        statements.push(statement);
        return { recordset: results[reads++] ?? [] };
      },
    }),
  } as unknown as sql.ConnectionPool;
  return { pool, statements, count: () => reads };
}
test("SQL-backed reader uses parameterized, exact single-row Widget and review lookup", async () => {
  const mock = mockPool([[widget()], [review()]]);
  const trust = createDormantChartTrustReaders(async () => mock.pool);
  assert((await trust.readSavedWidget(7, 88))?.revision);
  const currentReview = await trust.readPublicReview(scope, subject);
  assert(currentReview);
  assert(mock.statements[0]?.includes("w.Id=@widgetId"));
  assert(mock.statements[0]?.includes("DashboardChartWidgetSeal"));
  assert(mock.statements[1]?.includes("DashboardChartPrivacyReview"));
  assert(mock.statements[1]?.includes("r.QueryRevision=@queryRev"));
  for (const statement of mock.statements) {
    assert.match(statement,/uqp\.AuditLogArchive/);
    assert.match(statement,/AuditReceiptVerified/);
    assert.match(statement,/IsImportant=1/);
  }
  assert.equal(mock.count(), 2);
});
test("missing future catalog, duplicate approvals or database failures fail closed", async () => {
  const none = createDormantChartTrustReaders(async () => null);
  assert.equal(await none.readSavedWidget(7, 88), null);
  assert.equal(await none.readPublicReview(scope, subject), null);
  const dupe = mockPool([[widget(), widget()], [review(), review()]]);
  const trust = createDormantChartTrustReaders(async () => dupe.pool);
  assert.equal(await trust.readSavedWidget(7, 88), null);
  assert.equal(await trust.readPublicReview(scope, subject), null);
  const broken = createDormantChartTrustReaders(async () => {
    throw new Error("SQL catalog error with database details");
  });
  assert.equal(await broken.readSavedWidget(7, 88), null);
  assert.equal(await broken.readPublicReview(scope, subject), null);
});
