import assert from "node:assert/strict";
import test from "node:test";
import { applyDatasetDeliveryPolicy } from "./datasetDeliveryPolicy.js";
import {
  LegacyMaskConversionError,
  planLegacyDatasetMaskConversion,
  type LegacyDashboardMaskRule,
  type LegacyDatasetMaskRule,
} from "./datasetLegacyMaskConversion.js";

const rule = (columnName: string, mode: string, customMask?: { prefix: number; suffix: number; symbol: string }): LegacyDatasetMaskRule => ({
  columnName,
  sensitivityType: "OTHER",
  mode,
  ...(customMask ? { customMask } : {}),
});
const approvalVersion = "a".repeat(64);
const dashboardPolicy = (dashboardId: number, rules: readonly LegacyDashboardMaskRule[], version = approvalVersion) => ({
  dashboardId, version, expectedVersion: version, rules,
});

const plan = (rules: readonly LegacyDatasetMaskRule[], extra: Record<string, unknown> = {}) =>
  planLegacyDatasetMaskConversion({ sourceVersion: "8", expectedVersion: "8", rules, dashboardPolicies: [], ...extra });

test("converts every legacy mode only to CUSTOM, OMIT, or an unset rule", () => {
  const custom = { prefix: 1, suffix: 2, symbol: "*" };
  const result = plan([
    rule("none", "NONE"), rule("name", "NAME"), rule("mrn", "MRN"), rule("phone", "PHONE"),
    rule("generic", "GENERIC"), rule("full", "FULL"), rule("omit", "OMIT"), rule("custom", "CUSTOM", custom),
  ]);
  assert.equal(result.status, "READY");
  assert.deepEqual(result.impacts.map((impact) => [impact.fromMode, impact.toMode]), [
    ["NONE", "UNSET"], ["NAME", "CUSTOM"], ["MRN", "OMIT"], ["PHONE", "OMIT"],
    ["GENERIC", "CUSTOM"], ["FULL", "OMIT"], ["OMIT", "OMIT"], ["CUSTOM", "CUSTOM"],
  ]);
  assert.deepEqual(result.convertedRules?.map((item) => item.mode), ["CUSTOM", "OMIT", "OMIT", "CUSTOM", "OMIT", "OMIT", "CUSTOM"]);
  assert.deepEqual(result.convertedRules?.find((item) => item.columnName === "custom")?.customMask, custom);
});

test("uses conservative Unicode-safe conversions for short, Chinese, emoji, empty, and special values", () => {
  const result = plan([rule("NAME", "NAME"), rule("MRN", "MRN"), rule("PHONE", "PHONE"), rule("GENERIC", "GENERIC")]);
  assert.equal(result.status, "READY");
  const policy = { state: "CONFIRMED" as const, version: "8", rules: result.convertedRules! };
  const values = ["", "A", "甲乙", "甲乙丙丁", "😀🧪🌐🚀", "!@#$%^&*"];
  for (const value of values) {
    const output = applyDatasetDeliveryPolicy({
      policy,
      columns: [{ name: "NAME" }, { name: "MRN" }, { name: "PHONE" }, { name: "GENERIC" }],
      rows: [{ NAME: value, MRN: value, PHONE: value, GENERIC: value }],
    });
    assert.deepEqual(Object.keys(output.rows[0]!), ["NAME", "GENERIC"]);
  }
  assert.deepEqual(applyDatasetDeliveryPolicy({
    policy,
    columns: [{ name: "NAME" }, { name: "MRN" }, { name: "PHONE" }, { name: "GENERIC" }],
    rows: [{ NAME: null, MRN: null, PHONE: null, GENERIC: null }],
  }).rows, [{ NAME: null, GENERIC: null }]);
});

test("FULL converts to OMIT and review output does not reveal raw values or original length", () => {
  const secret = "synthetic-private-identifier-123456789";
  const result = plan([rule("SECRET", "FULL")]);
  assert.deepEqual(result.convertedRules, [{ columnName: "SECRET", sensitivityType: "OTHER", mode: "OMIT" }]);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes("length"), false);
});

test("blocks automatic conversion when a Dashboard rule is stricter", () => {
  const result = plan([rule("NAME", "NAME"), rule("ROOM", "NONE"), rule("SHORT", "NAME")], {
    dashboardPolicies: [dashboardPolicy(11, [
      { sourceKey: "PRIMARY", columnName: "NAME", mode: "OMIT" },
      { sourceKey: "PRIMARY", columnName: "ROOM", mode: "FULL" },
      { sourceKey: "PRIMARY", columnName: "SHORT", mode: "MRN" },
    ])],
  });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.convertedRules, null);
  assert.equal(result.blockers.length, 3);
  assert.ok(result.blockers.every((blocker) => blocker.reason === "DASHBOARD_POLICY_STRONGER"));
});

test("accepts Dashboard rules that are inherited, equal, or weaker", () => {
  const result = plan([rule("NAME", "NAME"), rule("SECRET", "FULL"), rule("ROOM", "NONE")], {
    dashboardPolicies: [dashboardPolicy(12, [
      { sourceKey: "PRIMARY", columnName: "NAME", mode: "INHERIT" },
      { sourceKey: "PRIMARY", columnName: "SECRET", mode: "OMIT" },
      { sourceKey: "PRIMARY", columnName: "ROOM", mode: "NONE" },
    ])],
  });
  assert.equal(result.status, "READY");
  assert.deepEqual(result.blockers, []);
});

test("preserves inherited Dataset CUSTOM and blocks orphan Dashboard CUSTOM as fail-closed OMIT", () => {
  const custom = { prefix: 1, suffix: 1, symbol: "#" };
  assert.equal(plan([rule("NAME", "CUSTOM", custom)], {
    dashboardPolicies: [dashboardPolicy(1, [{ sourceKey: "PRIMARY", columnName: "NAME", mode: "CUSTOM" }])],
  }).status, "READY");
  assert.equal(plan([], {
    dashboardPolicies: [dashboardPolicy(1, [{ sourceKey: "PRIMARY", columnName: "NAME", mode: "CUSTOM" }])],
  }).status, "BLOCKED");
});

test("rejects unknown modes, invalid CUSTOM settings, and stale custom settings on other modes", () => {
  const invalid = [
    [rule("A", "UNKNOWN")],
    [rule("A", "CUSTOM")],
    [rule("A", "CUSTOM", { prefix: -1, suffix: 1, symbol: "*" })],
    [rule("A", "CUSTOM", { prefix: 1, suffix: 1, symbol: "**" })],
    [{ ...rule("A", "OMIT"), customMask: { prefix: 0, suffix: 0, symbol: "*" } }],
    [{ ...rule("A", "NONE"), sensitivityType: "NAME" }],
  ];
  for (const rules of invalid) assert.throws(() => plan(rules), { code: "DATASET_LEGACY_POLICY_INVALID" });
});

test("rejects case-insensitive duplicate Dataset and Dashboard fields as a whole", () => {
  assert.throws(() => plan([rule("MRN", "OMIT"), rule("mrn", "OMIT")]), { code: "DATASET_LEGACY_POLICY_INVALID" });
  assert.throws(() => plan([rule("MRN", "OMIT")], { dashboardPolicies: [dashboardPolicy(1, [
    { sourceKey: "PRIMARY", columnName: "MRN", mode: "OMIT" },
    { sourceKey: "primary", columnName: "mrn", mode: "OMIT" },
  ])] }), { code: "DATASET_LEGACY_POLICY_INVALID" });
});

test("requires opaque trusted versions and rejects stale A-to-B-to-A evidence", () => {
  for (const sourceVersion of ["", "0", "01", "1.5", "unsafe"]) {
    assert.throws(() => planLegacyDatasetMaskConversion({ sourceVersion, expectedVersion: sourceVersion, rules: [], dashboardPolicies: [] }), {
      code: "DATASET_LEGACY_POLICY_INVALID",
    });
  }
  assert.throws(() => planLegacyDatasetMaskConversion({
    sourceVersion: "10",
    expectedVersion: "8",
    rules: [rule("NAME", "NAME")],
    dashboardPolicies: [],
  }), { code: "DATASET_LEGACY_POLICY_VERSION_CONFLICT" });
  assert.throws(() => plan([rule("NAME", "NAME")], { dashboardPolicies: [{
    ...dashboardPolicy(1, []), expectedVersion: "b".repeat(64),
  }] }), { code: "DATASET_LEGACY_POLICY_VERSION_CONFLICT" });
});

test("does not infer sensitivity from column names", () => {
  const result = plan([rule("姓名", "NONE"), rule("not_sensitive", "NAME"), rule("medical_record_number", "OMIT")]);
  assert.deepEqual(result.impacts.map(({ columnName, toMode }) => [columnName, toMode]), [
    ["姓名", "UNSET"], ["not_sensitive", "CUSTOM"], ["medical_record_number", "OMIT"],
  ]);
});

test("does not mutate frozen rules or Dashboard review input", () => {
  const custom = Object.freeze({ prefix: 1, suffix: 1, symbol: "*" });
  const rules = Object.freeze([Object.freeze(rule("NAME", "CUSTOM", custom))]);
  const dashboardPolicies = Object.freeze([Object.freeze(dashboardPolicy(2,
    Object.freeze([Object.freeze({ sourceKey: "PRIMARY", columnName: "NAME", mode: "INHERIT" })]))) ]);
  const before = JSON.stringify({ rules, dashboardPolicies });
  const result = planLegacyDatasetMaskConversion({ sourceVersion: "8", expectedVersion: "8", rules, dashboardPolicies });
  assert.equal(JSON.stringify({ rules, dashboardPolicies }), before);
  assert.notEqual(result.convertedRules?.[0]?.customMask, custom);
});

test("errors and impact output never contain row data", () => {
  const secret = "synthetic-patient-record";
  assert.throws(() => plan([rule("A", "CUSTOM", { prefix: 1, suffix: 1, symbol: secret })]), (error) => {
    assert.ok(error instanceof LegacyMaskConversionError);
    assert.equal(error.message.includes(secret), false);
    return true;
  });
  const output = plan([rule("A", "NAME")]);
  assert.equal(JSON.stringify(output).includes(secret), false);
});
