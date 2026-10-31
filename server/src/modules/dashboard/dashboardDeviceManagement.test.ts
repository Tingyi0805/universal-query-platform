import { revokeDashboardQueryDevice } from "./dashboardQueryMode.repository.js";
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
import { createDeviceManagementStore, defaultDeviceManagementDependencies } from "./dashboardDeviceManagement.repository.js";
import { createDeviceManagementService } from "./dashboardDeviceManagement.service.js";
import { createDeviceManagementRouter, legacyDeviceWriteGuard } from "./dashboardDeviceManagement.routes.js";
import { deviceMetadataSchema, devicePlacementSchema } from "./dashboardDeviceManagement.schema.js";
const copy = <T>(v: T): T => deserialize(serialize(v));
const actor = { userId: 1, tokenVersion: 1 };
const metadata = { deviceName: "Synthetic new", enforceIpRestriction: true, allowedIp: "192.0.2.1", allowedCidr: null, expiresAtUtc: "2099-01-01T00:00:00Z" };
const placement = { browser: "edge" as const, screenNumber: 2, fullscreen: true, windowX: -1920, windowY: 0, windowWidth: 1920, windowHeight: 1080 };
type Row = Record<string, any>;
function fixture() {
  let db = { sequence: 3n, parent: { Id: 1, Name: "Synthetic", QueryDefinitionId: 20, ParametersJson: "{}", IsActive: false, QueryMode: "LEGACY", QueryModeVersion: 0,
    QuerySourceMaxRows: 100, RefreshSeconds: 30, PageSize: 10, PageSeconds: 15, UpdatedAtUtc: "2026-10-20T00:00:00Z", DisplayMode: "TABLE",
    ShowClock: true, ShowPageNumber: true, ShowCountdown: true, ApprovalRowVersion: Buffer.from("0000000000000001", "hex") } as Row,
    devices: [{ Id: 7, DashboardId: 1, DeviceName: "Synthetic", CreatedByUserId: 2, SharedWorkstationId: 3, IsActive: true, ExpiresAtUtc: null, RevokedAtUtc: null,
      ArchivedAtUtc: null, EnforceIpRestriction: true, AllowedIp: "192.0.2.2", AllowedCidr: null, TokenHash: "a".repeat(64), QueryModeGrantVersion: 1, DelegatorTokenVersion: 1 }] as Row[],
    placements: [] as Row[], audits: [] as Row[] };
  let staged = copy(db), queue = Promise.resolve();
  const control = { enabled: true, schema: true, modeSchema: true, deviceSchema: true, pool: true, failAt: "", deniedUser: 0, account: true,
    permissions: ["DESIGN_QUERY", "EXECUTE_QUERY"], tokenVersion: 1, workstation: true, query: true, statements: [] as string[], events: [] as string[] };
  const fail = (at: string) => { if (control.failAt === at) throw new Error("synthetic-private-diagnostic"); };
  let currentTx: sql.Transaction;
  const deps: typeof defaultDeviceManagementDependencies = { ...defaultDeviceManagementDependencies,
    getPool: async () => control.pool ? {} as sql.ConnectionPool : null,
    createTransaction: () => {
      let release = () => {};
      const tx = { begin: async (level: number) => { assert.equal(level, sql.ISOLATION_LEVEL.SERIALIZABLE); const previous = queue;
        queue = new Promise<void>(resolve => { release = resolve; }); await previous; currentTx = tx; staged = copy(db); control.events.push("begin"); },
        commit: async () => { fail("commit"); db = copy(staged); control.events.push("commit"); release(); },
        rollback: async () => { staged = copy(db); control.events.push("rollback"); release(); } } as unknown as sql.Transaction;
      return tx;
    },
    securitySchema: async () => { if (!control.schema) throw new SecurityContractError("SECURITY_SCHEMA_REQUIRED"); },
    modeSchema: async () => control.modeSchema, deviceSchema: async () => control.deviceSchema,
    lifecycleSchema: async () => { fail("lifecycle-schema"); },
    session: async (id, tx) => { assert.equal(tx, currentTx); return { isActive: control.account && id !== control.deniedUser, tokenVersion: control.tokenVersion, permissions: control.permissions } as any; },
    getEffectiveQueryAccess: async (id, _q, tx) => { assert.equal(tx, currentTx); return id !== control.deniedUser && control.query ? { canView: true, canExecute: true } as any : null; },
    getDataset: async (_id, tx) => { assert.equal(tx, currentTx); return { id: 2, isActive: true, isArchived: false, sqlText: "SELECT 1" } as any; },
    listDatasetParameters: async (_id, tx) => { assert.equal(tx, currentTx); return []; },
    writeAuditEvent: async (input, tx) => { assert.equal(tx, currentTx); staged.audits.push(copy(input)); fail("audit"); return control.failAt === "audit-evidence" ? NaN : staged.audits.length; },
    createRequest: tx => {
      assert.equal(tx, currentTx); const v: Row = {};
      return { input(name: string, _type: unknown, value: unknown) { v[name] = value; return this; }, async query(s: string) {
        control.statements.push(s);
        if (s.includes("CK_DashboardDataSource_QueryBoundLimit")) return { recordset: [{ Ready: true }] };
        if (s.includes("AS Suspended,")) return {recordset:[{Suspended:8,Pending:1}]};
        if (s.includes("DEVICE_LIFECYCLE_TRIGGER_CONFLICT")) { fail("lifecycle-schema"); return {recordset:[]}; }
        if (s.includes("SET IsActive=0,RevokedAtUtc=SYSUTCDATETIME()")) {
          assert.match(s,/SuspendedAtUtc=NULL,ReenrollmentRequired=NULL/);
          assert.doesNotMatch(s,/AND IsActive=1/);
          const d=staged.devices.find(d=>d.Id===v.deviceId && d.DashboardId===v.id && !d.RevokedAtUtc && !d.ArchivedAtUtc);
          if(!d)return {rowsAffected:[0]};
          Object.assign(d,{IsActive:false,RevokedAtUtc:new Date(Math.floor(Date.now()/1000)*1000).toISOString(),SuspendedAtUtc:null,
            ReenrollmentRequired:null,TokenHash:"f".repeat(64),QueryModeGrantVersion:null,DelegatorTokenVersion:null});
          return {rowsAffected:[1]};
        }
        if (s.includes("DECLARE @eventTime")) {
          assert.match(s, /OUTPUT INSERTED.Id INTO @changed/);
          assert.match(s, /CRYPT_GEN_RANDOM\(32\)/);
          assert.match(s, /RevokedAtUtc IS NULL AND ArchivedAtUtc IS NULL/);
          const d = staged.devices.find(d => d.Id === v.deviceId && d.DashboardId === v.dashboardId);
          const suspend = s.includes("SuspendedAtUtc=@eventTime"), time = new Date(Math.round(Date.now()/1000)*1000).toISOString();
          if (!d || d.RevokedAtUtc || d.ArchivedAtUtc || d.ExpiresAtUtc && Date.parse(d.ExpiresAtUtc)<=Date.now() ||
            (suspend ? !d.IsActive || d.SuspendedAtUtc : d.IsActive || !d.SuspendedAtUtc || d.ReenrollmentRequired !== true)) return {recordset:[]};
          Object.assign(d,{IsActive:!suspend,SuspendedAtUtc:suspend?time:null,ReenrollmentRequired:true,
            TokenHash:suspend?"d".repeat(64):"e".repeat(64),QueryModeGrantVersion:null,DelegatorTokenVersion:null});
          fail("lifecycle"); return {recordset:[{Id:d.Id,EventTime:time}]};
        }
        if (s.startsWith("SELECT * FROM uqp.Dashboard WITH")) { assert.match(s, /UPDLOCK,HOLDLOCK/); return { recordset: v.dashboardId === 1 ? [copy(staged.parent)] : [] }; }
        if (s.startsWith("SELECT * FROM uqp.DashboardDataSource") || s.includes("SELECT w.ConfigJson") || s.startsWith("SELECT Id,SourceKey,DatasetId,ApprovalRowVersion")) return { recordset: [] };
        if (s.startsWith("SELECT QueryDefinitionId,ApprovalRowVersion")) return { recordset: [copy(staged.parent)] };
        if (s.includes("FROM uqp.DashboardDisplayDevice WITH")) { assert.match(s, /UPDLOCK,HOLDLOCK/); return { recordset: copy(staged.devices) }; }
        if (s.startsWith("SELECT p.* FROM uqp.DashboardDevicePlaybackSettings")) { assert.match(s, /UPDLOCK,HOLDLOCK/); return { recordset: copy(staged.placements) }; }
        if (s.startsWith("SELECT Id,DatasetId,IsPublished")) return { recordset: control.query ? [{ Id: 20, DatasetId: 2, IsPublished: true, IsActive: true, IsArchived: false }] : [] };
        if (s.includes("FROM uqp.SharedWorkstation WITH")) return { recordset: [{ IsActive: control.workstation, RetiredAtUtc: null, PurposeCode: "DASHBOARD" }] };
        if(/UPDATE\s+uqp\.DashboardDisplayDevice\s+SET ExpiresAtUtc=DATEADD/.test(s)){
          assert.match(s,/ArchivedAtUtc IS NULL/);assert.match(s,/RevokedAtUtc IS NULL/);assert.match(s,/ExpiresAtUtc>SYSUTCDATETIME/);assert.match(s,/DATEADD\(DAY,365,SYSUTCDATETIME/);
          assert.doesNotMatch(s.split("OUTPUT")[0]!,/TokenHash=|QueryModeGrantVersion=|DelegatorTokenVersion=|IsActive=/);
          const d=staged.devices.find(d=>d.Id===v.deviceId&&d.DashboardId===v.dashboardId)!;
          if(control.failAt==="renew-expired")return{recordset:[]};
          d.ExpiresAtUtc=new Date(Date.parse(d.ExpiresAtUtc)+v.extendDays*86400000).toISOString();fail("renew");return{recordset:[copy(d)]};
        }
        if (s.startsWith("INSERT INTO uqp.DashboardDisplayDevice")) {
          assert.match(s, /CRYPT_GEN_RANDOM\(32\)/); assert.match(s, /NULL,1,@expiresAtUtc/); assert.doesNotMatch(s, /OUTPUT INSERTED\.\*/);
          staged.devices.push({ Id: 8, DashboardId: v.dashboardId, DeviceName: v.deviceName, CreatedByUserId: v.ownerId, SharedWorkstationId: null,
            IsActive: true, ExpiresAtUtc: v.expiresAtUtc, EnforceIpRestriction: v.enforceIpRestriction, AllowedIp: v.allowedIp, AllowedCidr: v.allowedCidr,
            TokenHash: "b".repeat(64), QueryModeGrantVersion: null, DelegatorTokenVersion: null, RevokedAtUtc: null, ArchivedAtUtc: null });
          fail("create"); return { recordset: [{ Id: 8 }] };
        }
        if (s.startsWith("UPDATE uqp.DashboardDisplayDevice SET")) {
          assert.match(s, /RevokedAtUtc IS NULL AND ArchivedAtUtc IS NULL/); assert.match(s, /ExpiresAtUtc>SYSUTCDATETIME/);
          assert.doesNotMatch(s.split("WHERE")[0]!, /CreatedByUserId=|SharedWorkstationId=|IsActive=|RevokedAtUtc=/);
          Object.assign(staged.devices.find(d => d.Id === v.deviceId && d.DashboardId === v.dashboardId)!, { DeviceName: v.deviceName, EnforceIpRestriction: v.enforceIpRestriction,
            AllowedIp: v.allowedIp, AllowedCidr: v.allowedCidr, ExpiresAtUtc: v.expiresAtUtc, TokenHash: "c".repeat(64), QueryModeGrantVersion: null, DelegatorTokenVersion: null, LastUsedAtUtc: null });
          fail("metadata"); return { rowsAffected: [control.failAt === "rowcount" ? 0 : 1] };
        }
        if (s.includes("UPDATE uqp.DashboardDevicePlaybackSettings SET")) {
          assert.match(s, /RevokedAtUtc IS NULL AND ArchivedAtUtc IS NULL/); assert.doesNotMatch(s, /TokenHash=|ParametersJson|ColumnMask/);
          staged.placements = [{ DashboardId: v.dashboardId, DeviceId: v.deviceId, Browser: v.browser, ScreenNumber: v.screenNumber, Fullscreen: v.fullscreen,
            WindowX: v.windowX, WindowY: v.windowY, WindowWidth: v.windowWidth, WindowHeight: v.windowHeight }]; fail("placement"); return { rowsAffected: [1] };
        }
        if (s.startsWith("UPDATE uqp.Dashboard SET UpdatedAtUtc")) { staged.parent.ApprovalRowVersion = Buffer.from((staged.sequence++).toString(16).padStart(16, "0"), "hex"); fail("touch"); return { rowsAffected: [1] }; }
        throw new Error("unexpected synthetic SQL");
      } } as unknown as sql.Request;
    },
  };
  const store=createDeviceManagementStore(deps);
  const service = createDeviceManagementService(store, () => control.enabled);
  const revoke=()=>store.transaction(async tx=>{await tx.readState(1);await tx.records(1);await revokeDashboardQueryDevice(1,7,deps.createRequest(currentTx));});
  return { service, revoke, deps, control, db: () => db, snapshot: () => copy(db), version: async () => (await service.read(1, actor)).version };
}

test("metadata-only creation creates no credential; authenticated creator is the immutable delegator", async () => {
  const f = fixture(), version = await f.version(), before = f.snapshot();
  const result = await f.service.create(1, actor, { expectedVersion: version, confirmed: true, metadata });
  assert.equal(result.credentialIssued, false); assert.notEqual(result.version, version);
  const d = f.db().devices.at(-1)!; assert.equal(d.CreatedByUserId, 1); assert.equal(d.SharedWorkstationId, null); assert.equal(d.IsActive, true);
  assert.equal(d.QueryModeGrantVersion, null); assert.equal(d.DelegatorTokenVersion, null); assert.equal(f.db().audits.length, 1);
  assert.equal(f.db().parent.ParametersJson, before.parent.ParametersJson); assert.equal(f.control.events.at(-1), "commit");
  assert.doesNotMatch(JSON.stringify(result), /TokenHash|tokenHash|credentialFingerprint|"token"/);
});
test("IP/expiry/name edits invalidate credentials without changing delegator, workstation, activation or policy", async () => {
  const f = fixture(), before = f.snapshot(); f.db().parent.QueryMode = "QUERY_ONLY"; f.db().parent.IsActive = true;
  const result = await f.service.metadata(1, 7, actor, { expectedVersion: await f.version(), confirmed: true, metadata });
  const d = f.db().devices[0]!; assert.equal(result.deviceCredentialsInvalidated, true); assert.notEqual(d.TokenHash, before.devices[0]!.TokenHash);
  assert.equal(d.QueryModeGrantVersion, null); assert.equal(d.DelegatorTokenVersion, null); assert.equal(d.CreatedByUserId, 2); assert.equal(d.SharedWorkstationId, 3); assert.equal(d.IsActive, true);
  assert.equal(f.db().parent.ParametersJson, before.parent.ParametersJson);
});
test("placement persists independently without rotating credentials or changing masking/exposure-audit configuration", async () => {
  const f = fixture(), before = f.snapshot(), version = await f.version();
  const result = await f.service.placement(1, 7, actor, { expectedVersion: version, confirmed: true, placement });
  assert.equal(result.deviceCredentialsInvalidated, false); assert.notEqual(result.version, version); assert.deepEqual(f.db().devices, before.devices);
  assert.equal(f.db().parent.ParametersJson, before.parent.ParametersJson); assert.deepEqual(result.devices[0]!.placement, placement);
  assert.equal(f.db().audits[0]!.eventType, "DASHBOARD_DEVICE_PLACEMENT_UPDATED");
});
for (const op of ["create", "metadata", "placement"] as const) for (const failure of [op, "touch", "audit", "audit-evidence", "commit"]) test(`${op}: ${failure} fully rolls back`, async () => {
  const f = fixture(), version = await f.version(), before = f.snapshot(); f.control.failAt = failure;
  await assert.rejects(op === "create" ? f.service.create(1, actor, { expectedVersion: version, confirmed: true, metadata }) : op === "metadata" ?
    f.service.metadata(1, 7, actor, { expectedVersion: version, confirmed: true, metadata }) : f.service.placement(1, 7, actor, { expectedVersion: version, confirmed: true, placement }));
  assert.deepEqual(f.snapshot(), before); assert.equal(f.control.events.at(-1), "rollback");
});
for (const reason of ["token", "rbac", "execute", "account", "query", "919", "918", "device-schema", "rowversion", "flag"]) test(`all writes fail closed: ${reason}`, async () => {
  const f = fixture(), version = await f.version();
  if (reason === "token") f.control.tokenVersion++;
  if (reason === "rbac") f.control.permissions = [];
  if (reason === "execute") f.control.permissions = ["DESIGN_QUERY"];
  if (reason === "account") f.control.account = false;
  if (reason === "query") f.control.query = false;
  if (reason === "919") f.control.schema = false;
  if (reason === "918") f.control.modeSchema = false;
  if (reason === "device-schema") f.control.deviceSchema = false;
  if (reason === "rowversion") f.db().parent.ApprovalRowVersion = null;
  if (reason === "flag") f.control.enabled = false;
  const before = f.snapshot();
  await assert.rejects(f.service.create(1, actor, { expectedVersion: version, confirmed: true, metadata }));
  await assert.rejects(f.service.metadata(1, 7, actor, { expectedVersion: version, confirmed: true, metadata }));
  await assert.rejects(f.service.placement(1, 7, actor, { expectedVersion: version, confirmed: true, placement })); assert.deepEqual(f.snapshot(), before);
});
for (const reason of ["inactive", "revoked", "archived", "expired", "owner", "workstation"]) test(`settings cannot restore invalid delegation: ${reason}`, async () => {
  const f = fixture(), d = f.db().devices[0]!;
  if (reason === "inactive") d.IsActive = false;
  if (reason === "revoked") d.RevokedAtUtc = "2020-01-01T00:00:00Z";
  if (reason === "archived") d.ArchivedAtUtc = "2020-01-01T00:00:00Z";
  if (reason === "expired") d.ExpiresAtUtc = "2020-01-01T00:00:00Z";
  if (reason === "owner") f.control.deniedUser = 2;
  if (reason === "workstation") f.control.workstation = false;
  const version = await f.version(), before = f.snapshot();
  await assert.rejects(f.service.metadata(1, 7, actor, { expectedVersion: version, confirmed: true, metadata }));
  await assert.rejects(f.service.placement(1, 7, actor, { expectedVersion: version, confirmed: true, placement })); assert.deepEqual(f.snapshot(), before);
});
test("concurrent updates and A→B→A reject stale aggregate versions even within one timestamp", async () => {
  const f = fixture(), version = await f.version();
  const results = await Promise.allSettled([f.service.metadata(1, 7, actor, { expectedVersion: version, confirmed: true, metadata }), f.service.placement(1, 7, actor, { expectedVersion: version, confirmed: true, placement })]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason.code, "DASHBOARD_DEVICE_VERSION_CONFLICT");
  await f.service.metadata(1, 7, actor, { expectedVersion: await f.version(), confirmed: true, metadata: { ...metadata, deviceName: "Synthetic" } });
  await assert.rejects(f.service.create(1, actor, { expectedVersion: version, confirmed: true, metadata }), { code: "DASHBOARD_DEVICE_VERSION_CONFLICT" });
});
test("credential rotation invalidates versions; LastUsed does not; other Dashboard/device identities are rejected", async () => {
  const f = fixture(), version = await f.version(); f.db().devices[0]!.LastUsedAtUtc = new Date().toISOString(); assert.equal(await f.version(), version);
  f.db().devices[0]!.TokenHash = "d".repeat(64); assert.notEqual(await f.version(), version);
  await assert.rejects(f.service.read(2, actor), { code: "DASHBOARD_NOT_FOUND" });
  await assert.rejects(f.service.metadata(1, 99, actor, { expectedVersion: await f.version(), confirmed: true, metadata }), { code: "DASHBOARD_DEVICE_NOT_FOUND" });
});
test("strict schemas reject delegator/workstation/token injection, invalid IP/date/placement", () => {
  for (const bad of [{ ...metadata, createdByUserId: 9 }, { ...metadata, sharedWorkstationId: 9 }, { ...metadata, token: "synthetic" }, { ...metadata, isActive: true },
    { ...metadata, allowedIp: "0.0.0.999" }, { ...metadata, allowedCidr: "192.0.2.0/" }, { ...metadata, enforceIpRestriction: false }, { ...metadata, expiresAtUtc: "2000-01-01T00:00:00Z" }]) assert.equal(deviceMetadataSchema.safeParse(bad).success, false);
  for (const bad of [{ ...placement, deviceColumnMasks: {} }, { ...placement, windowWidth: 199 }, { ...placement, screenNumber: 17 }, { ...placement, windowX: 32769 }]) assert.equal(devicePlacementSchema.safeParse(bad).success, false);
});
async function httpFixture() {
  const f = fixture(), oldSecret = env.JWT_SECRET; env.JWT_SECRET = "synthetic-5b3a-test-secret";
  const app = express(); app.use(express.json());
  const session = { isActive: true, tokenVersion: 1, permissions: ["DESIGN_QUERY", "EXECUTE_QUERY"], id: 1, username: "synthetic", displayName: "Synthetic" };
  app.use(createAuthenticateJwt(async () => session as any)); app.use(createDeviceManagementRouter(f.service));
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const token = jwt.sign({ sub: "1", tokenVersion: 1 }, env.JWT_SECRET, { expiresIn: "1h" });
  const request = async (method = "GET", suffix = "", body?: unknown, credential: string | null = token) => {
    const response = await fetch(`http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/1/device-management/v1${suffix}`, {
      method, headers: { "Content-Type": "application/json", ...(credential ? { Authorization: `Bearer ${credential}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
  };
  return { ...f, request, session, token, close: async () => { env.JWT_SECRET = oldSecret; await new Promise<void>(resolve => server.close(() => resolve())); } };
}
test("HTTP create/update uses actual JWT middleware, strict confirmation and no secret response", async () => {
  const f = await httpFixture(); try {
    const view = await f.request(); assert.equal(view.status, 200); assert.equal(view.cache, "no-store");
    const created = await f.request("POST", "", { expectedVersion: view.body.version, confirmed: true, metadata });
    assert.equal(created.status, 201); assert.equal(created.body.credentialIssued, false); assert.doesNotMatch(JSON.stringify(created.body), /TokenHash|credentialFingerprint|"token"/);
    assert.equal((await f.request("PUT", "/7/metadata", { expectedVersion: view.body.version, confirmed: true, metadata })).status, 409);
    assert.equal((await f.request("PUT", "/7/metadata", { expectedVersion: created.body.version, confirmed: true, metadata: { ...metadata, createdByUserId: 99 } })).status, 400);
    assert.equal((await f.request("PUT", "/7/placement", { expectedVersion: created.body.version, confirmed: true, placement })).status, 200);
    assert.equal((await f.request("POST", "", { expectedVersion: created.body.version, metadata })).status, 400);
  } finally { await f.close(); }
});
for (const reason of ["missing", "invalid", "expired", "middleware-version", "middleware-permission", "transaction-version"]) test(`HTTP authentication rejects ${reason}`, async () => {
  const f = await httpFixture(); try {
    const version = (await f.request()).body.version; let token: string | null = f.token;
    if (reason === "missing") token = null;
    if (reason === "invalid") token = "invalid";
    if (reason === "expired") token = jwt.sign({ sub: "1", tokenVersion: 1 }, env.JWT_SECRET!, { expiresIn: -1 });
    if (reason === "middleware-version") f.session.tokenVersion++;
    if (reason === "middleware-permission") f.session.permissions = [];
    if (reason === "transaction-version") f.control.tokenVersion++;
    const before = f.snapshot(), response = await f.request("POST", "", { expectedVersion: version, confirmed: true, metadata }, token);
    assert.equal(response.status, reason === "middleware-permission" ? 403 : 401); assert.deepEqual(f.snapshot(), before);
  } finally { await f.close(); }
});
test("HTTP storage/audit failure redacts driver detail and rolls back", async () => {
  const f = await httpFixture(); try {
    const version = (await f.request()).body.version, before = f.snapshot(); f.control.failAt = "audit";
    const response = await f.request("POST", "", { expectedVersion: version, confirmed: true, metadata });
    assert.equal(response.status, 503); assert.doesNotMatch(JSON.stringify(response), /private-diagnostic|TokenHash/); assert.deepEqual(f.snapshot(), before);
  } finally { await f.close(); }
});
test("Legacy write guard rejects managed/unversioned writes and preserves pure reads and explicit Legacy mode", async () => {
  for (const managed of [false, true]) for (const mode of ["LEGACY", "QUERY_ONLY", "QUERY_ONLY_DISABLED"]) for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
    let next = false, status = 200;
    await legacyDeviceWriteGuard(() => managed, async () => ({ mode }))({ method, params: { id: "1" } } as any,
      { status(v: number) { status = v; return this; }, json() {} } as any, () => { next = true; });
    assert.equal(next, method === "GET" || (!managed && mode === "LEGACY")); assert.equal(status, next ? 200 : 409);
  }
});

test("versioned renewal reuses existing SQL and atomically changes only expiry, preserving credentials and grants",async()=>{
 const f=fixture();f.db().devices[0]!.ExpiresAtUtc=new Date(Date.now()+7*86400000).toISOString();const before=f.snapshot(),version=await f.version();
 const result=await f.service.renew(1,7,actor,{expectedVersion:version,confirmed:true,days:30});
 assert.notEqual(result.version,version);assert.equal(result.credentialIssued,false);assert.equal(result.deviceCredentialsInvalidated,false);
 const expected=copy(before.devices);expected[0]!.ExpiresAtUtc=new Date(Date.parse(expected[0]!.ExpiresAtUtc)+30*86400000).toISOString();assert.deepEqual(f.db().devices,expected);
 const audit=f.db().audits[0]!;assert.equal(audit.eventType,"DASHBOARD_DEVICE_RENEWED");assert.equal(audit.parameters.extendDays,30);assert.equal(audit.parameters.previousExpiresAtUtc,before.devices[0]!.ExpiresAtUtc);assert.equal(audit.parameters.expiresAtUtc,expected[0]!.ExpiresAtUtc);
 assert.doesNotMatch(JSON.stringify([result,audit]),/TokenHash|credentialFingerprint|"token"/);
 await assert.rejects(f.service.renew(1,7,actor,{expectedVersion:version,confirmed:true,days:1}),/DASHBOARD_DEVICE_VERSION_CONFLICT/);
});
for(const failure of ["renew","renew-expired","touch","audit","audit-evidence","commit"])test(`renewal ${failure} rolls back expiry and audit`,async()=>{
 const f=fixture();f.db().devices[0]!.ExpiresAtUtc=new Date(Date.now()+86400000).toISOString();const version=await f.version(),before=f.snapshot();f.control.failAt=failure;
 await assert.rejects(f.service.renew(1,7,actor,{expectedVersion:version,confirmed:true,days:30}));assert.deepEqual(f.snapshot(),before);assert.equal(f.control.events.at(-1),"rollback");
});
for(const reason of ["expired","revoked","archived","inactive","none","over-limit","owner","workstation","permission","token","query","disabled-mode","mode-grant","delegator-version"])test(`safe renewal rejects ${reason} without restoring authority`,async()=>{
 const f=fixture(),d=f.db().devices[0]!;d.ExpiresAtUtc=new Date(Date.now()+86400000).toISOString();
 if(reason==="expired")d.ExpiresAtUtc=new Date(Date.now()-1).toISOString();if(reason==="revoked")d.RevokedAtUtc=new Date().toISOString();if(reason==="archived")d.ArchivedAtUtc=new Date().toISOString();if(reason==="inactive")d.IsActive=false;if(reason==="none")d.ExpiresAtUtc=null;if(reason==="over-limit")d.ExpiresAtUtc=new Date(Date.now()+360*86400000).toISOString();
 if(reason==="owner")f.control.deniedUser=2;if(reason==="workstation")f.control.workstation=false;if(reason==="disabled-mode")f.db().parent.QueryMode="QUERY_ONLY_DISABLED";
 if(reason==="mode-grant"||reason==="delegator-version"){f.db().parent.QueryMode="QUERY_ONLY";f.db().parent.QueryModeVersion=4;f.db().parent.IsActive=true;d.QueryModeGrantVersion=reason==="mode-grant"?3:4;d.DelegatorTokenVersion=reason==="delegator-version"?0:1;}
 const version=await f.version(),before=f.snapshot();if(reason==="query")f.control.query=false;if(reason==="permission")f.control.permissions=["DESIGN_QUERY"];if(reason==="token")f.control.tokenVersion++;
 await assert.rejects(f.service.renew(1,7,actor,{expectedVersion:version,confirmed:true,days:30}));assert.deepEqual(f.snapshot(),before);
});
for(const days of [0,-1,366,1.5,NaN])test(`renewal bounds reject ${days}`,async()=>{const f=fixture();f.db().devices[0]!.ExpiresAtUtc=new Date(Date.now()+86400000).toISOString();await assert.rejects(f.service.renew(1,7,actor,{expectedVersion:await f.version(),confirmed:true,days}));});
test("concurrent renewals with the same version commit exactly once",async()=>{const f=fixture();f.db().devices[0]!.ExpiresAtUtc=new Date(Date.now()+86400000).toISOString();const input={expectedVersion:await f.version(),confirmed:true as const,days:30};const results=await Promise.allSettled([f.service.renew(1,7,actor,input),f.service.renew(1,7,actor,input)]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(f.db().audits.length,1);});
test("renewal HTTP route requires explicit confirmation, version and bounded days",async()=>{const f=await httpFixture();try{
 f.db().devices[0]!.ExpiresAtUtc=new Date(Date.now()+86400000).toISOString();let version=(await f.request()).body.version;
 for(const body of [{days:30},{expectedVersion:version,days:30},{expectedVersion:version,confirmed:true,days:366},{expectedVersion:version,confirmed:true,days:30,token:"forbidden"}])assert.equal((await f.request("POST","/7/renew",body)).status,400);
 const result=await f.request("POST","/7/renew",{expectedVersion:version,confirmed:true,days:30});assert.equal(result.status,200);assert.equal(result.body.credentialIssued,false);assert.equal(result.cache,"no-store");assert.equal((await f.request("POST","/7/renew",{expectedVersion:version,confirmed:true,days:30})).status,409);
 }finally{await f.close();}});
test("renew active Query-only with matching mode/delegator grant to the 365-day lifetime bound",async()=>{
 const f=fixture(),d=f.db().devices[0]!;f.db().parent.QueryMode="QUERY_ONLY";f.db().parent.QueryModeVersion=4;f.db().parent.IsActive=true;d.QueryModeGrantVersion=4;d.DelegatorTokenVersion=1;d.ExpiresAtUtc=new Date(Date.now()+86400000).toISOString();
 const result=await f.service.renew(1,7,actor,{expectedVersion:await f.version(),confirmed:true,days:364});assert.equal(result.deviceCredentialsInvalidated,false);assert.equal(f.db().devices[0]!.QueryModeGrantVersion,4);assert.equal(f.db().devices[0]!.DelegatorTokenVersion,1);
});
for(const reason of ["missing-mode-version","inactive-query-only"])test(`Query-only renewal requires reliable active-mode evidence: ${reason}`,async()=>{
 const f=fixture(),d=f.db().devices[0]!;d.ExpiresAtUtc=new Date(Date.now()+86400000).toISOString();d.QueryModeGrantVersion=4;d.DelegatorTokenVersion=1;f.db().parent.QueryMode="QUERY_ONLY";f.db().parent.IsActive=reason!=="inactive-query-only";f.db().parent.QueryModeVersion=reason==="missing-mode-version"?undefined:4;const version=await f.version(),before=f.snapshot();
 await assert.rejects(f.service.renew(1,7,actor,{expectedVersion:version,confirmed:true,days:30}));assert.deepEqual(f.snapshot(),before);
});


test("D2-A legacy NULL/absent markers suspend and restore pending with two hash rotations, no credential", async () => {
 const f=fixture(), old=f.db().devices[0]!.TokenHash;
 const a=await f.service.suspend(1,7,actor,{expectedVersion:await f.version(),confirmed:true});
 const suspended=f.snapshot().devices[0]!;
 assert.equal(suspended.IsActive,false);assert.equal(suspended.ReenrollmentRequired,true);assert.notEqual(suspended.TokenHash,old);
 assert.equal(suspended.QueryModeGrantVersion,null);assert.equal(suspended.DelegatorTokenVersion,null);
 const b=await f.service.restore(1,7,actor,{expectedVersion:a.version,confirmed:true});
 const pending=f.db().devices[0]!;assert.equal(pending.IsActive,true);assert.equal(pending.SuspendedAtUtc,null);assert.equal(pending.ReenrollmentRequired,true);
 assert.notEqual(pending.TokenHash,suspended.TokenHash);assert.notEqual(pending.TokenHash,old);assert.equal(pending.ExpiresAtUtc,null);
 assert.equal(a.credentialIssued,false);assert.equal(b.credentialIssued,false);assert(!JSON.stringify(b).includes(pending.TokenHash));
 assert.deepEqual(f.db().audits.map(a=>a.eventType),["DASHBOARD_DEVICE_SUSPENDED","DASHBOARD_DEVICE_RESTORED_PENDING"]);
 await assert.rejects(f.service.restore(1,7,actor,{expectedVersion:b.version,confirmed:true}));
});
test("D2-A safety read and suspend survive delegator/Query ACL loss; restore rechecks", async()=>{
 const f=fixture(); f.control.deniedUser=2;f.control.query=false;
 const v=await f.service.safetyRead(1,actor);
 const a=await f.service.suspend(1,7,actor,{expectedVersion:v.version,confirmed:true});
 const before=f.snapshot();await assert.rejects(f.service.restore(1,7,actor,{expectedVersion:a.version,confirmed:true}));assert.deepEqual(f.snapshot(),before);
});
for(const action of ["suspend","restore"] as const)for(const failure of ["lifecycle-schema","lifecycle","touch","audit","audit-evidence","commit"])test(`D2-A ${action} rolls back ${failure}`,async()=>{
 const f=fixture();if(action==="restore")await f.service.suspend(1,7,actor,{expectedVersion:await f.version(),confirmed:true});
 const input={expectedVersion:(await f.service.safetyRead(1,actor)).version,confirmed:true as const},before=f.snapshot();f.control.failAt=failure;
 await assert.rejects(f.service[action](1,7,actor,input));assert.deepEqual(f.snapshot(),before);assert.equal(f.control.events.at(-1),"rollback");
});
for(const reason of ["revoked","archived","expired","inactive","permission","session","delegator","workstation","query","confirmation"] as const)test(`D2-A restore rejects ${reason}`,async()=>{
 const f=fixture();await f.service.suspend(1,7,actor,{expectedVersion:await f.version(),confirmed:true});const d=f.db().devices[0]!;
 if(reason==="revoked")d.RevokedAtUtc="2026-01-01T00:00:00Z";if(reason==="archived")d.ArchivedAtUtc="2026-01-01T00:00:00Z";
 if(reason==="expired")d.ExpiresAtUtc="2026-01-01T00:00:00Z";if(reason==="inactive")d.SuspendedAtUtc=null;
 const version=(await f.service.safetyRead(1,actor)).version;
 if(reason==="permission")f.control.permissions=[];if(reason==="session")f.control.tokenVersion++;if(reason==="delegator")f.control.deniedUser=2;
 if(reason==="workstation")f.control.workstation=false;if(reason==="query")f.control.query=false;
 const before=f.snapshot();await assert.rejects(f.service.restore(1,7,actor,{expectedVersion:version,confirmed:(reason!=="confirmation") as true}));assert.deepEqual(f.snapshot(),before);
});
test("D2-A repeated and simultaneous suspension commits exactly once",async()=>{
 const f=fixture(),input={expectedVersion:await f.version(),confirmed:true as const};
 const results=await Promise.allSettled([f.service.suspend(1,7,actor,input),f.service.suspend(1,7,actor,input)]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(f.db().audits.length,1);
 await assert.rejects(f.service.suspend(1,7,actor,{...input,expectedVersion:(await f.service.safetyRead(1,actor)).version}));
});
test("D2-A concurrent permanent revocation invalidates full device version before restore",async()=>{
 const f=fixture();await f.service.suspend(1,7,actor,{expectedVersion:await f.version(),confirmed:true});
 const version=(await f.service.safetyRead(1,actor)).version,d=f.db().devices[0]!;
 Object.assign(d,{RevokedAtUtc:"2026-01-01T00:00:00Z",SuspendedAtUtc:null,ReenrollmentRequired:null,TokenHash:"f".repeat(64)});
 const before=f.snapshot();await assert.rejects(f.service.restore(1,7,actor,{expectedVersion:version,confirmed:true}),{code:"DASHBOARD_DEVICE_VERSION_CONFLICT"});assert.deepEqual(f.snapshot(),before);
});
test("D2-A HTTP strict confirmation, version conflicts, no-store and safe management read",async t=>{
 const f=await httpFixture();t.after(f.close);
 const view=await f.request("GET","/lifecycle");assert.equal(view.status,200);
 for(const body of [{expectedVersion:view.body.version},{confirmed:true},{expectedVersion:view.body.version,confirmed:true,token:"forbidden"}])assert.equal((await f.request("POST","/7/suspend",body)).status,400);
 const a=await f.request("POST","/7/suspend",{expectedVersion:view.body.version,confirmed:true});assert.equal(a.status,200);assert.equal(a.cache,"no-store");
 assert.equal((await f.request("POST","/7/restore",{expectedVersion:view.body.version,confirmed:true})).status,409);
 assert.equal((await f.request("POST","/7/restore",{expectedVersion:a.body.version,confirmed:true})).status,200);
});

for(const revokeFirst of [true,false])test(`D2-A serialized restore/revoke race revokeFirst=${revokeFirst} always ends permanently revoked`,async()=>{
 const f=fixture();await f.service.suspend(1,7,actor,{expectedVersion:await f.version(),confirmed:true});
 const input={expectedVersion:(await f.service.safetyRead(1,actor)).version,confirmed:true as const};
 const results=await Promise.allSettled(revokeFirst?[f.revoke(),f.service.restore(1,7,actor,input)]:[f.service.restore(1,7,actor,input),f.revoke()]);
 assert.equal(results[revokeFirst?0:1]!.status,"fulfilled");if(revokeFirst)assert.equal(results[1]!.status,"rejected");
 const d=f.db().devices[0]!;assert.equal(d.IsActive,false);assert(d.RevokedAtUtc);assert.equal(d.SuspendedAtUtc,null);assert.equal(d.ReenrollmentRequired,null);
 assert.equal(d.QueryModeGrantVersion,null);assert.equal(d.DelegatorTokenVersion,null);
 await assert.rejects(f.service.restore(1,7,actor,{...input,expectedVersion:(await f.service.safetyRead(1,actor)).version}));
});
test("D2-A revocation without 926 never references lifecycle columns in UPDATE",async()=>{
 const statements:string[]=[];const request={input(){return this;},async query(s:string){statements.push(s);return s.includes("AS Suspended,")?{recordset:[{Suspended:null,Pending:null}]}:{rowsAffected:[1]};}} as unknown as sql.Request;
 await revokeDashboardQueryDevice(1,7,request);assert.equal(statements.length,2);assert.doesNotMatch(statements[1]!,/SuspendedAtUtc|ReenrollmentRequired/);assert.match(statements[1]!,/AND IsActive=1/);
});

test("D2-A designer can suspend after losing global Execute permission but cannot restore",async()=>{
 const f=fixture();f.control.permissions=["DESIGN_QUERY"];
 const v=await f.service.safetyRead(1,actor),a=await f.service.suspend(1,7,actor,{expectedVersion:v.version,confirmed:true});
 const before=f.snapshot();await assert.rejects(f.service.restore(1,7,actor,{expectedVersion:a.version,confirmed:true}),{code:"FORBIDDEN"});assert.deepEqual(f.snapshot(),before);
});
for(const reason of ["permission","session","confirmation","missing","expired","revoked","archived"])test(`D2-A suspend rejects ${reason} atomically`,async()=>{
 const f=fixture(),version=await f.version(),d=f.db().devices[0]!;
 if(reason==="permission")f.control.permissions=["EXECUTE_QUERY"];if(reason==="session")f.control.tokenVersion++;
 if(reason==="expired")d.ExpiresAtUtc="2026-01-01T00:00:00Z";if(reason==="revoked")d.RevokedAtUtc="2026-01-01T00:00:00Z";if(reason==="archived")d.ArchivedAtUtc="2026-01-01T00:00:00Z";
 const before=f.snapshot();await assert.rejects(f.service.suspend(1,reason==="missing"?99:7,actor,{expectedVersion:version,confirmed:(reason!=="confirmation") as true}));assert.deepEqual(f.snapshot(),before);
});
test("D2-A simultaneous restores commit once and never clear pending",async()=>{
 const f=fixture(),a=await f.service.suspend(1,7,actor,{expectedVersion:await f.version(),confirmed:true}),input={expectedVersion:a.version,confirmed:true as const};
 const results=await Promise.allSettled([f.service.restore(1,7,actor,input),f.service.restore(1,7,actor,input)]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(f.db().audits.length,2);assert.equal(f.db().devices[0]!.ReenrollmentRequired,true);
});

test("D2-A 926 readiness is required only for lifecycle APIs; ordinary management remains compatible",async()=>{
 const f=fixture();f.control.failAt="lifecycle-schema";
 const version=await f.version();assert.match(version,/^[a-f0-9]{64}$/);
 for(const work of [()=>f.service.safetyRead(1,actor),()=>f.service.suspend(1,7,actor,{expectedVersion:version,confirmed:true}),()=>f.service.restore(1,7,actor,{expectedVersion:version,confirmed:true})]){
  const before=f.snapshot();await assert.rejects(work(),{code:"DASHBOARD_DEVICE_LIFECYCLE_SCHEMA_REQUIRED",status:503});assert.deepEqual(f.snapshot(),before);
 }
});
