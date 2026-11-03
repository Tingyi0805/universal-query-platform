import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createWorkstationQueryRouter } from "./workstationQuery.routes.js";
import { workstationSessions } from "./workstationSession.repository.js";
import { credentialCookie, sessionCookie } from "./workstationCookies.js";
import { createQueryDelivery, defaultQueryDeliveryDependencies, QueryDeliveryError } from "../queryDefinition/queryDelivery.js";
import { defaultQueryRuntimeDependencies } from "../queryDefinition/queryRuntime.routes.js";
const credential = `12345678-1234-4234-8234-123456789abc.${Buffer.alloc(32, 7).toString("base64url")}`;
const token = `12345678-1234-4234-8234-123456789abd.${Buffer.alloc(32, 8).toString("base64url")}`;
async function fixture(run: (f: { state: { active: boolean; phase: string; successes: number; failures: number; executes: number };
  request: (path: string, method?: string, cookie?: string) => Promise<Response> }) => Promise<void>) {
  const state = { active: true, phase: "", successes: 0, failures: 0, executes: 0 };
  const sessions = { ...workstationSessions, read: async () => state.active ? {
    workstationId: 7, credentialVersion: 1, generation: "2", userId: 8, username: "synthetic", displayName: "Synthetic",
    tokenVersion: 1, pinVersion: 1, permissions: ["VIEW_QUERY", "EXECUTE_QUERY"], sessionId: "B", authMethod: "PIN" as const,
  } : null };
  const query = { id: 4, datasetId: 7, name: "Rooms", code: "ROOMS", isPublished: true, isActive: true, isArchived: false, canView: true, canExecute: true };
  const delivery = createQueryDelivery({ ...defaultQueryDeliveryDependencies,
    access: async () => query as never, accessRevision: async () => "1", reports: async () => [],
    dataset: async () => ({ id: 7, dataSourceId: 1, isActive: true, isArchived: false, sqlText: "SELECT ROOM" }) as never,
    snapshot: async () => ({ datasetId: 7, definitionVersion: "0000000000000001", sensitivityVersion: "1", patientAuditVersion: "0",
      policy: { state: "CONFIRMED", version: "1", rules: [{ columnName: "ROOM", mode: "NONE" }] },
      patientAudit: { configured: false, enabled: false, patientKeyColumn: null } }),
    pinPolicy: async () => [{ ColumnName: "ROOM", SensitivityType: "OTHER", Version: "1" }],
    execute: async () => { state.executes++; if (state.phase === "sql") state.active = false;
      return { columns: [{ name: "ROOM" }, { name: "SECRET" }], rows: [{ ROOM: "R1", SECRET: "NEVER-DELIVER" }], rowCount: 1, truncated: false, elapsedMs: 1 }; },
  });
  const app = express(); app.use(express.json());
  app.use(createWorkstationQueryRouter(sessions, { ...defaultQueryRuntimeDependencies, delivery,
    listAccessibleQueries: async () => [query] as never, listDatasetParameters: async () => [], startAudit: async () => 1,
    finalizeDeliveryAudit: async (_id, _stats, validate) => {
      if (state.phase === "audit") state.active = false;
      await validate({} as never); state.successes++;
      if (state.phase === "after-audit") state.active = false;
    }, completeAuditFailure: async () => { state.failures++; },
  }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error instanceof QueryDeliveryError ? error.status : 503).json({ error: { code: "REFUSED" } });
  });
  const server = createServer(app); await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try { await run({ state, request: (path, method = "GET", cookie = `${credentialCookie}=${credential}; ${sessionCookie}=${token}`) => fetch(base + path, {
    method, headers: { "content-type": "application/json", cookie }, ...(method === "POST" ? { body: JSON.stringify({ values: {} }) } : {}),
  }) }); } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
}
test("PIN query HTTP uses existing delivery masking and exposes only permitted runtime endpoints", () => fixture(async f => {
  const response = await f.request("/4/execute", "POST"); assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).result.rows, [{ ROOM: "R1" }]); assert.equal(f.state.successes, 1);
  for (const path of ["/4/export/csv", "/4/export/excel", "/4/favorite", "/contexts"]) assert.equal((await f.request(path, "POST")).status, 403);
  assert.equal((await f.request("/4", "GET", "")).status, 401);
}));
test("PIN revocation during SQL, final Audit and after Audit suppresses all old rows", () => fixture(async f => {
  for (const phase of ["sql", "audit", "after-audit"]) {
    f.state.active = true; f.state.phase = phase;
    const response = await f.request("/4/execute", "POST"); assert.equal(response.status, 401);
    assert.ok(!(await response.text()).includes("NEVER-DELIVER"));
  }
  assert.equal(f.state.failures, 3);
}));
