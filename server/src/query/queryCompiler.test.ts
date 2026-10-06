import assert from "node:assert/strict";
import test from "node:test";
import { compileQuery, extractParameterNames } from "./queryCompiler.js";

test("extracts unique parameter names", () => {
  assert.deepEqual(
    extractParameterNames("SELECT * FROM T WHERE A={{A}} OR B={{B}} OR C={{A}}"),
    ["A", "B"],
  );
});

test("compiles SQL Server bind parameters", () => {
  const result = compileQuery(
    "SELECT * FROM T WHERE A={{A}} AND B={{B}}",
    "SQLSERVER",
    { A: 1, B: "x" },
  );

  assert.equal(result.sql, "SELECT * FROM T WHERE A=@A AND B=@B");
  assert.deepEqual(result.binds, { A: 1, B: "x" });
});

test("compiles Oracle bind parameters", () => {
  const result = compileQuery(
    "SELECT * FROM T WHERE A={{A}}",
    "ORACLE",
    { A: 1 },
  );

  assert.equal(result.sql, "SELECT * FROM T WHERE A=:A");
  assert.deepEqual(result.binds, { A: 1 });
});

test("expands multi-select values safely", () => {
  const result = compileQuery(
    "SELECT * FROM T WHERE CODE IN ({{CODES}})",
    "SQLSERVER",
    { CODES: ["A", "B"] },
  );

  assert.equal(result.sql, "SELECT * FROM T WHERE CODE IN (@CODES_0, @CODES_1)");
  assert.deepEqual(result.binds, { CODES_0: "A", CODES_1: "B" });
});

test("rejects missing parameters", () => {
  assert.throws(
    () => compileQuery("SELECT * FROM T WHERE A={{A}}", "ORACLE", {}),
    /MISSING_QUERY_PARAMETER:A/,
  );
});
