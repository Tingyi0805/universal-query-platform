import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";

const migrations = new URL("../../../database/migrations/", import.meta.url);
test("paging migration separates new column declarations from constraints for SQL Server batch binding", async () => {
  const sql = await readFile(new URL("914_dashboard_source_paging.sql", migrations), "utf8");
  const batches = sql.split(/^\s*GO\s*$/gim);
  for (const column of ["PageSize", "PageSeconds"]) {
    const added = batches.findIndex(batch => batch.includes(`ADD ${column} INT`));
    const checked = batches.findIndex(batch => batch.includes(`CHECK (${column} BETWEEN`));
    assert.ok(added >= 0 && checked > added, `${column} must be bound in a later batch`);
  }
});
test("additive schema and reconciliation have prerequisite guards, ordered migration names and no destructive data statements", async () => {
  const files = (await readdir(migrations)).filter(file => /^91[0-5]_/.test(file)).sort();
  assert.equal(files.length, 6);
  for (const file of files) {
    const sql = await readFile(new URL(file, migrations), "utf8");
    assert.match(sql, /IF (?:OBJECT_ID|COL_LENGTH)/);
    assert.doesNotMatch(sql, /\b(?:DELETE\s+FROM|TRUNCATE\s+TABLE|DROP\s+TABLE)\b/i);
  }
  const repair = await readFile(new URL("915_dashboard_security_reconciliation.sql", migrations), "utf8");
  assert.match(repair, /WITH CHECK ADD CONSTRAINT CK_DatasetSensitiveColumn_CustomMask/);
  assert.match(repair, /CustomMaskJson IS NOT NULL AND ISJSON/);
  assert.match(repair, /TRY_CONVERT/);
  assert.match(repair, /CK_DashboardDataSource_PageSize/);
  assert.match(repair, /CK_DashboardDataSource_PageSeconds/);
});
