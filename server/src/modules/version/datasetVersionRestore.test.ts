import assert from "node:assert/strict";
import test from "node:test";
import sql from "mssql";
import { createDatasetVersionRestorer } from "./version.repository.js";

function fixture() {
  const snapshot = {
    dataset: { name: "synthetic-history", description: null, sqlText: "SELECT 'synthetic' AS NAME", dataSourceId: 3,
      maxRows: 50, queryTimeoutSec: 10, isActive: true },
    parameters: [{ name: "WARD", label: "synthetic", dataType: "STRING", controlType: "TEXT", isRequired: false,
      defaultValue: null, displayOrder: 0, placeholder: null, helpText: null, optionMode: "NONE",
      fixedOptionsJson: null, lookupDatasetId: null, lookupValueField: null, lookupLabelField: null }],
  };
  const original = {
    dataset: { Id: 2, IsArchived: false, SqlText: snapshot.dataset.sqlText, DataSourceId: 3, IsActive: true },
    rules: [{ ColumnName: "NAME", DeviceMaskMode: "NAME" }],
    patientConfig: { PatientKeyColumn: "SYNTHETIC_KEY", ConfigurationVersion: "7" },
    metadata: { DefinitionHash: "synthetic-proof" } as object | null,
    approvals: { primary: "synthetic-version-1", extra: "synthetic-version-2" },
    versions: [1, 2], parameters: ["ORIGINAL"], published: true,
  };
  const state = { saved: structuredClone(original), staged: structuredClone(original), queries: [] as string[],
    commits: 0, rollbacks: 0, snapshots: 0, invalidations: 0, failOn: "", missing: false, missingVersion: false };
  const tx = {
    begin: async (level: number) => { assert.equal(level, sql.ISOLATION_LEVEL.SERIALIZABLE); state.staged = structuredClone(state.saved); },
    commit: async () => { if (state.failOn === "commit") throw new Error("SYNTHETIC_COMMIT_FAILED"); state.saved = structuredClone(state.staged); state.commits++; },
    rollback: async () => { state.rollbacks++; state.staged = structuredClone(state.saved); },
  } as unknown as sql.Transaction;
  function request(parent: sql.Transaction) {
    assert.equal(parent, tx);
    const values: Record<string, unknown> = {};
    const r = {
      input(name: string, _type: unknown, value: unknown) { values[name] = value; return r; },
      async query(text: string) {
        state.queries.push(text);
        if (state.failOn && text.includes(state.failOn)) throw new Error("SYNTHETIC_TRANSACTION_FAILED");
        if (text.includes("FROM uqp.Dataset WITH")) {
          assert.match(text, /UPDLOCK, HOLDLOCK/);
          return { recordset: state.missing ? [] : [structuredClone(state.staged.dataset)] };
        }
        if (text.includes("SELECT SnapshotJson")) return { recordset: state.missingVersion ? [] : [{ SnapshotJson: JSON.stringify(snapshot) }] };
        if (text.includes("FROM uqp.DatasetSensitiveColumn")) {
          assert.match(text, /HOLDLOCK/);
          return { recordset: state.staged.rules };
        }
        if (text.includes("FROM uqp.DataSource")) return { recordset: [{ Id: 3 }] };
        if (text.includes("UPDATE uqp.Dataset")) {
          Object.assign(state.staged.dataset, { SqlText: values.sqlText, DataSourceId: values.dataSourceId,
            Name: values.name, IsActive: false });
        } else if (text.includes("DELETE FROM uqp.DatasetParameter")) state.staged.parameters = [];
        else if (text.includes("INSERT INTO uqp.DatasetParameter")) state.staged.parameters.push(String(values.name));
        else if (text.includes("UPDATE q")) state.staged.published = false;
        else throw new Error("UNEXPECTED_MOCK_QUERY");
        return { recordset: [] };
      },
    };
    return r as unknown as sql.Request;
  }
  const restore = createDatasetVersionRestorer({
    getPool: async () => ({}) as sql.ConnectionPool, createTransaction: () => tx, createRequest: request,
    snapshotVersion: async (parent, id, user, reason) => {
      assert.equal(parent, tx); assert.equal(id, 2); assert.equal(user, 5); assert.equal(reason, "RESTORE_FROM_V1");
      state.snapshots++; state.staged.versions.push(3); return 3;
    },
    invalidateMetadata: async parent => { assert.equal(parent, tx); state.invalidations++; state.staged.metadata = null; },
  });
  return { state, snapshot, restore: () => restore(2, 1, 5) };
}

for (const change of ["sql", "source", "whitespace"] as const) {
  test(`sensitive restore rejects changed ${change} before writes and preserves security/history`, async () => {
    const f = fixture();
    if (change === "source") f.snapshot.dataset.dataSourceId = 4;
    else f.snapshot.dataset.sqlText = change === "whitespace" ? f.snapshot.dataset.sqlText + " " : "SELECT 'different-expression' AS NAME";
    const before = structuredClone(f.state.saved);
    await assert.rejects(f.restore(), /DATASET_SENSITIVITY_REVIEW_REQUIRED/);
    assert.deepEqual(f.state.saved, before); assert.deepEqual(f.state.staged, before);
    assert.equal(f.state.snapshots, 0); assert.equal(f.state.invalidations, 0);
    assert.equal(f.state.commits, 0); assert.equal(f.state.rollbacks, 1);
    assert.ok(f.state.queries.every(q => /^\s*SELECT/.test(q)));
  });
}

test("same SQL/source permits restore and preserves rules/config/approvals", async () => {
  const f = fixture(); const before = structuredClone(f.state.saved);
  await f.restore();
  assert.equal(f.state.commits, 1); assert.equal(f.state.rollbacks, 0);
  assert.equal(f.state.saved.dataset.IsActive, false); assert.equal(f.state.saved.published, false);
  assert.deepEqual(f.state.saved.parameters, ["WARD"]); assert.deepEqual(f.state.saved.versions, [1, 2, 3]);
  assert.deepEqual(f.state.saved.rules, before.rules); assert.deepEqual(f.state.saved.patientConfig, before.patientConfig);
  assert.deepEqual(f.state.saved.approvals, before.approvals);
  assert.equal(f.state.saved.metadata, null); // Existing restore invalidates former proof.
});

test("without sensitive rules changed SQL/source restore remains available", async () => {
  const f = fixture(); f.state.saved.rules = [];
  f.snapshot.dataset.sqlText = "SELECT 1 AS SYNTHETIC"; f.snapshot.dataset.dataSourceId = 4;
  await f.restore();
  assert.equal(f.state.saved.dataset.SqlText, f.snapshot.dataset.sqlText);
  assert.equal(f.state.saved.dataset.DataSourceId, 4); assert.equal(f.state.commits, 1);
});

test("policy read failure fails closed before snapshot/metadata or definition changes", async () => {
  const f = fixture(); f.snapshot.dataset.sqlText = "SELECT 1"; f.state.failOn = "FROM uqp.DatasetSensitiveColumn";
  const before = structuredClone(f.state.saved);
  await assert.rejects(f.restore(), /SYNTHETIC_TRANSACTION_FAILED/);
  assert.deepEqual(f.state.saved, before); assert.equal(f.state.snapshots, 0); assert.equal(f.state.invalidations, 0);
  assert.equal(f.state.rollbacks, 1); assert.equal(f.state.commits, 0);
});

test("update, parameter, unpublish and commit failures roll back definition, history and proof", async () => {
  for (const failOn of ["UPDATE uqp.Dataset", "INSERT INTO uqp.DatasetParameter", "UPDATE q", "commit"]) {
    const f = fixture(); const before = structuredClone(f.state.saved); f.state.failOn = failOn;
    await assert.rejects(f.restore(), /SYNTHETIC_(TRANSACTION|COMMIT)_FAILED/);
    assert.deepEqual(f.state.saved, before); assert.deepEqual(f.state.staged, before);
    assert.equal(f.state.snapshots, 1); assert.equal(f.state.invalidations, 1);
    assert.equal(f.state.commits, 0); assert.equal(f.state.rollbacks, 1);
  }
});

test("missing dataset/version and archived dataset refuse with no writes", async () => {
  for (const mode of ["dataset", "version", "archived"]) {
    const f = fixture(); f.state.missing = mode === "dataset"; f.state.missingVersion = mode === "version";
    f.state.saved.dataset.IsArchived = mode === "archived";
    await assert.rejects(f.restore(), new RegExp(mode === "dataset" ? "DATASET_NOT_FOUND" : mode === "version" ? "DATASET_VERSION_NOT_FOUND" : "DATASET_ARCHIVED"));
    assert.equal(f.state.snapshots, 0); assert.equal(f.state.invalidations, 0); assert.equal(f.state.commits, 0);
    assert.equal(f.state.rollbacks, 1);
  }
});
