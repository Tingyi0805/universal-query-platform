import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { createServer } from "node:http";
import { env } from "../../config/env.js";
import { createAuthenticateJwt } from "../auth/auth.middleware.js";
import { createQuerySourceExecution, type ExecutionBinding, type ExecutionDependencies } from "./dashboardQuerySourceExecution.js";
import { createQuerySourceExecutionRouter } from "./dashboardQuerySourceExecution.routes.js";
import { QuerySourceError } from "./dashboardQuerySources.service.js";
import { getDashboardPageSnapshot } from "./dashboardPageSnapshot.js";

const subject = { userId: 1, tokenVersion: 1, tokenHash: "synthetic-session" };
function fixture() {
  const binding = (key: string, queryDefinitionId: number): ExecutionBinding => ({ dashboardId: 1, sourceId: queryDefinitionId + 100, sourceKey: key,
    queryDefinitionId, bindingRevision: 1, managed: true, dashboardActive: false, enabled: true,
    parameters: { WARD: "SYNTHETIC" }, refreshSeconds: 30, pageSeconds: 5, pageSize: 1, maxRows: 10 });
  const control = {
    enabled: true, schema: true, session: { isActive: true, tokenVersion: 1, permissions: ["DESIGN_QUERY", "EXECUTE_QUERY"] },
    bindings: { WARD: binding("WARD", 21), ROOM: binding("ROOM", 22) } as Record<string, ExecutionBinding>,
    queries: new Map([[21, { id: 21, datasetId: 99, isActive: true, isPublished: true, isArchived: false }],
      [22, { id: 22, datasetId: 100, isActive: true, isPublished: true, isArchived: false }]]),
    denied: new Set<number>(), revision: "acl-v1", policyVersion: 1, datasourceActive: true,
    executions: [] as number[], audits: [] as Parameters<ExecutionDependencies["audit"]>[0][],
    failExecute: false, failAudit: false, missingAudit: false,
    afterExecute: () => {}, afterAudit: () => {},
  };
  const deps: ExecutionDependencies = {
    loadBinding: async (_id, key) => {
      if (!control.schema) throw new QuerySourceError("QUERY_SOURCE_SCHEMA_REQUIRED", 503);
      if (!control.bindings[key]) throw new QuerySourceError("DASHBOARD_SOURCE_NOT_FOUND", 404);
      return structuredClone(control.bindings[key]!);
    },
    getSession: async () => structuredClone(control.session),
    getQuery: async id => structuredClone(control.queries.get(id)) as Awaited<ReturnType<ExecutionDependencies["getQuery"]>>,
    getAccess: async (_user, id) => control.denied.has(id) ? null : { canView: true, canExecute: true } as NonNullable<Awaited<ReturnType<ExecutionDependencies["getAccess"]>>>,
    getAccessRevision: async () => control.revision,
    getDataset: async id => ({ id, dataSourceId: 4, maxRows: 10, isActive: true, isArchived: false,
      sqlText: "SELECT {{WARD}}" } as NonNullable<Awaited<ReturnType<ExecutionDependencies["getDataset"]>>>),
    getParameters: async () => [{ name: "WARD", dataType: "STRING", controlType: "TEXT", isRequired: true, defaultValue: null } as Awaited<ReturnType<ExecutionDependencies["getParameters"]>>[number]],
    getDataSource: async () => ({ isActive: control.datasourceActive, revision: "source-v1" }),
    getSensitivity: async () => ({ version: control.policyVersion, columns: [
      { columnName: "NAME", sensitivityType: "NAME", deviceMaskMode: "NAME" },
      { columnName: "MRN", sensitivityType: "MRN", deviceMaskMode: "OMIT" },
    ] }),
    execute: async (id, _values, maxRows) => {
      assert.equal(maxRows, 10); control.executions.push(id);
      if (control.failExecute) throw new Error("private SQL bind token connection-string");
      control.afterExecute();
      return { columns: [{ name: "NAME" }, { name: "MRN" }], rows: [{ NAME: "測試患者甲", MRN: "00000123" },
        { NAME: "測試患者乙", MRN: "00000456" }], rowCount: 2, elapsedMs: 1, truncated: false };
    },
    audit: async input => {
      if (control.failAudit) throw new Error("private audit token");
      control.audits.push(input); control.afterAudit(); return control.missingAudit ? null : control.audits.length;
    },
  };
  return { control, deps, service: createQuerySourceExecution(deps, () => control.enabled) };
}
test("Query-only execution derives Dataset from Query, masks and audits only the requested page", async () => {
  const f = fixture();
  // No historical DatasetId exists in the execution contract; any stray legacy field is ignored.
  Object.assign(f.control.bindings.WARD!, { datasetId: 3 });
  const first = await f.service.page(1, "WARD", subject, { page: 1 });
  assert.deepEqual(f.control.executions, [99]); assert.equal(first.result.rows.length, 1);
  assert.equal(first.result.rows[0]!.NAME, "測○○○甲"); assert.equal(first.result.rows[0]!.MRN, undefined);
  assert.equal(f.control.audits[0]!.queryDefinitionId, 21); assert.equal(f.control.audits[0]!.datasetId, 99);
  assert.equal(f.control.audits[0]!.rows[0]!.MRN, "00000123");
  assert.equal(JSON.stringify(first).includes("00000123"), false);
  const second = await f.service.page(1, "WARD", subject, { page: 2, snapshotId: first.snapshotId });
  assert.equal(second.page, 2); assert.equal(f.control.executions.length, 1);
  const snapshot = getDashboardPageSnapshot(first.snapshotId, -1, 1)!;
  assert.deepEqual([snapshot.sourceKey, snapshot.queryId, snapshot.bindingRevision, snapshot.accessRevision,
    snapshot.authorizationRevision, snapshot.modeVersion], ["WARD", 21, 1, "acl-v1", 1, "QUERY_ONLY_PREVIEW_V1"]);
});
test("source, Dashboard, account and token-session namespaces cannot share snapshots", async () => {
  const f = fixture(), first = await f.service.page(1, "WARD", subject, { page: 1 });
  await assert.rejects(f.service.page(1, "ROOM", subject, { page: 1, snapshotId: first.snapshotId }), { code: "DASHBOARD_SNAPSHOT_EXPIRED" });
  await assert.rejects(f.service.page(1, "WARD", { ...subject, userId: 2 }, { page: 1, snapshotId: first.snapshotId }), { code: "DASHBOARD_SNAPSHOT_EXPIRED" });
  await assert.rejects(f.service.page(1, "WARD", { ...subject, tokenHash: "other-token" }, { page: 1, snapshotId: first.snapshotId }), { code: "DASHBOARD_SNAPSHOT_EXPIRED" });
  assert.equal(getDashboardPageSnapshot(first.snapshotId, -1, 2), null);
});
for (const changed of ["binding", "recreated", "acl", "policy", "query"] as const) test(`${changed} version invalidates existing snapshots`, async () => {
  const f = fixture(), first = await f.service.page(1, "WARD", subject, { page: 1 });
  if (changed === "binding") f.control.bindings.WARD!.bindingRevision++;
  if (changed === "recreated") f.control.bindings.WARD!.sourceId++;
  if (changed === "acl") f.control.revision = "acl-v2";
  if (changed === "policy") f.control.policyVersion++;
  if (changed === "query") f.control.queries.get(21)!.datasetId = 101;
  await assert.rejects(f.service.page(1, "WARD", subject, { page: 1, snapshotId: first.snapshotId }), { code: "DASHBOARD_SNAPSHOT_EXPIRED" });
  assert.equal(f.control.executions.length, 1);
});
for (const failure of ["unpublished", "inactive", "revoked", "token", "parameters", "pending", "schema", "datasource"] as const)
  test(`${failure} is rejected before query execution without affecting sibling sources`, async () => {
    const f = fixture();
    if (failure === "unpublished") f.control.queries.get(21)!.isPublished = false;
    if (failure === "inactive") f.control.queries.get(21)!.isActive = false;
    if (failure === "revoked") f.control.denied.add(21);
    if (failure === "token") f.control.session.tokenVersion++;
    if (failure === "parameters") f.control.bindings.WARD!.parameters = {};
    if (failure === "pending") f.control.bindings.WARD!.queryDefinitionId = null;
    if (failure === "schema") f.control.schema = false;
    if (failure === "datasource") f.control.datasourceActive = false;
    await assert.rejects(f.service.page(1, "WARD", subject, { page: 1 }));
    assert.equal(f.control.executions.length, 0);
    if (!["token", "schema", "datasource"].includes(failure)) {
      assert.equal((await f.service.page(1, "ROOM", subject, { page: 1 })).sourceKey, "ROOM");
      assert.deepEqual(f.control.executions, [100]);
    }
  });
test("capability is default off; active/unmanaged dashboards cannot bypass staging protection", async () => {
  const f = fixture(); f.control.enabled = false;
  await assert.rejects(f.service.page(1, "WARD", subject, { page: 1 }), { code: "QUERY_SOURCE_EXECUTION_DISABLED" });
  f.control.enabled = true; f.control.bindings.WARD!.dashboardActive = true;
  await assert.rejects(f.service.page(1, "WARD", subject, { page: 1 }), { code: "QUERY_SOURCE_PREVIEW_REQUIRES_STAGED_DASHBOARD" });
  f.control.bindings.WARD!.dashboardActive = false; f.control.bindings.WARD!.managed = false;
  await assert.rejects(f.service.page(1, "WARD", subject, { page: 1 }), { code: "QUERY_SOURCE_PREVIEW_REQUIRES_STAGED_DASHBOARD" });
  assert.equal(f.control.executions.length, 0);
});
test("Query ACL cannot substitute for the existing global EXECUTE_QUERY permission", async () => {
  const f = fixture(); f.control.session.permissions = ["DESIGN_QUERY"];
  await assert.rejects(f.service.page(1, "WARD", subject, { page: 1 }), { code: "QUERY_SOURCE_QUERY_FORBIDDEN", status: 403 });
  assert.equal(f.control.executions.length, 0);
});
test("permissions changed during SQL or audit fail closed; failed executions do not poison healthy snapshots", async () => {
  for (const stage of ["afterExecute", "afterAudit"] as const) {
    const f = fixture(); f.control[stage] = () => f.control.denied.add(21);
    await assert.rejects(f.service.page(1, "WARD", subject, { page: 1 }), { code: "QUERY_SOURCE_QUERY_FORBIDDEN" });
  }
  const f = fixture(), healthy = await f.service.page(1, "ROOM", subject, { page: 1 });
  f.control.failExecute = true; await assert.rejects(f.service.page(1, "WARD", subject, { page: 1 }));
  f.control.failExecute = false;
  assert.equal((await f.service.page(1, "ROOM", subject, { page: 2, snapshotId: healthy.snapshotId })).snapshotId, healthy.snapshotId);
});
test("audit is mandatory for nonempty pages and parameters remain classified", async () => {
  const f = fixture(); f.control.missingAudit = true;
  await assert.rejects(f.service.page(1, "WARD", subject, { page: 1 }), { code: "PATIENT_AUDIT_NOT_CONFIGURED" });
  f.control.missingAudit = false; f.control.failAudit = true;
  await assert.rejects(f.service.page(1, "WARD", subject, { page: 1 }));
  f.control.failAudit = false; f.control.bindings.WARD!.parameters = {};
  await assert.rejects(f.service.page(1, "WARD", subject, { page: 1 }), { code: "PARAMETER_REQUIRED", status: 400 });
});
test("Mock HTTP uses real JWT/TokenVersion middleware and never exposes private failures", async () => {
  const f = fixture(), oldSecret = env.JWT_SECRET; env.JWT_SECRET = "isolated-query-source-test-secret";
  const token = jwt.sign({ sub: "1", tokenVersion: 1 }, env.JWT_SECRET);
  const app = express(); app.use(express.json()); app.use(createAuthenticateJwt(f.deps.getSession));
  app.use(createQuerySourceExecutionRouter(f.service));
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/1/query-sources/v1/WARD/page`;
  const request = async (credential = token) => {
    const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" }, body: '{"page":1}' });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await request("invalid")).status, 401);
    f.control.enabled = false; assert.equal((await request()).status, 404); f.control.enabled = true;
    f.control.denied.add(21); assert.equal((await request()).status, 403); f.control.denied.clear();
    f.control.failExecute = true;
    const failed = await request(); assert.equal(failed.status, 503); assert.equal(JSON.stringify(failed.body).includes("connection-string"), false);
    f.control.failExecute = false; assert.equal((await request()).status, 200);
    f.control.session.tokenVersion = 2; assert.equal((await request()).status, 401);
  } finally { env.JWT_SECRET = oldSecret; await new Promise<void>(resolve => server.close(() => resolve())); }
});
