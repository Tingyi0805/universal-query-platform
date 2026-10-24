import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createDatasetVersionRestoreHandler } from "./dataset.routes.js";
import { createAuthenticateJwt, requirePermission } from "../auth/auth.middleware.js";
import { env } from "../../config/env.js";
import { errorHandler } from "../../middleware/errorHandler.js";

async function fixture(run: (request: (authenticated?: boolean) => Promise<{ status: number; body: any }>,
  state: { permissions: string[]; tokenVersion: number; restores: number; reads: number; failure: string }) => Promise<void>) {
  const previous = env.JWT_SECRET;
  env.JWT_SECRET = "synthetic-restore-test-key";
  const state = { permissions: ["DESIGN_QUERY"], tokenVersion: 1, restores: 0, reads: 0, failure: "" };
  const app = express();
  app.use(createAuthenticateJwt(async () => ({ isActive: true, tokenVersion: state.tokenVersion, permissions: state.permissions })));
  app.use(requirePermission("DESIGN_QUERY"));
  app.post("/:id/versions/:versionNo/restore", createDatasetVersionRestoreHandler({
    restoreDatasetVersion: async (id, version, user, context) => {
      assert.deepEqual([id, version, user], [2, 1, 5]); state.restores++;
      assert.equal(context?.ipAddress, "127.0.0.1");
      if (state.failure) throw new Error(state.failure);
    },
    getDataset: async () => { state.reads++; return null; },
  }));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const token = jwt.sign({ sub: "5", tokenVersion: 1 }, env.JWT_SECRET);
  try {
    await run(async (authenticated = true) => {
      const response = await fetch(base + "/2/versions/1/restore", {
        method: "POST", headers: authenticated ? { Authorization: `Bearer ${token}` } : {},
      });
      return { status: response.status, body: await response.json() };
    }, state);
  } finally {
    env.JWT_SECRET = previous;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

test("restore requires current DESIGN_QUERY and valid JWT/TokenVersion before repository access", () => fixture(async (request, state) => {
  assert.equal((await request(false)).status, 401);
  state.permissions = []; assert.equal((await request()).status, 403);
  state.permissions = ["DESIGN_QUERY"]; state.tokenVersion = 2;
  assert.equal((await request()).status, 401);
  assert.equal(state.restores, 0); assert.equal(state.reads, 0);
}));

test("sensitivity refusal is explicit 409 without success audit or dataset response", () => fixture(async (request, state) => {
  state.failure = "DATASET_SENSITIVITY_REVIEW_REQUIRED";
  const response = await request();
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, state.failure);
  assert.equal(response.body.status, undefined); assert.equal(response.body.dataset, undefined);
  assert.equal(state.reads, 0);
}));

test("transaction errors cannot return success, definition, or success audit", () => fixture(async (request, state) => {
  state.failure = "SYNTHETIC_TRANSACTION_FAILED";
  const response = await request();
  assert.equal(response.status, 500); assert.equal(response.body.error.code, "INTERNAL_SERVER_ERROR");
  assert.equal(response.body.status, undefined); assert.equal(response.body.dataset, undefined);
  assert.ok(!JSON.stringify(response.body).includes(state.failure));
  assert.equal(state.reads, 0);
}));

test("successful restore reloads only after the transaction-owned audit completes", () => fixture(async (request, state) => {
  const response = await request();
  assert.equal(response.status, 200); assert.equal(response.body.status, "OK");
  assert.equal(state.restores, 1); assert.equal(state.reads, 1);
}));

test("restore route has no best-effort success audit fallback", () => {
  const source = readFileSync(new URL("./dataset.routes.ts", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf("export const createDatasetVersionRestoreHandler"),
    source.indexOf('datasetRouter.post("/:id/versions/:versionNo/restore"'));
  assert.ok(!handler.includes("tryWriteAuditEvent"));
  assert.ok(!handler.includes("DATASET_VERSION_RESTORED"));
});

test("production restore remains behind router JWT and DESIGN_QUERY gates", () => {
  const source = readFileSync(new URL("./dataset.routes.ts", import.meta.url), "utf8");
  const gate = source.indexOf('datasetRouter.use(authenticateJwt, requirePermission("DESIGN_QUERY"))');
  assert.ok(gate >= 0);
  assert.ok(source.indexOf('datasetRouter.post("/:id/versions/:versionNo/restore", createDatasetVersionRestoreHandler())') > gate);
});
