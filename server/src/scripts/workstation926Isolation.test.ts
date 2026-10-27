import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { isolated926Approval, isolated926Target, assertIsolated926Witness } from "./workstation926Isolation.js";
import { workstationNamedWriterCoverage } from "../modules/auth/workstationRevocationWriterInventory.js";
import { legacyWorkstationWriterFenceSql } from "../modules/auth/workstationLegacyWriterFence.js";
const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const approved = { UQP926_APPROVE: isolated926Approval, UQP926_RUN_ID: "a".repeat(32), UQP926_PASSWORD: "S9!" + "c".repeat(32) };

test("isolation target rejects absent approval, malformed nonce or credential before any connection", () => {
  for (const env of [{}, { ...approved, UQP926_APPROVE: "" }, { ...approved, UQP926_RUN_ID: "../production" },
    { ...approved, UQP926_PASSWORD: "" }, { ...approved, UQP926_RUN_ID: "UQP" }])
    assert.throws(() => isolated926Target(env), /ISOLATED_926_APPROVAL_REQUIRED/);
  const target = isolated926Target({ ...approved, PLATFORM_DB_SERVER: "production", PLATFORM_DB_DATABASE: "UniversalQueryPlatform" });
  assert.equal(target.server, "127.0.0.1"); assert.equal(target.port, 14336);
  assert.equal(target.database, "UQP926_" + "a".repeat(32));
});
test("engine, instance identity, master target and empty instance are mandatory", () => {
  const witness = { Engine: 15, Machine: "uqp-h0-926-isolated", ServerName: "uqp-h0-926-isolated",
    DatabaseName: "master", LoginName: "sa", UserDatabases: 0, IsSysadmin: 1 };
  assert.doesNotThrow(() => assertIsolated926Witness(witness, "uqp-h0-926-isolated"));
  for (const change of [{ Engine: 16 }, { Machine: "EINOV-VPN" }, { ServerName: "other" },
    { DatabaseName: "UniversalQueryPlatform" }, { UserDatabases: 1 }, { UserDatabases: null },
    { LoginName: "runtime" }, { IsSysadmin: 0 }])
    assert.throws(() => assertIsolated926Witness({ ...witness, ...change }, "uqp-h0-926-isolated"));
});
test("launcher has explicit approval, internal network, loopback port, no mounts and owner-only cleanup", () => {
  const shell = read("tools/sqlserver-acceptance/h0-926/run-isolated.sh");
  for (const marker of ["CREATE_DISPOSABLE_SYNTHETIC_926_ONLY", "--internal", "127.0.0.1:14336:1433",
    "--cidfile", "uqp926.run", "unset UQP926_PASSWORD", "unix:///var/run/docker.sock"])
    assert.ok(shell.includes(marker), marker);
  assert.doesNotMatch(shell, /--privileged|--network[= ]host|--volume|--mount|docker system prune/);
});
test("complete real migration manifest, 926 draft and catalog stay outside normal runner", () => {
  const files = readdirSync(new URL("database/migrations/", root)).filter(name => /^\d+_.*\.sql$/.test(name)).sort();
  assert.equal(files.length, 48); assert.equal(files.at(-1), "921_datasource_native_parameter_versions.sql");
  for (const prefix of ["902_", "903_", "904_", "905_", "916_"]) assert.ok(files.some(name => name.startsWith(prefix)));
  assert.ok(!files.some(name => name.startsWith("926_")));
  const runner = read("server/src/scripts/workstation926SqlAcceptance.ts");
  assert.ok(runner.includes('database/drafts/926_shared_workstation_session_security.sql'));
  assert.doesNotMatch(runner, /getPlatformDbPool|from ["'].*config\/|process\.env\.PLATFORM_DB/);
  assert.match(runner, /sourceManifest/); assert.match(runner, /COMMIT_UNKNOWN/);
  assert.match(runner, /sqlErrors.slice\(priorErrors\).includes\(1205\)/);
  assert.match(runner, /number, 1222/);
  const catalog = read("tools/sqlserver-acceptance/drafts/926/926_catalog_readonly.sql");
  assert.equal((catalog.match(/OUTER APPLY/g) ?? []).length, 2);
  assert.doesNotMatch(catalog, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|EXEC)\s+(?:INTO\s+)?uqp\./i);
});
test("legacy denial uses the identical gate before old config locks; every named path is traceable", () => {
  assert.match(legacyWorkstationWriterFenceSql, /UQP:WORKSTATION_SESSION_SECURITY:V1/);
  assert.match(legacyWorkstationWriterFenceSql, /@LockOwner = N'Transaction'/);
  assert.match(legacyWorkstationWriterFenceSql, /IF @result < 0 THROW/);
  assert.doesNotMatch(legacyWorkstationWriterFenceSql, /SELECT @result AS GateResult/);
  for (const name of ["DeviceSession", "OperatorState", "PinAttemptState", "SessionRequest", "SessionDecision"])
    assert.ok(legacyWorkstationWriterFenceSql.includes("SharedWorkstation" + name));
  assert.match(legacyWorkstationWriterFenceSql, /PolicyRowVersion/);
  assert.match(legacyWorkstationWriterFenceSql, /LEGACY_WRITER_METADATA_VISIBILITY_REQUIRED/);
  for (const path of workstationNamedWriterCoverage) {
    const code = read(path.source);
    for (const fn of path.functions) assert.ok(code.includes(fn), path.source + ":" + fn);
    if (path.coverage === "COMMON_GATE_DENY_ON_926") assert.ok(code.includes("legacyWorkstationWriterFenceSql"), path.source);
  }
});
