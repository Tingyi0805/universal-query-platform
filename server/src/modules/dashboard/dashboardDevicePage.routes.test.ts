import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import { createDashboardDevicePageRouter, type DevicePageDependencies } from "./dashboardDevicePage.routes.js";

type Dashboard = NonNullable<Awaited<ReturnType<DevicePageDependencies["getDashboard"]>>>;
type Dataset = NonNullable<Awaited<ReturnType<DevicePageDependencies["getDataset"]>>>;
type Query = NonNullable<Awaited<ReturnType<DevicePageDependencies["getQueryDefinition"]>>>;
type Layout = Awaited<ReturnType<DevicePageDependencies["getDashboardLayout"]>>;
type Device = Extract<Awaited<ReturnType<DevicePageDependencies["checkDashboardDisplayDevice"]>>, { status: "VALID" }>["device"];

async function fixture(run: (f: Awaited<ReturnType<typeof openFixture>>) => Promise<void>) {
  const f = await openFixture();
  try { await run(f); } finally { await new Promise<void>(resolve => f.server.close(() => resolve())); }
}
async function openFixture() {
  const state = {
    valid: true, queryManaged: false, accessRevision: "acl-v1", sqlCalls: 0, audits: [] as Parameters<DevicePageDependencies["auditPatientListIfConfigured"]>[0][],
    dashboard: { id: 1, queryDefinitionId: 2, isActive: true, pageSize: 1, pageSeconds: 5, refreshSeconds: 10,
      parameters: { deviceColumnMasks: { NAME: "NAME", MRN: "CUSTOM", ROOM: "NONE" } } } as unknown as Dashboard,
    dataset: { id: 3, dataSourceId: 4, sqlText: "SELECT NAME, MRN, ROOM FROM synthetic", isActive: true, isArchived: false } as Dataset,
    query: { id: 2, datasetId: 3, isPublished: true, isActive: true, isArchived: false, code: "SYNTHETIC", name: "Synthetic" } as Query,
    layout: { profiles: [{ isDefault: true, widgets: [{ widgetType: "TABLE", config: { dataSourceKey: "ORACLE" } }] }] } as unknown as Layout,
    dataSource: { isActive: true, revision: "SQLSERVER-v1" },
    policy: { version: 1, columns: [
      { columnName: "NAME", sensitivityType: "NAME", deviceMaskMode: "NAME" as const },
      { columnName: "MRN", sensitivityType: "MRN", deviceMaskMode: "CUSTOM" as const, customMask: { prefix: 0, suffix: 2, symbol: "*" } },
      { columnName: "SECRET", sensitivityType: "HEALTH", deviceMaskMode: "OMIT" as const },
    ] },
    sources: [{ id: 10, dashboardId: 1, sourceKey: "ORACLE", datasetId: 3, refreshSeconds: 10, pageSize: 1, pageSeconds: 5, parameters: { WARD: "TEST" }, isEnabled: true }],
    afterSql: () => {}, afterAudit: () => {}, sqlFailure: false, auditFailure: false, auditEnabled: true,
  };
  const deps: DevicePageDependencies = {
    legacySourceIsQueryBound: async () => state.queryManaged,
    getQueryAccessRevision: async () => state.accessRevision,
    checkDashboardDisplayDevice: async (_id, token) => state.valid && token === "synthetic-device-token"
      ? { status: "VALID", device: { id: 11, dashboardId: 1, createdByUserId: 12, lastUsedAtUtc: new Date().toISOString() } as Device }
      : { status: "DISABLED" },
    getDashboard: async () => structuredClone(state.dashboard),
    getQueryDefinition: async () => structuredClone(state.query),
    getDataset: async () => structuredClone(state.dataset),
    getDashboardLayout: async () => structuredClone(state.layout),
    getDataSourcePlaybackState: async () => structuredClone(state.dataSource),
    getDatasetSensitivitySnapshot: async () => structuredClone(state.policy),
    listDatasetParameters: async () => [], listReportColumns: async () => [],
    listDashboardDataSources: async () => structuredClone(state.sources),
    executeSavedDataset: async () => {
      state.sqlCalls++;
      if (state.sqlFailure) throw new Error("SQL contains synthetic private patient NAME, MRN and credentials");
      state.afterSql();
      return { columns: ["NAME", "MRN", "SECRET", "ROOM"].map(name => ({ name })),
        rows: [{ NAME: "測試患者甲", MRN: "00000123", SECRET: "synthetic diagnosis", ROOM: "TEST" },
          { NAME: "測試患者乙", MRN: "00000456", SECRET: "synthetic diagnosis", ROOM: "TEST2" }], rowCount: 2, elapsedMs: 1, truncated: false };
    },
    auditPatientListIfConfigured: async input => {
      if (!state.auditEnabled) return null;
      if (state.auditFailure) throw new Error("synthetic audit unavailable");
      state.audits.push(input); state.afterAudit(); return state.audits.length;
    },
  };
  const app = express(); app.use(express.json()); app.use(createDashboardDevicePageRouter(deps));
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = async (path: string, body: unknown, token = "synthetic-device-token") => {
    const r = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", "X-Dashboard-Device-Token": token }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json(), cacheControl: r.headers.get("cache-control") };
  };
  return { state, server, request };
}
const primary = "/device/1/page";
const supplemental = "/device/1/data-sources/ORACLE/page";
test("managed bindings cannot be played through legacy PRIMARY or Dataset fallback routes", () => fixture(async f => {
  f.state.queryManaged = true;
  for (const path of [primary, supplemental]) {
    const result = await f.request(path, { page: 1 });
    assert.equal(result.status, 409); assert.equal(result.body.error.code, "QUERY_SOURCE_MODE_NOT_ACTIVATED");
  }
  assert.equal(f.state.sqlCalls, 0); assert.equal(f.state.audits.length, 0);
}));

for (const path of [primary, supplemental]) {
  test(`${path}: page-only masked delivery, raw identities audited server-side, paging does not execute SQL`, () => fixture(async f => {
    const first = await f.request(path, { page: 1 });
    assert.equal(first.status, 200); assert.equal(first.cacheControl, "no-store");
    assert.equal(first.body.result.rows.length, 1);
    assert.equal(first.body.result.rows[0].NAME, "測○○○甲");
    assert.equal(first.body.result.rows[0].MRN, "******23");
    assert.equal(first.body.result.rows[0].SECRET, undefined);
    assert.equal(JSON.stringify(first.body).includes("00000123"), false);
    assert.equal(first.body.dashboard?.parameters, undefined);
    assert.equal(f.state.audits[0]?.rows[0]?.MRN, "00000123");
    assert.equal(f.state.audits[0]?.dashboardDeviceId, 11);
    const second = await f.request(path, { page: 2, snapshotId: first.body.snapshotId });
    assert.equal(second.status, 200); assert.equal(f.state.sqlCalls, 1);
    assert.equal(f.state.audits.length, 2); assert.equal(f.state.audits[1]?.pageNumber, 2);
  }));
  test(`${path}: invalid token and invalid input cannot query or disclose`, () => fixture(async f => {
    assert.equal((await f.request(path, { page: 1 }, "invalid")).status, 401);
    assert.equal((await f.request(path, { page: 0 })).status, 400);
    assert.equal(f.state.sqlCalls, 0); assert.equal(f.state.audits.length, 0);
  }));
  for (const change of ["dataset", "source", "policy", "dashboard", "query", "layout", "disabled", "revoked", "permissions"] as const) {
    test(`${path}: ${change} change invalidates old data`, () => fixture(async f => {
      const first = await f.request(path, { page: 1 }); assert.equal(first.status, 200);
      switch (change) {
        case "dataset": f.state.dataset.sqlText += " WHERE ROOM='NEW'"; break;
        case "source": f.state.dataSource.revision = "ORACLE-v2"; break;
        case "policy": f.state.policy.version++; break;
        case "dashboard": f.state.dashboard.parameters.deviceColumnMasks = { NAME: "OMIT" }; break;
        case "query": f.state.query.isPublished = false; break;
        case "layout": f.state.layout.profiles = []; break;
        case "disabled": f.state.dataSource.isActive = false; break;
        case "revoked": f.state.valid = false; break;
        case "permissions": f.state.accessRevision = "acl-v2"; break;
      }
      const next = await f.request(path, { page: 2, snapshotId: first.body.snapshotId });
      assert.notEqual(next.status, 200); assert.equal(next.body.result, undefined); assert.equal(f.state.sqlCalls, 1);
    }));
  }
  test(`${path}: policy or authorization changed during SQL/audit fails closed`, () => fixture(async f => {
    f.state.afterSql = () => { f.state.policy.version++; };
    assert.equal((await f.request(path, { page: 1 })).status, 409);
    f.state.afterSql = () => {}; f.state.afterAudit = () => { f.state.valid = false; };
    const denied = await f.request(path, { page: 1 }); assert.equal(denied.status, 401); assert.equal(denied.body.result, undefined);
  }));
  test(`${path}: database and audit failures return no rows or private error details`, () => fixture(async f => {
    f.state.sqlFailure = true;
    const failed = await f.request(path, { page: 1 }); assert.equal(failed.status, 503);
    assert.equal(JSON.stringify(failed.body).includes("credentials"), false);
    f.state.sqlFailure = false; f.state.auditEnabled = false;
    assert.equal((await f.request(path, { page: 1 })).body.error.code, "PATIENT_AUDIT_NOT_CONFIGURED");
    f.state.auditEnabled = true; f.state.auditFailure = true;
    assert.equal((await f.request(path, { page: 1 })).body.result, undefined);
  }));
}
test("supplemental parameter, page settings and source replacement invalidate snapshots", () => fixture(async f => {
  for (const change of [() => { f.state.sources[0]!.parameters.WARD = "OTHER"; },
    () => { f.state.sources[0]!.pageSize = 2; }, () => { f.state.sources[0]!.id++; }]) {
    const first = await f.request(supplemental, { page: 1 }); assert.equal(first.status, 200);
    change(); assert.equal((await f.request(supplemental, { page: 1, snapshotId: first.body.snapshotId })).status, 409);
  }
}));
for (const path of [primary, supplemental]) test(`${path}: conflicting policy rejects fresh or previously cached pages`, () => fixture(async f => {
  const first = await f.request(path, { page: 1 }); assert.equal(first.status, 200);
  f.state.policy.columns.push({ columnName: "name", sensitivityType: "NAME", deviceMaskMode: "NAME" });
  const denied = await f.request(path, { page: 1, snapshotId: first.body.snapshotId });
  assert.equal(denied.status, 503); assert.equal(denied.body.error.code, "DASHBOARD_SENSITIVITY_POLICY_INVALID");
  assert.equal(denied.body.result, undefined); assert.equal(f.state.sqlCalls, 1);
}));
for (const path of [primary, supplemental]) test(`${path}: a never-reviewed empty Dataset policy cannot authorize playback`, () => fixture(async f => {
  f.state.policy = { version: 0, columns: [] };
  const r = await f.request(path, { page: 1 }); assert.equal(r.status, 503); assert.equal(r.body.error.code, "DASHBOARD_SENSITIVITY_POLICY_REQUIRED");
  assert.equal(f.state.sqlCalls, 0);
}));
