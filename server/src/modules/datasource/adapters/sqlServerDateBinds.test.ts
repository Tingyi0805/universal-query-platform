import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import sql from "mssql";
import { SqlServerAdapter } from "./sqlServerAdapter.js";
import type { DataSourceConfig } from "../datasource.types.js";
import { parseCanonicalDate } from "../../dataset/dateParameter.js";

const require = createRequire(import.meta.url);
const tedious = require("tedious");
const WritableBuffer = require("tedious/lib/tracking-buffer/writable-tracking-buffer.js");

// Production adapter, actual mssql Request and local TDS serialization only.
// No connection, SQL execution or database is used.
test("SQL Server native date binds preserve end-of-day milliseconds without rounding into tomorrow", async t => {
  const request = new sql.Request({ config: { options: { useUTC: true } } } as any);
  t.mock.method(sql.ConnectionPool.prototype, "connect", async function (this: sql.ConnectionPool) { return this; });
  t.mock.method(sql.ConnectionPool.prototype, "request", () => request);
  t.mock.method(sql.ConnectionPool.prototype, "close", async () => {});
  t.mock.method(request, "query", async () => ({ recordset: [] }) as any);
  const date = parseCanonicalDate("2026-10-27T23:59:59.999Z", true);
  await new SqlServerAdapter().executeQuery({ host: "synthetic", port: 1433, connectionTimeoutSec: 1 } as DataSourceConfig,
    { sql: "SELECT @EDATE", binds: { EDATE: date, ROC_DATE: "1151027" }, maxRows: 1, timeoutSec: 1 });
  const bound = request.parameters.EDATE as any;
  assert.equal(bound.type, sql.DateTime2);
  assert.equal(bound.scale, 7);
  const buffer = new WritableBuffer();
  tedious.TYPES.DateTime2.writeValue(buffer, bound, { useUTC: true });
  assert.equal(buffer.data.readUIntLE(1, 5), 863999990000); // 100ns ticks before midnight
  assert.equal(buffer.data.readUIntLE(6, 3), Math.floor(Date.UTC(2026, 9, 27) / 86400000) + 719162);
  assert.equal((request.parameters.ROC_DATE as any).type, sql.NVarChar);
  assert.equal(request.parameters.ROC_DATE!.value, "1151027");
});
