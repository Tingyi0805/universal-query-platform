import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
test("916 is additive, separates new-column constraints into later batches and never rebuilds existing data", () => {
  const dir = new URL("../../../../database/migrations/", import.meta.url);
  const names = readdirSync(dir);
  assert.equal(names.filter((n) => n.startsWith("916_")).length, 1);
  const source = readFileSync(
    new URL("916_workstation_management.sql", dir),
    "utf8",
  );
  assert.ok(!/\b(DELETE|TRUNCATE|DROP)\b/i.test(source));
  assert.match(source, /REFERENCES uqp\.AppUser\(Id\)/);
  assert.ok(!source.includes("RolePermission"));
  const batches = source.split(/^GO\s*$/m);
  assert.ok(
    batches.findIndex((s) => s.includes("ADD PurposeCode")) <
      batches.findIndex((s) => s.includes("CHECK (PurposeCode")),
  );
  assert.ok(
    batches.findIndex((s) => s.includes("ADD SharedWorkstationId")) <
      batches.findIndex((s) => s.includes("FK_DisplayDevice_Workstation")),
  );
});
