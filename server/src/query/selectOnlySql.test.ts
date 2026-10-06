import assert from "node:assert/strict";
import test from "node:test";
import { assertSelectOnlySql } from "./selectOnlySql.js";

test("allows a normal SELECT", () => {
  assert.doesNotThrow(() => assertSelectOnlySql("SELECT * FROM PATIENT WHERE ID = {{ID}}"));
});

test("allows a CTE SELECT", () => {
  assert.doesNotThrow(() => assertSelectOnlySql("WITH X AS (SELECT 1 AS A) SELECT * FROM X"));
});

for (const sql of [
  "DELETE FROM PATIENT",
  "UPDATE PATIENT SET NAME='X'",
  "SELECT * INTO TMP FROM PATIENT",
  "SELECT * FROM PATIENT FOR UPDATE",
  "SELECT 1; DELETE FROM PATIENT",
]) {
  test(`rejects unsafe SQL: ${sql}`, () => {
    assert.throws(() => assertSelectOnlySql(sql));
  });
}

test("ignores forbidden words inside string literals and comments", () => {
  assert.doesNotThrow(() =>
    assertSelectOnlySql("SELECT 'DELETE' AS TXT FROM PATIENT -- UPDATE is only a comment"),
  );
});
