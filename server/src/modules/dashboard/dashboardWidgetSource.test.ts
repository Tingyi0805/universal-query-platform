import assert from "node:assert/strict";
import test from "node:test";
import { resolveWidgetDataSourceKey, validateWidgetDataSources } from "./dashboardWidgetSource.js";

test("preserves existing single-query layouts", () => {
  assert.equal(resolveWidgetDataSourceKey({}), "PRIMARY");
  assert.equal(resolveWidgetDataSourceKey({ dataSourceKey: "PRIMARY" }), "PRIMARY");
  assert.deepEqual(validateWidgetDataSources([{ widgets: [
    { widgetType: "FIELD", config: {} },
    { widgetType: "TABLE", config: { dataSourceKey: "PRIMARY" } },
  ] }], []), { valid: true });
});

test("accepts configured supplemental sources only", () => {
  const profiles = [{ widgets: [{ widgetType: "FIELD", config: { dataSourceKey: "CLINIC" } }] }];
  assert.deepEqual(validateWidgetDataSources(profiles, ["CLINIC"]), { valid: true });
  assert.deepEqual(validateWidgetDataSources(profiles, ["WAITING"]), { valid: false, sourceKey: "CLINIC" });
});

test("rejects malformed source keys", () => {
  for (const value of ["../secret", "a.b", " ", 5, {}, "x".repeat(65)]) {
    assert.equal(resolveWidgetDataSourceKey({ dataSourceKey: value }), "INVALID");
  }
  assert.deepEqual(validateWidgetDataSources([{ widgets: [
    { widgetType: "TABLE", config: { dataSourceKey: "../secret" } },
  ] }], ["CLINIC"]), { valid: false, sourceKey: "INVALID" });
});
