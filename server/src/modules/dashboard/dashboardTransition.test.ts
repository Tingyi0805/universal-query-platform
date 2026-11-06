import {resolveDatasetPublicDisplayMasks} from "../dataset/datasetPublicDisplayPolicy.js";
import assert from "node:assert/strict";
import test from "node:test";
import { serialize, deserialize } from "node:v8";
import { createServer } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import sql from "mssql";
import { env } from "../../config/env.js";
import { createAuthenticateJwt } from "../auth/auth.middleware.js";
import { SecurityContractError } from "../securityContract/securityContract.js";
import { deleteDashboard } from "./dashboard.repository.js";
import { createQuerySourceManagement } from "./dashboardQuerySources.service.js";
import { createQuerySourceRouter } from "./dashboardQuerySources.routes.js";
import { createDashboardTransitionRouter } from "./dashboardTransition.routes.js";
import { createDashboardTransitionService } from "./dashboardTransition.service.js";
import { createDashboardTransitionStore, defaultTransitionDependencies } from "./dashboardTransition.repository.js";
import { resolveDashboardDisclosureMasks, maskDeviceRows } from "./dashboardDeviceMasking.js";

const copy = <T>(value: T): T => deserialize(serialize(value));
const actor = { userId: 1, tokenVersion: 1 };
type Row = Record<string, any>;
function fixture() {
  let db = {
    nextVersion: 4n,
    parent: { Id: 1, QueryDefinitionId: 20, IsActive: true, QueryMode: "LEGACY", QueryModeVersion: 0,
      QuerySourceMaxRows: null, RefreshSeconds: 30, PageSize: 10, PageSeconds: 15,
      UpdatedAtUtc: "2026-10-20T00:00:00Z", Name: "Synthetic", DisplayMode: "TABLE", DisplayTitle: "Synthetic",
      ShowClock: true, ShowPageNumber: true, ShowCountdown: true,
      ParametersJson: JSON.stringify({ WARD: "SYNTHETIC", snapshotSeconds: 60, deviceColumnMasks: { NAME: "INHERIT" },
        deviceColumnTypes: { NAME: "NAME" }, deviceSourceColumnMasks: { WARD: { NAME: "INHERIT" }, ROOM: { NAME: "FULL" } } }),
      ApprovalRowVersion: Buffer.from("0000000000000001", "hex") } as Row,
    sources: [{ Id: 10, DashboardId: 1, SourceKey: "WARD", DatasetId: 3, QueryDefinitionId: null, QueryBindingRevision: 0,
      MaxRows: null, ParametersJson: '{"WARD":"SYNTHETIC"}', IsEnabled: true, RefreshSeconds: 30, PageSize: 10, PageSeconds: 15,
      ApprovalRowVersion: Buffer.from("0000000000000002", "hex") }] as Row[],
    widgets: [{ ProfileId: 5, ProfileName: "Synthetic", CanvasWidth: 1920, CanvasHeight: 1080, IsDefault: true,
      WidgetId: 8, WidgetType: "TABLE", ConfigJson: '{"dataSourceKey":"WARD"}', StaticText: "Synthetic text", X: 0, Y: 0 }] as Row[],
    devices: [{ Id: 7, DashboardId: 1, IsActive: true, credentialEpoch: 1, QueryModeGrantVersion: null, DelegatorTokenVersion: null, LastUsedAtUtc: "synthetic" }] as Row[],
    audits: [] as Row[],
  };
  let staged = copy(db);
  const control = { management: true, schema917: true, schema918: true, schema919: true, pool: true, failAt: "",
    session: { isActive: true, tokenVersion: 1, permissions: ["DESIGN_QUERY", "EXECUTE_QUERY"] },
    queries: new Map<number, Row>([[20, { Id: 20, DatasetId: 2, IsPublished: true, IsActive: true, IsArchived: false, allowed: true }],
      [21, { Id: 21, DatasetId: 3, IsPublished: true, IsActive: true, IsArchived: false, allowed: true }],
      [22, { Id: 22, DatasetId: 4, IsPublished: true, IsActive: true, IsArchived: false, allowed: true }]]),
    statements: [] as string[], events: [] as string[],
  };
  const fail = (step: string) => { if (control.failAt === step) throw new Error("synthetic-private-storage-failure"); };
  const bump = (row: Row) => { row.ApprovalRowVersion = Buffer.from((staged.nextVersion++).toString(16).padStart(16, "0"), "hex"); };
  const tx = {
    begin: async (level: number) => { assert.equal(level, sql.ISOLATION_LEVEL.SERIALIZABLE); staged = copy(db); control.events.push("begin"); },
    commit: async () => { fail("commit"); db = staged; control.events.push("commit"); },
    rollback: async () => { staged = copy(db); control.events.push("rollback"); },
  } as unknown as sql.Transaction;
  const deps: typeof defaultTransitionDependencies = { ...defaultTransitionDependencies,
    getPool: async () => control.pool ? {} as sql.ConnectionPool : null,
    createTransaction: () => tx,
    securitySchema: async () => { control.events.push("schema919"); if (!control.schema919) throw new SecurityContractError("SECURITY_SCHEMA_REQUIRED"); },
    session: async (_id, actual) => { assert.equal(actual, tx); control.events.push("actor"); return copy(control.session); },
    createRequest: actual => {
      assert.equal(actual, tx);
      const values: Record<string, unknown> = {};
      const request = { input(name: string, _type: unknown, value: unknown) { values[name] = value; return this; },
        async query(statement: string) {
          control.statements.push(statement);
          if (statement.includes("AS Suspended,")) return {recordset:[{Suspended:null,Pending:null}]};
          assert.doesNotMatch(statement, /DELETE\s+FROM|INSERT\s+INTO/i);
          if (statement.includes("CK_DashboardDataSource_QueryBoundLimit")) return { recordset: [{ Ready: control.schema917 }] };
          if (statement.includes("CK_DashboardDevice_QueryModeGrant")) return { recordset: [{ Ready: control.schema918 }] };
          if (statement.startsWith("SELECT * FROM uqp.Dashboard WITH")) return { recordset: values.dashboardId === 1 ? [copy(staged.parent)] : [] };
          if (statement.startsWith("SELECT Id,IsActive,QueryMode FROM")) return { recordset: values.id === 1 ? [copy(staged.parent)] : [] };
          if (statement.startsWith("SELECT * FROM uqp.DashboardDataSource")) return { recordset: copy(staged.sources) };
          if (statement.includes("SELECT w.ConfigJson")) return { recordset: copy(staged.widgets) };
          if (statement.startsWith("SELECT QueryDefinitionId,ApprovalRowVersion")) return { recordset: [copy(staged.parent)] };
          if (statement.startsWith("SELECT Id,SourceKey,DatasetId,ApprovalRowVersion")) return { recordset: copy(staged.sources) };
          if (statement.startsWith("SELECT Id,DatasetId,IsPublished")) return { recordset: control.queries.has(Number(values.id)) ? [copy(control.queries.get(Number(values.id)))] : [] };
          if (statement.startsWith("UPDATE uqp.Dashboard SET IsActive=0")) {
            assert.match(statement, /WHERE Id=@id AND IsActive=1 AND QueryMode='LEGACY'/);
            if (control.failAt === "disable-rowcount") return { rowsAffected: [0] };
            staged.parent.IsActive = false; bump(staged.parent); fail("disable"); return { rowsAffected: [1] };
          }
          if (statement.startsWith("UPDATE uqp.DashboardDisplayDevice")) {
            assert.match(statement, /CRYPT_GEN_RANDOM\(32\)/);
            for (const device of staged.devices) { device.credentialEpoch++; device.QueryModeGrantVersion = null; device.DelegatorTokenVersion = null; device.LastUsedAtUtc = null; }
            fail("credentials"); return { rowsAffected: [staged.devices.length] };
          }
          if (statement.startsWith("UPDATE uqp.Dashboard SET ParametersJson")) {
            assert.match(statement, /IsActive=0 AND QueryMode<>'QUERY_ONLY'/);
            if (control.failAt === "approval-rowcount") return { rowsAffected: [0] };
            staged.parent.ParametersJson = values.parameters; bump(staged.parent); fail("approval"); return { rowsAffected: [1] };
          }
          if (statement.startsWith("UPDATE uqp.DashboardDataSource SET QueryDefinitionId")) {
            assert.doesNotMatch(statement.split("WHERE")[0]!, /(DatasetId|SourceKey)=/);
            const source = staged.sources.find(s => s.Id === values.id)!;
            Object.assign(source, { QueryDefinitionId: values.queryId, QueryBindingRevision: values.revision, MaxRows: values.maxRows,
              RefreshSeconds: values.refreshSeconds, PageSize: values.pageSize, PageSeconds: values.pageSeconds, ParametersJson: values.parameters, IsEnabled: values.enabled });
            bump(source); fail("binding"); return { rowsAffected: [1] };
          }
          if (statement.startsWith("UPDATE uqp.Dashboard SET QuerySourceMaxRows")) {
            staged.parent.QuerySourceMaxRows ??= 1000; bump(staged.parent); return { rowsAffected: [1] };
          }
          if (statement.startsWith("UPDATE uqp.Dashboard SET QueryDefinitionId")) {
            Object.assign(staged.parent, { QueryDefinitionId: values.queryId, ParametersJson: values.parameters,
              RefreshSeconds: values.refreshSeconds, PageSize: values.pageSize, PageSeconds: values.pageSeconds, QuerySourceMaxRows: values.maxRows });
            bump(staged.parent); return { rowsAffected: [1] };
          }
          throw new Error("unexpected synthetic SQL shape");
        } };
      return request as unknown as sql.Request;
    },
    getEffectiveQueryAccess: async (_user, queryId, actual) => {
      assert.equal(actual, tx); return control.queries.get(queryId)?.allowed ? { canView: true, canExecute: true } as any : null;
    },
    getDataset: async (id, actual) => { assert.equal(actual, tx); return { id, isActive: true, isArchived: false, sqlText: "SELECT 1" } as any; },
    listDatasetParameters: async (_id, actual) => { assert.equal(actual, tx); return []; },
    writeAuditEvent: async (input, actual) => { assert.equal(actual, tx); staged.audits.push(copy(input)); control.events.push("audit"); fail("audit"); return staged.audits.length; },
  };
  const store = createDashboardTransitionStore(deps);
  const service = createDashboardTransitionService(store, () => control.management);
  const sources = createQuerySourceManagement(store, () => control.management);
  const snapshot = () => copy(db);
  const pending = () => { db.parent.IsActive = false; };
  const upsert = (queryDefinitionId = 21) => ({ id: 10, sourceKey: "WARD", queryDefinitionId, parameters: { WARD: "SYNTHETIC" },
    refreshSeconds: 30, pageSize: 10, pageSeconds: 15, maxRows: 100, isEnabled: true });
  const convert = async (queryDefinitionId = 21) => sources.patch(1, 1, {
    expectedVersion: (await sources.configuration(1, 1)).version, upserts: [upsert(queryDefinitionId)], removals: [],
  });
  return { control, service, sources, store, deps, db: () => db, snapshot, pending, upsert, convert };
}

for (const management of [false, true]) test(`Legacy disable is atomic without whole-form saving; management=${management}`, async () => {
  const f = fixture(); f.control.management = management;
  f.control.queries.get(20)!.allowed = false; // Revoked clinical ACL must not prevent a designer stopping exposure.
  const before = f.snapshot(), view = await f.service.readDisable(1, actor);
  const result = await f.service.disable(1, actor, { expectedVersion: view.version, confirmed: true });
  const after = f.snapshot();
  assert.equal(result.isActive, false); assert.equal(result.credentialsInvalidated, true); assert.notEqual(result.version, view.version);
  assert.deepEqual(after.parent, { ...before.parent, IsActive: false, ApprovalRowVersion: after.parent.ApprovalRowVersion });
  assert.deepEqual(after.sources, before.sources); assert.deepEqual(after.widgets, before.widgets);
  assert.equal(after.devices.length, before.devices.length); assert.equal(after.devices[0]!.IsActive, true);
  assert.equal(after.devices[0]!.credentialEpoch, 2); assert.equal(after.audits[0]!.eventType, "DASHBOARD_LEGACY_DISABLED");
  assert.equal(f.control.events.at(-1), "commit");
  assert.ok(f.control.events.indexOf("audit") < f.control.events.lastIndexOf("commit"));
  await assert.rejects(f.service.disable(1, actor, { expectedVersion: result.version, confirmed: true }), { code: "DASHBOARD_ALREADY_INACTIVE" });
});

for (const mode of ["QUERY_ONLY", "QUERY_ONLY_DISABLED"]) test(`Legacy disable cannot alter ${mode}`, async () => {
  const f = fixture(); f.db().parent.QueryMode = mode; const before = f.snapshot();
  await assert.rejects(f.service.readDisable(1, actor), { code: "DASHBOARD_LEGACY_MODE_REQUIRED" });
  await assert.rejects(f.service.disable(1, actor, { expectedVersion: "0".repeat(64), confirmed: true }), { code: "DASHBOARD_LEGACY_MODE_REQUIRED" });
  assert.deepEqual(f.snapshot(), before);
});

test("Legacy stop does not parse damaged clinical parameters or layout and needs no EXECUTE_QUERY", async () => {
  const f = fixture(); f.control.session.permissions = ["DESIGN_QUERY"]; f.control.queries.clear();
  f.db().parent.ParametersJson = "[]"; f.db().sources[0]!.ParametersJson = "[]"; f.db().widgets[0]!.ConfigJson = "[]";
  const before = f.snapshot(), read = await f.service.readDisable(1, actor);
  await f.service.disable(1, actor, { expectedVersion: read.version, confirmed: true });
  assert.deepEqual(f.db().sources, before.sources); assert.deepEqual(f.db().widgets, before.widgets);
  assert.equal(f.db().parent.ParametersJson, "[]"); assert.equal(f.db().parent.IsActive, false);
  assert.equal(f.control.statements.some(q => q.includes("SELECT w.ConfigJson")), false);
});

for (const step of ["disable", "credentials", "audit", "commit", "disable-rowcount"]) test(`Legacy disable rollback includes credentials and audit; failure=${step}`, async () => {
  const f = fixture(), version = (await f.service.readDisable(1, actor)).version, before = f.snapshot();
  f.control.failAt = step;
  await assert.rejects(f.service.disable(1, actor, { expectedVersion: version, confirmed: true }));
  assert.deepEqual(f.snapshot(), before); assert.equal(f.control.events.at(-1), "rollback");
});

test("Legacy disable rejects stale version including RowVersion-only A→B→A", async () => {
  const f = fixture(), version = (await f.service.readDisable(1, actor)).version;
  f.db().parent.ApprovalRowVersion = Buffer.from("0000000000000010", "hex");
  const before = f.snapshot();
  await assert.rejects(f.service.disable(1, actor, { expectedVersion: version, confirmed: true }), { code: "DASHBOARD_TRANSITION_VERSION_CONFLICT" });
  assert.deepEqual(f.snapshot(), before);
});

for (const failure of ["token", "permission", "account", "917", "918", "919", "parent-version", "source-version"]) {
  test(`transition writes fail closed for ${failure}`, async () => {
    for (const operation of ["disable", "revoke"] as const) {
      const f = fixture(); if (operation === "revoke") f.pending();
      const version = operation === "disable" ? (await f.service.readDisable(1, actor)).version : (await f.service.readPending(1, "WARD", actor)).version;
      if (failure === "token") f.control.session.tokenVersion++;
      if (failure === "permission") f.control.session.permissions = [];
      if (failure === "account") f.control.session.isActive = false;
      if (failure === "917") f.control.schema917 = false;
      if (failure === "918") f.control.schema918 = false;
      if (failure === "919") f.control.schema919 = false;
      if (failure === "parent-version") f.db().parent.ApprovalRowVersion = null;
      if (failure === "source-version") f.db().sources[0]!.ApprovalRowVersion = Buffer.alloc(7);
      const before = f.snapshot();
      const action = operation === "disable" ? f.service.disable(1, actor, { expectedVersion: version, confirmed: true }) :
        f.service.revokePending(1, "WARD", actor, { sourceId: 10, expectedVersion: version, confirmed: true });
      await assert.rejects(action);
      assert.deepEqual(f.snapshot(), before); assert.equal(f.control.events.at(-1), "rollback");
    }
  });
}

test("optional historical cleanup and same-Dataset conversion preserve guards without creating Dataset public grants", async () => {
  const f = fixture(); f.pending(); const before = f.snapshot();
  const probe=fixture();probe.pending();const originalJson=probe.db().parent.ParametersJson;await probe.convert();assert.equal(probe.db().parent.ParametersJson,originalJson);assert.equal(probe.db().parent.IsActive,false);
  const view = await f.service.readPending(1, "WARD", actor);
  assert.equal(view.hasApprovals, true); assert.equal(JSON.stringify(view).includes("SYNTHETIC"), false);
  const revoked = await f.service.revokePending(1, "WARD", actor, { sourceId: view.sourceId, expectedVersion: view.version, confirmed: true });
  const params = JSON.parse(f.db().parent.ParametersJson), oldParams = JSON.parse(before.parent.ParametersJson);
  assert.deepEqual(params, { ...oldParams, deviceSourceColumnMasks: { ROOM: { NAME: "FULL" } } });
  assert.deepEqual(f.db().sources, before.sources); assert.deepEqual(f.db().widgets, before.widgets); assert.deepEqual(f.db().devices, before.devices);
  assert.equal(revoked.reapprovalRequired, true);
  const converted = await f.convert(); assert.equal(converted.playbackEnabled, false);
  const source = f.db().sources[0]!;
  assert.deepEqual([source.Id, source.SourceKey, source.DatasetId, source.QueryDefinitionId, source.QueryBindingRevision], [10, "WARD", 3, 21, 1]);
  assert.equal(f.db().parent.IsActive, false); assert.equal(f.db().parent.QueryMode, "LEGACY");
  const policy = [{ columnName: "NAME", sensitivityType: "NAME", deviceMaskMode: "FULL" as const }];
  let masks = resolveDashboardDisclosureMasks(JSON.parse(f.db().parent.ParametersJson), "WARD", policy);
  assert.deepEqual(maskDeviceRows([{ NAME: "SYNTHETIC" }], masks), [{}]);
  await f.sources.disclosure(1, 1, { expectedVersion: (await f.sources.configuration(1, 1)).version, sourceKey: "WARD", masks: { NAME: "INHERIT" } });
  masks = resolveDashboardDisclosureMasks(JSON.parse(f.db().parent.ParametersJson), "WARD", policy);
  assert.notDeepEqual(maskDeviceRows([{ NAME: "SYNTHETIC" }], masks), [{}]);
  assert.deepEqual(resolveDatasetPublicDisplayMasks({version:1,columns:policy},null,["NAME"]),{});
  assert.equal(f.db().audits[0]!.eventType, "DASHBOARD_PENDING_APPROVALS_REVOKED");
  assert.equal(JSON.stringify(f.db().audits).includes("SYNTHETIC"), false);
});

for (const step of ["approval", "audit", "commit", "approval-rowcount"]) test(`pending revocation failure=${step} preserves all configuration`, async () => {
  const f = fixture(); f.pending(); const view = await f.service.readPending(1, "WARD", actor), before = f.snapshot();
  f.control.failAt = step;
  await assert.rejects(f.service.revokePending(1, "WARD", actor, { sourceId: 10, expectedVersion: view.version, confirmed: true }));
  assert.deepEqual(f.snapshot(), before); assert.equal(f.control.events.at(-1), "rollback");
});

test("pending cleanup version covers source RowVersion and rejects identity drift", async () => {
  const f = fixture(); f.pending(); const view = await f.service.readPending(1, "WARD", actor);
  f.db().sources[0]!.ApprovalRowVersion = Buffer.from("0000000000000020", "hex");
  const before = f.snapshot();
  await assert.rejects(f.service.revokePending(1, "WARD", actor, { sourceId: 10, expectedVersion: view.version, confirmed: true }), { code: "DASHBOARD_TRANSITION_VERSION_CONFLICT" });
  const current = await f.service.readPending(1, "WARD", actor);
  await assert.rejects(f.service.revokePending(1, "WARD", actor, { sourceId: 11, expectedVersion: current.version, confirmed: true }), { code: "QUERY_SOURCE_IDENTITY_CONFLICT" });
  assert.deepEqual(f.snapshot(), before);
});

for (const change of ["active", "playing", "bound", "disabled-capability", "primary-acl", "primary-unpublished", "ambiguous-key"]) test(`pending cleanup rejects ${change}`, async () => {
  const f = fixture(); f.pending(); const view = await f.service.readPending(1, "WARD", actor);
  if (change === "active") f.db().parent.IsActive = true;
  if (change === "playing") f.db().parent.QueryMode = "QUERY_ONLY";
  if (change === "bound") f.db().sources[0]!.QueryDefinitionId = 21;
  if (change === "disabled-capability") f.control.management = false;
  if (change === "primary-acl") f.control.queries.get(20)!.allowed = false;
  if (change === "primary-unpublished") f.control.queries.get(20)!.IsPublished = false;
  if (change === "ambiguous-key") f.db().sources.push({ ...copy(f.db().sources[0]!), Id: 11, SourceKey: "ward" });
  const before = f.snapshot();
  await assert.rejects(f.service.readPending(1, "WARD", actor));
  await assert.rejects(f.service.revokePending(1, "WARD", actor, { sourceId: 10, expectedVersion: view.version, confirmed: true }));
  assert.deepEqual(f.snapshot(), before);
});

test("case-equivalent historical JSON stays non-authoritative and optional cleanup revokes only that source", async () => {
  const f = fixture(); f.pending();
  const params = JSON.parse(f.db().parent.ParametersJson);
  params.deviceSourceColumnMasks.ward = { MRN: "CUSTOM" };
  delete params.deviceSourceColumnMasks.WARD;
  f.db().parent.ParametersJson = JSON.stringify(params);
  const probe=fixture();probe.pending();probe.db().parent.ParametersJson=JSON.stringify(params);await probe.convert();assert.equal(probe.db().parent.ParametersJson,JSON.stringify(params));
  const view = await f.service.readPending(1, "WARD", actor);
  await f.service.revokePending(1, "WARD", actor, { sourceId: 10, expectedVersion: view.version, confirmed: true });
  await f.convert();
  assert.deepEqual(JSON.parse(f.db().parent.ParametersJson).deviceSourceColumnMasks, { ROOM: { NAME: "FULL" } });
});

for (const failure of ["missing", "unpublished", "inactive", "archived", "acl", "dataset", "binding", "audit"]) test(`conversion failure=${failure} leaves revoked approvals revoked and source pending`, async () => {
  const f = fixture(); f.pending(); const view = await f.service.readPending(1, "WARD", actor);
  await f.service.revokePending(1, "WARD", actor, { sourceId: 10, expectedVersion: view.version, confirmed: true });
  if (failure === "missing") f.control.queries.delete(21);
  if (failure === "unpublished") f.control.queries.get(21)!.IsPublished = false;
  if (failure === "inactive") f.control.queries.get(21)!.IsActive = false;
  if (failure === "archived") f.control.queries.get(21)!.IsArchived = true;
  if (failure === "acl") f.control.queries.get(21)!.allowed = false;
  if (failure === "dataset") f.control.queries.get(21)!.DatasetId = 4;
  if (failure === "binding" || failure === "audit") f.control.failAt = failure;
  const before = f.snapshot();
  await assert.rejects(f.convert()); assert.deepEqual(f.snapshot(), before);
  assert.equal(f.db().sources[0]!.QueryDefinitionId, null);
});

test("referenced source can convert in place but cannot be deleted or rebound to another Query", async () => {
  const f = fixture(); f.pending(); const view = await f.service.readPending(1, "WARD", actor);
  await f.service.revokePending(1, "WARD", actor, { sourceId: 10, expectedVersion: view.version, confirmed: true });
  await f.convert(); const before = f.snapshot(), config = await f.sources.configuration(1, 1);
  await assert.rejects(f.sources.patch(1, 1, { expectedVersion: config.version, upserts: [], removals: [{ id: 10, sourceKey: "WARD" }] }), { code: "QUERY_SOURCE_IN_USE" });
  await assert.rejects(f.convert(22), { code: "QUERY_SOURCE_IN_USE" });
  assert.deepEqual(f.snapshot(), before);
});

for (const mode of ["LEGACY", "QUERY_ONLY", "QUERY_ONLY_DISABLED"]) test(`hard deletion has no storage side effects for ${mode}`, async () => {
  const f = fixture(); f.db().parent.QueryMode = mode; const before = f.snapshot();
  await assert.rejects(deleteDashboard(1), { code: "DASHBOARD_HARD_DELETE_DISABLED", status: 409 });
  assert.deepEqual(f.snapshot(), before); assert.deepEqual(f.control.statements, []);
});

async function withApi(run: (f: ReturnType<typeof fixture>, request: (path: string, method?: string, body?: unknown, credential?: string | null) => Promise<{ status: number; body: any }>) => Promise<void>) {
  const f = fixture(), previous = env.JWT_SECRET;
  env.JWT_SECRET = "synthetic-transition-test-secret";
  const credential = jwt.sign({ sub: "1", tokenVersion: 1 }, env.JWT_SECRET);
  const app = express(); app.use(express.json()); app.use(createAuthenticateJwt(async () => copy(f.control.session)));
  app.use(createDashboardTransitionRouter(f.service)); app.use(createQuerySourceRouter(f.sources));
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await run(f, async (path, method = "GET", body, token = credential) => {
      const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    });
  } finally { env.JWT_SECRET = previous; await new Promise<void>(resolve => server.close(() => resolve())); }
}

test("HTTP Legacy disable works with management enabled and cannot submit any other setting", async () => {
  await withApi(async (f, request) => {
    const path = "/1/legacy-disable/v1", read = await request(path);
    assert.equal(read.status, 200);
    const before = f.snapshot();
    const body = { expectedVersion: read.body.version, confirmed: true };
    for (const extra of [{ isActive: true }, { isActive: false }, { activate: false }, { queryDefinitionId: 21 }, { parameters: {} }, { profiles: [] }]) {
      const denied = await request(path, "POST", { ...body, ...extra });
      assert.equal(denied.status, 400); assert.deepEqual(f.snapshot(), before);
    }
    assert.equal((await request(path, "POST", { ...body, confirmed: false })).status, 400);
    assert.equal((await request(path, "POST", { ...body, expectedVersion: read.body.version + "\n" })).status, 400);
    const disabled = await request(path, "POST", body);
    assert.equal(disabled.status, 200); assert.equal(disabled.body.credentialsInvalidated, true);
    assert.equal(f.db().parent.IsActive, false);
    const stale = await request(path, "POST", body);
    assert.equal(stale.status, 409);
    assert.equal((await request(path, "POST", { ...body, expectedVersion: disabled.body.version })).status, 409);
  });
});

for (const failure of ["missing-jwt", "invalid-jwt", "token-version", "permission", "transaction-token"]) test(`HTTP transitions reject ${failure} without writes`, async () => {
  await withApi(async (f, request) => {
    const view = await request("/1/legacy-disable/v1");
    if (failure === "token-version") f.control.session.tokenVersion++;
    if (failure === "permission") f.control.session.permissions = [];
    if (failure === "transaction-token") f.deps.session = async () => ({ ...copy(f.control.session), tokenVersion: 2 });
    const before = f.snapshot();
    const credential = failure === "missing-jwt" ? null : failure === "invalid-jwt" ? "synthetic-invalid" : undefined;
    const failed = await request("/1/legacy-disable/v1", "POST", { expectedVersion: view.body.version, confirmed: true }, credential);
    assert.equal(failed.status, failure === "permission" ? 403 : 401);
    assert.deepEqual(f.snapshot(), before); assert.equal(failed.body.isActive, undefined);
  });
});

test("HTTP pending cleanup requires explicit confirmation/identity and accepts no Query, parameters or bulk clearing", async () => {
  await withApi(async (f, request) => {
    f.pending();
    const path = "/1/query-sources/v1/WARD/pending-approvals", read = await request(path);
    assert.equal(read.status, 200); assert.equal(read.body.hasApprovals, true);
    const before = f.snapshot(), body = { sourceId: 10, expectedVersion: read.body.version, confirmed: true };
    for (const extra of [{ queryDefinitionId: 21 }, { masks: {} }, { parameters: {} }, { sourceKey: "ROOM" }, { upserts: [] }]) {
      assert.equal((await request(path, "POST", { ...body, ...extra })).status, 400);
      assert.deepEqual(f.snapshot(), before);
    }
    assert.equal((await request(path, "POST", { ...body, confirmed: false })).status, 400);
    assert.equal((await request(path, "POST", { ...body, sourceId: 11 })).status, 409);
    const revoked = await request(path, "POST", body); assert.equal(revoked.status, 200);
    assert.equal(revoked.body.reapprovalRequired, true);
    assert.equal((await request(path, "POST", body)).status, 409);
    const config = await request("/1/query-sources/v1/configuration");
    const converted = await request("/1/query-sources/v1", "PATCH", { expectedVersion: config.body.version, upserts: [f.upsert()], removals: [] });
    assert.equal(converted.status, 200); assert.equal(converted.body.playbackEnabled, false);
    assert.equal(f.db().sources[0]!.Id, 10); assert.equal(f.db().parent.IsActive, false);
  });
});

test("HTTP pending conversion uses real JWT/TokenVersion middleware and preserves revoked grants on rejection", async () => {
  await withApi(async (f, request) => {
    f.pending(); const path = "/1/query-sources/v1/WARD/pending-approvals";
    const read = await request(path);
    await request(path, "POST", { sourceId: 10, expectedVersion: read.body.version, confirmed: true });
    const config = await request("/1/query-sources/v1/configuration"), before = f.snapshot();
    f.control.session.tokenVersion++;
    const failed = await request("/1/query-sources/v1", "PATCH", { expectedVersion: config.body.version, upserts: [f.upsert()], removals: [] });
    assert.equal(failed.status, 401); assert.deepEqual(f.snapshot(), before);
  });
});

for (const mode of ["LEGACY", "QUERY_ONLY", "QUERY_ONLY_DISABLED"]) test(`HTTP DELETE remains present and refuses ${mode} regardless of capability`, async () => {
  await withApi(async (f, request) => {
    f.db().parent.QueryMode = mode;
    for (const enabled of [false, true]) {
      f.control.management = enabled; const before = f.snapshot();
      const failed = await request("/1", "DELETE");
      assert.equal(failed.status, 409); assert.equal(failed.body.error.code, "DASHBOARD_HARD_DELETE_DISABLED");
      assert.deepEqual(f.snapshot(), before); assert.deepEqual(f.control.statements, []);
    }
  });
});

test("HTTP exposes safe Schema failures and no private driver details after rollback", async () => {
  await withApi(async (f, request) => {
    const path = "/1/legacy-disable/v1", read = await request(path), before = f.snapshot();
    f.control.schema919 = false;
    const missing = await request(path, "POST", { expectedVersion: read.body.version, confirmed: true });
    assert.equal(missing.status, 503); assert.equal(missing.body.error.code, "SECURITY_SCHEMA_REQUIRED");
    f.control.schema919 = true; f.control.failAt = "audit";
    const failed = await request(path, "POST", { expectedVersion: read.body.version, confirmed: true });
    assert.equal(failed.status, 503); assert.equal(JSON.stringify(failed.body).includes("synthetic-private"), false);
    assert.deepEqual(f.snapshot(), before);
  });
});
