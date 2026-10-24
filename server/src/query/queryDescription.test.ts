import assert from "node:assert/strict";
import test from "node:test";
import { acquireDescriptionConnection, candidateDescription, compileDescription, descriptionDeadline,
  type DescribeQueryInput } from "./queryDescription.js";

const input: DescribeQueryInput = { sql: "SELECT {{P}} AS Value", parameters: [{ name: "P", nativeType: { type: "INT" } }], timeoutSec: 5 };

test("description compiler uses explicit native declarations, no values or generic Dataset type inference", () => {
  assert.deepEqual(compileDescription(input, "SQLSERVER"), { sql: "SELECT @P AS Value", parameterDeclaration: "@P int" });
  const types = [
    [{ type: "NVARCHAR", length: 32 }, "nvarchar(32)"], [{ type: "VARCHAR", length: "MAX" }, "varchar(max)"],
    [{ type: "DECIMAL", precision: 18, scale: 4 }, "decimal(18,4)"], [{ type: "DATE" }, "date"],
  ] as const;
  for (const [nativeType, expected] of types) {
    assert.equal(compileDescription({ ...input, parameters: [{ name: "P", nativeType }] }, "SQLSERVER").parameterDeclaration, `@P ${expected}`);
  }
});

for (const sql of ["DELETE FROM T", "EXEC dbo.T", "SELECT X INTO T FROM S", "SELECT 1; SELECT 2", "WITH T AS (DELETE FROM S) SELECT * FROM T", "SELECT X FROM T FOR UPDATE"]) {
  test(`description denies non-read-only statement shape ${sql.split(" ")[0]}`, () => {
    assert.throws(() => compileDescription({ ...input, sql, parameters: [] }, "SQLSERVER"), /DESCRIPTION_SELECT_ONLY/);
  });
}

test("description compiler rejects missing, duplicate, extra, unknown or invalid typed parameter evidence", () => {
  for (const parameters of [[], [...input.parameters, ...input.parameters], [{ name: "OTHER", nativeType: { type: "INT" } }],
    [{ name: "P", nativeType: { type: "NUMBER" } }], [{ name: "P", nativeType: { type: "NVARCHAR", length: 0 } }],
    [{ name: "P", nativeType: { type: "DECIMAL", precision: 39, scale: 0 } }],
    [{ name: "P", nativeType: { type: "DECIMAL", precision: 2, scale: 3 } }],
    [{ name: "P); DELETE", nativeType: { type: "INT" } }], [{ name: "P", nativeType: { type: "int);EXEC X" } }]]) {
    assert.throws(() => compileDescription({ ...input, parameters } as DescribeQueryInput, "SQLSERVER"), /DESCRIPTION_PARAMETER_UNSUPPORTED/);
  }
});

test("description refuses ambiguous tokens, native binds, lists and comments rather than guessing", () => {
  for (const sql of ["SELECT '{{P}}'", 'SELECT "{{P}}"', "SELECT [{{P}}]", "SELECT @P", "SELECT :P FROM DUAL",
    "SELECT {{p}}", "SELECT 1 -- {{P}}", "SELECT /*{{P}}*/ 1", "SELECT q'[{{P}}]' FROM DUAL"]) {
    assert.throws(() => compileDescription({ ...input, sql }, "SQLSERVER"), /DESCRIPTION_PARAMETER_UNSUPPORTED/);
  }
  assert.throws(() => compileDescription(input, "ORACLE"), /DESCRIPTION_PARAMETER_UNSUPPORTED/);
});

test("description accepts literal text unchanged but never treats it as parameter evidence", () => {
  const sql = "SELECT 'synthetic@example:literal' AS Label";
  assert.equal(compileDescription({ ...input, sql, parameters: [] }, "SQLSERVER").sql, sql);
});

test("description requires a finite bounded timeout", () => {
  for (const timeoutSec of [0, -1, 31, Infinity, NaN, 1.1]) {
    assert.throws(() => compileDescription({ ...input, timeoutSec }, "SQLSERVER"), /DESCRIPTION_INVALID_INPUT/);
  }
});

test("candidate evidence is projected, immutable and explicitly requires future execution comparison", () => {
  const columns = [{ name: "Synthetic", dataType: "int", ordinal: 1, value: "MUST_NOT_LEAVE" }];
  const result = candidateDescription("SQLSERVER_DESCRIBE_FIRST_RESULT_SET", columns);
  assert.deepEqual(result, { trust: "UNBOUND_CANDIDATE", evidenceType: "SQLSERVER_DESCRIBE_FIRST_RESULT_SET",
    requiresExecutionComparison: true, columns: [{ name: "Synthetic", dataType: "int", ordinal: 1 }] });
  assert.ok(Object.isFrozen(result.columns[0]));
  assert.ok(Object.isFrozen(result.columns));
  assert.ok(Object.isFrozen(result));
  assert.equal(columns[0]?.value, "MUST_NOT_LEAVE");
});

for (const columns of [[], [{ name: " ", dataType: "int", ordinal: 1 }], [{ name: "X", dataType: "", ordinal: 1 }],
  [{ name: "X", dataType: "UNKNOWN", ordinal: 1 }], [{ name: "X", ordinal: 1 }],
  [{ name: "X", dataType: "int", ordinal: 2 }],
  [{ name: "Alias", dataType: "int", ordinal: 1 }, { name: "ALIAS", dataType: "int", ordinal: 2 }]]) {
  test("indeterminate, empty, noncontiguous or duplicate candidate metadata fails closed", () => {
    assert.throws(() => candidateDescription("ORACLE_STATEMENT_INFO", columns as any), /DESCRIPTION_METADATA_INVALID/);
  });
}

test("connection arriving after the acquisition deadline is closed without being used", async () => {
  let resolve!: (value: { close(): Promise<void> }) => void;
  let closed = 0;
  const pending = new Promise<{ close(): Promise<void> }>(r => { resolve = r; });
  await assert.rejects(acquireDescriptionConnection(() => pending, c => c.close(), 5), /DESCRIPTION_TIMEOUT/);
  resolve({ close: async () => { closed++; } });
  await new Promise(r => setImmediate(r));
  assert.equal(closed, 1);
});

test("deadline cancels pending native describe, and a late failure is consumed", async () => {
  let reject!: (error: Error) => void;
  let cancelled = 0;
  const pending = new Promise<never>((_resolve, r) => { reject = r; });
  await assert.rejects(descriptionDeadline(pending, 5, async () => { cancelled++; }), /DESCRIPTION_TIMEOUT/);
  reject(new Error("SYNTHETIC_SECRET"));
  await new Promise(r => setImmediate(r));
  assert.equal(cancelled, 1);
});

test("column-only compiler safely preserves literals, translates named scalar bindings and never guesses native types", async () => {
  const { compileUnboundDescription, inferredDescriptionDeclarations } = await import("./queryDescription.js");
  for (const source of ["SQLSERVER", "ORACLE"] as const) {
    const result = compileUnboundDescription({ purpose: "COLUMN_OPTIONS_ONLY", sql: "SELECT 'x:@literal' AS Label FROM T WHERE Id={{ID}}",
      parameterNames: ["ID"], timeoutSec: 5 }, source);
    assert.equal(result.sql, `SELECT 'x:@literal' AS Label FROM T WHERE Id=${source === "ORACLE" ? ":" : "@"}ID`);
  }
  assert.equal(inferredDescriptionDeclarations([{ name: "@ID", suggested_system_type_name: "bigint" }], ["ID"]), "@ID bigint");
  for (const type of ["int);DELETE FROM T", "nvarchar(9999)", "decimal(39,0)", "decimal(2,3)", "dbo.CustomType"]) {
    assert.throws(() => inferredDescriptionDeclarations([{ name: "@ID", suggested_system_type_name: type }], ["ID"]), /DESCRIPTION_PARAMETER_UNSUPPORTED/);
  }
  for (const rows of [[], [{ name: "@OTHER", suggested_system_type_name: "int" }],
    [{ name: "@ID", suggested_system_type_name: "int", suggested_user_type_name: "AliasType" }]])
    assert.throws(() => inferredDescriptionDeclarations(rows, ["ID"]), /DESCRIPTION_PARAMETER_UNSUPPORTED/);
  for (const sql of ["EXEC T", "SELECT @ID", "SELECT :ID", "SELECT '{{ID}}'", "SELECT {{ID}};DELETE FROM T"]) {
    assert.throws(() => compileUnboundDescription({ purpose: "COLUMN_OPTIONS_ONLY", sql, parameterNames: ["ID"], timeoutSec: 5 }, "SQLSERVER"));
  }
});
