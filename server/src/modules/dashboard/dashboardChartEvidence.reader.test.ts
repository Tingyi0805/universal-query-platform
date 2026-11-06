import test from "node:test";
import assert from "node:assert/strict";
import { chartFactsDefaults, createSqlChartFactsReader,
  type ChartFactsDependencies } from "./dashboardChartEvidence.reader.js";
import { evaluateServerChartApproval } from "./dashboardChartApproval.policy.js";
import type { ExecutionSubject } from "./dashboardQuerySourceExecution.js";

const subject: ExecutionSubject = { context: "designer", userId: 8,
  tokenVersion: 1, tokenHash: "synthetic" };
const config = {
  version: 1, chartType: "BAR", dataSourceKey: "PRIMARY",
  categoryColumn: "ROOM", valueColumn: "TOTAL",
  valueMode: "QUERY_RESULT", maxPoints: 20, showLegend: false,
};
function fixture() {
  const trace: string[] = [];
  let approval = "a".repeat(64), accessRevision = "b".repeat(64);
  let sessionActive = true, isPublished = true, dataSourceActive = true;
  let queryId = 9, publicStatus = "CONFIRMED";
  const spies = (name: string, result: unknown) => async (..._args: unknown[]) => {
    trace.push(name); return result;
  };
  const deps = {
    ...chartFactsDefaults,
    loadBinding: spies("binding", {
      dashboardId: 7, sourceId: 1, sourceKey: "PRIMARY",
      queryDefinitionId: queryId, bindingRevision: 1, enabled: true,
      managed: true, referenced: true, dashboardActive: false,
      mode: "QUERY_ONLY_DISABLED",
    }),
    getSession: async () => { trace.push("session"); return {
      isActive: sessionActive, tokenVersion: 1,
      permissions: ["DESIGN_QUERY", "EXECUTE_QUERY"],
    }; },
    getQuery: async () => { trace.push("query"); return {
      id: queryId, datasetId: 10, isPublished, isActive: true, isArchived: false,
    }; },
    getAccess: spies("access", { canView: true, canExecute: true }),
    getAccessRevision: async () => { trace.push("accessRevision"); return accessRevision; },
    getDataset: spies("dataset", { id: 10, dataSourceId: 11, isActive: true, isArchived: false }),
    getDataSource: async () => { trace.push("datasource"); return {
      isActive: dataSourceActive, revision: "d".repeat(64),
    }; },
    getSensitivity: spies("sensitivity", { version: 2, columns: [
      { columnName: "ROOM", sensitivityType: "OTHER", deviceMaskMode: "NONE" },
      { columnName: "TOTAL", sensitivityType: "OTHER", deviceMaskMode: "NONE" },
    ] }),
    getPublicDisplay: async () => { trace.push("public"); return {
      status: publicStatus, version: "f".repeat(16),
      policy: { confirmed: true, sensitivityVersion: 2, grants: [
        { columnName: "ROOM", permitted: true },
        { columnName: "TOTAL", permitted: true },
      ] },
    }; },
    getReportColumns: spies("reports", [
      { columnName: "ROOM", dataType: "nvarchar(40)", groupOrder: 1,
        aggregateType: "NONE", isVisible: true },
      { columnName: "TOTAL", dataType: "bigint", groupOrder: null,
        aggregateType: "COUNT", isVisible: true },
    ]),
    getDashboardEvidence: async () => { trace.push("evidence"); return approval; },
    getRevisions: spies("revisions", {
      query: "c".repeat(16), dataset: "d".repeat(16),
    }),
    getVerifiedAggregate: async () => { trace.push("aggregate"); return null; },
  } as unknown as ChartFactsDependencies;
  return { deps, trace,
    revoke: () => { sessionActive = false; },
    unpublish: () => { isPublished = false; },
    disableDataSource: () => { dataSourceActive = false; },
    moveBinding: () => { queryId = 22; },
    changeApproval: () => { approval = "0".repeat(64); },
    changeAcl: () => { accessRevision = "1".repeat(64); },
    changePublic: () => { publicStatus = "STALE"; },
  };
}

test("read-only SQL candidate facts are loaded but cannot authorize without aggregate proof", async () => {
  const f = fixture();
  const read = createSqlChartFactsReader(f.deps);
  const result = await read(7, "PRIMARY", subject);
  assert(result);
  assert.equal(result.verifiedAggregate, null);
  assert.equal(result.query.id, 9);
  assert.equal(result.sensitivity.version, 2);
  assert.equal(result.publicDisplay, null);
  assert.equal(evaluateServerChartApproval(config, result, subject), null);
  assert(f.trace.includes("access"));
  assert(f.trace.includes("reports"));
  assert(!f.trace.includes("public"));
});
test("invalid source identity is refused before repository reads", async () => {
  const f = fixture(), read = createSqlChartFactsReader(f.deps);
  assert.equal(await read(0, "PRIMARY", subject), null);
  assert.equal(await read(7, "PRIMARY;DROP", subject), null);
  assert.equal(await read(7, "PRIMARY", { ...subject, userId: 0 }), null);
  assert.deepEqual(f.trace, []);
});
test("revoked JWT, unpublished Query or disabled datasource fail closed", async () => {
  for (const change of ["revoke", "unpublish", "disableDataSource"] as const) {
    const f = fixture(); f[change]();
    assert.equal(await createSqlChartFactsReader(f.deps)(7, "PRIMARY", subject), null);
  }
});
test("device cannot read candidates without a matching current device proof", async () => {
  const f = fixture(), read = createSqlChartFactsReader(f.deps);
  const actor: ExecutionSubject = { ...subject, context: "device", deviceId: 77 };
  assert.equal(await read(7, "PRIMARY", actor), null);
  assert.deepEqual(f.trace, []);
  assert.equal(await read(7, "PRIMARY", {
    ...actor, verifyDevice: async () => ({
      deviceId: 99, userId: 8, tokenVersion: 1, fingerprint: "synthetic",
    }),
  }), null);
  assert.deepEqual(f.trace, []);
});
test("public playback reads the public policy but does not bypass Query-only gate", async () => {
  const f = fixture(), read = createSqlChartFactsReader(f.deps);
  const actor: ExecutionSubject = { ...subject, context: "user",
    expiresAt: Math.floor(Date.now() / 1000) + 1200 };
  const candidate = await read(7, "PRIMARY", actor);
  assert(candidate);
  assert.equal(candidate.publicDisplay?.status, "CONFIRMED");
  // The stage is inactive and must not be usable by a public user.
  assert.equal(evaluateServerChartApproval(config, candidate, actor), null);
});
test("approval reader fails closed after evidence or ACL changes", async () => {
  const f = fixture(), original = f.deps.getReportColumns;
  f.deps.getReportColumns = async (...args) => {
    const result = await original(...args);
    f.changeApproval();
    return result;
  };
  assert.equal(await createSqlChartFactsReader(f.deps)(7, "PRIMARY", subject), null);
  const g = fixture(), old = g.deps.getReportColumns;
  g.deps.getReportColumns = async (...args) => {
    const result = await old(...args); g.changeAcl(); return result;
  };
  assert.equal(await createSqlChartFactsReader(g.deps)(7, "PRIMARY", subject), null);
});
test("missing versions, SQL errors and absent aggregate verifier never leak a chart approval", async () => {
  const f = fixture();
  f.deps.getRevisions = async () => null;
  assert.equal(await createSqlChartFactsReader(f.deps)(7, "PRIMARY", subject), null);
  const g = fixture();
  g.deps.getSensitivity = async () => { throw Error("DB_UNAVAILABLE"); };
  assert.equal(await createSqlChartFactsReader(g.deps)(7, "PRIMARY", subject), null);
  const h = fixture();
  h.deps.getVerifiedAggregate = async () => null;
  const candidate = await createSqlChartFactsReader(h.deps)(7, "PRIMARY", subject);
  assert(candidate);
  assert.equal(evaluateServerChartApproval(config, candidate, subject), null);
});
