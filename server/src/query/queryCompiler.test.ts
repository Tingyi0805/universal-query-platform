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


test("compiles MySQL positional bind parameters", () => {
  const result = compileQuery(
    "SELECT * FROM T WHERE A={{A}} AND B IN ({{B}})",
    "MYSQL",
    { A: 1, B: ["x", "y"] },
  );

  assert.equal(result.sql, "SELECT * FROM T WHERE A=? AND B IN (?, ?)");
  assert.deepEqual(result.binds, {});
  assert.deepEqual(result.bindValues, [1, "x", "y"]);
});

test("compiles PostgreSQL positional bind parameters", () => {
  const result = compileQuery(
    "SELECT * FROM T WHERE A={{A}} AND B IN ({{B}})",
    "POSTGRESQL",
    { A: 1, B: ["x", "y"] },
  );

  assert.equal(result.sql, "SELECT * FROM T WHERE A=$1 AND B IN ($2, $3)");
  assert.deepEqual(result.binds, {});
  assert.deepEqual(result.bindValues, [1, "x", "y"]);
});

test("repeats MySQL values for repeated parameter tokens", () => {
  const result = compileQuery(
    "SELECT * FROM T WHERE A={{A}} OR B={{A}}",
    "MYSQL",
    { A: 5 },
  );

  assert.equal(result.sql, "SELECT * FROM T WHERE A=? OR B=?");
  assert.deepEqual(result.bindValues, [5, 5]);
});

test("expands repeated PostgreSQL parameters by occurrence", () => {
  const result = compileQuery(
    "SELECT * FROM T WHERE A={{A}} OR B={{A}}",
    "POSTGRESQL",
    { A: 5 },
  );

  assert.equal(result.sql, "SELECT * FROM T WHERE A=$1 OR B=$2");
  assert.deepEqual(result.bindValues, [5, 5]);
});


test("compiles ODBC positional bind parameters", () => {
  const result = compileQuery(
    "SELECT * FROM T WHERE A={{A}} AND B IN ({{B}})",
    "ODBC",
    { A: 1, B: ["x", "y"] },
  );

  assert.equal(result.sql, "SELECT * FROM T WHERE A=? AND B IN (?, ?)");
  assert.deepEqual(result.binds, {});
  assert.deepEqual(result.bindValues, [1, "x", "y"]);
});

test("repeats ODBC values for repeated parameter tokens", () => {
  const result = compileQuery(
    "SELECT * FROM T WHERE A={{A}} OR B={{A}}",
    "ODBC",
    { A: 5 },
  );

  assert.equal(result.sql, "SELECT * FROM T WHERE A=? OR B=?");
  assert.deepEqual(result.bindValues, [5, 5]);
});
