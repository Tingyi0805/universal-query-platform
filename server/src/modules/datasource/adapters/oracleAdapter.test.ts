import { coerceRuntimeParameters } from "../../dataset/parameter.service.js";
import { syntheticParameter } from "../../dataset/parameterTestFixture.js";
import { compileQuery } from "../../../query/queryCompiler.js";
import assert from "node:assert/strict";
import test from "node:test";
import oracledb from "oracledb";
import { OracleAdapter, supportsOracleDescriptionServer, validateOracleBinds } from "./oracleAdapter.js";
import type { DataSourceConfig } from "../datasource.types.js";
const config = { oracleServiceName: "SYNTHETIC", queryTimeoutSec: 10 } as DataSourceConfig;
test("Oracle preserves scalar, native date, null and buffer binds without coercion", () => {
  const binds = { TEXT: "synthetic", NUMBER: 42, DATE: new Date("2026-01-01"), EMPTY: null, BINARY: Buffer.from([1]) };
  assert.equal(validateOracleBinds(binds), binds);
});
test("invalid bind types are rejected before acquiring any Oracle connection", async t => {
  let connections = 0;
  t.mock.method(oracledb, "getConnection", async () => { connections++; throw new Error("MUST_NOT_CONNECT"); });
  for (const value of [true, false, undefined, {}, { val: "synthetic", type: 1 }, [1], NaN, Infinity, new Date(NaN)]) {
    await assert.rejects(new OracleAdapter().executeQuery(config, { sql: "SELECT :P FROM DUAL", binds: { P: value }, bindValues: [], maxRows: 1, timeoutSec: 1 }), /^Error: ORACLE_BIND_INVALID$/);
  }
  assert.equal(connections, 0);
});
test("Oracle execution passes typed binds and closes connection after driver failure", async t => {
  const failure = Object.assign(new Error("ORA-00942: synthetic SQL password"), { code: "ORA-00942", errorNum: 942 });
  let closed = 0;
  const binds = { P: 42 };
  t.mock.method(oracledb, "getConnection", async () => ({ execute: async (_sql: string, actual: unknown) => {
    assert.equal(actual, binds); throw failure;
  }, close: async () => { closed++; } }));
  await assert.rejects(new OracleAdapter().executeQuery(config, { sql: "SELECT :P FROM DUAL", binds, bindValues: [], maxRows: 1, timeoutSec: 1 }), e => e === failure);
  assert.equal(closed, 1);
});

test("Oracle metadata version gate admits 11.2 only in Thick mode", () => {
  assert.equal(supportsOracleDescriptionServer(false, 1102000000), true);
  assert.equal(supportsOracleDescriptionServer(false, 1101000000), false);
  assert.equal(supportsOracleDescriptionServer(true, 1102000000), false);
  assert.equal(supportsOracleDescriptionServer(true, 1201000000), true);
  assert.equal(supportsOracleDescriptionServer(false, NaN), false);
});

test("Oracle driver boundary preserves canonical DATETIME Dates and formatted ROC strings", async t => {
  const definitions = [
    { ...syntheticParameter, name: "SDATE", dataType: "DATETIME" as const, controlType: "DATETIME" as const, dateOutputMode: "NATIVE" as const },
    { ...syntheticParameter, name: "EDATE", dateOutputMode: "STRING" as const },
  ];
  const values = coerceRuntimeParameters(definitions, { SDATE: "2026-10-27T11:26:47", EDATE: "2026-10-28" });
  const compiled = compileQuery("SELECT 1 FROM DUAL WHERE SYNTHETIC BETWEEN {{SDATE}} AND {{EDATE}}", "ORACLE", values);
  let closed = 0, calls = 0;
  t.mock.method(oracledb, "getConnection", async () => ({ execute: async (sql: string, binds: Record<string, unknown>) => {
    calls++;
    assert.match(sql, /BETWEEN :SDATE AND :EDATE/);
    assert.ok(binds.SDATE instanceof Date);
    assert.equal(binds.SDATE.toISOString(), "2026-10-27T11:26:47.000Z");
    assert.equal(binds.EDATE, "1151028");
    return { rows: [], metaData: [] };
  }, close: async () => { closed++; } }));
  await new OracleAdapter().executeQuery(config, { ...compiled, timeoutSec: 1, maxRows: 1 });
  assert.equal(calls, 1); assert.equal(closed, 1);
});
