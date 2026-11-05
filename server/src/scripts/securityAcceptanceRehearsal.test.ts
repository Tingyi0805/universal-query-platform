import assert from "node:assert/strict";
import test from "node:test";
import { reviewMigrationRehearsal } from "./securityAcceptanceRehearsal.js";
function fixture(profile: "legacy" | "coexistence" = "legacy") {
  return {
    profile,
    isolation: { profile, runId: "012345abcdef",
      target: { host: "127.0.0.1", port: 15433, database: "UQP_ACCEPT_012345abcdef" },
      evidence: { dedicatedInstanceId: "isolated-test-01", localEndpointVerified: true,
        noForwardingVerified: true, separateNetworkVerified: true, separateVolumeVerified: true,
        noSharedMountVerified: true, independentCredentialsVerified: true, syntheticDataOnlyVerified: true,
        noExternalSourcesVerified: true, backupRestorePlanReviewed: true, operatorReviewed: true },
    },
    backup: { runId: "012345abcdef", pre919SnapshotRecorded: true, copyOnlyFullBackupPlanned: true,
      checksumPlanned: true, restoreVerifyOnlyPlanned: true, actualRestorePlanned: true,
      separateRestoreDatabasePlanned: true, noSharedVolumeCleanup: true },
    failure: { independentCopiesForDestructiveCases: true, runnerOuterTransactionCasePlanned: true,
      lateDdlRollbackCasePlanned: true, concurrentSessionsPlanned: true, noAutomaticRetryOrAdopt: true },
  };
}
test("full rehearsal checklist is informational and does not authorize migration", async () => {
  for (const profile of ["legacy", "coexistence"] as const) {
    const result = await reviewMigrationRehearsal(fixture(profile));
    assert.equal(result.checklistComplete, true);
    assert.equal(result.expectedMigrationCount, profile === "legacy" ? 43 : 46);
    assert.equal(result.authorizesSqlExecution, false);
    assert.equal(result.executed, false);
    assert.equal(result.databaseVerified, false);
  }
});
test("backup, fault injection, and isolation missing checks are preserved", async () => {
  const input = fixture();
  input.backup.actualRestorePlanned = false;
  input.failure.noAutomaticRetryOrAdopt = false;
  input.isolation.evidence.noSharedMountVerified = false;
  const result = await reviewMigrationRehearsal(input);
  assert.equal(result.checklistComplete, false);
  assert.deepEqual(result.missing, ["isolation.noSharedMountVerified", "backup.actualRestorePlanned", "failure.noAutomaticRetryOrAdopt"]);
});
test("run identity mismatch refuses review", async () => {
  const input = fixture();
  input.backup.runId = "fedcba987654";
  await assert.rejects(reviewMigrationRehearsal(input), /REHEARSAL_RUN_ID_MISMATCH/);
});

test("rehearsal refuses an isolation checklist for another migration profile", async () => {
  const input = fixture("legacy");
  input.isolation.profile = "coexistence";
  await assert.rejects(reviewMigrationRehearsal(input), /REHEARSAL_PROFILE_MISMATCH/);
});

test("rehearsal never accepts a descriptor that differs from the pinned isolated target rules", async () => {
  const input = fixture("legacy");
  input.isolation.target.database = "UQP_ACCEPT_fedcba987654";
  await assert.rejects(reviewMigrationRehearsal(input), /ISOLATION_TARGET_INVALID/);
});

test("rehearsal refuses a non-isolated network address even with all self-reported checks true", async () => {
  const input = fixture("coexistence");
  input.isolation.target.host = "10.0.0.1";
  await assert.rejects(reviewMigrationRehearsal(input), /ISOLATION_TARGET_INVALID/);
});
