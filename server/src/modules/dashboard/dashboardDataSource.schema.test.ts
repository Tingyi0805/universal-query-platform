import assert from "node:assert/strict";
import test from "node:test";
import { dashboardSourcesSchema } from "./dashboardDataSource.schema.js";
test("source configuration enforces bounded refresh/paging, reserved keys and source count", () => {
  const source = { sourceKey: "ORACLE", datasetId: 3 };
  assert.equal(dashboardSourcesSchema.safeParse({ sources: [source] }).success, true);
  for (const patch of [{ sourceKey: "PRIMARY" }, { sourceKey: "primary" }, { sourceKey: "INVALID-key" },
    { refreshSeconds: 4 }, { refreshSeconds: 3601 }, { pageSize: 0 }, { pageSize: 101 }, { pageSeconds: 4 },
    { pageSeconds: 3601 }, { datasetId: 0 }, { parameters: [] }]) {
    assert.equal(dashboardSourcesSchema.safeParse({ sources: [{ ...source, ...patch }] }).success, false);
  }
  assert.equal(dashboardSourcesSchema.safeParse({ sources: [source, { ...source, sourceKey: "oracle" }] }).success, false);
  assert.equal(dashboardSourcesSchema.safeParse({ sources: Array.from({ length: 9 }, (_, i) => ({ ...source, sourceKey: `SQL${i}` })) }).success, false);
});
