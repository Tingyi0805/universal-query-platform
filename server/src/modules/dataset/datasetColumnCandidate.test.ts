import assert from "node:assert/strict";
import test from "node:test";
import { createDatasetColumnCandidate } from "./datasetColumnCandidate.js";

const v = "0000000000000001";
function fixture() {
  const s = { datasetId: 7, dataSourceId: 11, sqlText: "SELECT 1 AS FIELD_A",
    definitionVersion: v, configurationVersion: v, datasetActive: true, datasetArchived: false,
    sourceActive: true, sourceType: "SQLSERVER" };
  let parameters: unknown[] = [], describes = 0, changed = false;
  const deps = {
    snapshot: async () => changed ? { ...s, definitionVersion: "0000000000000002" } : { ...s },
    parameters: async () => parameters as never,
    config: async () => ({ type: "SQLSERVER", isActive: true }) as never,
    describe: async () => {
      describes++;
      return { trust: "UNBOUND_CANDIDATE" as const, evidenceType: "SQLSERVER_DESCRIBE_FIRST_RESULT_SET" as const,
        requiresExecutionComparison: true as const,
        columns: [{ name: "FIELD_A", dataType: "int", ordinal: 1 }] };
    },
  };
  return { s, deps, get describes() { return describes; },
    setParameters(value: unknown[]) { parameters = value; }, change() { changed = true; },
    service: createDatasetColumnCandidate(deps) };
}

test("candidate describes only saved zero-parameter SQL and never gains delivery authority", async () => {
  const f = fixture(), ctx = await f.service.open(7), result = await ctx.describe();
  assert.equal(result.trust, "UNBOUND_CANDIDATE");
  assert.equal(result.requiresExecutionComparison, true);
  assert.equal(f.describes, 1);
  assert.deepEqual(result.columns, [{ name: "FIELD_A", dataType: "int", ordinal: 1 }]);
});

test("missing, inactive, archived or unsupported-source Dataset never reaches describe", async () => {
  for (const key of ["datasetActive", "datasetArchived", "sourceActive", "sourceType"] as const) {
    const f = fixture();
    (f.s as any)[key] = key === "datasetActive" || key === "sourceActive" ? false : key === "sourceType" ? "MYSQL" : true;
    await assert.rejects(f.service.open(7));
    assert.equal(f.describes, 0);
  }
});

test("saved parameters or SQL bind tokens fail closed before RPC", async () => {
  const f = fixture(); f.setParameters([{ name: "A" }]);
  await assert.rejects(f.service.open(7), { code: "DATASET_COLUMN_DESCRIPTION_UNSUPPORTED" });
  assert.equal(f.describes, 0);
  const g = fixture(); g.s.sqlText = "SELECT {{A}} AS FIELD_A";
  await assert.rejects(g.service.open(7), { code: "DATASET_COLUMN_DESCRIPTION_UNSUPPORTED" });
  assert.equal(g.describes, 0);
});

test("definition drift after opening prevents description", async () => {
  const f = fixture(); const ctx = await f.service.open(7); f.change();
  await assert.rejects(ctx.describe(), { code: "DATASET_COLUMN_DESCRIPTION_CONFLICT" });
  assert.equal(f.describes, 0);
});

test("description returns no raw SQL or rows", async () => {
  const f = fixture(); const result = await (await f.service.open(7)).describe();
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("SELECT")); assert.ok(!serialized.includes("rows"));
  assert.deepEqual(Object.keys(result).sort(), ["columns", "evidenceType", "requiresExecutionComparison", "trust"]);
});

test("Oracle zero-bind metadata uses the existing statement-info contract and remains unbound", async () => {
  const f = fixture(); f.s.sourceType = "ORACLE";
  f.deps.config = async () => ({ type: "ORACLE", isActive: true }) as never;
  f.deps.describe = async () => ({ trust: "UNBOUND_CANDIDATE", requiresExecutionComparison: true,
    evidenceType: "ORACLE_STATEMENT_INFO", columns: [{ name: "FIELD_A", dataType: "NUMBER", ordinal: 1 }] }) as never;
  const result = await (await f.service.open(7)).describe();
  assert.equal(result.evidenceType, "ORACLE_STATEMENT_INFO"); assert.equal(result.trust, "UNBOUND_CANDIDATE");
  f.s.sqlText = "SELECT {{A}} AS FIELD_A FROM DUAL";
  await assert.rejects(f.service.open(7), { code: "DATASET_COLUMN_DESCRIPTION_UNSUPPORTED" });
});
test("duplicate aliases, bad ordinals or oversize names/types fail before field synchronization", async () => {
  for (const columns of [
    [{ name: "A", dataType: "int", ordinal: 1 }, { name: "a", dataType: "int", ordinal: 2 }],
    [{ name: "A", dataType: "int", ordinal: 2 }],
    [{ name: "A".repeat(257), dataType: "int", ordinal: 1 }],
    [{ name: "A", dataType: "X".repeat(101), ordinal: 1 }],
  ]) {
    const f = fixture(); f.deps.describe = async () => ({ trust: "UNBOUND_CANDIDATE", requiresExecutionComparison: true,
      evidenceType: "SQLSERVER_DESCRIBE_FIRST_RESULT_SET", columns }) as never;
    await assert.rejects((await f.service.open(7)).describe(), { code: "DATASET_COLUMN_DESCRIPTION_INVALID_COLUMNS" });
  }
});
