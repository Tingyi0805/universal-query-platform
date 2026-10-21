import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { versionFoundationSchemaSql } from "./versionFoundationSchema.js";
import { inventory, selectProfile } from "../../scripts/securityAcceptancePlan.js";

const directory = new URL("../../../../database/migrations/", import.meta.url);
const file = "921_datasource_native_parameter_versions.sql";

test("921 is unique, appended and pinned; existing acceptance profiles and 920 hash remain unchanged", async () => {
  const files = (await readdir(directory)).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
  assert.equal(files.at(-1), file);
  assert.equal(files.filter(f => f.startsWith("921_")).length, 1);
  const rows = await inventory();
  assert.equal(rows.find(r => r.id === 920)?.sha256, "f8d6b9d50881c12407d453f1d3ccf4e7054efd931c2f19f8cb1f7316b791880b");
  for (const profile of ["legacy", "coexistence"]) {
    assert.deepEqual(selectProfile(rows, profile), selectProfile(rows.filter(r => r.id <= 920), profile));
  }
});

test("921 uses one atomic additive transaction with XACT_ABORT, conflict checks and failure rollback", async () => {
  const source = await readFile(new URL(file, directory), "utf8");
  assert.match(source, /SET XACT_ABORT ON/);
  assert.equal((source.match(/BEGIN TRANSACTION/g) ?? []).length, 1);
  assert.equal((source.match(/COMMIT TRANSACTION/g) ?? []).length, 1);
  assert.match(source, /BEGIN CATCH\s+IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;\s+THROW;/);
  assert.doesNotMatch(source, /^\s*GO\s*$/m);
  assert.match(source, /ALTER TABLE uqp.DataSource ADD ConfigurationRowVersion ROWVERSION NOT NULL/);
  assert.match(source, /VERSION_FOUNDATION_PARTIAL_INSTALLATION/);
  assert.match(source, /system_type_id=189 AND name<>N'ConfigurationRowVersion'/);
  assert.doesNotMatch(source, /(?:UPDATE|INSERT INTO|DELETE FROM|MERGE|TRUNCATE|DROP TABLE) uqp\./i);
  assert.doesNotMatch(source, /ALTER TABLE uqp.Dataset\b/);
});

test("repeated migration and runtime use the exact same strict catalog contract", async () => {
  const source = await readFile(new URL(file, directory), "utf8");
  const shared = source.split("-- BEGIN SHARED CATALOG VALIDATION\n")[1]?.split("-- END SHARED CATALOG VALIDATION")[0];
  assert.equal(shared, versionFoundationSchemaSql);
  for (const guard of ["user_type_id=189", "is_computed=0", "is_nullable=0", "c.is_identity=0",
    "is_not_trusted=0", "is_disabled=0", "is_not_for_replication=0", "delete_referential_action=0",
    "update_referential_action=0", "sys.foreign_key_columns", "sys.check_constraints", "LOWER(c.definition)",
    "sys.default_constraints", "sys.index_columns", "temporal_type=0", "sys.triggers", "OBJECT_ID(N'uqp.DatasetParameter',N'U') IS NULL"]) {
    assert.ok(shared?.includes(guard), guard);
  }
});

test("native contract cannot be seeded, auto-verified, cascaded or inferred from generic Dataset types", async () => {
  const source = await readFile(new URL(file, directory), "utf8");
  assert.match(source, /ContractRowVersion ROWVERSION NOT NULL/);
  assert.match(source, /DefinitionRowVersion BINARY\(8\) NOT NULL/);
  assert.match(source, /ConfigurationRowVersion BINARY\(8\) NOT NULL/);
  assert.match(source, /State=N''UNCONFIRMED''/);
  assert.match(source, /DATABASE_DECLARATION/);
  assert.match(source, /EXPLICIT_RUNTIME_BIND/);
  assert.match(source, /ISJSON\(NativeTypesJson\)=1/);
  assert.doesNotMatch(source, /ON DELETE CASCADE|INSERT INTO uqp.DatasetNativeParameterContract/);
});

test("DataSource create/update/delete rely on native ROWVERSION rather than assigning a historical version", async () => {
  const source = await readFile(new URL("./datasource.repository.ts", import.meta.url), "utf8");
  assert.match(source, /INSERT INTO uqp.DataSource/);
  assert.match(source, /UPDATE uqp.DataSource SET[\s\S]*EncryptedPassword=@encryptedPassword/);
  assert.match(source, /DELETE FROM uqp.DataSource WHERE Id=@id/);
  assert.doesNotMatch(source, /ConfigurationRowVersion\s*=/);
  const reader = await readFile(new URL("./datasourceVersion.repository.ts", import.meta.url), "utf8");
  assert.match(reader, /OBJECT_ID\(N'uqp.DataSource',N'U'\)/);
  assert.doesNotMatch(reader, /decryptSecret|getDataSourcePlaybackState|SELECT TOP \(1\) \*/);
});
