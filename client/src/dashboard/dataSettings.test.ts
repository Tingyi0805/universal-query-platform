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
