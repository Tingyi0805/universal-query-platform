import assert from "node:assert/strict";
import test from "node:test";
import { reviewIsolationChecklist } from "./securityAcceptanceIsolation.js";
const complete = () => ({
  profile: "legacy", runId: "012345abcdef",
  target: { host: "127.0.0.1", port: 15433, database: "UQP_ACCEPT_012345abcdef" },
  evidence: {
    dedicatedInstanceId: "isolated-test-01", localEndpointVerified: true,
    noForwardingVerified: true, separateNetworkVerified: true,
    separateVolumeVerified: true, noSharedMountVerified: true,
    independentCredentialsVerified: true, syntheticDataOnlyVerified: true,
    noExternalSourcesVerified: true, backupRestorePlanReviewed: true,
    operatorReviewed: true,
  },
});
test("complete operator assertions still never authorize a SQL connection or migration", () => {
  const outcome = reviewIsolationChecklist(complete());
  assert.equal(outcome.checklistComplete, true);
  assert.equal(outcome.selfReportedOnly, true);
  assert.equal(outcome.verifiedByDatabase, false);
  assert.equal(outcome.authorizesConnection, false);
  assert.equal(outcome.authorizesMigration, false);
});
test("missing checks are visible and cannot be treated as complete", () => {
  const o = complete();
  o.evidence.noSharedMountVerified = false;
  const result = reviewIsolationChecklist(o);
  assert.equal(result.checklistComplete, false);
  assert.deepEqual(result.missing, ["noSharedMountVerified"]);
});
test("shared or forwarded-looking descriptors fail closed", () => {
  const cases = [
    { target: { ...complete().target, host: "shared.example.com" } },
    { target: { ...complete().target, database: "master" } },
    { target: { ...complete().target, port: 1433 } },
    { evidence: { ...complete().evidence, dedicatedInstanceId: "" } },
    { runId: "../unsafe" },
  ];
  for (const patch of cases) assert.throws(() => reviewIsolationChecklist({ ...complete(), ...patch }));
});
