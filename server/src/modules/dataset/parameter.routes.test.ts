import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import { createDatasetParameterRouter } from "./parameter.routes.js";
import { parameterFixture, syntheticParameter } from "./parameterTestFixture.js";
import type { DatasetRecord } from "./dataset.types.js";
import { errorHandler } from "../../middleware/errorHandler.js";
import { readFileSync } from "node:fs";
async function fixture(run: (request: (path: string, options?: RequestInit) => Promise<{ status: number; body: any }>, f: ReturnType<typeof parameterFixture>) => Promise<void>) {
  const f = parameterFixture();
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.id = "synthetic-request"; req.authUser = { id: 5 } as typeof req.authUser; next(); });
  app.use(createDatasetParameterRouter({ ...f.repository, getDataset: async id => id === 2 ? { sqlText: f.state.sqlText, isArchived: f.state.archived } as DatasetRecord : null }));
  app.use(errorHandler);
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try { await run(async (path, options) => { const response = await fetch(base + path, options); return { status: response.status, body: await response.json() }; }, f); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
test("GET parameters only reads DB for active/archived datasets and returns differences", () => fixture(async (request, f) => {
  for (const archived of [false, true]) {
    f.state.archived = archived;
    const response = await request("/2/parameters");
    assert.equal(response.status, 200); assert.deepEqual(response.body.parameters, [syntheticParameter]);
    assert.deepEqual(response.body.preview.added, ["NEW"]);
  }
  assert.equal(f.state.transactions, 0); assert.ok(f.state.queries.every(q => /^\s*SELECT/.test(q)));
}));
test("read failures return 500 with Request ID, never an empty parameters result", () => fixture(async (request, f) => {
  f.state.failOn = "SELECT";
  const response = await request("/2/parameters");
  assert.equal(response.status, 500); assert.equal(response.body.error.requestId, "synthetic-request");
  assert.equal(response.body.parameters, undefined); assert.ok(!JSON.stringify(response.body).includes("password"));
}));
test("invalid and missing IDs do not synchronize; malformed detection remains read-only", () => fixture(async (request, f) => {
  assert.equal((await request("/bad/parameters")).status, 400);
  assert.equal((await request("/999/parameters")).status, 404);
  f.state.sqlText = "SELECT {{invalid}}";
  assert.equal((await request("/2/parameters")).body.preview.detectionStatus, "FAILED");
  assert.equal(f.state.transactions, 0);
}));
test("sync requires preview; POST stale preview fails without changing saved rows", () => fixture(async (request, f) => {
  const post = (body: unknown) => request("/2/parameters/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await post({})).status, 400); assert.equal(f.state.transactions, 0);
  const previewToken = (await request("/2/parameters")).body.preview.previewToken;
  assert.equal((await post({ previewToken })).status, 200);
  assert.equal((await post({ previewToken })).status, 409);
  assert.equal(f.state.rows.length, 2);
}));
test("production parameter routes retain DESIGN_QUERY gate; dataset create/save never invoke sync", () => {
  const source = readFileSync(new URL("./dataset.routes.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf('requirePermission("DESIGN_QUERY")') < source.indexOf("datasetRouter.use(createDatasetParameterRouter())"));
  assert.ok(!source.includes("syncDatasetParameters"));
});
test("renamed SQL token is an addition plus unused setting, not a metadata rename", () => fixture(async (request, f) => {
  f.state.rows[0]!.Name = "REGNO_NAME";
  f.state.sqlText = "SELECT {{REGNO}}";
  const result = await request("/2/parameters");
  assert.deepEqual(result.body.preview.added, ["REGNO"]);
  assert.deepEqual(result.body.preview.unused, ["REGNO_NAME"]);
  const original = structuredClone(f.state.rows[0]);
  const sync = await request("/2/parameters/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ previewToken: result.body.preview.previewToken, removeNames: [] }) });
  assert.equal(sync.status, 200);
  assert.deepEqual(f.state.rows[0], original);
  assert.equal(f.state.rows[1]!.Name, "REGNO");
}));
