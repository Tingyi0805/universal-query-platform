import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { acceptanceDirectory, inventory, plan, selectProfile, validateTarget } from "./securityAcceptancePlan.js";
import { definitionHash, describePatientState, confirmedAliases } from "../modules/dataset/patientAuditConfig.service.js";
import { hashPatientForDisclosure, parsePatientAuditKeyring } from "../modules/audit/patientAuditKeyring.js";

test("offline inventory pins all 46 migrations and dependency order without loading application config", async () => {
  const actual = await inventory();
  assert.equal(actual.length, 46);
  assert.deepEqual(actual, JSON.parse(await readFile(path.join(acceptanceDirectory, "migration-inventory.json"), "utf8")));
  assert.ok(actual.every(row => /^[a-f0-9]{64}$/.test(row.sha256)));
  const source = await readFile(new URL("./securityAcceptancePlan.ts", import.meta.url), "utf8");
  const imports = source.match(/from\s+["'][^"']+["']/g) ?? [];
  assert.ok(imports.every(value => /["']node:(crypto|fs\/promises|path|url)["']/.test(value)));
});
test("legacy excludes 916-918 while coexistence includes them; both contain 919 prerequisites", async () => {
  const rows = await inventory();
  assert.equal(selectProfile(rows, "legacy").length, 43);
  assert.ok(selectProfile(rows, "legacy").every(row => ![916,917,918].includes(row.id)));
  assert.equal(selectProfile(rows, "coexistence").length, 46);
  assert.throws(() => selectProfile(rows.filter(row => row.id !== 907), "legacy"));
  assert.throws(() => selectProfile(rows, "all"));
});
test("runner source still auto-selects 916-919 and status bootstrap precedes command dispatch", async () => {
  const runner = await readFile(new URL("./migrate.ts", import.meta.url), "utf8");
  assert.ok(runner.includes('.filter((file) => /^\\d+_.*\\.sql$/i.test(file))'));
  assert.ok(runner.includes('.sort((a, b) => a.localeCompare(b))'));
  assert.ok(runner.indexOf('const command =') < runner.indexOf("CREATE TABLE uqp.SchemaMigration"));
  assert.ok(runner.includes('if (command !== "apply-range" && command !== "resume-916-to-919") await pool.request().batch('));
  assert.ok(runner.indexOf('const pool = await getPlatformDbPool()') < runner.indexOf('command === "status"'));
  const files = (await inventory()).map(row => row.file).filter(file => /^\d+_.*\.sql$/i.test(file));
  assert.deepEqual(files.filter(file => /^(916|917|918|919)_/.test(file)).map(file => Number(file.slice(0,3))), [916,917,918,919]);
  assert.ok(runner.includes('"900_dashboard_device_archive.sql":'));
  assert.doesNotMatch(runner, /DASHBOARD_QUERY_|"91[6-9]_[^"]+":/);
});
test("offline plans have no database or write mode even with an acknowledged target", async () => {
  const unbound = await plan([]);
  assert.equal(unbound.target, null); assert.equal(unbound.executable, false); assert.equal(unbound.connectsToDatabase, false);
  const bound = await plan(["--host", "127.0.0.1", "--port", "15433", "--database", "UQP_ACCEPT_012345abcdef"]);
  assert.equal(bound.executable, false); assert.equal(bound.target?.database, "UQP_ACCEPT_012345abcdef");
  for (const args of [["--execute"], ["--apply", "true"], ["--password", "not-a-secret"], ["--profile"], ["--profile", "legacy", "--profile", "coexistence"], ["--host", "127.0.0.1"]])
    await assert.rejects(plan(args));
});
test("target descriptors reject shared hosts, default ports, system DBs and injection", () => {
  for (const [host, port, db] of [["shared", "15433", "UQP_ACCEPT_012345abcdef"], ["127.0.0.1", "1433", "UQP_ACCEPT_012345abcdef"],
    ["127.0.0.1", "65536", "UQP_ACCEPT_012345abcdef"], ["127.0.0.1", "15433", "master"], ["127.0.0.1", "15433", "UQP_ACCEPT_012345abcdef';DROP"],
    ["127.0.0.1", "15433", "UQP_ACCEPT_012345ABCDEF"], ["127.0.0.1", "1e4", "UQP_ACCEPT_012345abcdef"]])
    assert.throws(() => validateTarget(host!, port!, db!));
});
test("missing migration directory content refuses instead of producing a partial plan", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "uqp-offline-inventory-"));
  try { await assert.rejects(inventory(directory), /INCOMPLETE/); } finally { await rm(directory, { recursive: true }); }
});
test("catalog probe is one default-denied read-only batch with isolation/version/visibility checks", async () => {
  const text = (await readFile(path.join(acceptanceDirectory, "catalog-probe.sql"), "utf8")).replace(/--[^\n]*/g, "");
  assert.doesNotMatch(text, /^\s*GO\s*$/im);
  assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|MERGE|ALTER|CREATE|DROP|TRUNCATE|EXEC|BACKUP|RESTORE)\b/i);
  for (const guard of ["SESSION_CONTEXT", "DB_NAME()", "ProductMajorVersion", "compatibility_level", "VIEW DEFINITION", "ISOLATED_ACCEPTANCE_CONTEXT_REQUIRED", "is_not_trusted", "user_type_id", "key_ordinal"])
    assert.ok(text.includes(guard));
  assert.ok(text.indexOf("THROW") < text.indexOf("SELECT SERVERPROPERTY"));
});
test("synthetic fixture metadata binds exact stored definition, not saved column names or other sources", async () => {
  const fixture = JSON.parse(await readFile(path.join(acceptanceDirectory, "synthetic-fixture.json"), "utf8"));
  const definition = { sqlText: fixture.sqlText as string, dataSourceId: 101 };
  const metadata = { definitionHash: definitionHash(definition), columns: fixture.aliases as string[] };
  const state = { definition, metadata, config: { isEnabled: true, patientKeyColumn: "PatientId", version: "1" }, nameColumns: ["PatientName"] };
  assert.equal(describePatientState(state, true).status, "CONFIRMED");
  assert.equal(describePatientState({ ...state, metadata: null }, true).metadataStatus, "METADATA_UNCONFIRMED");
  for (const changed of [{ ...definition, sqlText: definition.sqlText + " " }, { ...definition, dataSourceId: 102 }])
    assert.equal(describePatientState({ ...state, definition: changed }, true).metadataStatus, "METADATA_UNCONFIRMED");
  assert.equal(confirmedAliases(["PatientId", "patientid"]), false);
  assert.equal(describePatientState({ ...state, config: { ...state.config, patientKeyColumn: "PatientName" } }, true).status, "PATIENT_KEY_INVALID");
  assert.equal(describePatientState(state, false).status, "KEY_UNAVAILABLE");
});
test("synthetic HMAC has scope separation, stable normalization and key versions without logging material", () => {
  // Deliberately deterministic unit-test bytes, never an installable or production key.
  const keys = { activeVersion: 1, versions: new Map([[1, Buffer.alloc(32, 41)], [2, Buffer.alloc(32, 42)]]) };
  const hash = hashPatientForDisclosure(" SYNTH-0001 ", "dataset:101", keys);
  assert.equal(hash.keyVersion, 1); assert.equal(hash.patientKeyHash.length, 32);
  assert.deepEqual(hash.patientKeyHash, hashPatientForDisclosure("SYNTH-0001", "dataset:101", keys).patientKeyHash);
  assert.notDeepEqual(hash.patientKeyHash, hashPatientForDisclosure("SYNTH-0001", "dataset:102", keys).patientKeyHash);
  assert.notDeepEqual(hash.patientKeyHash, hashPatientForDisclosure("SYNTH-0001", "dataset:101", { ...keys, activeVersion: 2 }).patientKeyHash);
  assert.throws(() => parsePatientAuditKeyring(undefined, undefined));
});

test("migration runner keeps ledger insert inside the outer transaction and attempts rollback on failure", async () => {
  // Static safety invariant only: does not execute migrations or simulate SQL Server's DDL rollback semantics.
  const runner = await readFile(new URL("./migrate.ts", import.meta.url), "utf8");
  const begin = runner.indexOf("await transaction.begin()");
  const batches = runner.indexOf("new sql.Request(transaction).batch(", begin);
  const ledger = runner.indexOf('query("INSERT INTO uqp.SchemaMigration (FileName) VALUES (@fileName)")', batches);
  const commit = runner.indexOf("await transaction.commit()", ledger);
  const rollback = runner.indexOf("await rollbackMigrationSafely(transaction, file)", commit);
  assert.ok(begin >= 0 && batches > begin && ledger > batches && commit > ledger && rollback > commit);
  assert.ok(runner.includes("await transaction.rollback()"));
  assert.ok(runner.includes("throw error;"));
  assert.ok(runner.includes("catch (rollbackError)"));
  const migration = await readFile(new URL("../../../database/migrations/919_dashboard_dataset_security_contract.sql", import.meta.url), "utf8");
  assert.match(migration, /SET XACT_ABORT ON/);
  assert.match(migration, /BEGIN TRANSACTION/);
  assert.match(migration, /IF @@TRANCOUNT>0 ROLLBACK TRANSACTION/);
});

test("scoped upgrade runner restricts 915->919 to exact four filenames and refuses baseline drift", async () => {
  // Source-contract test; migrate.ts has an executable entrypoint and must not be imported in offline tests.
  const source = await readFile(new URL("./migrate.ts", import.meta.url), "utf8");
  for (const filename of [
    "916_workstation_management.sql",
    "917_dashboard_query_source_model.sql",
    "918_dashboard_query_playback_mode.sql",
    "919_dashboard_dataset_security_contract.sql",
  ]) assert.ok(source.includes('"' + filename + '"'));
  assert.match(source, /args\[0\] !== "apply-range"/);
  assert.match(source, /args\.length !== 3 \|\| args\[1\] !== "916" \|\| args\[2\] !== "919"/);
  assert.match(source, /MIGRATION_BASELINE_NOT_EXACT_915/);
  assert.match(source, /MIGRATION_RANGE_FILES_OR_LEDGER_MISMATCH/);
  assert.ok(source.indexOf("const scope = resolveMigrationScope(args, files, applied)") <
    source.indexOf("for (const file of files) {\n    if (scope && !scope.has(file)) continue;"));
});

test("scoped upgrade validates target identity before any bootstrap and requires explicit attestation", async () => {
  const runner = await readFile(new URL("./migrate.ts", import.meta.url), "utf8");
  assert.ok(runner.includes("MIGRATION_TARGET_ATTESTATION_REQUIRED"));
  assert.ok(runner.includes("MIGRATION_TARGET_MISMATCH"));
  assert.ok(runner.includes('row.DatabaseName !== "UniversalQueryPlatform"'));
  assert.ok(runner.includes("UQP_MIGRATION_EXPECTED_SERVER"));
  assert.ok(runner.includes("UQP_MIGRATION_EXPECTED_LOGIN"));
  assert.ok(runner.indexOf('if (command === "apply-range" || command === "resume-916-to-919") await requireScopedTarget(pool)') <
    runner.indexOf('if (command !== "apply-range" && command !== "resume-916-to-919") await pool.request().batch('));
  assert.ok(runner.indexOf('if (command === "apply-range" || command === "resume-916-to-919") await requireScopedTarget(pool)') <
    runner.indexOf("SELECT FileName FROM uqp.SchemaMigration"));
});

test("resume requires exact recorded 916 and restricts writes to 917-919", async () => {
  const runner = await readFile(new URL("./migrate.ts", import.meta.url), "utf8");
  assert.match(runner, /args\[0\] !== "resume-916-to-919"/);
  assert.match(runner, /MIGRATION_RESUME_REQUIRES_RECORDED_916/);
  assert.match(runner, /MIGRATION_BASELINE_NOT_EXACT_916/);
  assert.ok(runner.includes('const expected = resuming ? remaining : [baseline, ...remaining]'));
  assert.ok(runner.includes('expected.some(file => !files.includes(file) || applied.has(file))'));
  assert.ok(runner.includes('const outside = files.filter(file => !expected.includes(file) && !applied.has(file))'));
  assert.ok(runner.includes('applied.size !== files.length - expected.length'));
  assert.ok(runner.includes('if (command === "apply-range" || command === "resume-916-to-919") await requireScopedTarget(pool)'));
  assert.ok(runner.includes('if (command !== "apply-range" && command !== "resume-916-to-919") await pool.request().batch('));
});

test("migration rollback failure preserves original error and prohibits automatic retry", async () => {
  const source = await readFile(new URL("./migrate.ts", import.meta.url), "utf8");
  assert.match(source, /export async function rollbackMigrationSafely/);
  assert.match(source, /await transaction\.rollback\(\)/);
  assert.match(source, /await rollbackMigrationSafely\(transaction, file\);/);
  assert.match(source, /No automatic retry/);
  assert.ok(source.indexOf("await rollbackMigrationSafely(transaction, file);") <
    source.indexOf("throw error;", source.indexOf("await rollbackMigrationSafely(transaction, file);")));
});
