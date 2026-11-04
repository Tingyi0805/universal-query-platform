import test from "node:test";
import assert from "node:assert/strict";
import {
  createServerChartApprovalReader, evaluateServerChartApproval,
  type ServerChartFacts,
} from "./dashboardChartApproval.policy.js";
import type { ExecutionSubject } from "./dashboardQuerySourceExecution.js";

const config = {
  version: 1, chartType: "BAR", dataSourceKey: "PRIMARY",
  categoryColumn: "ROOM", valueColumn: "TOTAL",
  valueMode: "QUERY_RESULT", maxPoints: 20, showLegend: true,
};
const subject: ExecutionSubject = { context: "designer", userId: 8,
  tokenVersion: 1, tokenHash: "synthetic" };
const report = (columnName: string, dataType: string, groupOrder: number | null, aggregateType: "NONE" | "COUNT" | "SUM") => ({
  columnName, dataType, groupOrder, aggregateType, displayLabel: columnName,
  displayOrder: 0, isVisible: true, width: null, displayFormat: null,
  alignment: "LEFT" as const,
});
function facts(): ServerChartFacts {
  return {
    dashboardId: 7, sourceKey: "PRIMARY",
    source: {
      queryId: 9, bindingRevision: 1, enabled: true, managed: true,
      referenced: true, activeDashboard: false, mode: "QUERY_ONLY_DISABLED",
    },
    actor: {
      userId: 8, tokenVersion: 1, active: true,
      permissions: ["DESIGN_QUERY", "EXECUTE_QUERY"],
      canView: true, canExecute: true,
    },
    query: { id: 9, datasetId: 10, active: true, published: true, archived: false },
    dataset: { id: 10, active: true, archived: false },
    revisions: {
      dashboardApproval: "a".repeat(64), access: "b".repeat(64),
      query: "c".repeat(16), dataset: "d".repeat(16),
    },
    sensitivity: { version: 2, columns: [
      { columnName: "ROOM", sensitivityType: "OTHER", deviceMaskMode: "NONE" },
      { columnName: "TOTAL", sensitivityType: "OTHER", deviceMaskMode: "NONE" },
      { columnName: "PATIENT", sensitivityType: "NAME", deviceMaskMode: "NAME" },
    ] },
    publicDisplay: null,
    reportColumns: [report("ROOM", "nvarchar(30)", 1, "NONE"), report("TOTAL", "decimal(18,2)", null, "COUNT")],
    verifiedAggregate: {
      verified: true, queryId: 9, datasetId: 10,
      queryRevision: "c".repeat(16), datasetRevision: "d".repeat(16),
      categoryColumn: "ROOM", valueColumn: "TOTAL",
      evidenceVersion: "e".repeat(64),
    },
  };
}
const approve = (f: ServerChartFacts | null, c: unknown = config, actor = subject) =>
  evaluateServerChartApproval(c, f, actor);
const refuses = (f: ServerChartFacts | null, c: unknown = config, actor = subject) =>
  assert.equal(approve(f, c, actor), null);

test("trusted aggregate and currently allowed report fields produce scoped approval", () => {
  const approved = approve(facts());
  assert(approved);
  assert.deepEqual(approved.approvedCategoryColumns, ["ROOM"]);
  assert.deepEqual(approved.approvedNumericColumns, ["TOTAL"]);
  assert.equal(approved.queryId, 9);
  assert.match(approved.version, /^[a-f0-9]{64}$/);
});
test("without a trusted SQL aggregate certificate even report COUNT/group cannot be trusted", () => {
  const f = facts(); f.verifiedAggregate = null;
  refuses(f);
  const g = facts(); g.verifiedAggregate = { ...g.verifiedAggregate!, queryRevision: "0".repeat(16) };
  refuses(g);
  const h = facts(); h.verifiedAggregate = { ...h.verifiedAggregate!, categoryColumn: "PATIENT" };
  refuses(h);
});
test("report grouping metadata is only an additional constraint, never proof of SQL aggregation", () => {
  const f = facts(); f.reportColumns = [report("ROOM", "nvarchar(30)", null, "NONE"), report("TOTAL", "decimal(18,2)", null, "COUNT")];
  refuses(f);
  const g = facts(); g.reportColumns = [report("ROOM", "nvarchar(30)", 1, "NONE"), report("TOTAL", "decimal(18,2)", null, "NONE")];
  refuses(g);
  const h = facts(); h.reportColumns = [report("ROOM", "nvarchar(30)", 1, "NONE"), report("TOTAL", "nvarchar(30)", null, "SUM")];
  refuses(h);
  const i = facts(); i.reportColumns = [{ ...report("ROOM", "nvarchar(30)", 1, "NONE"), isVisible: false }, report("TOTAL", "bigint", null, "COUNT")];
  refuses(i);
  const j = facts(); j.reportColumns = [...j.reportColumns, report("room", "nvarchar(30)", 1, "NONE")];
  refuses(j);
});
test("sensitive, masked, omitted, unknown and ambiguous fields are never approved", () => {
  for (const rule of [
    { columnName: "ROOM", sensitivityType: "NAME", deviceMaskMode: "NAME" as const },
    { columnName: "ROOM", sensitivityType: "OTHER", deviceMaskMode: "FULL" as const },
    { columnName: "ROOM", sensitivityType: "OTHER", deviceMaskMode: "OMIT" as const },
  ]) {
    const f = facts(); f.sensitivity.columns = [rule, ...f.sensitivity.columns.filter(r => r.columnName !== "ROOM")];
    refuses(f);
  }
  const g = facts(); g.sensitivity.columns = g.sensitivity.columns.filter(r => r.columnName !== "ROOM");
  refuses(g);
  const h = facts(); h.sensitivity.columns = [...h.sensitivity.columns, { columnName: "room", sensitivityType: "OTHER", deviceMaskMode: "NONE" }];
  refuses(h);
  const i = facts(); i.reportColumns = [report("PATIENT", "nvarchar(30)", 1, "NONE"), report("TOTAL", "int", null, "COUNT")];
  refuses(i, { ...config, categoryColumn: "PATIENT" });
});
test("query publication, source binding, actor revocation and revisions are required", () => {
  const cases: Array<(f: ServerChartFacts) => void> = [
    f => { f.query.published = false; }, f => { f.query.archived = true; },
    f => { f.dataset.active = false; }, f => { f.source.enabled = false; },
    f => { f.source.managed = false; }, f => { f.source.queryId = 99; },
    f => { f.actor.active = false; }, f => { f.actor.canExecute = false; },
    f => { f.actor.tokenVersion = 2; },
    f => { f.revisions.query = "bad"; },
    f => { f.revisions.dashboardApproval = "bad"; },
  ];
  for (const mutate of cases) { const f = facts(); mutate(f); refuses(f); }
});
test("public playback requires active Query-only source, current public grants and exact columns", () => {
  const viewer: ExecutionSubject = { ...subject, context: "device", deviceId: 71 };
  const f = facts();
  f.source.activeDashboard = true;
  f.source.mode = "QUERY_ONLY";
  f.publicDisplay = {
    status: "CONFIRMED", version: "f".repeat(16),
    policy: { confirmed: true, sensitivityVersion: 2, grants: [
      { columnName: "ROOM", permitted: true },
      { columnName: "TOTAL", permitted: true },
    ] },
  };
  assert(approve(f, config, viewer));
  const h = facts(); Object.assign(h, {
    source: { ...f.source }, publicDisplay: f.publicDisplay,
  });
  h.publicDisplay = { ...f.publicDisplay!, status: "STALE" };
  refuses(h, config, viewer);
  h.publicDisplay = { ...f.publicDisplay!, policy: { ...f.publicDisplay!.policy!, grants: [
    { columnName: "ROOM", permitted: true }, { columnName: "TOTAL", permitted: false },
  ] } };
  refuses(h, config, viewer);
  h.publicDisplay = f.publicDisplay;
  h.source.referenced = false;
  refuses(h, config, viewer);
  const unknown = facts(); unknown.source = f.source;
  refuses(unknown, config, viewer);
});
test("approval fingerprints change when authoritative revisions change, including ABA via rowversion", () => {
  const first = approve(facts())!;
  const newer = facts(); newer.revisions.query = "1".repeat(16);
  newer.verifiedAggregate = { ...newer.verifiedAggregate!, queryRevision: newer.revisions.query };
  const second = approve(newer)!;
  assert.notEqual(second.version, first.version);
  const previous = approve(facts())!;
  assert.equal(previous.version, first.version);
  // Actual SQL stores MUST supply the current monotonically changing revision
  // even if values later become identical. This policy does not invent it.
});
test("factory is dependency-injected and no production evidence reader exists", async () => {
  const reader = createServerChartApprovalReader(config, async () => facts());
  assert((await reader(7, "PRIMARY", subject))?.version);
  assert.equal(await reader(7, "OTHER", subject), null);
  const deny = createServerChartApprovalReader(config, async () => null);
  assert.equal(await deny(7, "PRIMARY", subject), null);
  assert.equal(await reader(999, "PRIMARY", subject), null);
});
