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
