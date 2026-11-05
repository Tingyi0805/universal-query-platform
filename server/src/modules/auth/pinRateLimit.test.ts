import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { createPinRateLimiter } from "./pinRateLimit.js";
test("PIN management rate limit bounds attempts per authenticated user and resets after deadline", () => {
  let now = 0;
  const guard = createPinRateLimiter(() => now, 2, 60000);
  let allowed = 0,
    status = 0;
  let body: unknown;
  const res = {
    setHeader: () => {},
    status: (code: number) => {
      status = code;
      return res;
    },
    json: (value: unknown) => {
      body = value;
      return res;
    },
  } as unknown as Response;
  const req = { authUser: { id: 1 }, id: "synthetic-request" } as Request;
  guard(req, res, () => {
    allowed++;
  });
  guard(req, res, () => {
    allowed++;
  });
  guard(req, res, () => {
    allowed++;
  });
  assert.equal(allowed, 2);
  assert.equal(status, 429);
  assert.ok(!JSON.stringify(body).includes("password"));
  now = 60001;
  guard(req, res, () => {
    allowed++;
  });
  assert.equal(allowed, 3);
});
