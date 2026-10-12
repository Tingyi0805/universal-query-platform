import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { errorHandler } from "./errorHandler.js";
test("unexpected database failures never include SQL, patient bind values or credentials in API responses", () => {
  let body: unknown; let status: number | undefined;
  const response = { status: (code: number) => { status = code; return response; }, json: (value: unknown) => { body = value; return response; } };
  errorHandler(new Error("SELECT synthetic NAME WHERE MRN=00000123; password=synthetic"),
    { id: "synthetic-request", method: "POST", path: "/api/datasets/1/preview" } as Request,
    response as unknown as Response, () => {});
  assert.equal(status, 500);
  assert.deepEqual(body, { error: { code: "INTERNAL_SERVER_ERROR", message: "伺服器發生未預期錯誤。", requestId: "synthetic-request" } });
});
