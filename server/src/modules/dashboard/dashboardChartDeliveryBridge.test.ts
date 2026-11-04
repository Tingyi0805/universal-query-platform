import test from "node:test";
import assert from "node:assert/strict";
import { createDashboardPageSnapshot } from "./dashboardPageSnapshot.js";
import { ChartContractError } from "./dashboardChartWidget.contract.js";
import {
  projectChartFromAuditedDashboardPage, type AuditedPageProvider,
  type ServerChartApproval, type ServerChartApprovalReader,
} from "./dashboardChartDeliveryBridge.js";
import type { ExecutionSubject } from "./dashboardQuerySourceExecution.js";

const config = {
  version: 1, chartType: "BAR", dataSourceKey: "PRIMARY",
  categoryColumn: "ROOM", valueColumn: "COUNT",
  valueMode: "QUERY_RESULT", maxPoints: 50, showLegend: true,
};
const subject: ExecutionSubject = { context: "designer", userId: 8,
  tokenVersion: 1, tokenHash: "ci" };
const approved = (): ServerChartApproval => ({
  dashboardId: 7, sourceKey: "PRIMARY", queryId: 9, datasetId: 10,
  sensitivityVersion: 2, version: "a".repeat(64),
  approvedCategoryColumns: ["ROOM"], approvedNumericColumns: ["COUNT"],
});
function fixture(options: { rows?: Array<Record<string, unknown>>; pageSize?: number;
  truncated?: boolean | null; mask?: boolean; approval?: ServerChartApproval | null } = {}) {
  const rows = options.rows ?? [{ ROOM: "OR-01", COUNT: 3, PERSON_ID: "PRIVATE" },
    { ROOM: "OR-02", COUNT: 5, PERSON_ID: "PRIVATE" }];
  const snap = createDashboardPageSnapshot({
    deviceId: -subject.userId, dashboardId: 7, queryId: 9, datasetId: 10,
    sourceKey: "PRIMARY", executionContext: "designer",
    sourceScope: "ci-disposable", modeVersion: "QUERY_ONLY_PREVIEW_V1",
    sensitivityVersion: 2, truncated: options.truncated ?? false,
    columns: [{ name: "ROOM" }, { name: "COUNT" }, { name: "PERSON_ID" }],
    rows,
  });
  const size = options.pageSize ?? rows.length;
  const displayed = rows.slice(0, size).map(row => ({
    ROOM: options.mask ? "○○○" : row.ROOM,
    COUNT: row.COUNT,
  }));
  let delivered = 0, approvals = 0;
  const service: AuditedPageProvider = { page: async (_, key, __, input) => {
    assert.equal(key, "PRIMARY");
    assert.equal(input.page, 1);
    delivered++;
    return {
      sourceKey: "PRIMARY", modeVersion: "QUERY_ONLY_PREVIEW_V1",
      query: { id: 9 }, page: 1,
      totalPages: Math.max(1, Math.ceil(rows.length / size)),
      totalRows: rows.length,
      snapshotId: snap.id, snapshotExpiresAt: snap.createdAt + snap.ttlMs,
      result: { columns: [{ name: "ROOM" }, { name: "COUNT" }], rows: displayed },
    };
  } };
  let approval = options.approval === undefined ? approved() : options.approval;
  const readApproval: ServerChartApprovalReader = async () => { approvals++; return approval; };
  return { snap, service, readApproval, setApproval: (next: ServerChartApproval | null) => { approval = next; },
    counts: () => ({ delivered, approvals }) };
}
const project = (f: ReturnType<typeof fixture>, settings: unknown = config) =>
  projectChartFromAuditedDashboardPage(settings, 7, subject, f.service, f.readApproval);
const refuses = async (f: ReturnType<typeof fixture>, settings: unknown = config) =>
  assert.rejects(project(f, settings), (e: unknown) =>
    e instanceof ChartContractError && e.code === "CHART_TRUSTED_DELIVERY_REQUIRED");

test("single full audited page maps selected fields, never raw patient data", async () => {
  const f = fixture();
  assert.deepEqual(await project(f), {
    chartType: "BAR", showLegend: true,
    points: [{ label: "OR-01", value: 3 }, { label: "OR-02", value: 5 }],
  });
  assert.deepEqual(f.counts(), { delivered: 1, approvals: 2 });
});
test("invalid configuration and absent approval reject before calling Query executor", async () => {
  const f = fixture({ approval: null });
  await refuses(f);
  assert.equal(f.counts().delivered, 0);
  const f2 = fixture();
  await refuses(f2, { ...config, maxPoints: 500 });
  assert.equal(f2.counts().delivered, 0);
});
test("server-controlled approval must name exact source/query/dataset/version", async () => {
  for (const changes of [{ sourceKey: "ANOTHER" }, { queryId: 77 },
    { datasetId: 22 }, { sensitivityVersion: 4 }, { version: "" },
    { approvedCategoryColumns: [] }, { approvedNumericColumns: [] },
  ]) {
    const f = fixture({ approval: { ...approved(), ...changes } });
    await refuses(f);
  }
});
test("pagination, truncation and missing truncate proof never produce totals", async () => {
  await refuses(fixture({ pageSize: 1 }));
  await refuses(fixture({ truncated: true }));
  await refuses(fixture({ truncated: null }));
  await refuses(fixture({ rows: Array.from({ length: 51 }, (_, i) => ({ ROOM: "R" + i, COUNT: 1 })) }));
});
test("masked grouping cannot be used as a chart category", async () => {
  await refuses(fixture({ mask: true }));
});
test("missing or expired snapshot and unaudited delivery cannot be trusted", async () => {
  const f = fixture();
  f.snap.createdAt -= f.snap.ttlMs;
  await refuses(f);
  const throwBeforePage = fixture();
  throwBeforePage.service.page = async () => { throw Error("AUDIT_NOT_COMMITTED"); };
  await assert.rejects(project(throwBeforePage), /AUDIT_NOT_COMMITTED/);
});
test("approval version change after audited delivery refuses the result", async () => {
  const f = fixture();
  const original = f.service.page;
  f.service.page = async (...args) => {
    const result = await original(...args);
    f.setApproval({ ...approved(), version: "b".repeat(64) });
    return result;
  };
  await refuses(f);
});
test("approval identity does not make masked numeric values valid", async () => {
  const f = fixture({ rows: [{ ROOM: "OR-01", COUNT: "●●" }] });
  await assert.rejects(project(f), (e: unknown) =>
    e instanceof ChartContractError && e.code === "CHART_VALUE_NOT_NUMERIC");
});
