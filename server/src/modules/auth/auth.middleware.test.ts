import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { createServer } from "node:http";
import { createAuthenticateJwt, requirePermission } from "./auth.middleware.js";
import { env } from "../../config/env.js";

test("API uses current server permissions instead of stale JWT grants, and rejects revoked sessions", async () => {
  const previous = env.JWT_SECRET; env.JWT_SECRET = "synthetic-test-key-not-a-production-secret";
  let session: Awaited<ReturnType<typeof import("./auth.repository.js").getTokenSessionState>> = {
    isActive: true, tokenVersion: 1, permissions: [],
  };
  const app = express(); app.use(createAuthenticateJwt(async () => session));
  app.get("/sources", requirePermission("DESIGN_QUERY"), (_req, res) => res.json({ status: "authorized" }));
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const token = jwt.sign({ sub: "1", tokenVersion: 1, permissions: ["DESIGN_QUERY"] }, env.JWT_SECRET);
  const request = (value?: string) => fetch(base + "/sources", { headers: value ? { Authorization: `Bearer ${value}` } : {} });
  try {
    assert.equal((await request()).status, 401);
    assert.equal((await request("invalid")).status, 401);
    assert.equal((await request(token)).status, 403);
    session.permissions = ["DESIGN_QUERY"]; assert.equal((await request(token)).status, 200);
    session.tokenVersion = 2; assert.equal((await request(token)).status, 401);
    session = null; assert.equal((await request(token)).status, 401);
  } finally { env.JWT_SECRET = previous; await new Promise<void>(resolve => server.close(() => resolve())); }
});
