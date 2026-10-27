/** Safe acceptance evidence only. Never imports SQL or platform configuration. */
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const sql926Cases = ["catalog-roundtrip", "no-legacy", "linked-legacy", "unknown-history-before-dml",
  "credential-version-conflict", "operator-cas-conflict", "request-replay-rollback", "audit-trigger-rollback",
  "decision-trigger-rollback", "commit-unknown-committed", "commit-unknown-rolled-back", "concurrent-revoke",
  "concurrent-renewal-revoke", "legacy-insert-predicate-block", "gate-timeout",
  "legacy-writer-denial", "immutable-decision-request", "foreign-workstation-unchanged",
  "multiple-active-device-constraint", "rollback-ack-unknown", "deadlock-1205"] as const;
export type Sql926CaseResult = {
  name: typeof sql926Cases[number]; status: "PASS" | "FAIL" | "NOT_RUN";
  startedAtUtc?: string; finishedAtUtc?: string; sqlError?: number;
};
export const report926Url = new URL("../../../tools/sqlserver-acceptance/h0-926/last-report.json", import.meta.url);
const safe = (value: string | undefined, pattern: RegExp) => value && pattern.test(value) ? value : null;
export function create926Report(env: NodeJS.ProcessEnv = {}) {
  return {
    contract: "H0_926_SQL_ACCEPTANCE_V1", SQL_ACCEPTANCE: "NOT_RUN",
    runtimeEnabled: false, productionReady: false, legacyWriterCoverage: "BLOCKED", productionSafety: "BLOCKED",
    startedAtUtc: new Date().toISOString(),
    cases: sql926Cases.map(name => ({ name, status: "NOT_RUN" as const })) as Sql926CaseResult[],
    sourceManifest: [],
    launcher: {
      runId: safe(env.UQP926_RUN_ID, /^[0-9a-f]{32}$/),
      commit: safe(env.UQP926_COMMIT, /^[0-9a-f]{40}$/),
      containerId: safe(env.UQP926_CONTAINER_ID, /^[0-9a-f]{64}$/),
      networkId: safe(env.UQP926_NETWORK_ID, /^[0-9a-f]{64}$/),
      imageId: safe(env.UQP926_IMAGE_ID, /^sha256:[0-9a-f]{64}$/),
      imageDigest: safe(env.UQP926_IMAGE_DIGEST, /^mcr\.microsoft\.com\/mssql\/server@sha256:[0-9a-f]{64}$/),
    },
  };
}
export function finish926Report(report: Record<string, unknown>) {
  const cases = report.cases as Sql926CaseResult[];
  const valid = Array.isArray(cases) && cases.length === sql926Cases.length &&
    cases.every((c, i) => c.name === sql926Cases[i] && ["PASS", "FAIL", "NOT_RUN"].includes(c.status));
  if (!valid) throw Error("ACCEPTANCE_REPORT_CASES_INVALID");
  const environment = report.environment as Record<string, unknown> | undefined;
  if (report.SQL_ACCEPTANCE === "PASS_ISOLATED_REVOCATION_CASES_ONLY" &&
      (cases.some(c => c.status !== "PASS" || !c.startedAtUtc || !c.finishedAtUtc) ||
       environment?.engine !== 15 || typeof environment?.build !== "string" ||
       !/^15\./.test(environment.build) || environment.compatibility !== 150)) {
    report.SQL_ACCEPTANCE = "FAIL";
    report.failureStage = "INCOMPLETE_SQL_ACCEPTANCE_EVIDENCE";
  }
  report.summary = {
    total: cases.length, passed: cases.filter(c => c.status === "PASS").length,
    failed: cases.filter(c => c.status === "FAIL").length, notRun: cases.filter(c => c.status === "NOT_RUN").length,
  };
  report.finishedAtUtc = new Date().toISOString();
  // A successful isolated run NEVER clears the production/legacy blockers.
  report.runtimeEnabled = false; report.productionReady = false;
  report.legacyWriterCoverage = "BLOCKED"; report.productionSafety = "BLOCKED";
  return report;
}

async function launcherReport(mode: string | undefined) {
  if (!/^[0-9a-f]{32}$/.test(process.env.UQP926_RUN_ID ?? "")) throw Error("REPORT_RUN_ID_REQUIRED");
  let report: Record<string, unknown> = create926Report(process.env);
  if (mode === "init") report.failureStage = "LAUNCHER_STARTUP";
  else if (mode === "cleanup") {
    try {
      const prior = JSON.parse(await readFile(report926Url, "utf8"));
      if (prior.launcher?.runId !== process.env.UQP926_RUN_ID) throw Error("REPORT_CORRELATION");
      finish926Report(prior); report = prior;
    } catch { report.failureStage = "REPORT_CORRELATION_OR_FORMAT_FAILURE"; }
    report.launcher = create926Report(process.env).launcher;
    const allowed = /^(?:NOT_CREATED|REMOVED|REFUSED|FAILED|UNKNOWN)$/;
    const container = safe(process.env.UQP926_CONTAINER_CLEANUP, allowed) ?? "UNKNOWN";
    const network = safe(process.env.UQP926_NETWORK_CLEANUP, allowed) ?? "UNKNOWN";
    report.launcherCleanup = { container, network,
      exitCode: safe(process.env.UQP926_EXIT_CODE, /^[0-9]{1,3}$/) ?? "UNKNOWN" };
    if ([container, network].some(status => ["REFUSED", "FAILED", "UNKNOWN"].includes(status))) {
      report.cleanup = "FAILED_OR_REFUSED_MANUAL_REVIEW_REQUIRED";
      if (report.SQL_ACCEPTANCE !== "NOT_RUN") report.SQL_ACCEPTANCE = "FAIL";
    } else report.cleanup = "COMPLETE";
    if (process.env.UQP926_EXIT_CODE === "0" && report.SQL_ACCEPTANCE !== "PASS_ISOLATED_REVOCATION_CASES_ONLY") {
      (report.launcherCleanup as Record<string, unknown>).exitCode = "1";
      process.exitCode = 1;
    }
  } else throw Error("REPORT_MODE_INVALID");
  await writeFile(report926Url, JSON.stringify(finish926Report(report), null, 2) + "\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await launcherReport(process.argv[2]); } catch { console.error("LAUNCHER_REPORT_FAILURE"); process.exitCode = 1; }
}
