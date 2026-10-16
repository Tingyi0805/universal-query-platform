/** R0: offline comparison only. Does not open a DB, run SQL, import config or write files. */
import { prepareAcceptance } from "./securityAcceptanceManifest.js";

export type ProductionSnapshot = {
  capturedAtUtc: string;
  source: "DBA_READ_ONLY_EXPORT";
  environment: "PRODUCTION";
  migrationLedgerPresent: boolean;
  appliedMigrationFiles: string[];
};

export async function reviewProductionSnapshot(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("R0_SNAPSHOT_INVALID");
  const data = input as Partial<ProductionSnapshot>;
  if (data.source !== "DBA_READ_ONLY_EXPORT" || data.environment !== "PRODUCTION" ||
      typeof data.capturedAtUtc !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(data.capturedAtUtc) ||
      !Number.isFinite(Date.parse(data.capturedAtUtc))) throw new Error("R0_SNAPSHOT_PROVENANCE_INVALID");
  if (data.migrationLedgerPresent !== true) throw new Error("R0_LEDGER_MISSING_REQUIRES_MANUAL_REVIEW");
  if (!Array.isArray(data.appliedMigrationFiles) ||
      data.appliedMigrationFiles.some(x => typeof x !== "string" || !/^\d{3}_[A-Za-z0-9_]+\.sql$/.test(x)) ||
      new Set(data.appliedMigrationFiles).size !== data.appliedMigrationFiles.length) throw new Error("R0_LEDGER_INVALID");
  const manifest = await prepareAcceptance(["--profile", "coexistence"]);
  const { inventory } = await import("./securityAcceptancePlan.js");
  const pinned = await inventory();
  const valid = new Set(pinned.map(m => m.file));
  const unknown = data.appliedMigrationFiles.filter(x => !valid.has(x));
  const recorded = new Set(data.appliedMigrationFiles);
  const notRecorded = pinned.filter(x => !recorded.has(x.file)).map(x => x.file);
  return {
    source: data.source, capturedAtUtc: data.capturedAtUtc,
    expectedMigrationCount: manifest.migrationIds.length,
    recordedCount: recorded.size, unknown, notRecorded,
    manualReviewRequired: true,
    executable: false, connectsToDatabase: false, authorizesMigration: false,
    schemaVerified: false, hashesVerifiedOnProduction: false,
    warning: "Ledger names are self-reported and do not prove installed schema or historical file hashes.",
  };
}
