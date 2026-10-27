/** Executes the real shell with a fake Docker binary; NEVER accesses a daemon. */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, symlinkSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { create926Report, finish926Report } from "./workstation926AcceptanceReport.js";

const root = new URL("../../../", import.meta.url);
const q = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
function launch(mode: string, approveVm = true) {
  const dir = mkdtempSync(join(tmpdir(), "uqp926-launcher-test-"));
  const scripts = join(dir, "server/src/scripts"), bin = join(dir, "bin");
  mkdirSync(scripts, { recursive: true }); mkdirSync(bin);
  writeFileSync(join(dir, "server/package.json"), JSON.stringify({ type: "module" }));
  const toolDir = join(dir, "tools/sqlserver-acceptance/h0-926"); mkdirSync(toolDir, { recursive: true });
  cpSync(new URL("tools/sqlserver-acceptance/h0-926/run-isolated.sh", root), join(toolDir, "run-isolated.sh"));
  cpSync(new URL("server/src/scripts/workstation926AcceptanceReport.ts", root), join(scripts, "workstation926AcceptanceReport.ts"));
  cpSync(new URL("server/src/scripts/workstationUserRevocationSqlAcceptanceCases.ts", root), join(scripts, "workstationUserRevocationSqlAcceptanceCases.ts"));
  symlinkSync(fileURLToPath(new URL("server/node_modules", root)), join(dir, "server/node_modules"), "dir");
  const log = join(dir, "events"), state = join(dir, "state");
  writeFileSync(join(bin, "git"), "#!/bin/sh\nprintf '%s\\n' '" + "e".repeat(40) + "'\n", { mode: 0o755 });
  // If the launcher attempts SQL, stop before even importing the SQL harness.
  writeFileSync(join(bin, "node"), `#!/bin/sh
if [ "$1" = "--import" ] && [ "$3" = "src/scripts/workstation926SqlAcceptance.ts" ]; then
  printf '%s\\n' '["SQL_HARNESS_BLOCKED_BY_TEST"]' >> "$UQP_TEST_LOG"
  exit 7
fi
exec ${q(process.execPath)} "$@"
`, { mode: 0o755 });
  writeFileSync(join(bin, "docker"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.shift() !== "--host=unix:///var/run/docker.sock") process.exit(90);
for (const name of ["DOCKER_HOST","DOCKER_CONTEXT","DOCKER_TLS","DOCKER_TLS_VERIFY","DOCKER_CERT_PATH"])
  if (process.env[name]) process.exit(91);
fs.appendFileSync(process.env.UQP_TEST_LOG, JSON.stringify(args)+"\\n");
let s = fs.existsSync(process.env.UQP_TEST_STATE) ? JSON.parse(fs.readFileSync(process.env.UQP_TEST_STATE,"utf8")) : {};
const save = () => fs.writeFileSync(process.env.UQP_TEST_STATE, JSON.stringify(s));
const mode = process.env.UQP_TEST_MODE, nonce = process.env.UQP926_RUN_ID;
const network = "a".repeat(64), cid = "b".repeat(64);
const out = value => process.stdout.write(value+"\\n");
if (args[0] === "info") process.exit(0);
if (args[0] === "network" && args[1] === "create") { out(network); process.exit(0); }
if (args[0] === "run") {
  s.created = true; s.running = true; save();
  fs.writeFileSync(args[args.indexOf("--cidfile")+1],cid);
  out(cid); process.exit(0);
}
if (args[0] === "inspect") {
  if (args.at(-1) !== cid) process.exit(92);
  out(args.includes("{{.Image}}") ? "sha256:"+"c".repeat(64) : mode === "foreign-container" ? "other-run" : nonce);
  process.exit(0);
}
if (args[0] === "image") { out("mcr.microsoft.com/mssql/server@sha256:"+"d".repeat(64)); process.exit(0); }
if (args[0] === "network" && args[1] === "inspect") {
  if (args.at(-1) !== network) process.exit(93);
  const format = args[args.indexOf("--format")+1];
  if (format === "{{.Internal}}") out("true");
  else if (format === "{{len .Containers}}") out(s.running || (s.created && mode === "busy-network") ? "1" : "0");
  else out(s.created && mode === "foreign-network" ? "other-run" : nonce);
  process.exit(0);
}
if (args[0] === "rm") {
  if (args.join(" ") !== "rm -f "+cid) process.exit(94);
  if (mode === "cleanup-fails") process.exit(9);
  s.running=false; save(); process.exit(0);
}
if (args[0] === "network" && args[1] === "rm" && args[2] === network) process.exit(0);
process.exit(95);
`, { mode: 0o755 });
  try {
    const result = spawnSync("bash", [join(toolDir, "run-isolated.sh")], {
      cwd: dir, encoding: "utf8", timeout: 20000, env: {
        ...process.env, PATH: bin + ":" + process.env.PATH,
        UQP926_APPROVE: "CREATE_DISPOSABLE_SYNTHETIC_926_ONLY",
        UQP926_VM_APPROVE: approveVm ? "NEW_UBUNTU_2404_VM_ONLY" : "",
        UQP_TEST_LOG: log, UQP_TEST_STATE: state, UQP_TEST_MODE: mode,
        DOCKER_HOST: "tcp://forbidden.invalid:2376", DOCKER_CONTEXT: "forbidden",
        DOCKER_TLS: "1", DOCKER_TLS_VERIFY: "1", DOCKER_CERT_PATH: "/forbidden",
      },
    });
    assert.ifError(result.error);
    const events = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line) as string[]) : [];
    const path = join(toolDir, "last-report.json");
    const report = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
    if (approveVm) assert.ok(report, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr + JSON.stringify(report) + JSON.stringify(events), /S9!|MSSQL_SA_PASSWORD=/);
    return { result, events, report };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("new VM confirmation is required before any Docker command", () => {
  const f = launch("normal", false);
  assert.equal(f.result.status, 2); assert.deepEqual(f.events, []);
  assert.match(f.result.stderr, /SQL_ACCEPTANCE=NOT_RUN/);
});
test("shell cleans only owned container/network; SQL is not run and all 35 cases remain NOT_RUN", () => {
  const f = launch("normal");
  assert.equal(f.result.status, 7);
  assert.ok(f.events.some(e => e[0] === "SQL_HARNESS_BLOCKED_BY_TEST"));
  assert.deepEqual(f.events.filter(e => e[0] === "rm"), [["rm","-f","b".repeat(64)]]);
  assert.deepEqual(f.events.filter(e => e[0] === "network" && e[1] === "rm"), [["network","rm","a".repeat(64)]]);
  assert.equal(f.report.SQL_ACCEPTANCE, "NOT_RUN"); assert.equal(f.report.summary.notRun, 35);
  assert.equal(f.report.cleanup, "COMPLETE");
  assert.equal(f.report.launcher.imageId, "sha256:" + "c".repeat(64));
  assert.equal(f.report.launcher.imageDigest, "mcr.microsoft.com/mssql/server@sha256:" + "d".repeat(64));
});
test("foreign container ownership refuses deletion and prevents SQL harness entry", () => {
  const f = launch("foreign-container");
  assert.notEqual(f.result.status, 0);
  assert.ok(!f.events.some(e => e[0] === "rm" || e[0] === "SQL_HARNESS_BLOCKED_BY_TEST"));
  assert.ok(!f.events.some(e => e[0] === "network" && e[1] === "rm"));
  assert.equal(f.report.launcherCleanup.container, "REFUSED");
});
for (const mode of ["foreign-network", "busy-network", "cleanup-fails"]) test("network/cleanup safety: " + mode, () => {
  const f = launch(mode);
  assert.notEqual(f.result.status, 0);
  assert.ok(!f.events.some(e => e[0] === "network" && e[1] === "rm"));
  assert.equal(f.report.cleanup, "FAILED_OR_REFUSED_MANUAL_REVIEW_REQUIRED");
  assert.equal(f.report.SQL_ACCEPTANCE, "NOT_RUN");
});
test("report keeps unexecuted cases and missing engine evidence explicit", () => {
  const report = finish926Report(create926Report({ UQP926_PASSWORD: "DO_NOT_SERIALIZE" }));
  assert.deepEqual(report.summary, { total: 35, passed: 0, failed: 0, notRun: 35 });
  assert.equal(report.environment, undefined); assert.equal(report.SQL_ACCEPTANCE, "NOT_RUN");
  assert.doesNotMatch(JSON.stringify(report), /DO_NOT_SERIALIZE/);
});
test("report refuses incomplete successful evidence and cannot clear production blockers", () => {
  const report = create926Report() as Record<string, unknown>;
  report.SQL_ACCEPTANCE = "PASS_ISOLATED_REVOCATION_CASES_ONLY";
  finish926Report(report);
  assert.equal(report.SQL_ACCEPTANCE, "FAIL");
  assert.equal(report.productionReady, false); assert.equal(report.legacyWriterCoverage, "BLOCKED");
});

test("synthetic report formatter preserves PASS/FAIL/NOT_RUN separately and never grants production authority", () => {
  // Formatter fixture ONLY. No database evidence is issued or persisted.
  const fixture = create926Report();
  for (const result of fixture.cases) {
    result.status = "PASS"; result.startedAtUtc = "2026-01-01T00:00:00.000Z"; result.finishedAtUtc = "2026-01-01T00:00:01.000Z";
  }
  const report: Record<string, unknown> = { ...fixture, SQL_ACCEPTANCE: "PASS_ISOLATED_REVOCATION_CASES_ONLY",
    environment: { engine: 15, build: "15.0.9999.0", compatibility: 150, edition: "SYNTHETIC_FORMATTER_TEST_ONLY" } };
  finish926Report(report);
  assert.equal(report.SQL_ACCEPTANCE, "PASS_ISOLATED_REVOCATION_CASES_ONLY");
  assert.deepEqual(report.summary, { total: 35, passed: 35, failed: 0, notRun: 0 });
  assert.equal(report.productionReady, false); assert.equal(report.productionSafety, "BLOCKED");
  const mixed = create926Report();
  mixed.cases[0]!.status = "PASS"; mixed.cases[1]!.status = "FAIL";
  assert.deepEqual(finish926Report(mixed).summary, { total: 35, passed: 1, failed: 1, notRun: 33 });
  (report.environment as Record<string, unknown>).build = "16.0.9999.0";
  assert.equal(finish926Report(report).SQL_ACCEPTANCE, "FAIL");
});

test("README startup command has no stray plus; all Ubuntu manual shell blocks parse", () => {
  const readme = readFileSync(new URL("tools/sqlserver-acceptance/h0-926/README.md", root), "utf8");
  assert.equal(readme.split("\n").find(line => line.startsWith("UQP926_APPROVE=")),
    "UQP926_APPROVE=CREATE_DISPOSABLE_SYNTHETIC_926_ONLY UQP926_VM_APPROVE=NEW_UBUNTU_2404_VM_ONLY bash tools/sqlserver-acceptance/h0-926/run-isolated.sh");
  for (const text of [readme, readFileSync(new URL("tools/sqlserver-acceptance/h0-926/UBUNTU-24.04.md", root), "utf8")]) {
    for (const block of text.matchAll(/```bash\n([\s\S]*?)```/g)) {
      const parsed = spawnSync("bash", ["-n"], { input: block[1], encoding: "utf8" });
      assert.ifError(parsed.error); assert.equal(parsed.status, 0, parsed.stderr);
    }
  }
});
