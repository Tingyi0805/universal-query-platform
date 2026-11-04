import test from "node:test";
import assert from "node:assert/strict";
import { createDashboardPageSnapshot } from "./dashboardPageSnapshot.js";
import {
  createDormantChartCoordinator, type ChartCoordinatorDependencies,
} from "./dashboardChartDelivery.coordinator.js";
import { ChartContractError } from "./dashboardChartWidget.contract.js";
import type { ServerChartFacts } from "./dashboardChartApproval.policy.js";
import type { ChartRevisionFence } from "./dashboardChartRevisionFence.js";
import type { PublicCountReview } from "./dashboardChartPublicCountPrivacy.js";
import type { ExecutionSubject } from "./dashboardQuerySourceExecution.js";

const config = {
  version: 1, chartType: "BAR", dataSourceKey: "PRIMARY",
  categoryColumn: "ROOM", valueColumn: "TOTAL",
  valueMode: "QUERY_RESULT", maxPoints: 20, showLegend: false,
};
const subject: ExecutionSubject = {
  context: "designer", userId: 8, tokenVersion: 1, tokenHash: "synthetic",
};
const viewer: ExecutionSubject = {
  ...subject, context: "user", expiresAt: Math.floor(Date.now() / 1000) + 3600,
};
const fence: ChartRevisionFence = {
  dashboardId: 7, sourceKey: "PRIMARY", queryId: 9, datasetId: 10,
  userId: 8, tokenVersion: 1, version: "a".repeat(64),
};
function facts(isPublic = false): ServerChartFacts {
  return {
    dashboardId: 7, sourceKey: "PRIMARY",
    source: { queryId: 9, bindingRevision: 1,
      enabled: true, managed: true, referenced: true,
      activeDashboard: isPublic, mode: isPublic ? "QUERY_ONLY" : "QUERY_ONLY_DISABLED" },
    actor: { userId: 8, tokenVersion: 1, active: true,
      permissions: ["EXECUTE_QUERY", "DESIGN_QUERY", "VIEW_QUERY"],
      canView: true, canExecute: true },
    query: { id: 9, datasetId: 10, active: true, published: true, archived: false },
    dataset: { id: 10, active: true, archived: false },
    revisions: { dashboardApproval: "b".repeat(64),
      access: "c".repeat(64), query: "d".repeat(16), dataset: "e".repeat(16) },
    sensitivity: { version: 2, columns: [
      { columnName: "ROOM", sensitivityType: "OTHER", deviceMaskMode: "NONE" },
      { columnName: "TOTAL", sensitivityType: "OTHER", deviceMaskMode: "NONE" },
      { columnName: "PATIENT_ID", sensitivityType: "PATIENT_ID", deviceMaskMode: "FULL" },
    ] },
    publicDisplay: isPublic ? {
      status: "CONFIRMED", version: "f".repeat(16), policy: {
        confirmed: true, sensitivityVersion: 2, grants: [
          { columnName: "ROOM", permitted: true }, { columnName: "TOTAL", permitted: true },
        ],
      },
    } : null,
    reportColumns: [
      { columnName: "ROOM", dataType: "nvarchar(20)", displayLabel: "Room",
        displayOrder: 1, isVisible: true, width: null, displayFormat: null,
        alignment: "LEFT", groupOrder: 1, aggregateType: "NONE" },
      { columnName: "TOTAL", dataType: "bigint", displayLabel: "Total",
        displayOrder: 2, isVisible: true, width: null, displayFormat: null,
        alignment: "RIGHT", groupOrder: null, aggregateType: "COUNT" },
    ],
    verifiedAggregate: { verified: true, queryId: 9, datasetId: 10,
      queryRevision: "d".repeat(16), datasetRevision: "e".repeat(16),
      categoryColumn: "ROOM", valueColumn: "TOTAL", evidenceVersion: "f".repeat(64) },
  };
}
type Scenario = {
  enabled?: boolean;
  isPublic?: boolean;
  rows?: Array<Record<string, unknown>>;
  truncated?: boolean | null;
  masked?: boolean;
  denyWidget?: boolean;
  noProof?: boolean;
  noReview?: boolean;
  changeApproval?: boolean;
  changeFence?: boolean;
  changeReview?: boolean;
  failedAudit?: boolean;
  changeWidget?: boolean;
  context?: "device" | "admin-preview";
  validDeviceProof?: boolean;
  expiredUser?: boolean;
  unreviewedPublic?: boolean;
  invalidPublicThreshold?: boolean;
  wrongReviewScope?: boolean;
};
function fixture(options: Scenario = {}) {
  const isPublic = options.isPublic ?? Boolean(options.context);
  const actor: ExecutionSubject = options.context === "device"
    ? { ...viewer, context: "device", deviceId: 71,
      verifyDevice: options.validDeviceProof
        ? async () => ({ deviceId: 71, userId: 8, tokenVersion: 1, fingerprint: "synthetic" })
        : undefined }
    : options.context === "admin-preview" ? { ...viewer, context: "admin-preview" }
    : isPublic ? { ...viewer, expiresAt: options.expiredUser
        ? Math.floor(Date.now() / 1000) - 1 : viewer.expiresAt }
    : subject;
  const rows = options.rows ?? [
    { ROOM: "OR-01", TOTAL: 7, PATIENT_ID: "SECRET_PATIENT_ID" },
    { ROOM: "OR-02", TOTAL: 9, PATIENT_ID: "SECRET_PATIENT_ID" },
  ];
  const snapshot = createDashboardPageSnapshot({
    deviceId: actor.deviceId ?? -actor.userId, dashboardId: 7, queryId: 9, datasetId: 10,
    sourceKey: "PRIMARY", executionContext: actor.context!,
    sourceScope: "test-isolated-only",
    modeVersion: "QUERY_ONLY_PREVIEW_V1",
    sensitivityVersion: 2,
    truncated: options.truncated === undefined ? false : options.truncated,
    columns: [{ name: "ROOM" }, { name: "TOTAL" }, { name: "PATIENT_ID" }],
    rows,
  });
  let readWidget = 0, reads = 0, calls = 0, publicReads = 0, fenceReads = 0;
  const savedFacts = facts(isPublic);
  const deps: ChartCoordinatorDependencies = {
    enabled: () => options.enabled !== false,
    readSavedWidget: async (id, widgetId) => {
      readWidget++;
      return options.denyWidget ? null : {
        dashboardId: id, id: widgetId, widgetType: "CHART",
        revision: options.changeWidget && calls > 0
          ? "b".repeat(16) : "a".repeat(16), config,
      };
    },
    createFactsReader: () => async () => {
      reads++;
      const next = structuredClone(savedFacts);
      if (options.noProof) next.verifiedAggregate = null;
      if (options.changeApproval && calls > 0) {
        next.revisions.dashboardApproval = "0".repeat(64);
      }
      return next;
    },
    auditedPage: { page: async () => {
      calls++;
      if (options.failedAudit) throw new Error("PATIENT_AUDIT_UNAVAILABLE:SECRET");
      const provided = rows.map(row => ({
        ROOM: options.masked ? "○○○" : row.ROOM, TOTAL: row.TOTAL,
      }));
      return {
        sourceKey: "PRIMARY", modeVersion: "QUERY_ONLY_PREVIEW_V1",
        query: { id: 9 }, page: 1, totalPages: 1, totalRows: rows.length,
        snapshotId: snapshot.id,
        snapshotExpiresAt: snapshot.createdAt + snapshot.ttlMs,
        result: { columns: [{ name: "ROOM" }, { name: "TOTAL" }], rows: provided },
      };
    } },
    readFence: async () => {
      fenceReads++;
      return {
        ...fence,
        version: options.changeFence && fenceReads > 1
          ? "0".repeat(64) : fence.version,
      };
    },
    readPublicReview: async scope => {
      publicReads++;
      if (options.noReview) return null;
      const review: PublicCountReview = {
        ...scope, sourceKey: options.wrongReviewScope ? "OTHER" : scope.sourceKey,
        status: "APPROVED", reviewRevision:
          options.changeReview && publicReads > 1 ? "0".repeat(64) : "1".repeat(64),
        minimumCellCount: options.invalidPublicThreshold ? 0 : 5,
        categoryPrivacyReviewed: (options.unreviewedPublic ? false : true) as true,
        differencingRiskReviewed: true,
      };
      return review;
    },
  };
  return {
    actor, invoke: (id = 7, wid = 88) =>
      createDormantChartCoordinator(deps)(id, wid, actor),
    counts: () => ({ readWidget, reads, calls, publicReads, fenceReads }),
  };
}
async function refused(f: ReturnType<typeof fixture>) {
  await assert.rejects(f.invoke(), (error: unknown) =>
    error instanceof ChartContractError &&
    error.code === "CHART_TRUSTED_DELIVERY_REQUIRED" &&
    !error.message.includes("SECRET"));
}
test("dormant gate rejects without looking up any widget or executing a Query", async () => {
  const f = fixture({ enabled: false });
  await refused(f);
  assert.deepEqual(f.counts(), {
    readWidget: 0, reads: 0, calls: 0, publicReads: 0, fenceReads: 0,
  });
});
test("trusted inactive designer preview uses audited page and emits no patient identifier", async () => {
  const f = fixture();
  const result = await f.invoke();
  assert.deepEqual(result, {
    chartType: "BAR", showLegend: false,
    points: [{ label: "OR-01", value: 7 }, { label: "OR-02", value: 9 }],
  });
  assert.equal(JSON.stringify(result).includes("SECRET_PATIENT_ID"), false);
  assert.equal(f.counts().publicReads, 0);
  assert.equal(f.counts().calls, 1);
  assert.equal(f.counts().fenceReads, 2);
});
test("public viewers require independent pre-and-post privacy review", async () => {
  const f = fixture({ isPublic: true });
  const result = await f.invoke();
  assert.equal(result.points.length, 2);
  assert.equal(f.counts().publicReads, 2);
  assert.equal(f.counts().calls, 1);
});
test("absent widget, missing SQL proof and absent privacy review fail before page execution", async () => {
  for (const scenario of [
    { denyWidget: true }, { noProof: true },
    { isPublic: true, noReview: true },
  ]) {
    const f = fixture(scenario);
    await refused(f);
    assert.equal(f.counts().calls, 0);
  }
});
test("review revision changes after audited page, or safety fence changes, refuse the chart", async () => {
  for (const scenario of [
    { isPublic: true, changeReview: true },
    { changeApproval: true }, { changeFence: true },
    { changeWidget: true },
  ]) {
    const f = fixture(scenario);
    await refused(f);
    assert.equal(f.counts().calls, 1);
  }
});
test("public counts below approved minimum refuse entire chart, not just a category", async () => {
  const f = fixture({ isPublic: true, rows: [
    { ROOM: "OR-01", TOTAL: 8 }, { ROOM: "OR-02", TOTAL: 1 },
  ] });
  await refused(f);
  assert.equal(f.counts().publicReads, 2);
});
test("masked group, partial snapshot and audit failure never return a chart", async () => {
  for (const scenario of [
    { masked: true }, { truncated: true }, { truncated: null },
    { failedAudit: true },
  ]) {
    const f = fixture(scenario);
    await refused(f);
  }
});
test("invalid Widget ID or untrusted saved record fails before query", async () => {
  const f = fixture();
  await assert.rejects(f.invoke(0), ChartContractError);
  await assert.rejects(f.invoke(7, 0), ChartContractError);
  assert.equal(f.counts().calls, 0);
});

test("expired public JWT and missing device proof reject before Widget lookup or SQL", async () => {
  for (const scenario of [
    { isPublic: true, expiredUser: true },
    { context: "device" as const },
  ]) {
    const f = fixture(scenario);
    await refused(f);
    assert.equal(f.counts().readWidget, 0);
    assert.equal(f.counts().calls, 0);
  }
});
test("valid synthetic device proof still requires public review and existing audited page", async () => {
  const f = fixture({ context: "device", validDeviceProof: true });
  assert.deepEqual(await f.invoke(), {
    chartType: "BAR", showLegend: false,
    points: [{ label: "OR-01", value: 7 }, { label: "OR-02", value: 9 }],
  });
  assert.equal(f.counts().publicReads, 2);
});
test("admin-preview is treated as public, never internal designer mode", async () => {
  const f = fixture({ context: "admin-preview", noReview: true });
  await refused(f);
  assert.equal(f.counts().calls, 0);
});

test("unreviewed, invalid-threshold or wrong-scope public review prevents Query execution", async () => {
  for (const scenario of [
    { isPublic: true, unreviewedPublic: true },
    { isPublic: true, invalidPublicThreshold: true },
    { isPublic: true, wrongReviewScope: true },
  ]) {
    const f = fixture(scenario);
    await refused(f);
    assert.equal(f.counts().calls, 0);
    assert.equal(f.counts().publicReads, 1);
  }
});
