/** Offline, read-only acceptance evidence validator. Never opens a database or writes evidence. */
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { prepareAcceptance } from "./securityAcceptanceManifest.js";

type Evidence = {
  phase: string; profile: string; repoSha: string; inventoryFingerprint: string;
  runId: string; environment: { sqlMajor: number; compatibilityLevel: number; instanceId: string; isolationAttested: boolean; restoreVerified: boolean };
  cases: Array<{ id: string; status: string; evidenceRef?: string }>;
};
const sha = /^[a-f0-9]{40}$/;
const run = /^[a-f0-9]{12}$/;
const evidenceRef = /^[a-zA-Z0-9][a-zA-Z0-9_.\/-]{0,199}$/;
export function validateEvidence(data: unknown, manifest: Awaited<ReturnType<typeof prepareAcceptance>>) {
  const fail = (reason: string): never => { throw new Error("ACCEPTANCE_EVIDENCE_REJECTED:" + reason); };
  if (!data || typeof data !== "object" || Array.isArray(data)) fail("SHAPE");
  const d = data as Partial<Evidence>;
  if (d.phase !== "4B-2" || d.profile !== manifest.profile || typeof d.repoSha !== "string" || !sha.test(d.repoSha) ||
      d.inventoryFingerprint !== manifest.pinnedInventoryFingerprint || typeof d.runId !== "string" || !run.test(d.runId)) fail("IDENTITY");
  if (!d.environment || d.environment.sqlMajor !== 15 || d.environment.compatibilityLevel !== 150 ||
      typeof d.environment.instanceId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(d.environment.instanceId)) fail("ENVIRONMENT");
  const cases = d.cases;
  if (!Array.isArray(cases) || cases.length !== manifest.cases.length) throw new Error("ACCEPTANCE_EVIDENCE_REJECTED:CASE_COUNT");
  const required = new Set(manifest.cases.map(c => c.id));
  const seen = new Set<string>();
  for (const c of cases) {
    if (!c || typeof c.id !== "string" || !required.has(c.id) || seen.has(c.id)) fail("CASE_ID");
    seen.add(c.id);
    if (!["PASS", "FAIL", "NOT_RUN", "BLOCKED"].includes(c.status)) fail("CASE_STATUS");
    if (c.status === "PASS" && (!c.evidenceRef || !evidenceRef.test(c.evidenceRef) || c.evidenceRef.includes(".."))) fail("MISSING_EVIDENCE");
    if (c.evidenceRef !== undefined && (!evidenceRef.test(c.evidenceRef) || c.evidenceRef.includes(".."))) fail("UNSAFE_EVIDENCE_REF");
  }
  const passed = cases.filter(c => c.status === "PASS").length;
  const failed = cases.filter(c => c.status === "FAIL").length;
  const blocked = cases.filter(c => c.status === "BLOCKED").length;
  const notRun = cases.filter(c => c.status === "NOT_RUN").length;
  return { acceptedForReview: true, verifiedByDatabase: false, eligibleForSignoff: false, // Offline self-reported records can never authorize signoff.
    counts: { passed, failed, blocked, notRun }, warning: "Schema, environment and evidence must be independently verified; this is not a database test." };
}
export async function reviewEvidence(args: string[]) {
  if (args.length !== 3 || args[0] !== "--profile" || !["legacy", "coexistence"].includes(args[1]!)) throw new Error("OFFLINE_REVIEW_ARGUMENT_INVALID");
  const filename = args[2]!;
  if (!/^\/tmp\/uqp-acceptance\/[a-zA-Z0-9_-]+\.json$/.test(filename)) throw new Error("OFFLINE_EVIDENCE_PATH_REQUIRED");
  const manifest = await prepareAcceptance(["--profile", args[1]!]);
  // Open with O_NOFOLLOW to block symlink substitution between metadata validation and read.
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error("OFFLINE_EVIDENCE_REGULAR_FILE_REQUIRED");
    if (metadata.size > 1024 * 1024) throw new Error("OFFLINE_EVIDENCE_TOO_LARGE");
    const raw = await handle.readFile({ encoding: "utf8" });
    if (Buffer.byteLength(raw, "utf8") > 1024 * 1024) throw new Error("OFFLINE_EVIDENCE_TOO_LARGE");
    return validateEvidence(JSON.parse(raw), manifest);
  } finally {
    await handle.close();
  }
}
if (process.argv[1] && /(?:^|[\\/])securityAcceptanceEvidence\.(?:ts|js)$/.test(process.argv[1])) {
  reviewEvidence(process.argv.slice(2)).then(value => process.stdout.write(JSON.stringify(value, null, 2) + "\n"))
    .catch(() => { process.stderr.write("Offline evidence refused; no database action performed.\n"); process.exitCode = 1; });
}
