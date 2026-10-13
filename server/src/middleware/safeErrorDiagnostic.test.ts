import assert from "node:assert/strict";
import test from "node:test";
import { safeAuditErrorCode, safeErrorDiagnostic, withErrorModule } from "./safeErrorDiagnostic.js";
import { logger } from "../config/logger.js";
import { errorHandler } from "./errorHandler.js";
import type { Request, Response } from "express";
test("driver classification uses only allowlisted codes and numeric SQL Server errors", () => {
  const secret = "SELECT synthetic_patient; bind=TEST; password=secret; token=secret; Server=secret";
  const e = Object.assign(new Error(secret), { code: "EREQUEST", originalError: { info: { number: 207, message: secret } }, name: secret, stack: secret, parameters: secret });
  assert.deepEqual(safeErrorDiagnostic(e), { module: "request", errorType: "DATABASE", driverCode: "EREQUEST", sqlServerNumber: 207 });
  for (const value of [secret, -1, Infinity, NaN, 1.2, 1000000]) {
    const diagnostic = safeErrorDiagnostic({ code: secret, number: value, message: secret });
    assert.deepEqual(diagnostic, { module: "request", errorType: "UNEXPECTED" });
  }
});
test("known application errors never include parameter suffixes or arbitrary messages", () => {
  assert.deepEqual(safeErrorDiagnostic(new Error("PARAMETER_REQUIRED:synthetic_secret")), {
    module: "request", errorType: "APPLICATION", applicationCode: "PARAMETER_REQUIRED",
  });
});
test("nested module tracking preserves original stage and original error", async () => {
  const e = new Error("synthetic_secret");
  await assert.rejects(withErrorModule("dataset.parameters.read", () => withErrorModule("dataset.parameters.load", async () => { throw e; })), error => error === e);
  assert.equal(safeErrorDiagnostic(e).module, "dataset.parameters.load");
});
test("actual error logger and response contain no SQL/binds/patients/password/token/connection string/path", async t => {
  const logs: unknown[] = [];
  t.mock.method(logger, "error", (fields: unknown) => { logs.push(fields); });
  const e = Object.assign(new Error("SELECT synthetic_patient; Bind Values=synthetic_identifier; password=secret; Token=secret; Server=secret"), { code: "EREQUEST", number: 229 });
  await assert.rejects(withErrorModule("dataset.query.execute", async () => { throw e; }));
  let body: unknown; const response = { status: () => response, json: (value: unknown) => { body = value; return response; } };
  errorHandler(e, { id: "synthetic-request", method: "POST", path: "/synthetic_identifier" } as Request, response as unknown as Response, () => {});
  assert.deepEqual(logs, [{ code: "INTERNAL_SERVER_ERROR", requestId: "synthetic-request", method: "POST", module: "dataset.query.execute", errorType: "DATABASE", driverCode: "EREQUEST", sqlServerNumber: 229 }]);
  const serialized = JSON.stringify([logs, body]);
  for (const secret of ["SELECT", "synthetic_patient", "synthetic_identifier", "password", "Token", "Server="]) assert.ok(!serialized.includes(secret));
});

test("query failure audit stores classification instead of raw driver errors or parameter suffixes", () => {
  assert.equal(safeAuditErrorCode(Object.assign(new Error("SELECT synthetic_secret"), { code: "EREQUEST", number: 208 })), "EREQUEST:208");
  assert.equal(safeAuditErrorCode(new Error("PARAMETER_REQUIRED:synthetic_secret")), "PARAMETER_REQUIRED");
  assert.equal(safeAuditErrorCode(new Error("password=synthetic_secret")), "INTERNAL_SERVER_ERROR");
});

test("native error classes are distinguished without trusting error.name or messages", () => {
  for (const [error, errorType] of [[new TypeError("synthetic_secret"), "TYPE_ERROR"], [new RangeError("synthetic_secret"), "RANGE_ERROR"], [new SyntaxError("synthetic_secret"), "SYNTAX_ERROR"]] as const) {
    error.name = "SELECT synthetic_secret";
    assert.equal(safeErrorDiagnostic(error).errorType, errorType);
    assert.ok(!JSON.stringify(safeErrorDiagnostic(error)).includes("synthetic_secret"));
  }
});

test("Oracle structured and legacy codes are safe; arbitrary messages and error numbers are omitted", () => {
  const secret = "SELECT synthetic_patient bind password Token connection";
  for (const code of ["ORA-00942", "NJS-011", "DPI-1047"]) {
    const error = Object.assign(new Error(`${code}: ${secret}`), { errorNum: 942 });
    assert.deepEqual(safeErrorDiagnostic(error), { module: "request", errorType: "DATABASE", oracleCode: code, oracleErrorNum: 942 });
    assert.equal(safeAuditErrorCode(error), code);
  }
  assert.deepEqual(safeErrorDiagnostic({ code: "ORA-00942", message: secret }), { module: "request", errorType: "DATABASE", oracleCode: "ORA-00942" });
  for (const value of [0, -1, Infinity, NaN, 1.2, 100000, secret]) {
    assert.deepEqual(safeErrorDiagnostic({ errorNum: value, code: secret, message: `synthetic ${secret} ORA-00942:` }), { module: "request", errorType: "UNEXPECTED" });
  }
});
test("Oracle bind faults have safe hints while SQL/connection failures remain general failures", async t => {
  const logs: unknown[] = [];
  t.mock.method(logger, "error", (fields: unknown) => logs.push(fields));
  for (const [error, expectedStatus, expectedCode] of [
    [new Error("ORACLE_BIND_INVALID"), 400, "ORACLE_BIND_INVALID"],
    [Object.assign(new Error("NJS-011: synthetic_patient SQL password"), { code: "NJS-011" }), 500, "ORACLE_BIND_ERROR"],
    [Object.assign(new Error("ORA-01722: synthetic_patient SQL password"), { errorNum: 1722 }), 500, "INTERNAL_SERVER_ERROR"],
    [Object.assign(new Error("ORA-01017: synthetic_patient SQL password"), { code: "ORA-01017" }), 500, "INTERNAL_SERVER_ERROR"],
  ] as const) {
    await assert.rejects(withErrorModule("dataset.query.execute", async () => { throw error; }));
    let status = 0; let body: any;
    const res = { status: (s: number) => { status = s; return res; }, json: (b: unknown) => { body = b; return res; } };
    errorHandler(error, { id: "synthetic-request", method: "POST" } as Request, res as unknown as Response, () => {});
    assert.equal(status, expectedStatus); assert.equal(body.error.code, expectedCode);
    assert.equal(body.error.requestId, "synthetic-request");
    assert.ok(!JSON.stringify(body).includes("synthetic_patient"));
  }
  for (const secret of ["synthetic_patient", "SQL", "password"]) assert.ok(!JSON.stringify(logs).includes(secret));
});
