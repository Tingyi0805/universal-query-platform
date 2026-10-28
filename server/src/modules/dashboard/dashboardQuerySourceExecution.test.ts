import { createDatasetService } from "../dataset/dataset.service.js";
import { syntheticParameter } from "../dataset/parameterTestFixture.js";
import type { DataSourceConfig } from "../datasource/datasource.types.js";
import {DatasetDisplayError} from "../dataset/datasetDisplaySchema.js";
import { createUserPlaybackSourcesReader } from "./dashboardQuerySourceExecution.repository.js";
import { advanceDashboardAccessEvidence } from "../queryDefinition/queryAccess.repository.js";
import { createUserPlaybackRouter } from "./dashboardUserPlayback.routes.js";
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
    publicAllowed:true,publicEpoch:1,enabled: true, schema: true, session: { isActive: true, tokenVersion: 1, permissions: ["DESIGN_QUERY", "EXECUTE_QUERY"] },
    bindings: { WARD: binding("WARD", 21), ROOM: binding("ROOM", 22) } as Record<string, ExecutionBinding>,
    queries: new Map([[21, { id: 21, datasetId: 99, isActive: true, isPublished: true, isArchived: false }],
      [22, { id: 22, datasetId: 100, isActive: true, isPublished: true, isArchived: false }]]),
    patientVersion: "1", metadataProof: "proof-v1", denied: new Set<number>(), revision: "acl-v1", policyVersion: 1, datasourceActive: true,
    parentRowVersion: 1n, sourceRowVersions: { WARD: 2n, ROOM: 3n },
    executions: [] as number[], audits: [] as Parameters<ExecutionDependencies["audit"]>[0][],
    failExecute: false, failAudit: false, missingAudit: false, patientConfigured: true,
    afterExecute: () => {}, afterAudit: () => {},
  };
  const deps: ExecutionDependencies = {
    getPublicDisplay:async()=>({status:control.publicAllowed?"CONFIRMED":"STALE",version:String(control.publicEpoch),sensitivityVersion:control.policyVersion,policy:{confirmed:control.publicAllowed,sensitivityVersion:control.policyVersion,grants:[{columnName:"NAME",permitted:true},{columnName:"MRN",permitted:false}]}}) as never,
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
    getPatientAuditConfig: async () => control.patientConfigured ? { isEnabled: true, patientKeyColumn: "MRN" } : null,
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
test("ordinary Dataset pages succeed without patient-specific audit while keeping Dataset masks", async () => {
  const f = fixture(); f.control.patientConfigured = false; f.control.missingAudit = true;
  const result = await f.service.page(1, "WARD", subject, { page: 1 });
  assert.equal(result.disclosureId, null);
  assert.equal(result.result.rows[0]?.NAME, "測○○○甲");
  assert.equal(result.result.rows[0]?.MRN, undefined);
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
test("Query-only PRIMARY uses Dataset masks regardless of Legacy JSON and still rejects unconfigured fields", async () => {
  const f = fixture(); f.control.bindings.PRIMARY = { ...f.control.bindings.WARD!, sourceKey: "PRIMARY", sourceId: 1, deviceMasks: { NAME: "FULL", MRN: "NONE", UNAPPROVED: "NONE" } };
  const page = await f.service.page(1, "PRIMARY", subject, { page: 1 });
  assert.deepEqual(page.result.rows[0], {NAME:"測○○○甲"});
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
  select("FULL"); const full = await f.service.page(1, key, subject, { page: 1 }); assert.deepEqual(full.result.rows, [{NAME:"測###甲"}]);
  select("OMIT"); assert.deepEqual((await f.service.page(1, key, subject, { page: 1 })).result.columns, [{name:"NAME"}]);
  select("INHERIT"); f.control.policyVersion++; await assert.rejects(f.service.page(1, key, subject, { page: 1, snapshotId: first.snapshotId }), { code: "DASHBOARD_SNAPSHOT_EXPIRED" });
  f.deps.getSensitivity = async () => ({ version: f.control.policyVersion, columns: [{ columnName: "RENAMED", sensitivityType: "NAME", deviceMaskMode: "FULL" }] });
  assert.deepEqual((await f.service.page(1, key, subject, { page: 1 })).result.columns, []);
});
test("Query-only uses the additional source Dataset policy without duplicate PRIMARY approvals", async () => {
  const f = fixture(); delete f.control.bindings.WARD!.sourceMasks;
  assert.deepEqual((await f.service.page(1, "WARD", subject, { page: 1 })).result.rows, [{NAME:"測○○○甲"}]);
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

  test(`${key} old JSON revocation expires cache but cannot replace Dataset mask policy`, async () => {
    const f = approvalFixture(), first = await f.service.page(1, key, subject, { page: 1 });
    changeApproval(f, key, null);
    await assert.rejects(f.service.page(1, key, subject, { page: 1, snapshotId: first.snapshotId }), { code: "DASHBOARD_SNAPSHOT_EXPIRED" });
    const fresh = await f.service.page(1, key, subject, { page: 1 });
    assert.deepEqual(fresh.result.columns, [{name:"NAME"}]);
    assert.ok(fresh.result.rows.every(r=>r.NAME!=="測試患者甲"));
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

const userSubject = () => ({ ...subject, context: "user" as const, expiresAt: Math.floor(Date.now() / 1000) + 3600 });
function userFixture() {
  const f = fixture();
  f.control.session.permissions = ["VIEW_QUERY", "EXECUTE_QUERY"];
  f.control.bindings.PRIMARY = { ...structuredClone(f.control.bindings.WARD!), sourceKey: "PRIMARY", sourceId: 1 };
  for (const b of Object.values(f.control.bindings)) Object.assign(b, { mode: "QUERY_ONLY", modeRevision: 1, dashboardActive: true, referenced: true });
  f.deps.loadUserSources = async () => ({ keys: Object.keys(f.control.bindings), references: ["WARD", "ROOM"], version: "synthetic-catalog-v1" });
  return f;
}
test("user context needs VIEW_QUERY/EXECUTE_QUERY without DESIGN_QUERY; masked page-by-page audit uses user identity", async () => {
  const f = userFixture(), user = userSubject();
  const first = await f.service.page(1, "PRIMARY", user, { page: 1 });
  assert.equal(first.modeVersion, "QUERY_ONLY_USER_V1:1"); assert.equal(first.result.rows[0]!.NAME, "測○○○甲");
  assert.equal(first.result.rows[0]!.MRN, undefined); assert.equal(f.control.audits[0]!.userId, 1); assert.equal(f.control.audits[0]!.dashboardDeviceId, undefined);
  await f.service.page(1, "PRIMARY", user, { page: 2, snapshotId: first.snapshotId });
  assert.equal(f.control.executions.length, 1); assert.equal(f.control.audits.length, 2);
  assert.equal(getDashboardPageSnapshot(first.snapshotId, -1, 1)!.executionContext, "user");
});
for (const reason of ["view", "execute", "token", "expired", "inactive", "legacy", "unmanaged", "pending", "approval", "sibling-acl", "policy", "flag"]) test(`user playback fails closed before SQL: ${reason}`, async () => {
  const f = userFixture(), user = userSubject();
  if (reason === "view") f.control.session.permissions = ["EXECUTE_QUERY"];
  if (reason === "execute") f.control.session.permissions = ["VIEW_QUERY"];
  if (reason === "token") f.control.session.tokenVersion++;
  if (reason === "expired") user.expiresAt = 1;
  if (reason === "inactive") f.control.bindings.PRIMARY!.dashboardActive = false;
  if (reason === "legacy") f.control.bindings.PRIMARY!.mode = "LEGACY";
  if (reason === "unmanaged") f.control.bindings.PRIMARY!.managed = false;
  if (reason === "pending") f.control.bindings.ROOM!.queryDefinitionId = null;
  if (reason === "approval") f.control.publicAllowed=false;
  if (reason === "sibling-acl") f.control.denied.add(22);
  if (reason === "policy") f.deps.getSensitivity = async () => ({ version: 0, columns: [] });
  if (reason === "flag") f.control.enabled = false;
  await assert.rejects(f.service.page(1, "PRIMARY", user, { page: 1 })); assert.equal(f.control.executions.length, 0);
});
for (const stage of ["afterExecute", "afterAudit"] as const) for (const changed of ["approval", "policy", "acl", "jwt"] as const)
  test(`user ${changed} change during ${stage} refuses result`, async () => {
    const f = userFixture(), user = userSubject();
    f.control[stage] = () => {
      if (changed === "approval") f.control.parentRowVersion++;
      if (changed === "policy") f.control.policyVersion++;
      if (changed === "acl") f.control.denied.add(22);
      if (changed === "jwt") user.expiresAt = 1;
    };
    await assert.rejects(f.service.page(1, "PRIMARY", user, { page: 1 }));
  });
for (const source of ["PRIMARY", "WARD"]) test(`user ${source} approval A→B→A cannot revive old snapshot`, async () => {
  const f = userFixture(), user = userSubject(), first = await f.service.page(1, source, user, { page: 1 });
  if (source === "PRIMARY") f.control.parentRowVersion += 2n; else f.control.sourceRowVersions.WARD += 2n;
  await assert.rejects(f.service.page(1, source, user, { page: 2, snapshotId: first.snapshotId }), { code: "DASHBOARD_SNAPSHOT_EXPIRED" });
  assert.equal(f.control.executions.length, 1);
});
test("user/designer/device/session/source namespaces cannot share snapshots; context cannot forge a device identity", async () => {
  const f = userFixture(), user = userSubject(), first = await f.service.page(1, "PRIMARY", user, { page: 1 });
  for (const target of [{...user,userId:2}, {...user,tokenHash:"another-session"}]) await assert.rejects(f.service.page(1,"PRIMARY",target,{page:1,snapshotId:first.snapshotId}),{code:"DASHBOARD_SNAPSHOT_EXPIRED"});
  await assert.rejects(f.service.page(1,"WARD",user,{page:1,snapshotId:first.snapshotId}),{code:"DASHBOARD_SNAPSHOT_EXPIRED"});
  f.control.session.permissions.push("DESIGN_QUERY");
  f.control.bindings.PRIMARY!.dashboardActive=false;
  await assert.rejects(f.service.page(1,"PRIMARY",subject,{page:1,snapshotId:first.snapshotId}),{code:"DASHBOARD_SNAPSHOT_EXPIRED"});
  f.control.bindings.PRIMARY!.dashboardActive=true;
  const device = {...subject,deviceId:7,verifyDevice:async()=>({deviceId:7,userId:1,tokenVersion:1,fingerprint:"synthetic-device"})};
  await assert.rejects(f.service.page(1,"PRIMARY",device,{page:1,snapshotId:first.snapshotId}),{code:"DASHBOARD_SNAPSHOT_EXPIRED"});
  const devicePage=await f.service.page(1,"PRIMARY",device,{page:1});
  await assert.rejects(f.service.page(1,"PRIMARY",user,{page:1,snapshotId:devicePage.snapshotId}),{code:"DASHBOARD_SNAPSHOT_EXPIRED"});
  await assert.rejects(f.service.page(1,"PRIMARY",{...user,context:"device"},{page:1}),{code:"INVALID_EXECUTION_CONTEXT"});
});
test("user audit failure/missing evidence and expired snapshot never return cached data",async()=>{
  for(const reason of ["audit","evidence","expiry"]){
    const f=userFixture(),user=userSubject(),first=await f.service.page(1,"PRIMARY",user,{page:1});
    if(reason==="audit")f.control.failAudit=true;
    if(reason==="evidence")f.control.missingAudit=true;
    if(reason==="expiry")getDashboardPageSnapshot(first.snapshotId,-1,1)!.createdAt=0;
    await assert.rejects(f.service.page(1,"PRIMARY",user,{page:2,snapshotId:first.snapshotId}));
  }
});
for(const reason of ["success","expired-jwt","token-version","permission","preview","injection","flag"])test(`user HTTP route and existing designer guard: ${reason}`,async()=>{
  const f=userFixture(),oldSecret=env.JWT_SECRET;env.JWT_SECRET="synthetic-user-playback-test";
  const app=express();app.use(express.json());app.use(createAuthenticateJwt(async()=>structuredClone(f.control.session) as any));
  app.use(createUserPlaybackRouter(f.service,{mode:async()=>({mode:"QUERY_ONLY",version:1}),dashboard:async()=>({id:1,name:"Synthetic",code:"SYNTHETIC",isActive:true,parameters:{private:"synthetic-private-parameters"},refreshSeconds:30,pageSeconds:5,pageSize:1} as any),layout:async()=>({profiles:[]})}));
  app.use(createQuerySourceExecutionRouter(f.service));
  const server=createServer(app);await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{
    const token=jwt.sign({sub:"1",tokenVersion:1},env.JWT_SECRET,{expiresIn:reason==="expired-jwt"?-1:3600});
    if(reason==="token-version")f.control.session.tokenVersion++;
    if(reason==="permission")f.control.session.permissions=["VIEW_QUERY"];
    if(reason==="flag")f.control.enabled=false;
    const response=await fetch(`http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/1/${reason==="preview"?"query-sources/v1":"playback/v1"}/PRIMARY/page`,{
      method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({page:1,...(reason==="injection"?{context:"designer"}: {})})});
    const expected=reason==="success"?200:["expired-jwt","token-version"].includes(reason)?401:["permission","preview"].includes(reason)?403:reason==="injection"?400:404;
    assert.equal(response.status,expected);const body=await response.json();assert.doesNotMatch(JSON.stringify(body),/synthetic-private-parameters|00000123/);
    if(reason==="success"){assert.equal(body.modeVersion,"QUERY_ONLY_USER_V1:1");assert.deepEqual(body.dashboard.parameters,{});assert.equal(response.headers.get("cache-control"),"no-store");}
    else assert.equal(f.control.executions.length,0);
  }finally{env.JWT_SECRET=oldSecret;await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test("ACL A→B→A advances 919 evidence within the existing ACL transaction, for PRIMARY and additional bindings",async()=>{
  for(const bound of [null,8]){
    const statements:string[]=[];let revision=1n;
    const request={input(name:string,_type:unknown,value:unknown){assert.equal(name,"dashboardAccessQueryId");assert.equal(value,21);return this;},async query(statement:string){
      statements.push(statement);
      if(statement.startsWith("SELECT"))return {recordset:[{VersionLength:8,TrustedVersion:1,SourceBinding:bound}]};
      assert.match(statement,/UPDATE d SET UpdatedAtUtc=SYSUTCDATETIME/);assert.equal(statement.includes("DashboardDataSource"),bound!==null);revision++;return {rowsAffected:[1]};
    }} as unknown as sql.Request;
    await advanceDashboardAccessEvidence(request,21);await advanceDashboardAccessEvidence(request,21);assert.equal(revision,3n);assert.equal(statements.length,4);
  }
  const f=userFixture(),user=userSubject(),first=await f.service.page(1,"PRIMARY",user,{page:1});
  // Successful revoke and regrant now update affected parent rowversions in their ACL transaction.
  f.control.denied.add(22);f.control.parentRowVersion++;f.control.denied.delete(22);f.control.parentRowVersion++;
  await assert.rejects(f.service.page(1,"PRIMARY",user,{page:2,snapshotId:first.snapshotId}),{code:"DASHBOARD_SNAPSHOT_EXPIRED"});
});
test("ACL evidence advancement preserves pre-919 Query compatibility and rejects conflicting version columns",async()=>{
  for(const row of [{VersionLength:null,TrustedVersion:0},{VersionLength:8,TrustedVersion:0},{VersionLength:4,TrustedVersion:1}]){
    let writes=0;
    const request={input(){return this;},async query(s:string){if(s.startsWith("SELECT"))return {recordset:[row]};writes++;return {rowsAffected:[1]};}}as unknown as sql.Request;
    if(row.VersionLength===null)await advanceDashboardAccessEvidence(request,21);else await assert.rejects(advanceDashboardAccessEvidence(request,21),{message:"SECURITY_SCHEMA_REQUIRED"});
    assert.equal(writes,0);
  }
});
for(const reason of ["valid","inactive","disabled-mode","pending-disabled-source","disabled-reference","schema"])test(`locked user source catalog: ${reason}`,async()=>{
  const saved:any={dashboard:{id:1,queryDefinitionId:21,isActive:true,mode:"QUERY_ONLY",modeVersion:1,maxRows:10,parameters:{},updatedAtUtc:"2026-10-20T00:00:00Z",refreshSeconds:30,pageSize:1,pageSeconds:5},
    sources:[{id:2,sourceKey:"WARD",datasetId:99,queryDefinitionId:22,queryBindingRevision:1,maxRows:10,isEnabled:true,parameters:{}}],references:["PRIMARY","WARD"],layoutFingerprint:"synthetic-layout"};
  if(reason==="inactive")saved.dashboard.isActive=false;
  if(reason==="disabled-mode")saved.dashboard.mode="QUERY_ONLY_DISABLED";
  if(reason==="pending-disabled-source"){saved.sources[0].isEnabled=false;saved.sources[0].queryDefinitionId=null;}
  if(reason==="disabled-reference")saved.sources[0].isEnabled=false;
  const reader=createUserPlaybackSourcesReader({transaction:async work=>work({schemaReady:async()=>reason!=="schema",readState:async (id:number)=>{assert.equal(id,1);return saved;}} as any)});
  if(reason==="valid"){const view=await reader(1);assert.deepEqual(view.keys,["PRIMARY","WARD"]);assert.match(view.version,/^[a-f0-9]{64}$/);}
  else await assert.rejects(reader(1));
});

for(const ctx of ["designer","user","device"] as const)test(`Dataset public policy applies to ${ctx}, Legacy JSON never supplies missing grants`,async()=>{
 const f=userFixture();for(const b of Object.values(f.control.bindings)){b.deviceMasks={};b.sourceMasks={};}
 const subjectFor=ctx==="designer"?{...subject,context:ctx}:{...userSubject(),context:ctx,...(ctx==="device"?{deviceId:7,verifyDevice:async()=>({deviceId:7,userId:1,tokenVersion:1,fingerprint:"device"})}:{})};
 if(ctx!=="user")f.control.session.permissions=["DESIGN_QUERY","EXECUTE_QUERY"];
 if(ctx==="designer")for(const b of Object.values(f.control.bindings))b.dashboardActive=false;
 f.control.publicAllowed=false;
 if(ctx==="designer"){assert.equal((await f.service.page(1,"PRIMARY",subjectFor,{page:1})).result.rows.length,1);}
 else {await assert.rejects(f.service.page(1,"PRIMARY",subjectFor,{page:1}),{code:"QUERY_SOURCE_PUBLIC_POLICY_REQUIRED"});assert.equal(f.control.executions.length,0);f.control.publicAllowed=true;const r=await f.service.page(1,"PRIMARY",subjectFor,{page:1});assert.equal(r.result.rows[0]!.NAME,"測○○○甲");f.control.publicEpoch+=2;await assert.rejects(f.service.page(1,"PRIMARY",subjectFor,{page:1,snapshotId:r.snapshotId}),{code:"DASHBOARD_SNAPSHOT_EXPIRED"});}
});

test("missing public Schema is a traceable rejection before SQL, never a Legacy grant fallback",async()=>{
 const f=userFixture();f.deps.getPublicDisplay=async()=>{throw new DatasetDisplayError("DATASET_DISPLAY_SCHEMA_REQUIRED",503);};
 await assert.rejects(f.service.page(1,"PRIMARY",userSubject(),{page:1}),{code:"DATASET_DISPLAY_SCHEMA_REQUIRED",status:503});assert.equal(f.control.executions.length,0);
});

test("a stale configured column absent from result metadata cannot leak through preview row keys",async()=>{
 const f=fixture();f.deps.getSensitivity=async()=>({version:1,columns:[{columnName:"NAME",sensitivityType:"OTHER",deviceMaskMode:"FULL"},{columnName:"PHONE",sensitivityType:"OTHER",deviceMaskMode:"NONE"}]});
 f.deps.execute=async()=>({columns:[{name:"NAME"}],rows:[{NAME:"SYNTHETIC",PHONE:"SYNTHETIC_PRIVATE_PHONE"}],rowCount:1,elapsedMs:1,truncated:false});
 await assert.rejects(f.service.page(1,"WARD",subject,{page:1}),/DASHBOARD_COLUMNS_AMBIGUOUS/);
 assert.equal(f.control.audits.length,0);
});

test("confirmed all-deny public policy cannot reveal row counts or run SQL",async()=>{
 const f=userFixture();f.deps.getPublicDisplay=async()=>({status:"CONFIRMED",sensitivityVersion:1,policy:{confirmed:true,sensitivityVersion:1,grants:[]}}) as never;
 await assert.rejects(f.service.page(1,"PRIMARY",userSubject(),{page:1}),{code:"QUERY_SOURCE_PUBLIC_POLICY_REQUIRED"});assert.equal(f.control.executions.length,0);
});

test("two Dashboards sharing one Dataset require re-confirmation together and use the same updated mask",async()=>{
 const f=userFixture(),original=f.deps.loadBinding;let confirmedVersion=1,epoch=1,symbol="#";
 f.deps.loadBinding=async(id,key)=>({...await original(id,key),dashboardId:id});
 f.deps.getSensitivity=async()=>({version:f.control.policyVersion,columns:[{columnName:"NAME",sensitivityType:"OTHER",deviceMaskMode:"CUSTOM",customMask:{prefix:1,suffix:1,symbol}},{columnName:"MRN",sensitivityType:"OTHER",deviceMaskMode:"OMIT"}]});
 f.deps.getPublicDisplay=async()=>({status:confirmedVersion===f.control.policyVersion?"CONFIRMED":"STALE",version:String(epoch),sensitivityVersion:confirmedVersion,policy:{confirmed:true,sensitivityVersion:confirmedVersion,grants:[{columnName:"NAME",permitted:true}]}}) as never;
 const a=await f.service.page(1,"PRIMARY",userSubject(),{page:1}),b=await f.service.page(2,"PRIMARY",userSubject(),{page:1});assert.deepEqual(a.result.rows,b.result.rows);assert.equal(a.result.rows[0]!.NAME,"測###甲");
 symbol="*";f.control.policyVersion++;
 for(const id of [1,2])await assert.rejects(f.service.page(id,"PRIMARY",userSubject(),{page:1}),{code:"QUERY_SOURCE_PUBLIC_POLICY_REQUIRED"});
 // Only this synthetic provider's explicit re-confirmation advances its policy.
 confirmedVersion=f.control.policyVersion;epoch++;
 for(const [id,old] of [[1,a],[2,b]] as const){await assert.rejects(f.service.page(id,"PRIMARY",userSubject(),{page:1,snapshotId:old.snapshotId}),{code:"DASHBOARD_SNAPSHOT_EXPIRED"});assert.equal((await f.service.page(id,"PRIMARY",userSubject(),{page:1})).result.rows[0]!.NAME,"測***甲");}
});

for (const type of ["SQLSERVER", "ORACLE"] as const)
  for (const calendar of ["ROC", "GREGORIAN"] as const)
    test(`Dashboard ${type} inherits current Dataset ${calendar} formats and defaults through execution`, async () => {
      const f = fixture();
      f.control.bindings.WARD!.parameters = {};
      const getDataset = f.deps.getDataset;
      f.deps.getDataset = async id => ({ ...(await getDataset(id))!,
        sqlText: "SELECT NAME, MRN FROM SYNTHETIC_DATES WHERE EXAM_DATE BETWEEN {{SDATE}} AND {{EDATE}}" });
      f.deps.getParameters = async () => ["SDATE", "EDATE"].map(name => ({ ...syntheticParameter, name,
        defaultValue: "2026-10-27", dateCalendar: calendar, dateFormat: calendar === "ROC" ? "yyyMMdd" : "yyyyMMdd" }));
      const originalExecute = f.deps.execute;
      let calls = 0;
      const datasetService = createDatasetService({ getDataset: f.deps.getDataset, listDatasetParameters: f.deps.getParameters,
        getDataSourceConfig: async () => ({ type, isActive: true, queryTimeoutSec: 10 } as DataSourceConfig),
        createAdapter: async () => ({ testConnection: async () => ({ ok: true, message: "synthetic" }), executeQuery: async (_config, input) => {
          calls++;
          const expected = calendar === "ROC" ? "1151027" : "20261027";
          assert.deepEqual(input.binds, { SDATE: expected, EDATE: expected });
          assert.match(input.sql, type === "ORACLE" ? /BETWEEN :SDATE AND :EDATE/ : /BETWEEN @SDATE AND @EDATE/);
          return originalExecute(99, {}, 10);
        } }),
      });
      f.deps.execute = datasetService.executeSavedDataset;
      const result = await f.service.page(1, "WARD", subject, { page: 1 });
      assert.equal(calls, 1);
      assert.equal(result.result.rows.length, 1);
    });

const adminPreviewSubject = () => ({ ...subject, context: "admin-preview" as const, expiresAt: Math.floor(Date.now() / 1000) + 3600 });
function activeAdminFixture() {
  const f = fixture();
  Object.assign(f.control.bindings.WARD!, { mode: "QUERY_ONLY", modeRevision: 1, dashboardActive: true });
  return f;
}
test("active administrator preview uses Query identity, public Dataset masks and audit without a device grant", async () => {
  const f = activeAdminFixture(), before = structuredClone(f.control.bindings);
  const response = await f.service.page(1, "WARD", adminPreviewSubject(), { page: 1 });
  assert.match(response.modeVersion, /^QUERY_ONLY_ADMIN_PREVIEW_V1:1$/);
  assert.equal(response.result.rows[0]!.NAME, "測○○○甲"); assert.equal(response.result.rows[0]!.MRN, undefined);
  assert.equal(f.control.audits[0]!.masked, true); assert.equal(f.control.audits[0]!.userId, 1);
  assert.equal(f.control.audits[0]!.dashboardDeviceId, undefined);
  assert.deepEqual(f.control.executions, [99]); assert.deepEqual(f.control.bindings, before);
  await assert.rejects(f.service.page(1, "WARD", subject, { page: 1 }), { code: "QUERY_SOURCE_PREVIEW_REQUIRES_STAGED_DASHBOARD" });
});
for (const reason of ["mode", "revision", "public", "permission", "acl", "expired", "audit", "receipt", "flag"])
  test(`active admin preview rejects ${reason} without legacy fallback`, async () => {
    const f = activeAdminFixture(), admin = adminPreviewSubject();
    if (reason === "mode") f.control.bindings.WARD!.mode = "QUERY_ONLY_DISABLED";
    if (reason === "revision") f.control.bindings.WARD!.modeRevision = 0;
    if (reason === "public") f.control.publicAllowed = false;
    if (reason === "permission") f.control.session.permissions = ["VIEW_QUERY", "EXECUTE_QUERY"];
    if (reason === "acl") f.control.denied.add(21);
    if (reason === "expired") admin.expiresAt = 1;
    if (reason === "audit") f.control.failAudit = true;
    if (reason === "receipt") f.control.missingAudit = true;
    if (reason === "flag") f.control.enabled = false;
    await assert.rejects(f.service.page(1, "WARD", admin, { page: 1 }));
    if (!["audit", "receipt"].includes(reason)) assert.equal(f.control.executions.length, 0);
  });
for (const stage of ["afterExecute", "afterAudit"] as const)
  for (const reason of ["mode", "public", "acl", "binding"])
    test(`admin preview ${stage} ${reason} mutation prevents disclosure`, async () => {
      const f = activeAdminFixture();
      f.control[stage] = () => {
        if (reason === "mode") f.control.bindings.WARD!.modeRevision!++;
        if (reason === "public") f.control.publicEpoch++;
        if (reason === "acl") f.control.denied.add(21);
        if (reason === "binding") f.control.bindings.WARD!.bindingRevision++;
      };
      await assert.rejects(f.service.page(1, "WARD", adminPreviewSubject(), { page: 1 }));
    });
test("staged admin preview retains staging protection and cannot share another context's snapshot", async () => {
  const f = fixture();
  f.control.bindings.WARD!.mode = "QUERY_ONLY_DISABLED";
  const staged = await f.service.page(1, "WARD", subject, { page: 1 });
  await assert.rejects(f.service.page(1, "WARD", adminPreviewSubject(), { page: 1, snapshotId: staged.snapshotId }), { code: "DASHBOARD_SNAPSHOT_EXPIRED" });
  assert.equal((await f.service.page(1, "WARD", adminPreviewSubject(), { page: 1 })).result.rows.length, 1);
});
for (const reason of ["success", "page", "snapshot", "context", "permission", "expired"])
  test(`admin read-only preview HTTP contract: ${reason}`, async () => {
    const f = activeAdminFixture(), oldSecret = env.JWT_SECRET;
    env.JWT_SECRET = "synthetic-admin-preview-only";
    const app = express(); app.use(express.json()); app.use(createAuthenticateJwt(f.deps.getSession));
    app.use(createQuerySourceExecutionRouter(f.service));
    const server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      if (reason === "permission") f.control.session.permissions = ["VIEW_QUERY", "EXECUTE_QUERY"];
      const token = jwt.sign({ sub: "1", tokenVersion: 1 }, env.JWT_SECRET, { expiresIn: reason === "expired" ? -1 : 3600 });
      const response = await fetch(`http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/1/query-sources/v1/WARD/preview`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ page: reason === "page" ? 2 : 1,
          ...(reason === "snapshot" ? { snapshotId: "11111111-1111-4111-8111-111111111111" } : {}), ...(reason === "context" ? { context: "designer" } : {}) }),
      });
      assert.equal(response.status, reason === "success" ? 200 : reason === "permission" ? 403 : reason === "expired" ? 401 : 400);
      if (reason !== "expired") assert.equal(response.headers.get("cache-control"), "no-store");
      const body = await response.json(); assert.ok(!JSON.stringify(body).includes("00000123"));
      if (reason !== "success") { assert.equal(body.result, undefined); assert.equal(f.control.executions.length, 0); }
    } finally { env.JWT_SECRET = oldSecret; await new Promise<void>(resolve => server.close(() => resolve())); }
  });
