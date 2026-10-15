import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../../../database/migrations/919_dashboard_dataset_security_contract.sql", import.meta.url), "utf8");
test("919 is one SQL Server 2019 transaction with atomic failure handling", () => {
  assert.match(migration, /SET XACT_ABORT ON/);
  assert.equal((migration.match(/BEGIN TRANSACTION/g) ?? []).length, 1);
  assert.equal((migration.match(/COMMIT TRANSACTION/g) ?? []).length, 1);
  assert.match(migration, /BEGIN CATCH[\s\S]*ROLLBACK TRANSACTION;[\s\S]*THROW;/);
  assert.doesNotMatch(migration, /^GO\s*$/m);
});
test("919 guards prerequisites without depending on Query-only migrations", () => {
  for (const table of ["DatasetPatientAuditConfig", "Dataset", "DatasetColumn", "DatasetSensitiveColumn", "DatasetSensitivePolicyVersion", "Dashboard", "DashboardDataSource", "AuditLog"])
    assert.ok(migration.includes(`OBJECT_ID(N'uqp.${table}', N'U') IS NULL`), table);
  assert.match(migration, /SECURITY_CONTRACT_PREREQUISITE_MISSING/);
  assert.doesNotMatch(migration, /QueryMode|QueryBindingRevision|SharedWorkstation/);
});
test("919 adds guarded versions and metadata without rewriting existing patient or policy data", () => {
  assert.match(migration, /ConfigurationVersion BIGINT NOT NULL/);
  for (const table of ["Dashboard", "DashboardDataSource"])
    assert.ok(migration.includes(`ALTER TABLE uqp.${table} ADD ApprovalRowVersion ROWVERSION NOT NULL`));
  assert.match(migration, /DEFAULT \(1\) WITH VALUES/);
  assert.match(migration, /CREATE TABLE uqp.DatasetPatientAuditMetadata/);
  assert.doesNotMatch(migration, /\b(DROP|DELETE|TRUNCATE|MERGE|UPDATE|INSERT)\s+(TABLE|INTO|uqp\.)/i);
  assert.match(migration, /IF COL_LENGTH\(N'uqp.DatasetPatientAuditConfig', N'ConfigurationVersion'\) IS NULL/);
  assert.match(migration, /IF OBJECT_ID\(N'uqp.DatasetPatientAuditMetadata', N'U'\) IS NULL/);
});
test("same names cannot substitute for owned constraint semantics", () => {
  for (const code of ["DEFAULT_CONFLICT", "VERSION_CHECK_CONFLICT", "METADATA_CHECK_CONFLICT", "METADATA_PK_CONFLICT", "METADATA_FK_CONFLICT", "COLUMN_CONFLICT", "OBJECT_CONFLICT"])
    assert.ok(migration.includes(`SECURITY_CONTRACT_${code}`), code);
  for (const evidence of ["is_not_trusted=0", "is_not_for_replication=0", "user_type_id<>system_type_id", "pc.name=N'DatasetId'", "rc.name=N'Id'", "f.update_referential_action=0", "x.is_disabled=0", "configurationversion>=1", "isjsoncolumnsjson=1"])
    assert.ok(migration.includes(evidence), evidence);
});
