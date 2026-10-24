import assert from "node:assert/strict";
import test from "node:test";
import sql from "mssql";
import { createDatasetColumnRepository } from "./column.repository.js";

const v = "0000000000000001";
function fixture() {
  const state = { columns: [{ name: "OLD", dataType: "int", ordinal: 0 }], rules: [] as string[], audits: 0 };
  let staged = structuredClone(state), checks = 0, authorizations = 0, rollbacks = 0;
  const control = { fault: "", parameters: false, definition: v, source: v, invalidVersionShape: false, parameterValidator: undefined as undefined | ((transaction: sql.Transaction) => Promise<void>) };
  const tx = {
    begin: async (isolation: number) => { assert.equal(isolation, sql.ISOLATION_LEVEL.SERIALIZABLE); staged = structuredClone(state); },
    commit: async () => { if (control.fault === "commit") throw new Error("synthetic-private-driver-message"); Object.assign(state, staged); },
    rollback: async () => { rollbacks++; if (control.fault === "rollback") throw new Error("synthetic-private-driver-message"); },
  };
  const repository = createDatasetColumnRepository({ getPool: async () => ({}) as sql.ConnectionPool,
    transaction: () => tx as unknown as sql.Transaction,
    request: () => {
      const values: Record<string, unknown> = {};
      return { input(name: string, _type: unknown, value: unknown) { values[name] = value; return this; },
        async query(text: string) {
          if (text === "SET XACT_ABORT ON") return { recordset: [] };
          if (text.includes("FROM uqp.Dataset d")) { checks++; return { recordset: [{ DefinitionVersion: control.invalidVersionShape ? control.definition : Buffer.from(control.definition, "hex"), ConfigurationVersion: Buffer.from(control.source, "hex") }] }; }
          if (text.includes("FROM uqp.DatasetParameter")) return { recordset: control.parameters ? [{ Id: 1 }] : [] };
          if (text.includes("FROM uqp.DatasetSensitiveColumn")) return { recordset: staged.rules.map(ColumnName => ({ ColumnName })) };
          if (text.startsWith("DELETE FROM uqp.DatasetColumn")) staged.columns = [];
          else if (text.startsWith("INSERT INTO uqp.DatasetColumn")) {
            if (control.fault === "insert") throw new Error("synthetic-private-driver-message");
            staged.columns.push({ name: String(values.columnName), dataType: String(values.dataType), ordinal: Number(values.ordinal) });
          } else if (text.startsWith("INSERT INTO uqp.AuditLog")) {
            if (control.fault === "audit") throw new Error("synthetic-private-driver-message");
            assert.doesNotMatch(String(values.details), /SELECT|secret/); staged.audits++;
          } else throw new Error("unexpected table write");
          return { recordset: [] };
        },
      } as unknown as sql.Request;
    },
  });
  const sync = (columns = [{ name: "FIELD", dataType: "nvarchar(30)" }]) => repository.syncDatasetColumns(7, columns, {
    dataSourceId: 11, definitionVersion: v, configurationVersion: v, userId: 2, revalidateParameters: control.parameterValidator,
    reauthorize: async passed => {
      assert.equal(passed, tx); authorizations++;
      if (control.fault === "authorization" || control.fault === "late-authorization" && authorizations > 1) throw new Error("revoked");
      if (control.fault === "rollback") throw new Error("failure-before-rollback");
    },
  });
  return { state, control, sync, get checks() { return checks; }, get rollbacks() { return rollbacks; } };
}

test("metadata-only sync persists ordered options and mandatory audit together without creating policy or patient evidence", async () => {
  const f = fixture(); f.state.columns = [];
  await f.sync([{ name: "NAME", dataType: "nvarchar(30)" }, { name: "PHONE", dataType: "varchar(20)" }]);
  assert.deepEqual(f.state.columns.map(c => [c.name, c.ordinal]), [["NAME", 0], ["PHONE", 1]]);
  assert.equal(f.state.audits, 1); assert.equal(f.checks, 2); assert.deepEqual(f.state.rules, []);
  await f.sync([{ name: "NAME", dataType: "nvarchar(30)" }, { name: "PHONE", dataType: "varchar(20)" }]);
  assert.equal(f.state.columns.length, 2); assert.equal(f.state.audits, 2);
});
for (const fault of ["insert", "audit", "commit", "authorization", "late-authorization", "rollback"]) {
  test(`synthetic ${fault} failure never returns success or leaves partial columns/audit`, async () => {
    const f = fixture(); const before = structuredClone(f.state); f.control.fault = fault;
    await assert.rejects(f.sync(), { message: "DATASET_COLUMN_SYNC_FAILED" });
    assert.deepEqual(f.state, before); assert.equal(f.rollbacks, 1);
  });
}
for (const kind of ["definition", "source", "parameters"] as const) {
  test(`saved ${kind} drift refuses sync without writes`, async () => {
    const f = fixture(); const before = structuredClone(f.state);
    if (kind === "parameters") f.control.parameters = true; else f.control[kind] = "0000000000000002";
    await assert.rejects(f.sync(), /DATASET_COLUMN_SYNC_CONFLICT/); assert.deepEqual(f.state, before);
  });
}
test("sync preserves existing masks and refuses disappearing aliases", async () => {
  const f = fixture(); f.state.rules = ["OLD"]; const before = structuredClone(f.state);
  await assert.rejects(f.sync(), /DATASET_SENSITIVITY_COLUMNS_STALE/); assert.deepEqual(f.state, before);
  await f.sync([{ name: "old", dataType: "int" }]); assert.deepEqual(f.state.rules, ["OLD"]);
});
test("empty, ambiguous or invalid field descriptions cannot replace a saved catalogue", async () => {
  const f = fixture();
  for (const columns of [[], [{ name: "A", dataType: "int" }, { name: "a", dataType: "int" }],
    [{ name: "", dataType: "int" }], [{ name: "A", dataType: "" }], [{ name: "A\n", dataType: "int" }]])
    await assert.rejects(f.sync(columns), /DATASET_COLUMN_SYNC_FAILED/);
  assert.equal(f.checks, 0);
});

test("version evidence must come from native binary(8), never coerced text or Number", async () => {
  const f = fixture(); f.control.invalidVersionShape = true;
  const before = structuredClone(f.state);
  await assert.rejects(f.sync(), /DATASET_COLUMN_SYNC_CONFLICT/); assert.deepEqual(f.state, before);
});

test("parameterized sync requires the captured definition validator in the same owner and rejects late drift atomically", async () => {
  const f = fixture(); f.control.parameters = true;
  let validations = 0;
  f.control.parameterValidator = async transaction => { assert.ok(transaction); validations++; };
  await f.sync(); assert.equal(validations, 2);
  const before = structuredClone(f.state);
  f.control.parameterValidator = async () => { if (++validations === 4) throw new Error("SYNTHETIC_PARAMETER_DRIFT"); };
  await assert.rejects(f.sync([{ name: "NEW", dataType: "int" }]), /DATASET_COLUMN_SYNC_FAILED/);
  assert.deepEqual(f.state, before);
});
