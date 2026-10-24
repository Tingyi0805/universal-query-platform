import assert from "node:assert/strict";
import test from "node:test";
import { suggestSensitivityRule } from "./sensitivitySuggestions";

test("known Dataset column aliases get advisory rules", () => {
  assert.deepEqual(suggestSensitivityRule(" mrn "), { label: "病歷號", mode: "CUSTOM", prefix: 0, suffix: 4, symbol: "*" });
  assert.equal(suggestSensitivityRule("姓名")?.mode, "CUSTOM");
  assert.equal(suggestSensitivityRule("NATIONAL_ID")?.mode, "OMIT");
});
test("unknown and potentially misleading names do not inherit any approval", () => {
  for (const name of ["NAME", "CODE", "PAT_NO", "DOCTOR_NAME", "", "A".repeat(257)]) assert.equal(suggestSensitivityRule(name), null);
});
