/** 4B-2: offline migration rehearsal gate; no database driver or execution. */
import { prepareAcceptance } from "./securityAcceptanceManifest.js";
import { reviewIsolationChecklist } from "./securityAcceptanceIsolation.js";

export type RehearsalInput = {
  profile: "legacy" | "coexistence";
  isolation: unknown;
  backup: {
    runId: string;
    pre919SnapshotRecorded: boolean;
    copyOnlyFullBackupPlanned: boolean;
    checksumPlanned: boolean;
    restoreVerifyOnlyPlanned: boolean;
    actualRestorePlanned: boolean;
    separateRestoreDatabasePlanned: boolean;
    noSharedVolumeCleanup: boolean;
  };
  failure: {
    independentCopiesForDestructiveCases: boolean;
    runnerOuterTransactionCasePlanned: boolean;
    lateDdlRollbackCasePlanned: boolean;
    concurrentSessionsPlanned: boolean;
    noAutomaticRetryOrAdopt: boolean;
  };
};
const backupFields = ["pre919SnapshotRecorded","copyOnlyFullBackupPlanned","checksumPlanned",
  "restoreVerifyOnlyPlanned","actualRestorePlanned","separateRestoreDatabasePlanned",
  "noSharedVolumeCleanup"] as const;
const failureFields = ["independentCopiesForDestructiveCases","runnerOuterTransactionCasePlanned",
  "lateDdlRollbackCasePlanned","concurrentSessionsPlanned","noAutomaticRetryOrAdopt"] as const;
export async function reviewMigrationRehearsal(input: RehearsalInput) {
  if (!input || (input.profile !== "legacy" && input.profile !== "coexistence")) throw new Error("REHEARSAL_PROFILE_INVALID");
  const isolation = reviewIsolationChecklist(input.isolation);
  const target = (input.isolation as { target: { host: string; port: number; database: string } }).target;
  // Bind the pinned migration manifest to the exact reviewed target descriptor.
  const manifest = await prepareAcceptance(["--profile", input.profile,
    "--host", target.host, "--port", String(target.port), "--database", target.database]);
  if (!manifest.target || manifest.target.host !== target.host ||
      manifest.target.port !== target.port || manifest.target.database !== target.database) {
    throw new Error("REHEARSAL_TARGET_MISMATCH");
  }
  // A checklist prepared for another migration profile must never validate this rehearsal.
  if ((input.isolation as { profile?: string }).profile !== input.profile) {
    throw new Error("REHEARSAL_PROFILE_MISMATCH");
  }
  const b = input.backup, f = input.failure;
  if (!b || !f || typeof b.runId !== "string" || !/^[a-f0-9]{12}$/.test(b.runId) ||
      b.runId !== (input.isolation as {runId?: string})?.runId) throw new Error("REHEARSAL_RUN_ID_MISMATCH");
  const missing = [
    ...(!isolation.checklistComplete ? isolation.missing.map(x => "isolation." + x) : []),
    ...backupFields.filter(x => b[x] !== true).map(x => "backup." + x),
    ...failureFields.filter(x => f[x] !== true).map(x => "failure." + x),
  ];
  return {
    profile: input.profile, runId: b.runId, expectedMigrationCount: manifest.migrationIds.length,
    excludedMigrationIds: input.profile === "legacy" ? [916, 917, 918] : [],
    manifestHash: manifest.pinnedInventoryFingerprint,
    checklistComplete: missing.length === 0, missing,
    executed: false, databaseVerified: false, authorizesSqlExecution: false,
    warning: "Dry-run only. A completed checklist cannot replace independent instance attestation, DBA approval, or restored-backup verification.",
  };
}
