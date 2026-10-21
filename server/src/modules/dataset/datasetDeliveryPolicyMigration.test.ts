import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";

const migrations = new URL("../../../../database/migrations/", import.meta.url);

test("920 is the next unique migration after 919", async () => {
  const files = (await readdir(migrations)).filter(file => /^\d+_.*\.sql$/u.test(file)).sort();
  const ids = files.map(file => Number(file.split("_")[0]));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.slice(-2), [919, 920]);
  assert.equal(files.at(-1), "920_dataset_definition_rowversion.sql");
});

test("920 is one additive transaction with explicit rollback", async () => {
  const migration = await readFile(new URL("920_dataset_definition_rowversion.sql", migrations), "utf8");
  assert.match(migration, /SET XACT_ABORT ON/);
  assert.equal((migration.match(/BEGIN TRANSACTION/g) ?? []).length, 1);
  assert.equal((migration.match(/COMMIT TRANSACTION/g) ?? []).length, 1);
  assert.match(migration, /BEGIN CATCH[\s\S]*IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;[\s\S]*THROW;/);
  assert.doesNotMatch(migration, /^\s*GO\s*$/mu);
  const sql = migration.replace(/--[^\n]*/gu, "");
  assert.doesNotMatch(sql, /\b(?:DROP|DELETE|TRUNCATE|UPDATE|INSERT|MERGE)\b/iu);
});

test("920 validates conflicts and adds only the Dataset ROWVERSION", async () => {
  const migration = await readFile(new URL("920_dataset_definition_rowversion.sql", migrations), "utf8");
  assert.match(migration, /OBJECT_ID\(N'uqp\.Dataset', N'U'\) IS NULL/);
  assert.match(migration, /system_type_id=189[\s\S]*name<>N'DefinitionRowVersion'/);
  assert.match(migration, /ALTER TABLE uqp\.Dataset ADD DefinitionRowVersion ROWVERSION NOT NULL/);
  for (const evidence of ["user_type_id=189", "max_length=8", "is_nullable=0", "is_computed=0"])
    assert.ok(migration.includes(evidence), evidence);
  assert.doesNotMatch(migration, /DatasetSensitiveColumn[\s\S]*(?:UPDATE|DELETE|ALTER)/i);
});
