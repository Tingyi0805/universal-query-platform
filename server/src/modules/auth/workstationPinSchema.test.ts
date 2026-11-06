import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { workstationPinSchemaSql } from "./workstationPinSchema.js";
import { inventory, selectProfile } from "../../scripts/securityAcceptancePlan.js";
test("927 catalog attestation exactly matches Migration and all historical SHA pins remain unchanged", async () => {
  const source = await readFile(new URL("../../../../database/migrations/927_workstation_pin_runtime.sql", import.meta.url), "utf8");
  const block = " -- Complete-state attestation" + source.split(" -- Complete-state attestation")[1]!.split(" IF @ownsTransaction=1 COMMIT TRANSACTION;")[0]!;
  assert.equal(workstationPinSchemaSql, block);
  const rows = await inventory(); assert.equal(rows.at(-1)?.id, 927);
  assert.deepEqual(rows.at(-1)?.requires, [902, 903, 904, 905, 916]);
  for (const profile of ["legacy", "coexistence"]) assert.deepEqual(selectProfile(rows, profile), selectProfile(rows.filter(r => r.id !== 927), profile));
  assert.doesNotMatch(source, /(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO|MERGE)\s+uqp\./i);
  const runner = await readFile(new URL("../../scripts/migrate.ts", import.meta.url), "utf8");
  assert.ok(runner.includes("PIN_RECORDED_SCHEMA_INVALID")); assert.ok(runner.includes("${workstationPinSchemaSql}"));
});
