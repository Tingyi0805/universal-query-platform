import assert from "node:assert/strict";
import test from "node:test";
import {
  assessCredentialRevocationScope,
  credentialLegacyScopePolicy,
  isolatedOperatorGenerationOverflowPredicate,
} from "./workstationCredentialScopePolicy.js";

const valid = { workstationId: "9007199254740993",
  credentialId: "f0a14a4d-870b-4379-82b0-cc4d2d1c21ad", expectedGeneration: "1" };

test("credential cannot implicitly revoke unrelated legacy workstation sessions", () => {
  assert.equal(assessCredentialRevocationScope(valid).reason, "UNMAPPED_LEGACY_SESSIONS");
  assert.equal(assessCredentialRevocationScope(valid).eligible, false);
  assert.equal(credentialLegacyScopePolicy.legacyWorkstationWideRevokeAllowed, false);
  assert.equal(credentialLegacyScopePolicy.releaseEnabled, false);
});
test("malformed identifiers and generation overflow fail closed", () => {
  for (const scope of [
    { ...valid, workstationId: "9223372036854775808" },
    { ...valid, workstationId: "01" },
    { ...valid, credentialId: "bad" },
  ]) assert.equal(assessCredentialRevocationScope(scope).reason, "UNKNOWN_SCOPE");
  for (const expectedGeneration of ["9223372036854775807", "9223372036854775808", "-1", "01"]) {
    assert.equal(assessCredentialRevocationScope({ ...valid, expectedGeneration }).reason, "UNVERIFIED_GENERATION");
  }
  assert.match(isolatedOperatorGenerationOverflowPredicate, /Generation < CONVERT\(BIGINT/u);
});
