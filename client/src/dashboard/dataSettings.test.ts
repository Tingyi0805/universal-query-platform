import test from "node:test";
import assert from "node:assert/strict";
import { objectJson, queryParameterValues, maskAtLeastAsStrong, sourcePreviewFailure } from "./dataSettings";
test("parameter separation preserves reserved policies and complex legacy values", () => {
  const saved = { REGNO: "synthetic", LIST: [1, 2], LEGACY: { x: 1 }, deviceColumnMasks: { NAME: "FULL" }, deviceColumnTypes: { NAME: "NAME" }, snapshotKind: "OTHER", snapshotSeconds: 30 };
  const copy = structuredClone(saved);
  assert.deepEqual(queryParameterValues(saved), { REGNO: "synthetic", LIST: [1, 2], LEGACY: { x: 1 } }); assert.deepEqual(saved, copy);
  for (const invalid of ["null", "[]", "not JSON"]) assert.throws(() => objectJson(invalid));
});
test("mask UI never weakens or guesses equivalence of partial policies", () => {
  for (const mode of ["NAME", "MRN", "PHONE", "GENERIC", "CUSTOM", "FULL", "OMIT"]) assert.equal(maskAtLeastAsStrong("NONE", mode), false);
  for (const [next, current, expected] of [["MRN", "NAME", false], ["NAME", "CUSTOM", false], ["FULL", "OMIT", false], ["FULL", "CUSTOM", true], ["OMIT", "FULL", true], ["NAME", "NAME", true], ["NONE", "NONE", true], ["FULL", "unknown", false]] as const) assert.equal(maskAtLeastAsStrong(next, current), expected);
});
test("source diagnostics never expose driver messages or unsafe identifiers", () => {
  const secret = "SELECT patient password Bind Token";
  assert.match(sourcePreviewFailure("PRIMARY", { code: "PARAMETER_REQUIRED", message: secret }), /PRIMARY：PARAMETER_REQUIRED/);
  assert.match(sourcePreviewFailure("WARD", { code: "QUERY_SOURCE_QUERY_FORBIDDEN", message: secret }), /WARD：QUERY_SOURCE_QUERY_FORBIDDEN/);
  assert.match(sourcePreviewFailure(secret, { code: secret, message: secret }), /UNKNOWN：REQUEST_FAILED/);
  assert.ok(!sourcePreviewFailure("PRIMARY", new Error(secret)).includes(secret));
});
test("Dataset CUSTOM offers inheritance without duplicating custom data; OMIT can never be approved", async () => {
  const { datasetApprovalAllowed, inheritedMaskSample } = await import("./dataSettings");
  const rule = { sensitivityType: "MRN", deviceMaskMode: "CUSTOM", customMask: { prefix: 1, suffix: 2, symbol: "#" } };
  for (const mode of ["INHERIT", "FULL", "OMIT"]) assert.equal(datasetApprovalAllowed(mode, rule), true);
  for (const mode of ["NONE", "NAME", "MRN", "PHONE"]) assert.equal(datasetApprovalAllowed(mode, rule), false);
  assert.equal(inheritedMaskSample(rule), "0#######56");
  assert.equal(datasetApprovalAllowed("INHERIT", undefined), false);
  for (const mode of ["FULL", "NONE"]) assert.equal(datasetApprovalAllowed(mode, { sensitivityType: "HEALTH", deviceMaskMode: "OMIT" }), false);
  assert.equal(datasetApprovalAllowed("INHERIT", { sensitivityType: "HEALTH", deviceMaskMode: "OMIT" }), true);
  assert.equal(maskAtLeastAsStrong("INHERIT", "CUSTOM"), true);
});
