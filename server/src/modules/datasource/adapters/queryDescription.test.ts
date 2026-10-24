import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import sql from "mssql";
import oracledb from "oracledb";
import { SqlServerAdapter } from "./sqlServerAdapter.js";
import { OracleAdapter } from "./oracleAdapter.js";
import type { DataSourceConfig } from "../datasource.types.js";
import type { DescribeQueryInput } from "../../../query/queryDescription.js";

const config = { oracleServiceName: "SYNTHETIC", connectionTimeoutSec: 10, queryTimeoutSec: 10 } as DataSourceConfig;
const input: DescribeQueryInput = { sql: "SELECT Synthetic FROM SyntheticTable", parameters: [], timeoutSec: 1 };
const sensitiveFailure = new Error("SELECT synthetic_patient FROM T; password=SYNTHETIC_SECRET");

function sqlServer(t: TestContext, rows: unknown = [{ name: "Synthetic", system_type_name: "int", column_ordinal: 1, is_hidden: false }]) {
  let closed = 0;
  let connected = 0;
  const calls: { name: string; type: unknown; value: unknown }[] = [];
  const procedures: string[] = [];
  let poolConfig: any;
  const request = {
    input(name: string, type: unknown, value: unknown) { calls.push({ name, type, value }); return this; },
    async execute(name: string) { procedures.push(name); return { recordset: rows }; },
    async query() { assert.fail("row query must never be used for description"); },
  };
  const pool = { async connect() { connected++; }, request() { return request; }, async close() { closed++; } };
  t.mock.method(sql, "ConnectionPool", function (value: unknown) { poolConfig = value; return pool; } as any);
  return { request, pool, calls, procedures, counts: () => ({ closed, connected }), config: () => poolConfig };
}

function oracle(t: TestContext, thick = false) {
  let closed = 0;
  let acquired = 0;
  let broken = 0;
  const statements: string[] = [];
  t.mock.getter(oracledb, "thin", () => !thick);
  t.mock.getter(oracledb, "versionString", () => "6.10.0");
  t.mock.getter(oracledb, "oracleClientVersion", () => 1900000000);
  const connection = {
    thin: !thick, oracleServerVersion: 1900000000, callTimeout: 0,
    async getStatementInfo(statement: string): Promise<any> {
      statements.push(statement);
      return { statementType: oracledb.STMT_TYPE_SELECT, bindNames: [],
        metaData: [{ name: "Synthetic", dbTypeName: "NUMBER" }] };
    },
    async execute() { assert.fail("Oracle row query must never be used for description"); },
    async break() { broken++; }, async close() { closed++; },
  };
  t.mock.method(oracledb, "getConnection", async () => { acquired++; return connection; });
  return { connection, statements, counts: () => ({ closed, acquired, broken }) };
}

test("SQL Server uses native description RPC with bound SQL and explicit typed declarations, never query()", async t => {
  const fake = sqlServer(t);
  const actual: DescribeQueryInput = { ...input, sql: "SELECT {{P}} AS Synthetic", parameters: [{ name: "P", nativeType: { type: "NVARCHAR", length: 20 } }] };
  const result = await new SqlServerAdapter().describeQuery(config, actual);
  assert.deepEqual(fake.procedures, ["sys.sp_describe_first_result_set"]);
  assert.deepEqual(fake.calls.map(c => [c.name, c.value]), [
    ["tsql", "SELECT @P AS Synthetic"], ["params", "@P nvarchar(20)"], ["browse_information_mode", 0],
  ]);
  assert.equal(fake.calls[0]?.type && (fake.calls[0].type as any).type, sql.NVarChar);
  assert.equal(result.evidenceType, "SQLSERVER_DESCRIBE_FIRST_RESULT_SET");
  assert.deepEqual(result.columns, [{ name: "Synthetic", dataType: "int", ordinal: 1 }]);
  assert.equal(fake.config().requestTimeout, 1000);
  assert.equal(fake.config().connectionTimeout, 1000);
  assert.deepEqual(fake.counts(), { connected: 1, closed: 1 });
});

test("SQL Server description without parameters sends a null declaration", async t => {
  const fake = sqlServer(t);
  await new SqlServerAdapter().describeQuery(config, input);
  assert.equal(fake.calls[1]?.value, null);
});

for (const row of [{ name: "", system_type_name: "int", column_ordinal: 1, is_hidden: false },
  { name: "X", column_ordinal: 1, is_hidden: false },
  { name: "X", system_type_name: "int", column_ordinal: 1 },
  { error_number: 11526, error_message: "SYNTHETIC_SECRET" }]) {
  test("SQL Server rejects incomplete native description and releases its pool", async t => {
    const fake = sqlServer(t, [row]);
    await assert.rejects(new SqlServerAdapter().describeQuery(config, input), /^QueryDescriptionError: DESCRIPTION_METADATA_INVALID$/);
    assert.equal(fake.counts().closed, 1);
  });
}

test("SQL Server describe failure and native request timeout are sanitized, close pool, never fallback", async t => {
  const fake = sqlServer(t);
  for (const error of [sensitiveFailure, Object.assign(new Error("SYNTHETIC_SECRET"), { code: "ETIMEOUT" })]) {
    t.mock.method(fake.request, "execute", async () => { throw error; });
    await assert.rejects(new SqlServerAdapter().describeQuery(config, input), /^QueryDescriptionError: DESCRIPTION_FAILED$/);
  }
  assert.equal(fake.counts().closed, 2);
});

test("SQL Server connection error and close error never expose driver details", async t => {
  const fake = sqlServer(t);
  t.mock.method(fake.pool, "connect", async () => { throw sensitiveFailure; });
  await assert.rejects(new SqlServerAdapter().describeQuery(config, input), /^QueryDescriptionError: DESCRIPTION_FAILED$/);
  assert.equal(fake.counts().closed, 1);
  t.mock.method(fake.pool, "close", async () => { throw sensitiveFailure; });
  await assert.rejects(new SqlServerAdapter().describeQuery(config, input), /^QueryDescriptionError: DESCRIPTION_CLEANUP_FAILED$/);
});

for (const thick of [false, true]) {
  test(`Oracle ${thick ? "Thick" : "Thin"} describes SELECT with getStatementInfo only`, async t => {
    const fake = oracle(t, thick);
    const result = await new OracleAdapter().describeQuery(config, input);
    assert.deepEqual(fake.statements, [input.sql]);
    assert.deepEqual(result.columns, [{ name: "Synthetic", dataType: "NUMBER", ordinal: 1 }]);
    assert.equal(result.evidenceType, "ORACLE_STATEMENT_INFO");
    assert.equal(result.trust, "UNBOUND_CANDIDATE");
    assert.equal(fake.connection.callTimeout, 1000);
    assert.deepEqual(fake.counts(), { acquired: 1, closed: 1, broken: 0 });
  });
}

test("Oracle cannot describe typed binds with getStatementInfo; rejects before connecting", async t => {
  const fake = oracle(t);
  await assert.rejects(new OracleAdapter().describeQuery(config, { ...input, sql: "SELECT {{P}} FROM DUAL",
    parameters: [{ name: "P", nativeType: { type: "INT" } }] }), /DESCRIPTION_PARAMETER_UNSUPPORTED/);
  assert.equal(fake.counts().acquired, 0);
});

test("both adapters reject non-SELECT and unknown parameter types before any connection", async t => {
  const sqlFake = sqlServer(t);
  const oraFake = oracle(t);
  for (const adapter of [new SqlServerAdapter(), new OracleAdapter()]) {
    await assert.rejects(adapter.describeQuery(config, { ...input, sql: "DELETE FROM Synthetic" }), /DESCRIPTION_SELECT_ONLY/);
    await assert.rejects(adapter.describeQuery(config, { ...input, sql: "SELECT {{P}} FROM Synthetic",
      parameters: [{ name: "P", nativeType: { type: "UNKNOWN" } }] } as any), /DESCRIPTION_PARAMETER_UNSUPPORTED/);
  }
  assert.equal(sqlFake.counts().connected, 0);
  assert.equal(oraFake.counts().acquired, 0);
});

for (const info of [null, { statementType: oracledb.STMT_TYPE_DELETE, bindNames: [], metaData: [] },
  { statementType: oracledb.STMT_TYPE_SELECT, bindNames: ["UNEXPECTED"], metaData: [] },
  { statementType: oracledb.STMT_TYPE_SELECT, bindNames: [] },
  { statementType: oracledb.STMT_TYPE_SELECT, bindNames: [], metaData: [{ name: " " }] },
  { statementType: oracledb.STMT_TYPE_SELECT, bindNames: [], metaData: [{ name: "X" }] },
  { statementType: oracledb.STMT_TYPE_SELECT, bindNames: [], metaData: [{ name: "X", dbTypeName: "NUMBER" }, { name: "x", dbTypeName: "NUMBER" }] }]) {
  test("Oracle rejects non-SELECT, unmanaged binds or incomplete/duplicate native metadata", async t => {
    const fake = oracle(t);
    t.mock.method(fake.connection, "getStatementInfo", async () => info);
    await assert.rejects(new OracleAdapter().describeQuery(config, input), /^QueryDescriptionError: DESCRIPTION_METADATA_INVALID$/);
    assert.equal(fake.counts().closed, 1);
  });
}

test("Oracle unsupported driver version/mode and old Thick client fail closed before connecting", async t => {
  const fake = oracle(t, true);
  t.mock.getter(oracledb, "oracleClientVersion", () => 1202000000);
  await assert.rejects(new OracleAdapter().describeQuery(config, input), /DESCRIPTION_UNSUPPORTED/);
  t.mock.getter(oracledb, "oracleClientVersion", () => 1900000000);
  for (const version of ["6.7.0", "7.0.0", "UNKNOWN"]) {
    t.mock.getter(oracledb, "versionString", () => version);
    await assert.rejects(new OracleAdapter().describeQuery(config, input), /DESCRIPTION_UNSUPPORTED/);
  }
  t.mock.getter(oracledb, "versionString", () => "6.10.0");
  t.mock.getter(oracledb, "thin", () => undefined);
  await assert.rejects(new OracleAdapter().describeQuery(config, input), /DESCRIPTION_UNSUPPORTED/);
  assert.equal(fake.counts().acquired, 0);
});

test("Oracle unsupported database version, missing method or mode mismatch releases connection", async t => {
  const fake = oracle(t);
  for (const patch of [{ oracleServerVersion: 1102000000 }, { getStatementInfo: undefined }, { thin: "UNKNOWN" }]) {
    const connection = { ...fake.connection, ...patch };
    t.mock.method(oracledb, "getConnection", async () => connection);
    await assert.rejects(new OracleAdapter().describeQuery(config, input), /DESCRIPTION_UNSUPPORTED/);
  }
  assert.equal(fake.counts().closed, 3);
});

test("Oracle native describe and acquisition errors are sanitized without query fallback", async t => {
  const fake = oracle(t);
  t.mock.method(fake.connection, "getStatementInfo", async () => { throw sensitiveFailure; });
  await assert.rejects(new OracleAdapter().describeQuery(config, input), /^QueryDescriptionError: DESCRIPTION_FAILED$/);
  assert.equal(fake.counts().closed, 1);
  t.mock.method(oracledb, "getConnection", async () => { throw sensitiveFailure; });
  await assert.rejects(new OracleAdapter().describeQuery(config, input), /^QueryDescriptionError: DESCRIPTION_FAILED$/);
});

test("Oracle deadline breaks pending description and closes connection", async t => {
  const fake = oracle(t);
  t.mock.method(fake.connection, "getStatementInfo", async () => new Promise(() => undefined));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const result = new OracleAdapter().describeQuery(config, input);
  // Allow acquisition and the describe deadline to be installed before ticking.
  for (let i = 0; i < 12; i++) await Promise.resolve();
  const rejection = assert.rejects(result, /^QueryDescriptionError: DESCRIPTION_TIMEOUT$/);
  t.mock.timers.tick(1000);
  await rejection;
  assert.deepEqual(fake.counts(), { acquired: 1, closed: 1, broken: 1 });
});

test("Oracle cleanup failure rejects candidate without leaking details", async t => {
  const fake = oracle(t);
  t.mock.method(fake.connection, "close", async () => { throw sensitiveFailure; });
  await assert.rejects(new OracleAdapter().describeQuery(config, input), /^QueryDescriptionError: DESCRIPTION_CLEANUP_FAILED$/);
});

test("Oracle acquisition timeout closes a late connection without submitting SQL", async t => {
  const fake = oracle(t);
  let resolve!: (value: unknown) => void;
  t.mock.method(oracledb, "getConnection", () => new Promise(r => { resolve = r; }));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const result = new OracleAdapter().describeQuery(config, input);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  const rejection = assert.rejects(result, /^QueryDescriptionError: DESCRIPTION_TIMEOUT$/);
  t.mock.timers.tick(1000);
  await rejection;
  resolve(fake.connection);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(fake.counts().closed, 1);
  assert.deepEqual(fake.statements, []);
});

test("Oracle candidate projects native metadata only, dropping any unexpected rows/values", async t => {
  const fake = oracle(t);
  t.mock.method(fake.connection, "getStatementInfo", async () => ({ statementType: oracledb.STMT_TYPE_SELECT,
    bindNames: [], rows: [{ Synthetic: "MUST_NOT_LEAVE" }], metaData: [{ name: "Synthetic", dbTypeName: "NUMBER", value: "MUST_NOT_LEAVE" }] }));
  const result = await new OracleAdapter().describeQuery(config, input);
  assert.equal(JSON.stringify(result).includes("MUST_NOT_LEAVE"), false);
  assert.deepEqual(result.columns, [{ name: "Synthetic", dataType: "NUMBER", ordinal: 1 }]);
});

test("SQL Server existing execution still binds values and returns its bounded row result", async t => {
  const fake = sqlServer(t);
  const recordset = Object.assign([{ Synthetic: 1 }, { Synthetic: 2 }], { columns: { Synthetic: { type: { declaration: "int" } } } });
  t.mock.method(fake.request, "query", async () => ({ recordset }) as any);
  const result = await new SqlServerAdapter().executeQuery(config, {
    sql: "SELECT @P AS Synthetic", binds: { P: 1 }, maxRows: 1, timeoutSec: 1,
  });
  assert.deepEqual(result.rows, [{ Synthetic: 1 }]);
  assert.equal(result.truncated, true);
  assert.deepEqual(fake.procedures, []);
  assert.equal(fake.counts().closed, 1);
});

test("SQL Server column discovery derives scalar types by metadata RPC only, and sends no actual values", async t => {
  const fake = sqlServer(t);
  t.mock.method(fake.request, "execute", async (name: string) => {
    fake.procedures.push(name);
    return { recordset: name === "sys.sp_describe_undeclared_parameters"
      ? [{ name: "@P", suggested_system_type_name: "int" }]
      : [{ name: "Synthetic", system_type_name: "int", column_ordinal: 1, is_hidden: false }] };
  });
  const result = await new SqlServerAdapter().describeQuery(config, { purpose: "COLUMN_OPTIONS_ONLY",
    sql: "SELECT Synthetic FROM SyntheticTable WHERE Id={{P}}", parameterNames: ["P"], timeoutSec: 1 });
  assert.deepEqual(fake.procedures, ["sys.sp_describe_undeclared_parameters", "sys.sp_describe_first_result_set"]);
  assert.equal(fake.calls.find(c => c.name === "params")!.value, "@P int");
  assert.ok(!fake.calls.some(c => c.name === "P"));
  assert.deepEqual(result.columns, [{ name: "Synthetic", dataType: "int", ordinal: 1 }]);
  assert.equal(result.trust, "UNBOUND_CANDIDATE");
});

test("SQL Server cannot turn unknown or injected inferred types into a query or declaration", async t => {
  const fake = sqlServer(t);
  t.mock.method(fake.request, "execute", async (name: string) => {
    fake.procedures.push(name);
    return { recordset: [{ name: "@P", suggested_system_type_name: "int);EXEC injected" }] };
  });
  await assert.rejects(new SqlServerAdapter().describeQuery(config, { purpose: "COLUMN_OPTIONS_ONLY",
    sql: "SELECT Id FROM T WHERE Id={{P}}", parameterNames: ["P"], timeoutSec: 1 }), /DESCRIPTION_PARAMETER_UNSUPPORTED/);
  assert.deepEqual(fake.procedures, ["sys.sp_describe_undeclared_parameters"]);
});

for (const thick of [false, true]) test(`Oracle ${thick ? "thick" : "thin"} scalar discovery verifies binds and never executes or fetches rows`, async t => {
  const fake = oracle(t, thick);
  t.mock.method(fake.connection, "getStatementInfo", async (statement: string) => {
    fake.statements.push(statement);
    return { statementType: oracledb.STMT_TYPE_SELECT, bindNames: ["P", "P"], metaData: [{ name: "Synthetic", dbTypeName: "NUMBER" }] };
  });
  const actual = { purpose: "COLUMN_OPTIONS_ONLY" as const, sql: "SELECT Id FROM T WHERE Id={{P}} OR {{P}} IS NULL", parameterNames: ["P"], timeoutSec: 1 };
  const result = await new OracleAdapter().describeQuery(config, actual);
  assert.deepEqual(fake.statements, ["SELECT Id FROM T WHERE Id=:P OR :P IS NULL"]);
  assert.equal(result.trust, "UNBOUND_CANDIDATE");
  t.mock.method(fake.connection, "getStatementInfo", async () => ({ statementType: oracledb.STMT_TYPE_SELECT,
    bindNames: ["FORGED"], metaData: [{ name: "Synthetic", dbTypeName: "NUMBER" }] }));
  await assert.rejects(new OracleAdapter().describeQuery(config, actual), /DESCRIPTION_METADATA_INVALID/);
});
