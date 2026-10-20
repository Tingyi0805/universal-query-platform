import { SecurityContractError } from "../securityContract/securityContract.js";
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { createServer } from "node:http";
import { env } from "../../config/env.js";
import { createAuthenticateJwt } from "../auth/auth.middleware.js";
import { createQuerySourceExecution, type ExecutionBinding, type ExecutionDependencies } from "./dashboardQuerySourceExecution.js";
import { createQuerySourceExecutionRouter } from "./dashboardQuerySourceExecution.routes.js";
import { createQueryDeviceRouter, type QueryDeviceDependencies } from "./dashboardQueryDevice.routes.js";
import { QuerySourceError } from "./dashboardQuerySources.service.js";
import { getDashboardPageSnapshot } from "./dashboardPageSnapshot.js";
import sql from "mssql";
import { createDashboardApprovalEvidenceReader } from "./dashboardApproval.repository.js";

const subject = { userId: 1, tokenVersion: 1, tokenHash: "synthetic-session" };
function fixture() {
  const binding = (key: string, queryDefinitionId: number): ExecutionBinding => ({ dashboardId: 1, sourceId: queryDefinitionId + 100, sourceKey: key,
    queryDefinitionId, bindingRevision: 1, managed: true, dashboardActive: false, enabled: true,
    deviceMasks: { NAME: "INHERIT", MRN: "INHERIT" }, sourceMasks: { WARD: { NAME: "INHERIT", MRN: "INHERIT" }, ROOM: { NAME: "INHERIT", MRN: "INHERIT" } },
    parameters: { WARD: "SYNTHETIC" }, refreshSeconds: 30, pageSeconds: 5, pageSize: 1, maxRows: 10 });
  const control = {
    enabled: true, schema: true, session: { isActive: true, tokenVersion: 1, permissions: ["DESIGN_QUERY", "EXECUTE_QUERY"] },
    bindings: { WARD: binding("WARD", 21), ROOM: binding("ROOM", 22) } as Record<string, ExecutionBinding>,
    queries: new Map([[21, { id: 21, datasetId: 99, isActive: true, isPublished: true, isArchived: false }],
      [22, { id: 22, datasetId: 100, isActive: true, isPublished: true, isArchived: false }]]),
    patientVersion: "1", metadataProof: "proof-v1", denied: new Set<number>(), revision: "acl-v1", policyVersion: 1, datasourceActive: true,
    parentRowVersion: 1n, sourceRowVersions: { WARD: 2n, ROOM: 3n },
    executions: [] as number[], audits: [] as Parameters<ExecutionDependencies["audit"]>[0][],
    failExecute: false, failAudit: false, missingAudit: false,
    afterExecute: () => {}, afterAudit: () => {},
  };
  const deps: ExecutionDependencies = {
    // Use the production evidence reader with a synthetic SQL driver, not a JSON-only version stub.
    getApprovalEvidence: createDashboardApprovalEvidenceReader({
      getPool: async () => ({}) as sql.ConnectionPool,
      createTransaction: () => ({ begin: async () => {}, commit: async () => {}, rollback: async () => {} }) as unknown as sql.Transaction,
      schema: async () => {}, // Catalog validation has its own production-repository tests.
      createRequest: () => ({
        input() { return this; },
        async query(statement: string) {
          assert.doesNotMatch(statement, /INSERT|UPDATE|DELETE/i);
          assert.match(statement, /HOLDLOCK/);
          if (statement.includes("DashboardDataSource")) return { recordset: Object.entries(control.sourceRowVersions).map(([SourceKey, revision], index) => ({
            Id: index + 5, SourceKey, DatasetId: index + 99, ApprovalRowVersion: Buffer.from(revision.toString(16).padStart(16, "0"), "hex"),
          })) };
          return { recordset: [{ QueryDefinitionId: 21, ApprovalRowVersion: Buffer.from(control.parentRowVersion.toString(16).padStart(16, "0"), "hex") }] };
        },
      }) as unknown as sql.Request,
    }),
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
    getSensitivity: async () => ({ version: control.policyVersion, patientAudit: { version: control.patientVersion, fingerprint: control.metadataProof }, columns: [
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
  await assert.rejects(f.service.page(1, "WARD", subject, { page: 1 }), { code: "QUERY_SOURCE_PERMISSION_REVOKED", status: 403 });
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
  const request = async (credential = token, snapshotId?: string) => {
    const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
      body: JSON.stringify({ page: 1, ...(snapshotId ? { snapshotId } : {}) }) });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await request("invalid")).status, 401);
    f.control.enabled = false; assert.equal((await request()).status, 404); f.control.enabled = true;
    f.control.denied.add(21); assert.equal((await request()).status, 403); f.control.denied.clear();
    f.control.failExecute = true;
    const failed = await request(); assert.equal(failed.status, 503); assert.equal(JSON.stringify(failed.body).includes("connection-string"), false);
    f.control.failExecute = false; const first = await request(); assert.equal(first.status, 200);
    f.control.afterAudit = () => { f.control.session.tokenVersion++; };
    const revoked = await request(); assert.equal(revoked.status, 401); assert.equal(revoked.body.result, undefined);
    const cached = await request(token, first.body.snapshotId); assert.equal(cached.status, 401); assert.equal(cached.body.result, undefined);
  } finally { env.JWT_SECRET = oldSecret; await new Promise<void>(resolve => server.close(() => resolve())); }
});
test("device PRIMARY and extra sources use stored delegator ACL, isolated snapshots and mandatory audit", async () => {
  const f = fixture();
  f.deps.getSensitivity = async () => ({ version: f.control.policyVersion, columns: [
    { columnName: "NAME", sensitivityType: "NAME", deviceMaskMode: "CUSTOM", customMask: { prefix: 1, suffix: 1, symbol: "#" } },
    { columnName: "MRN", sensitivityType: "MRN", deviceMaskMode: "OMIT" },
  ] });
  f.control.bindings.PRIMARY = { ...f.control.bindings.WARD!, sourceKey: "PRIMARY", sourceId: 1 };
  for (const binding of Object.values(f.control.bindings)) Object.assign(binding, { dashboardActive: true, mode: "QUERY_ONLY", modeRevision: 1, referenced: true });
  let valid = true, modeVersion = 1, grantVersion = 1;
  const owners: number[] = [];
  const original = f.deps.getAccess;
  f.deps.getAccess = async (user, query) => { owners.push(user); return original(user, query); };
  const deps: QueryDeviceDependencies = {
    mode: async () => ({ mode: "QUERY_ONLY", version: modeVersion }),
    dashboard: async () => ({ id: 1, name: "synthetic", parameters: { PRIVATE: "synthetic-secret" }, refreshSeconds: 30, pageSize: 1, pageSeconds: 5 } as unknown as NonNullable<Awaited<ReturnType<QueryDeviceDependencies["dashboard"]>>>),
    checkDevice: async () => valid ? { status: "VALID", device: { id: 7, dashboardId: 1, createdByUserId: 2,
      authorizationRevision: f.control.session.tokenVersion, queryModeGrantVersion: grantVersion, delegatorTokenVersion: 1,
      lastUsedAtUtc: new Date().toISOString() } as Extract<Awaited<ReturnType<QueryDeviceDependencies["checkDevice"]>>, { status: "VALID" }>["device"] } : { status: "DISABLED" },
  };
  const app = express(); app.use(express.json()); app.use(createQueryDeviceRouter(f.service, deps));
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = async (key: string, snapshotId?: string) => {
    const path = key === "PRIMARY" ? "/device/1/page" : `/device/1/data-sources/${key}/page`;
    const response = await fetch(base + path, { method: "POST", headers: { "X-Dashboard-Device-Token": "A".repeat(43), "Content-Type": "application/json" },
      body: JSON.stringify({ page: 1, ...(snapshotId ? { snapshotId } : {}) }) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const primary = await request("PRIMARY"), room = await request("ROOM");
    assert.equal(primary.status, 200); assert.equal(room.status, 200);
    assert.deepEqual(primary.body.result.rows, [{ NAME: "測###甲" }]);
    assert.deepEqual(room.body.result.rows, [{ NAME: "測###甲" }]);
    assert.ok(!JSON.stringify([primary.body, room.body]).includes("測試患者甲"));
    assert.equal(primary.body.dashboard.parameters, undefined);
    assert.ok(owners.length && owners.every(id => id === 2)); // Never inherits requester/designer 1.
    assert.equal(f.control.audits[0]!.dashboardDeviceId, 7); assert.equal(f.control.audits[0]!.userId, null);
    assert.equal(JSON.stringify(primary.body).includes("00000123"), false);
    assert.equal((await request("ROOM", primary.body.snapshotId)).status, 409);
    f.control.denied.add(21); assert.equal((await request("WARD")).status, 403);
    assert.equal((await request("PRIMARY", primary.body.snapshotId)).status, 403);
    assert.equal((await request("ROOM", room.body.snapshotId)).status, 200);
    f.control.denied.clear();
    f.control.bindings.WARD!.parameters = {}; assert.equal((await request("WARD")).status, 400);
    assert.equal((await request("ROOM", room.body.snapshotId)).status, 200);
    f.control.bindings.WARD!.parameters = { WARD: "SYNTHETIC" };
    f.control.failExecute = true; assert.equal((await request("WARD")).status, 503); f.control.failExecute = false;
    assert.equal((await request("ROOM", room.body.snapshotId)).status, 200);
    modeVersion = 2; assert.equal((await request("ROOM", room.body.snapshotId)).status, 401);
    modeVersion = 1; grantVersion = 0; assert.equal((await request("PRIMARY")).status, 401);
    grantVersion = 1; f.control.session.tokenVersion = 2; assert.equal((await request("PRIMARY")).status, 401);
    f.control.session.tokenVersion = 1; f.control.session.permissions = ["DESIGN_QUERY"];
    assert.equal((await request("PRIMARY")).status,401);assert.equal((await request("ROOM")).status,401);
    f.control.session.permissions = ["DESIGN_QUERY","EXECUTE_QUERY"]; valid = false; assert.equal((await request("PRIMARY")).status, 401);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
test("Query-only malformed/conflicting policy cannot disclose cached data or poison another source", async () => {
  const f = fixture(); const first = await f.service.page(1, "WARD", subject, { page: 1 });
  const original = f.deps.getSensitivity;
  f.deps.getSensitivity = async id => id === 99 ? { version: 1, columns: [
    { columnName: "NAME", sensitivityType: "NAME", deviceMaskMode: "NAME" },
    { columnName: "name", sensitivityType: "OTHER", deviceMaskMode: "NONE" },
  ] } : original(id);
  await assert.rejects(f.service.page(1, "WARD", subject, { page: 1, snapshotId: first.snapshotId }), { code: "QUERY_SOURCE_SENSITIVITY_POLICY_INVALID", status: 503 });
  const healthy = await f.service.page(1, "ROOM", subject, { page: 1 });
  assert.ok(!JSON.stringify(healthy).includes("00000123"));
  f.deps.getSensitivity = async () => null as any;
  await assert.rejects(f.service.page(1, "ROOM", subject, { page: 1 }), { code: "QUERY_SOURCE_SENSITIVITY_POLICY_INVALID", status: 503 });
});
test("Query-only PRIMARY strengthens Dashboard masks without granting unapproved fields or affecting extra sources", async () => {
  const f = fixture(); f.control.bindings.PRIMARY = { ...f.control.bindings.WARD!, sourceKey: "PRIMARY", sourceId: 1, deviceMasks: { NAME: "FULL", MRN: "NONE", UNAPPROVED: "NONE" } };
  const page = await f.service.page(1, "PRIMARY", subject, { page: 1 });
  assert.deepEqual(page.result.rows[0], { NAME: "○○○○" });
  const extra = await f.service.page(1, "WARD", subject, { page: 1 }); assert.equal(extra.result.rows[0]!.NAME, "測○○○甲");
  f.control.bindings.PRIMARY.deviceMasks = { NAME: "NONE" };
  await assert.rejects(f.service.page(1, "PRIMARY", subject, { page: 1, snapshotId: page.snapshotId }), { code: "DASHBOARD_SNAPSHOT_EXPIRED" });
  const refreshed = await f.service.page(1, "PRIMARY", subject, { page: 1 }); assert.equal(refreshed.result.rows[0]!.NAME, "測○○○甲");
});
test("Query-only missing policy rejects before execution, never treating it as a nonsensitive Dataset", async () => {
  const f = fixture(); f.deps.getSensitivity = async () => ({ version: 0, columns: [] });
  await assert.rejects(f.service.page(1, "WARD", subject, { page: 1 }), { code: "QUERY_SOURCE_SENSITIVITY_POLICY_REQUIRED", status: 503 });
  assert.deepEqual(f.control.executions, []);
});
for (const key of ["PRIMARY", "WARD"]) test(`Query-only ${key}: CUSTOM inheritance, explicit approvals and policy revision guard snapshots`, async () => {
  const f = fixture(); if (key === "PRIMARY") f.control.bindings.PRIMARY = { ...f.control.bindings.WARD!, sourceKey: "PRIMARY", sourceId: 1 };
  f.deps.getSensitivity = async () => ({ version: f.control.policyVersion, columns: [
    { columnName: "NAME", sensitivityType: "NAME", deviceMaskMode: "CUSTOM", customMask: { prefix: 1, suffix: 1, symbol: "#" } },
    { columnName: "MRN", sensitivityType: "MRN", deviceMaskMode: "OMIT" },
  ] });
  const select = (mode: string) => { const binding = f.control.bindings[key]!;
    if (key === "PRIMARY") binding.deviceMasks = { NAME: mode, MRN: "FULL" };
    else binding.sourceMasks = { WARD: { NAME: mode, MRN: "FULL" } };
  };
  select("INHERIT"); const first = await f.service.page(1, key, subject, { page: 1 }); assert.deepEqual(first.result.rows, [{ NAME: "測###甲" }]);
  select("FULL"); const full = await f.service.page(1, key, subject, { page: 1 }); assert.deepEqual(full.result.rows, [{ NAME: "○○○○" }]);
  select("OMIT"); assert.deepEqual((await f.service.page(1, key, subject, { page: 1 })).result.columns, []);
  select("INHERIT"); f.control.policyVersion++; await assert.rejects(f.service.page(1, key, subject, { page: 1, snapshotId: first.snapshotId }), { code: "DASHBOARD_SNAPSHOT_EXPIRED" });
  f.deps.getSensitivity = async () => ({ version: f.control.policyVersion, columns: [{ columnName: "RENAMED", sensitivityType: "NAME", deviceMaskMode: "FULL" }] });
  assert.deepEqual((await f.service.page(1, key, subject, { page: 1 })).result.columns, []);
});
test("Query-only Dataset policy alone and PRIMARY approvals never authorize additional sources", async () => {
  const f = fixture(); delete f.control.bindings.WARD!.sourceMasks;
  assert.deepEqual((await f.service.page(1, "WARD", subject, { page: 1 })).result.rows, [{}]);
});

for (const changed of ["patientVersion", "metadataProof"] as const) test(`Query-only ${changed} invalidates cached pages`, async () => {
  const f = fixture();
  const first = await f.service.page(1, "WARD", subject, { page: 1 });
  f.control[changed] = "changed";
  await assert.rejects(f.service.page(1, "WARD", subject, { page: 1, snapshotId: first.snapshotId }), { code: "DASHBOARD_SNAPSHOT_EXPIRED" });
  assert.equal(f.control.executions.length, 1);
});

test("Query-only retains safe Schema error codes without executing SQL or returning cached rows", async () => {
  const f = fixture(); f.deps.getSensitivity = async () => { throw new SecurityContractError("SECURITY_SCHEMA_REQUIRED"); };
  await assert.rejects(f.service.page(1, "WARD", subject, { page: 1 }), { code: "SECURITY_SCHEMA_REQUIRED", status: 503 }); assert.equal(f.control.executions.length, 0);
});

function approvalFixture() {
  const f = fixture();
  f.control.bindings.PRIMARY = { ...f.control.bindings.WARD!, sourceKey: "PRIMARY", sourceId: 1 };
  return f;
}

function changeApproval(f: ReturnType<typeof fixture>, key: string, mode: string | null) {
  const masks = mode === null ? {} : { NAME: mode, MRN: "INHERIT" };
  if (key === "PRIMARY") f.control.bindings.PRIMARY!.deviceMasks = masks;
  else f.control.bindings[key]!.sourceMasks = { ...(f.control.bindings[key]!.sourceMasks as Record<string, unknown>), [key]: masks };
  // Both approval APIs UPDATE the parent ParametersJson; SQL Server advances its rowversion.
  f.control.parentRowVersion++;
}

for (const key of ["PRIMARY", "WARD"]) {
  test(`${key} approval A→B→A cannot revive a cached page`, async () => {
    const f = approvalFixture();
    const first = await f.service.page(1, key, subject, { page: 1 });
    changeApproval(f, key, "FULL");
    await assert.rejects(f.service.page(1, key, subject, { page: 2, snapshotId: first.snapshotId }), { code: "DASHBOARD_SNAPSHOT_EXPIRED" });
    changeApproval(f, key, "INHERIT");
    await assert.rejects(f.service.page(1, key, subject, { page: 2, snapshotId: first.snapshotId }), { code: "DASHBOARD_SNAPSHOT_EXPIRED" });
    assert.equal(f.control.executions.length, 1);
    assert.equal(f.control.audits.length, 1);
    const fresh = await f.service.page(1, key, subject, { page: 1 });
    assert.notEqual(fresh.snapshotId, first.snapshotId);
    assert.deepEqual(fresh.result.rows, first.result.rows);
  });

  test(`${key} approval revocation omits the field and never returns the old page`, async () => {
    const f = approvalFixture(), first = await f.service.page(1, key, subject, { page: 1 });
    changeApproval(f, key, null);
    await assert.rejects(f.service.page(1, key, subject, { page: 1, snapshotId: first.snapshotId }), { code: "DASHBOARD_SNAPSHOT_EXPIRED" });
    const fresh = await f.service.page(1, key, subject, { page: 1 });
    assert.deepEqual(fresh.result.columns, []);
    assert.deepEqual(fresh.result.rows, [{}]);
    assert.equal(f.control.audits.length, 2); // Revocation does not disable page disclosure auditing.
  });

  test(`${key} source rowversion alone invalidates a cached page`, async () => {
    const f = approvalFixture(), first = await f.service.page(1, key, subject, { page: 1 });
    // The shared evidence conservatively covers every source, including independent source writes.
    f.control.sourceRowVersions.WARD++;
    await assert.rejects(f.service.page(1, key, subject, { page: 2, snapshotId: first.snapshotId }), { code: "DASHBOARD_SNAPSHOT_EXPIRED" });
    assert.equal(f.control.executions.length, 1);
  });

  for (const stage of ["afterExecute", "afterAudit"] as const) {
    for (const change of ["approvalABA", "parameters", "query", "policy", "acl", "jwt"] as const) {
      test(`${key}: ${change} during ${stage === "afterExecute" ? "SQL" : "disclosure audit"} rejects delivery`, async () => {
        const f = approvalFixture();
        f.control[stage] = () => {
          if (change === "approvalABA") { changeApproval(f, key, "FULL"); changeApproval(f, key, "INHERIT"); }
          if (change === "parameters") f.control.bindings[key]!.parameters = { WARD: "OTHER_SYNTHETIC" };
          if (change === "query") f.control.queries.get(21)!.datasetId = 101;
          if (change === "policy") f.control.policyVersion++;
          if (change === "acl") f.control.denied.add(21);
          if (change === "jwt") f.control.session.tokenVersion++;
        };
        const code = change === "acl" ? "QUERY_SOURCE_QUERY_FORBIDDEN" : change === "jwt" ? "TOKEN_REVOKED" : "DASHBOARD_SNAPSHOT_EXPIRED";
        await assert.rejects(f.service.page(1, key, subject, { page: 1 }), { code });
        assert.equal(f.control.executions.length, 1);
        assert.equal(f.control.audits.length, stage === "afterAudit" ? 1 : 0);
      });
    }
  }

  test(`${key} rejects expired snapshots without executing or auditing again`, async () => {
    const f = approvalFixture(), first = await f.service.page(1, key, subject, { page: 1 });
    const cached = getDashboardPageSnapshot(first.snapshotId, -subject.userId, 1)!;
    cached.createdAt -= cached.ttlMs;
    await assert.rejects(f.service.page(1, key, subject, { page: 2, snapshotId: first.snapshotId }), { code: "DASHBOARD_SNAPSHOT_EXPIRED" });
    assert.equal(f.control.executions.length, 1);
    assert.equal(f.control.audits.length, 1);
  });
}

test("PRIMARY/extra snapshots remain isolated and either approval write invalidates shared parent evidence", async () => {
  const f = approvalFixture();
  const primary = await f.service.page(1, "PRIMARY", subject, { page: 1 });
  const extra = await f.service.page(1, "WARD", subject, { page: 1 });
  assert.notEqual(primary.snapshotId, extra.snapshotId);
  for (const [key, snapshotId] of [["PRIMARY", extra.snapshotId], ["WARD", primary.snapshotId]])
    await assert.rejects(f.service.page(1, key!, subject, { page: 1, snapshotId }), { code: "DASHBOARD_SNAPSHOT_EXPIRED" });
  changeApproval(f, "WARD", "FULL");
  for (const [key, snapshotId] of [["PRIMARY", primary.snapshotId], ["WARD", extra.snapshotId]])
    await assert.rejects(f.service.page(1, key!, subject, { page: 1, snapshotId }), { code: "DASHBOARD_SNAPSHOT_EXPIRED" });
  assert.equal(f.control.executions.length, 2);
});

test("approval evidence brackets binding/policy reads and rejects a mixed security state before SQL", async () => {
  const f = approvalFixture(), original = f.deps.getSensitivity;
  f.deps.getSensitivity = async id => { const policy = await original(id); f.control.parentRowVersion++; return policy; };
  await assert.rejects(f.service.page(1, "PRIMARY", subject, { page: 1 }), { code: "DASHBOARD_SNAPSHOT_EXPIRED" });
  assert.equal(f.control.executions.length, 0);
  assert.equal(f.control.audits.length, 0);
});

for (const change of ["add", "remove"] as const) test(`source collection ${change} invalidates PRIMARY and extra snapshots`, async () => {
  const f = approvalFixture();
  const pages = await Promise.all(["PRIMARY", "WARD"].map(async key => ({ key, page: await f.service.page(1, key, subject, { page: 1 }) })));
  const versions = f.control.sourceRowVersions as Record<string, bigint>;
  if (change === "add") versions.EXTRA = 4n; else delete versions.ROOM;
  for (const { key, page } of pages)
    await assert.rejects(f.service.page(1, key, subject, { page: 2, snapshotId: page.snapshotId }), { code: "DASHBOARD_SNAPSHOT_EXPIRED" });
  assert.equal(f.control.executions.length, 2);
});

for (const evidence of [undefined, null, "", "a".repeat(63), "g".repeat(64), "a".repeat(64) + "\n"]) {
  test(`untrusted approval evidence (${evidence === undefined ? "missing" : evidence === null ? "null" : `length ${evidence.length}`}) rejects fresh and cached requests`, async () => {
    const f = approvalFixture(), first = await f.service.page(1, "PRIMARY", subject, { page: 1 });
    f.deps.getApprovalEvidence = async () => evidence as string;
    for (const snapshotId of [undefined, first.snapshotId])
      await assert.rejects(f.service.page(1, "PRIMARY", subject, { page: 1, snapshotId }), { code: "SECURITY_SCHEMA_REQUIRED", status: 503 });
    assert.equal(f.control.executions.length, 1);
    assert.equal(f.control.audits.length, 1);
  });
}

test("missing 919 Schema or RowVersion evidence rejects fresh/cached pages and mid-SQL/audit delivery", async () => {
  for (const stage of ["before", "afterExecute", "afterAudit"] as const) {
    const f = approvalFixture(), first = await f.service.page(1, "WARD", subject, { page: 1 });
    const missing = () => { f.deps.getApprovalEvidence = async () => { throw new SecurityContractError("SECURITY_SCHEMA_REQUIRED"); }; };
    if (stage === "before") missing(); else f.control[stage] = missing;
    await assert.rejects(f.service.page(1, "WARD", subject, { page: 1 }), { code: "SECURITY_SCHEMA_REQUIRED", status: 503 });
    await assert.rejects(f.service.page(1, "WARD", subject, { page: 1, snapshotId: first.snapshotId }), { code: "SECURITY_SCHEMA_REQUIRED", status: 503 });
  }
});

async function withDevicePages(run: (f: ReturnType<typeof approvalFixture>, request: (key: string, snapshotId?: string) => Promise<{ status: number; body: any }>, disable: (reason?: "DISABLED" | "INVALID_TOKEN" | "EXPIRED") => void) => Promise<void>) {
  const f = approvalFixture();
  for (const binding of Object.values(f.control.bindings)) Object.assign(binding, { dashboardActive: true, mode: "QUERY_ONLY", modeRevision: 1, referenced: true });
  let invalid: "DISABLED" | "INVALID_TOKEN" | "EXPIRED" | null = null, fallbacks = 0;
  const deps: QueryDeviceDependencies = {
    mode: async () => ({ mode: "QUERY_ONLY", version: 1 }),
    dashboard: async () => ({ id: 1, queryDefinitionId: 21, parameters: {} } as NonNullable<Awaited<ReturnType<QueryDeviceDependencies["dashboard"]>>>),
    checkDevice: async () => invalid === null ? { status: "VALID", device: { id: 7, dashboardId: 1, createdByUserId: 1,
      authorizationRevision: 1, queryModeGrantVersion: 1, delegatorTokenVersion: 1 } as Extract<Awaited<ReturnType<QueryDeviceDependencies["checkDevice"]>>, { status: "VALID" }>["device"] } : { status: invalid },
  };
  const app = express(); app.use(express.json()); app.use(createQueryDeviceRouter(f.service, deps));
  app.use((_req, res) => { fallbacks++; res.sendStatus(500); });
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await run(f, async (key, snapshotId) => {
      const path = key === "PRIMARY" ? "/device/1/page" : `/device/1/data-sources/${key}/page`;
      const response = await fetch(base + path, { method: "POST", headers: { "X-Dashboard-Device-Token": "A".repeat(43), "Content-Type": "application/json" },
        body: JSON.stringify({ page: 1, ...(snapshotId ? { snapshotId } : {}) }) });
      assert.equal(response.headers.get("cache-control"), "no-store");
      return { status: response.status, body: await response.json() };
    }, (reason = "DISABLED") => { invalid = reason; });
    assert.equal(fallbacks, 0);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}

for (const key of ["PRIMARY", "WARD"]) {
  test(`device ${key}: approval ABA and missing evidence cannot return cached rows or use Legacy`, async () => {
    await withDevicePages(async (f, request) => {
      const first = await request(key); assert.equal(first.status, 200);
      changeApproval(f, key, "FULL"); changeApproval(f, key, "INHERIT");
      const stale = await request(key, first.body.snapshotId);
      assert.equal(stale.status, 409); assert.equal(stale.body.result, undefined);
      f.deps.getApprovalEvidence = async () => { throw new SecurityContractError("SECURITY_SCHEMA_REQUIRED"); };
      for (const snapshotId of [undefined, first.body.snapshotId]) {
        const failed = await request(key, snapshotId);
        assert.equal(failed.status, 503); assert.equal(failed.body.error.code, "SECURITY_SCHEMA_REQUIRED");
        assert.equal(failed.body.result, undefined);
      }
      assert.equal(f.control.executions.length, 1);
    });
  });
  for (const stage of ["afterExecute", "afterAudit"] as const) {
    test(`device ${key}: approval version change during ${stage} rejects the HTTP response`, async () => {
      await withDevicePages(async (f, request) => {
        f.control[stage] = () => { changeApproval(f, key, "FULL"); changeApproval(f, key, "INHERIT"); };
        const failed = await request(key);
        assert.equal(failed.status, 409); assert.equal(failed.body.result, undefined);
        assert.equal(f.control.audits.length, stage === "afterAudit" ? 1 : 0);
      });
    });
    test(`device ${key}: revocation/workstation disable during ${stage} rejects delivery`, async () => {
      await withDevicePages(async (f, request, disable) => {
        const first = await request(key); assert.equal(first.status, 200);
        f.control[stage] = disable;
        const failed = await request(key);
        assert.equal(failed.status, 401); assert.equal(failed.body.result, undefined);
        const cached = await request(key, first.body.snapshotId);
        assert.equal(cached.status, 401); assert.equal(cached.body.result, undefined);
      });
    });
  }
  test(`device ${key}: failed or absent disclosure audit never returns rows`, async () => {
    await withDevicePages(async (f, request) => {
      for (const flag of ["failAudit", "missingAudit"] as const) {
        f.control[flag] = true;
        const failed = await request(key);
        assert.equal(failed.status, 503); assert.equal(failed.body.result, undefined);
        f.control[flag] = false;
      }
    });
  });
  test(`device ${key}: token rotation/expiry during SQL or audit rejects new and cached delivery`, async () => {
    for (const reason of ["INVALID_TOKEN", "EXPIRED"] as const) for (const stage of ["afterExecute", "afterAudit"] as const) {
      await withDevicePages(async (f, request, disable) => {
        const first = await request(key); assert.equal(first.status, 200);
        f.control[stage] = () => disable(reason);
        const failed = await request(key);
        assert.equal(failed.status, 401); assert.equal(failed.body.result, undefined);
        const cached = await request(key, first.body.snapshotId);
        assert.equal(cached.status, 401); assert.equal(cached.body.result, undefined);
      });
    }
  });
}
