import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { errorHandler } from "./errorHandler.js";
import { SecurityContractError } from "../modules/securityContract/securityContract.js";

test("typed security errors expose safe status/code but never diagnostic payloads", () => {
  for (const [code, expectedStatus] of [["SECURITY_SCHEMA_REQUIRED", 503], ["SECURITY_VERSION_INVALID", 400], ["SECURITY_VERSION_EXHAUSTED", 409]] as const) {
    let body: unknown; let status: number | undefined;
    const response = { status: (value: number) => { status = value; return response; }, json: (value: unknown) => { body = value; return response; } };
    const error = new SecurityContractError(code);
    error.message = "synthetic-private-diagnostic";
    errorHandler(error, { id: "synthetic-request" } as Request, response as unknown as Response, () => {});
    assert.equal(status, expectedStatus);
    assert.deepEqual(body, { error: { code, message: "安全契約驗證未通過，請確認 Schema 與版本。", requestId: "synthetic-request" } });
  }
});
test("unexpected database failures never include SQL, patient bind values or credentials in API responses", () => {
  let body: unknown; let status: number | undefined;
  const response = { status: (code: number) => { status = code; return response; }, json: (value: unknown) => { body = value; return response; } };
  errorHandler(new Error("SELECT synthetic NAME WHERE MRN=00000123; password=synthetic"),
    { id: "synthetic-request", method: "POST", path: "/api/datasets/1/preview" } as Request,
    response as unknown as Response, () => {});
  assert.equal(status, 500);
  assert.deepEqual(body, { error: { code: "INTERNAL_SERVER_ERROR", message: "伺服器發生未預期錯誤。", requestId: "synthetic-request" } });
});
