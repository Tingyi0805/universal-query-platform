import assert from "node:assert/strict";
import test from "node:test";
import sql from "mssql";
import { createDatasetUpdater } from "./dataset.repository.js";
import { syntheticParameter } from "./parameterTestFixture.js";
import type { DatasetInput } from "./dataset.types.js";

const base = 'SELECT A.NAME AS NAME, A.MRN AS MRN FROM SYNTHETIC_OPERATIONS A';
const filtered = `${base} WHERE A.APP_DATE BETWEEN {{S_DATE}} AND {{EXAM_DATE}}`;
function fixture() {
  const original = { SqlText: base, DataSourceId: 3, IsArchived: false,
    rules: [{ ColumnName: "NAME", SensitivityType: "NAME", DeviceMaskMode: "FULL" }], policyVersion: 7,
    approvals: { PRIMARY: "unchanged", EXTRA: "unchanged" }, parameters: { WARD: "unchanged" },
    versions: [1], metadata: { hash: "old-proof" } as object | null, published: true, audits: [] as object[] };
  const state = { saved: structuredClone(original), staged: structuredClone(original), queries: [] as string[],
    primary: [] as { ParametersJson: string }[], extra: [] as { ParametersJson: string }[], lookups: false,
    definitions: ["S_DATE", "EXAM_DATE"].map(name => ({ ...syntheticParameter, name, dataType: "DATE" as const,
      controlType: "DATE" as const, defaultValue: "2026-10-27" as string | null })),
    failure: "", deadlock: false, commits: 0, rollbacks: 0, snapshots: 0, invalidations: 0 };
  const fail = (stage: string) => {
    if (state.failure === stage) throw Object.assign(new Error(`FAILED_${stage}`), state.deadlock ? { number: 1205 } : {});
  };
  const tx = { begin: async (level: number) => { assert.equal(level, sql.ISOLATION_LEVEL.SERIALIZABLE); state.staged = structuredClone(state.saved); },
    commit: async () => { fail("commit"); state.saved = structuredClone(state.staged); state.commits++; },
    rollback: async () => { state.rollbacks++; state.staged = structuredClone(state.saved); } } as unknown as sql.Transaction;
  const request = (parent: sql.Transaction) => {
    assert.equal(parent, tx);
    const values: Record<string, unknown> = {};
    const r = { input(name: string, _type: unknown, value: unknown) { values[name] = value; return r; },
      async query(text: string) {
        state.queries.push(text);
        if (text.includes("FROM uqp.Dataset WITH")) {
          assert.match(text, /UPDLOCK, HOLDLOCK/); fail("read"); return { recordset: [structuredClone(state.staged)] };
        }
        if (text.includes("FROM uqp.DatasetSensitiveColumn")) {
          assert.match(text, /HOLDLOCK/); fail("rules"); return { recordset: state.staged.rules };
        }
        if (text.includes("OBJECT_ID(N'uqp.DashboardDataSource'")) {
          assert.match(text, /ds.DatasetId=@id OR q.DatasetId=@id/); assert.match(text, /HOLDLOCK/);
          fail("extra"); return { recordset: state.extra };
        }
        if (text.includes("FROM uqp.Dashboard d")) { assert.match(text, /HOLDLOCK/); fail("primary"); return { recordset: state.primary }; }
        if (text.includes("LookupDatasetId=@id")) { assert.match(text, /HOLDLOCK/); fail("lookups"); return { recordset: state.lookups ? [{ DatasetId: 9 }] : [] }; }
        if (text.includes("UPDATE uqp.Dataset")) {
          fail("update"); state.staged.SqlText = String(values.sqlText); state.staged.DataSourceId = Number(values.dataSourceId);
          return { recordset: [{ Affected: 1 }] };
        }
        if (text.includes("UPDATE uqp.QueryDefinition")) { fail("unpublish"); state.staged.published = false; return { recordset: [] }; }
        throw new Error("UNEXPECTED_QUERY");
      } };
    return r as unknown as sql.Request;
  };
  const update = createDatasetUpdater({ getPool: async () => ({}) as sql.ConnectionPool, createTransaction: () => tx, createRequest: request,
    snapshotVersion: async (parent, id, user, reason) => {
      assert.equal(parent, tx); assert.equal(id, 2); assert.equal(user, 5); assert.equal(reason, "DATASET_UPDATE");
      fail("snapshot"); state.snapshots++; state.staged.versions.push(2); return 2;
    },
    invalidateMetadata: async parent => { assert.equal(parent, tx); fail("invalidate"); state.invalidations++; state.staged.metadata = null; },
    listParameters: async (_id, parent) => { assert.equal(parent, tx); fail("parameters"); return structuredClone(state.definitions); },
    audit: async (input, parent) => {
      assert.equal(parent, tx); fail("audit");
      assert.equal(input.eventType, "DATASET_SQL_FILTER_UPDATED"); assert.equal(input.userId, 5); assert.equal(input.datasetId, 2);
      assert.equal(input.ipAddress, "192.0.2.1"); assert.equal(input.userAgent, "synthetic-agent");
      assert.deepEqual(input.parameters, { proof: "ROW_FILTER_REFINEMENT" });
      assert.ok(!JSON.stringify(input).includes("SYNTHETIC_OPERATIONS"));
      state.staged.audits.push(input); return 99;
    },
  });
  const input: DatasetInput = { code: "OR_001", name: "Synthetic", description: null, dataSourceId: 3,
    sqlText: filtered, maxRows: 100, queryTimeoutSec: 10, isActive: true };
  return { state, input, save: (user = 5) => update(2, input, user, { ipAddress: "192.0.2.1", userAgent: "synthetic-agent" }) };
}
test("allows filter-only save atomically; retains policy versions, Dashboard approvals and parameter settings", async () => {
  const f = fixture(), before = structuredClone(f.state.saved);
  await f.save();
  assert.equal(f.state.saved.SqlText, filtered); assert.equal(f.state.commits, 1); assert.equal(f.state.rollbacks, 0);
  for (const name of ["rules", "policyVersion", "approvals", "parameters"] as const) assert.deepEqual(f.state.saved[name], before[name]);
  assert.deepEqual(f.state.saved.versions, [1, 2]); assert.equal(f.state.saved.audits.length, 1);
  assert.equal(f.state.saved.published, false); assert.equal(f.state.saved.metadata, null);
});
for (const source of ["primary", "extra"] as const) {
  test(`allows ${source} Dashboard with saved parameter defaults`, async () => {
    const f = fixture(); f.state[source] = [{ ParametersJson: "{}" }]; await f.save(); assert.equal(f.state.commits, 1);
  });
  test(`allows ${source} Dashboard with explicit valid parameters`, async () => {
    const f = fixture(); f.state[source] = [{ ParametersJson: '{"S_DATE":"2026-10-26","EXAM_DATE":"2026-10-27"}' }];
    f.state.definitions.forEach(p => { p.defaultValue = null; }); await f.save(); assert.equal(f.state.commits, 1);
  });
  for (const failure of ["missing definition", "required without default", "invalid date", "invalid JSON", "array JSON"] as const)
    test(`refuses ${source} Dashboard ${failure}`, async () => {
      const f = fixture(); f.state[source] = [{ ParametersJson: "{}" }];
      if (failure === "missing definition") f.state.definitions.pop();
      if (failure === "required without default") f.state.definitions[0]!.defaultValue = null;
      if (failure === "invalid date") { f.state.definitions.forEach(p => { p.dateOutputMode = "NATIVE"; }); f.state[source][0]!.ParametersJson = '{"S_DATE":"2026-02-30"}'; }
      if (failure === "invalid JSON") f.state[source][0]!.ParametersJson = "{";
      if (failure === "array JSON") f.state[source][0]!.ParametersJson = "[]";
      const before = structuredClone(f.state.saved);
      await assert.rejects(f.save(), /DATASET_SENSITIVITY_REVIEW_REQUIRED/);
      assert.deepEqual(f.state.saved, before); assert.equal(f.state.snapshots, 0); assert.equal(f.state.invalidations, 0);
    });
}
test("lookup dependencies require saved defaults without Dashboard caller parameters", async () => {
  const f = fixture(); f.state.lookups = true; await f.save(); assert.equal(f.state.commits, 1);
  const blocked = fixture(); blocked.state.lookups = true; blocked.state.definitions[0]!.defaultValue = null;
  await assert.rejects(blocked.save(), /DATASET_SENSITIVITY_REVIEW_REQUIRED/); assert.equal(blocked.state.snapshots, 0);
});
for (const change of ["source", "same alias different expression", "missing policy column", "missing actor"] as const)
  test(`refuses ${change} before any writes`, async () => {
    const f = fixture();
    if (change === "source") f.input.dataSourceId++;
    if (change === "same alias different expression") f.input.sqlText = filtered.replace("A.NAME AS NAME", "A.SECRET AS NAME");
    if (change === "missing policy column") f.state.saved.rules[0]!.ColumnName = "UNKNOWN";
    const before = structuredClone(f.state.saved);
    await assert.rejects(f.save(change === "missing actor" ? 0 : 5), /DATASET_SENSITIVITY_REVIEW_REQUIRED/);
    assert.deepEqual(f.state.saved, before); assert.equal(f.state.snapshots, 0); assert.equal(f.state.rollbacks, 1);
  });
test("stale client cannot remove a filter committed by another editor", async () => {
  const f = fixture(); await f.save(); const before = structuredClone(f.state.saved);
  f.input.sqlText = `${base} WHERE A.STATUS = 'A'`;
  await assert.rejects(f.save(), /DATASET_SENSITIVITY_REVIEW_REQUIRED/);
  assert.deepEqual(f.state.saved, before); assert.equal(f.state.commits, 1);
});
for (const stage of ["rules", "primary", "extra", "lookups", "parameters", "invalidate", "snapshot", "update", "unpublish", "audit", "commit"])
  test(`${stage} failure rolls back definition, history, metadata, publication and audit`, async () => {
    const f = fixture(); f.state.primary = [{ ParametersJson: "{}" }]; f.state.failure = stage;
    const before = structuredClone(f.state.saved);
    await assert.rejects(f.save(), stage === "parameters" ? /DATASET_SENSITIVITY_REVIEW_REQUIRED/ : new RegExp(`FAILED_${stage}`));
    assert.deepEqual(f.state.saved, before); assert.deepEqual(f.state.staged, before);
    assert.equal(f.state.commits, 0); assert.equal(f.state.rollbacks, 1);
  });
test("database concurrency conflict is preserved and cannot commit a success audit", async () => {
  const f = fixture(); f.state.failure = "update"; f.state.deadlock = true;
  await assert.rejects(f.save(), (e: any) => e.number === 1205); assert.equal(f.state.saved.audits.length, 0);
});
test("unchanged SQL display edit preserves prior behavior", async () => {
  const f = fixture(); f.input.sqlText = base; await f.save();
  assert.equal(f.state.invalidations, 0); assert.equal(f.state.saved.audits.length, 0); assert.equal(f.state.snapshots, 1);
});
test("without sensitivity rules, existing general SQL editing stays available", async () => {
  const f = fixture(); f.state.saved.rules = []; f.input.sqlText = "SELECT 1 AS SYNTHETIC"; await f.save();
  assert.equal(f.state.commits, 1); assert.equal(f.state.invalidations, 1);
});
test("archived definition rejects before snapshot", async () => {
  const f = fixture(); f.state.saved.IsArchived = true;
  await assert.rejects(f.save(), /DATASET_ARCHIVED/); assert.equal(f.state.snapshots, 0);
});
