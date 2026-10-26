import assert from "node:assert/strict";
import test from "node:test";
import { inspectIsolatedCredentialSql, credentialRevocationSqlAdmission } from "./workstationCredentialSqlAdmission.js";
import { isolatedSqlAdapterReleaseGate } from "./workstationRevocationSqlAdapter.js";

test("H0-5C-2H known SQL draft gaps remain release blockers", () => {
  const inspection = inspectIsolatedCredentialSql();
  assert.equal(inspection.safeToEnable, false);
  assert.deepEqual(inspection.gaps, [
    "LEGACY_WORKSTATION_WIDE_REVOKE",
    "CREDENTIAL_VERSION_NOT_ROWVERSION",
    "AUDIT_DECISION_NOT_ATOMIC",
  ]);
  assert.equal(credentialRevocationSqlAdmission.productionReady, false);
  assert.equal(isolatedSqlAdapterReleaseGate.credentialRevocationEnabled, false);
});

test("missing SQL acceptance and legacy coordination cannot be mistaken for approval", () => {
  assert.equal(credentialRevocationSqlAdmission.sqlServer2019Acceptance, "NOT_RUN");
  assert.equal(credentialRevocationSqlAdmission.mixedVersionWritersCoordinated, false);
  assert.equal(credentialRevocationSqlAdmission.legacyScopeReviewed, false);
});
