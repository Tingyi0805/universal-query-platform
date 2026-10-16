/** Phase 4B-2: offline acceptance manifest. No DB client, application bootstrap, secrets or filesystem writes. */
import { createHash } from "node:crypto";
import { plan, type InventoryItem } from "./securityAcceptancePlan.js";

export type AcceptanceCase = { id: string; status: "NOT_RUN"; profile: "legacy" | "coexistence" };
const CASES = [
  ...Array.from({ length: 9 }, (_, i) => `M${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 8 }, (_, i) => `D${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 5 }, (_, i) => `L${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 5 }, (_, i) => `S${String(i + 1).padStart(2, "0")}`),
] as const;

function fingerprint(items: InventoryItem[]) {
  return createHash("sha256")
    .update(JSON.stringify(items.map(({ id, file, sha256 }) => ({ id, file, sha256 }))))
    .digest("hex");
}

/**
 * This is a non-executable safety manifest, NOT an execution approval.
 * No arguments permit running SQL. An isolated address alone cannot attest isolation.
 */
export async function prepareAcceptance(args: string[]) {
  const approvedFlags = new Set(["--profile", "--host", "--port", "--database"]);
  if (args.some((value, index) => index % 2 === 0 && !approvedFlags.has(value))) {
    throw new Error("ACCEPTANCE_EXECUTION_NOT_SUPPORTED");
  }
  const offline = await plan(args);
  const profile = offline.profile as "legacy" | "coexistence";
  const ids = offline.migrations.map(row => row.id);
  if (ids.at(-1) !== 919 || ids.length !== (profile === "legacy" ? 43 : 46)) {
    throw new Error("ACCEPTANCE_PROFILE_MISMATCH");
  }
  if (profile === "legacy" && ids.some(id => id === 916 || id === 917 || id === 918)) {
    throw new Error("ACCEPTANCE_LEGACY_UNSAFE");
  }
  return {
    phase: "4B-2",
    status: "PREPARATION_ONLY",
    executable: false,
    connectsToDatabase: false,
    migrationWritesEnabled: false,
    independentIsolationAttested: false,
    credentialsLoaded: false,
    profile,
    target: offline.target,
    migrationIds: ids,
    pinnedInventoryFingerprint: fingerprint(offline.migrations),
    cases: CASES.map(id => ({ id, profile, status: "NOT_RUN" as const })),
    blockers: [
      "Operator must verify instance/network/volume/credentials are isolated.",
      "No live migration runner or acceptance harness exists in this module.",
      "Obtain explicit separate approval and test restore before any DB write.",
    ],
  };
}

if (process.argv[1] && /(?:^|[\\/])securityAcceptanceManifest\.(?:ts|js)$/.test(process.argv[1])) {
  prepareAcceptance(process.argv.slice(2))
    .then(result => process.stdout.write(JSON.stringify(result, null, 2) + "\n"))
    .catch(() => {
      process.stderr.write("Acceptance manifest refused; no database action performed.\n");
      process.exitCode = 1;
    });
}
