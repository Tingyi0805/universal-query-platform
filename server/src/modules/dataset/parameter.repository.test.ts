import assert from "node:assert/strict";
import test from "node:test";
import { parameterFixture, syntheticParameter, rawParameter } from "./parameterTestFixture.js";
import { parameterPreview } from "./parameterSync.js";
async function token(f: ReturnType<typeof parameterFixture>) {
  return parameterPreview(2, f.state.sqlText, await f.repository.listDatasetParameters(2)).previewToken;
}
test("read only lists settings unchanged without transactions or writes", async () => {
  const f = parameterFixture();
  assert.deepEqual(await f.repository.listDatasetParameters(2), [syntheticParameter]);
  assert.equal(f.state.transactions, 0);
  assert.ok(f.state.queries.every(q => /^\s*SELECT/.test(q)));
});
test("explicit additive sync preserves all existing settings, ID, ordering and custom columns", async () => {
  const original = { ...rawParameter(syntheticParameter), CustomFutureProperty: "preserve" };
  const f = parameterFixture(undefined, [original]);
  await f.repository.syncDatasetParameters(2, await token(f), [], 5);
  assert.deepEqual(f.state.rows[0], original);
  assert.equal(f.state.rows[1]!.Name, "NEW");
  assert.equal(f.state.rows[1]!.DisplayOrder, 8);
  assert.equal(f.state.snapshots, 1); assert.equal(f.state.commits, 1);
  assert.ok(!f.state.queries.some(q => q.includes("DELETE FROM uqp.DatasetParameter")));
});
test("unused and zero-detection parameters survive sync", async () => {
  for (const sql of ["SELECT 1", "SELECT {{NEW}}"] ) {
    const f = parameterFixture(sql);
    await f.repository.syncDatasetParameters(2, await token(f));
    assert.deepEqual(f.state.rows[0], rawParameter(syntheticParameter));
    assert.ok(!f.state.queries.some(q => q.includes("DELETE FROM uqp.DatasetParameter")));
  }
});
test("parse failure and empty detections never authorize removals", async () => {
  for (const sql of ["SELECT {{broken}}", "SELECT {{WARD", "SELECT 1"]) {
    const f = parameterFixture(sql);
    await assert.rejects(f.repository.syncDatasetParameters(2, await token(f), ["WARD"]), /PARAMETER_(PARSE_FAILED|REMOVAL_INVALID)/);
    assert.deepEqual(f.state.rows, [rawParameter(syntheticParameter)]);
    assert.equal(f.state.commits, 0); assert.equal(f.state.rollbacks, 1);
    assert.ok(!f.state.queries.some(q => /INSERT|DELETE|UPDATE uqp.DatasetParameter/.test(q)));
  }
});
test("removals require an explicit unused name from a current nonempty preview", async () => {
  const f = parameterFixture("SELECT {{NEW}}");
  await assert.rejects(f.repository.syncDatasetParameters(2, await token(f), ["NEW"]), /PARAMETER_REMOVAL_INVALID/);
  await f.repository.syncDatasetParameters(2, await token(f), ["WARD"]);
  assert.deepEqual(f.state.rows.map(row => row.Name), ["NEW"]);
});
test("SQL or setting changes invalidate the preview before any write", async () => {
  for (const change of [(f: ReturnType<typeof parameterFixture>) => { f.state.sqlText = "SELECT {{NEW}}"; },
    (f: ReturnType<typeof parameterFixture>) => { f.state.rows[0]!.Label = "changed"; }]) {
    const f = parameterFixture(); const previewToken = await token(f); change(f);
    await assert.rejects(f.repository.syncDatasetParameters(2, previewToken), /PARAMETER_PREVIEW_STALE/);
    assert.ok(!f.state.queries.some(q => /INSERT|DELETE|UPDATE/.test(q)));
  }
});
test("failed insert/removal/unpublish rolls back all changes and preserves original errors", async () => {
  for (const failOn of ["INSERT INTO", "DELETE FROM", "UPDATE uqp.QueryDefinition"]) {
    const f = parameterFixture("SELECT {{NEW}}"); const original = structuredClone(f.state.rows);
    f.state.failOn = failOn; f.state.failRollback = failOn === "INSERT INTO";
    await assert.rejects(f.repository.syncDatasetParameters(2, await token(f), ["WARD"]), (error: any) => error.number === 229);
    assert.deepEqual(f.state.rows, original); assert.equal(f.state.commits, 0); assert.equal(f.state.rollbacks, 1);
  }
});
test("parameter save updates in place; omission/duplication/stale saves cannot delete settings", async () => {
  const f = parameterFixture("SELECT {{WARD}}");
  f.state.rows[0]!.CustomFutureProperty = "preserve";
  await f.repository.saveDatasetParameters(2, [{ ...syntheticParameter, label: "updated" }], 5, await token(f));
  assert.equal(f.state.rows[0]!.Id, 10); assert.equal(f.state.rows[0]!.CustomFutureProperty, "preserve");
  assert.equal(f.state.rows[0]!.Label, "updated");
  for (const parameters of [[], [syntheticParameter, syntheticParameter]]) {
    await assert.rejects(f.repository.saveDatasetParameters(2, parameters, 5, await token(f)), /PARAMETER_DEFINITION_MISMATCH/);
  }
  await assert.rejects(f.repository.saveDatasetParameters(2, [syntheticParameter], 5, "0".repeat(64)), /PARAMETER_PREVIEW_STALE/);
  assert.ok(!f.state.queries.some(q => /DELETE|INSERT INTO uqp.DatasetParameter/.test(q)));
});
test("parameter save failures roll back and archived datasets cannot be changed", async () => {
  const f = parameterFixture(); const original = structuredClone(f.state.rows);
  f.state.failOn = "UPDATE uqp.DatasetParameter";
  await assert.rejects(f.repository.saveDatasetParameters(2, [syntheticParameter], 5, await token(f)));
  assert.deepEqual(f.state.rows, original); assert.equal(f.state.commits, 0);
  f.state.failOn = ""; f.state.archived = true;
  await assert.rejects(f.repository.syncDatasetParameters(2, await token(f)), /DATASET_ARCHIVED/);
});

test("sync cannot exceed parameter count or display-order bounds without changing rows", async () => {
  for (const mode of ["count", "order"]) {
    const rows = mode === "count" ? Array.from({ length: 100 }, (_, i) => rawParameter({ ...syntheticParameter, id: i + 1, name: `OLD_${i}` }))
      : [rawParameter({ ...syntheticParameter, displayOrder: 10000 })];
    const f = parameterFixture("SELECT {{NEW}}", rows);
    await assert.rejects(f.repository.syncDatasetParameters(2, await token(f)), /PARAMETER_SYNC_LIMIT/);
    assert.deepEqual(f.state.rows, rows); assert.equal(f.state.commits, 0);
  }
});
