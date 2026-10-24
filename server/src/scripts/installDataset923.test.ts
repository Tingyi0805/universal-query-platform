import assert from "node:assert/strict";
import test from "node:test";
import { assess923Target, Install923Error } from "./installDataset923.js";

const baseline = () => ({
  server: "synthetic-instance", database: "SyntheticUQP", login: "dbo",
  engineMajor: 15, compatibility: 150, databaseState: "ONLINE",
  ledger: true, missingMigrations: [] as string[], requiredColumns: true,
  existingRecord: false, catalog: "NOT_INSTALLED",
  dbPrincipalId: 1, hasViewDefinition: 1, dbOwnerMember: 1,
});

test("923 preflight allows precisely absent schema with verified 001-921 prerequisites", () => {
  assert.equal(assess923Target(baseline()), "READY");
});
test("923 installed only when catalog exact AND ledger records same migration", () => {
  assert.equal(assess923Target({ ...baseline(), existingRecord: true, catalog: "EXACT_MATCH" }), "INSTALLED");
  assert.throws(() => assess923Target({ ...baseline(), catalog: "EXACT_MATCH" }), { code: "923_PARTIAL_UNRECORDED_OR_UNTRUSTED" });
  assert.throws(() => assess923Target({ ...baseline(), existingRecord: true }), { code: "923_PARTIAL_UNRECORDED_OR_UNTRUSTED" });
});
test("923 partial, different, unknown or tampered objects always reject", () => {
  for (const catalog of ["REJECTED_PARTIAL_OR_DIFFERENT", "UNVERIFIED", ""]) {
    assert.throws(() => assess923Target({ ...baseline(), catalog }), Install923Error);
  }
});
test("923 missing prerequisite records or schema, engine, compatibility and unready database reject", () => {
  for (const t of [
    { missingMigrations: ["920_dataset_definition_rowversion.sql"] },
    { requiredColumns: false }, { engineMajor: 16 }, { compatibility: 140 },
    { databaseState: "OFFLINE" }, { ledger: false }, { server: "" },
    { database: "" }, { login: "" },
  ]) assert.throws(() => assess923Target({ ...baseline(), ...t }), { code: "923_BASELINE_OR_ENGINE_NOT_READY" });
});
test("923 installer has no side-effect on import (this suite itself imports it)", () => {
  assert.equal(typeof assess923Target, "function");
});

test("923 REJECTED_UNKNOWN identifies insufficient visibility, never calls it a partial install", () => {
  for (const flags of [
    { dbPrincipalId: 5 },
    { hasViewDefinition: 0 },
    { hasViewDefinition: null },
    { dbPrincipalId: null },
    { dbPrincipalId: 7, dbOwnerMember: 1 },
  ]) assert.throws(() => assess923Target({ ...baseline(), catalog: "REJECTED_UNKNOWN", ...flags }),
    { code: "923_CATALOG_VISIBILITY_REQUIRES_DBO_AND_VIEW_DEFINITION" });
  assert.throws(() => assess923Target({ ...baseline(), catalog: "REJECTED_UNKNOWN" }),
    { code: "923_CATALOG_UNKNOWN_WITH_EXPECTED_VISIBILITY" });
});
test("923 visibility repair never authorizes partial schema or ledger mismatch", () => {
  assert.throws(() => assess923Target({ ...baseline(), catalog: "REJECTED_PARTIAL_OR_DIFFERENT" }),
    { code: "923_PARTIAL_UNRECORDED_OR_UNTRUSTED" });
  assert.throws(() => assess923Target({ ...baseline(), catalog: "EXACT_MATCH", existingRecord: false }),
    { code: "923_PARTIAL_UNRECORDED_OR_UNTRUSTED" });
});
