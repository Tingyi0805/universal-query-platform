import { SecurityContractError } from "../securityContract/securityContract.js";
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { createServer } from "node:http";
import { createDashboardPreviewRouter, type DashboardPreviewDependencies } from "./dashboardPreview.routes.js";
import { QuerySourceError } from "./dashboardQuerySources.service.js";
const rawName = "合成患者甲", rawMrn = "SYNTHETIC987654";
async function fixture(run: (f: { state: any; request: (path: string) => Promise<{ status: number; body: any; cache: string | null }> }) => Promise<void>) {
  const state = { schemaMissing: false, approvalEpoch: "rowversion-1", session: { isActive: true, tokenVersion: 1, permissions: ["DESIGN_QUERY", "EXECUTE_QUERY"] }, allowed: true, published: true,
    mrnMode: undefined as string | undefined, failSupplemental: false, managed: false, sqlFailure: false, policyFailure: false, auditFailure: false, missingAudit: false, patientConfigured: true, calls: 0, afterExecute: () => {}, afterAudit: () => {}, audits: [] as any[],
    policy: { version: 1, columns: [
      { columnName: "NAME", sensitivityType: "NAME", deviceMaskMode: "FULL" },
      { columnName: "MRN", sensitivityType: "MRN", deviceMaskMode: "CUSTOM", customMask: { prefix: 0, suffix: 2, symbol: "*" } },
      { columnName: "ROOM", sensitivityType: "OTHER", deviceMaskMode: "NONE" },
      { columnName: "SECRET", sensitivityType: "HEALTH", deviceMaskMode: "OMIT" },
    ] } };
  const deps: DashboardPreviewDependencies = {
    getApprovalEvidence: async () => { if (state.schemaMissing) throw new SecurityContractError("SECURITY_SCHEMA_REQUIRED"); return state.approvalEpoch; },
    getSession: async () => structuredClone(state.session),
    getDashboard: async () => ({ id: 1, queryDefinitionId: 2, isActive: true, parameters: { REGNO: "synthetic-bind", deviceSourceColumnMasks: { WARD: { NAME: "INHERIT", MRN: state.mrnMode ?? "INHERIT" } }, deviceColumnMasks: { NAME: "NONE", MRN: state.mrnMode ?? "NONE", SECRET: "NONE", ROOM: "NONE" } } }) as any,
    getQuery: async () => ({ id: 2, datasetId: 3, isActive: true, isPublished: state.published, isArchived: false }) as any,
    getAccess: async () => state.allowed ? { canView: true, canExecute: true } as any : null,
    getDataset: async () => ({ id: 3, dataSourceId: 4, isActive: true, isArchived: false }) as any,
    getPolicy: async () => { if (state.policyFailure) throw new Error("synthetic SQL Bind password"); return structuredClone(state.policy) as any; },
    getSources: async () => [{ id: 10, sourceKey: "WARD", datasetId: 3, isEnabled: true, parameters: { WARD: "synthetic" } }] as any,
    getReportColumns: async () => [{ columnName: "NAME" }, { columnName: "SECRET" }, { columnName: "UNAPPROVED" }] as any,
    legacyGuard: async () => { if (state.managed) throw new QuerySourceError("QUERY_SOURCE_LEGACY_WRITER_DISABLED"); },
    execute: async (_id, parameters) => {
      state.calls++; if (state.sqlFailure || (state.failSupplemental && parameters.WARD)) throw new Error("synthetic SQL Bind password"); state.afterExecute();
      return { columns: ["NAME", "MRN", "SECRET", "ROOM", "UNAPPROVED"].map(name => ({ name })), rows: [{ NAME: rawName, MRN: rawMrn, SECRET: "synthetic-diagnosis", ROOM: "OR01", UNAPPROVED: "private-note" }], rowCount: 1, elapsedMs: 1, truncated: false };
    },
    getPatientAuditConfig: async () => state.patientConfigured ? { isEnabled: true, patientKeyColumn: "MRN" } : null,
    audit: async input => { if (state.auditFailure) throw new Error("synthetic SQL Bind password"); state.audits.push(input); state.afterAudit(); return state.missingAudit ? null : 1; },
  };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.id = "synthetic-request"; req.authUser = { id: 5, permissions: state.session.permissions } as any; next(); }); app.use(createDashboardPreviewRouter(deps));
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const token = jwt.sign({ sub: "5", tokenVersion: 1 }, "synthetic-only");
  const request = async (path: string) => { const r = await fetch(`http://127.0.0.1:${(server.address() as any).port}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }); return { status: r.status, body: await r.json(), cache: r.headers.get("cache-control") }; };
  try { await run({ state, request }); } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
for (const path of ["/1/preview", "/1/data-sources/WARD/preview"]) {
  test(`${path}: actual HTTP response is masked, strips omitted/unapproved fields and private binds`, () => fixture(async f => {
    const r = await f.request(path); assert.equal(r.status, 200); assert.equal(r.cache, "no-store");
    for (const value of [rawName, rawMrn, "synthetic-diagnosis", "private-note", "synthetic-bind"]) assert.ok(!JSON.stringify(r.body).includes(value));
    assert.equal(r.body.result.rows[0].NAME, "○○○○"); assert.equal(r.body.result.rows[0].MRN, "*************54");
    assert.ok(!r.body.result.columns.some((c: any) => ["SECRET", "UNAPPROVED"].includes(c.name)));
    assert.equal(f.state.audits[0].rows[0].NAME, rawName); assert.equal(f.state.audits[0].masked, true);
  }));
  for (const failure of ["policyFailure", "auditFailure", "missingAudit", "sqlFailure"]) test(`${path}: ${failure} returns no rows or driver secrets`, () => fixture(async f => {
    f.state[failure] = true; const r = await f.request(path); assert.equal(r.status, 503); assert.equal(r.body.result, undefined);
    assert.equal(r.body.error.requestId, "synthetic-request"); assert.ok(!JSON.stringify(r.body).includes("password"));
  }));
  test(`${path}: revoked ACL/JWT, unpublished and managed Query-only cannot use fallback`, () => fixture(async f => {
    f.state.allowed = false; assert.equal((await f.request(path)).status, 403); f.state.allowed = true;
    f.state.session.tokenVersion++; assert.equal((await f.request(path)).status, 401); f.state.session.tokenVersion--;
    f.state.published = false; assert.equal((await f.request(path)).status, 409); f.state.published = true;
    f.state.managed = true; assert.equal((await f.request(path)).body.error.code, "QUERY_SOURCE_LEGACY_WRITER_DISABLED"); assert.equal(f.state.calls, 0);
  }));
  for (const stage of ["afterExecute", "afterAudit"]) test(`${path}: ${stage} policy/ACL changes block disclosure`, () => fixture(async f => {
    f.state[stage] = () => f.state.policy.version++; assert.equal((await f.request(path)).status, 409);
    f.state[stage] = () => { f.state.allowed = false; }; assert.equal((await f.request(path)).status, 403);
  }));
}
test("ordinary Dashboard preview with no patient audit returns masked data", () => fixture(async f => {
  f.state.patientConfigured = false; f.state.missingAudit = true;
  for (const path of ["/1/preview", "/1/data-sources/WARD/preview"]) {
    const response = await f.request(path);
    assert.equal(response.status, 200);
    assert.equal(response.body.disclosureId, null);
    assert.equal(response.body.result.rows[0].NAME, "○○○○");
  }
}));
test("conflicting policy blocks before SQL despite Dashboard raw approval", () => fixture(async f => {
  f.state.policy.columns.push({ columnName: "name", sensitivityType: "OTHER", deviceMaskMode: "NONE" }); const result = await f.request("/1/preview");
  assert.equal(result.status, 503); assert.equal(result.body.error.code, "DASHBOARD_SENSITIVITY_POLICY_INVALID"); assert.equal(f.state.calls, 0);
}));

test("failed Legacy extra source does not replace safe PRIMARY results with raw fallback", () => fixture(async f => {
  f.state.failSupplemental = true;
  assert.equal((await f.request("/1/data-sources/WARD/preview")).status, 503);
  const primary = await f.request("/1/preview"); assert.equal(primary.status, 200);
  for (const value of [rawName, rawMrn]) assert.ok(!JSON.stringify(primary.body).includes(value));
}));
test("absent/unreviewed Dataset policy fails closed; explicit empty reviewed policy is distinct", () => fixture(async f => {
  f.state.policy = { version: 0, columns: [] };
  for (const path of ["/1/preview", "/1/data-sources/WARD/preview"]) {
    const r = await f.request(path); assert.equal(r.status, 503); assert.equal(r.body.error.code, "DASHBOARD_SENSITIVITY_POLICY_REQUIRED");
  }
  assert.equal(f.state.calls, 0);
  f.state.policy.version = 1;
  assert.equal((await f.request("/1/preview")).status, 200);
  assert.deepEqual((await f.request("/1/data-sources/WARD/preview")).body.result.rows, [{}]);
}));
for (const path of ["/1/preview", "/1/data-sources/WARD/preview"]) test(`${path}: HTTP CUSTOM inheritance uses Dataset settings, FULL/OMIT protect and removed rules revoke approval`, () => fixture(async f => {
  // State drives the real route policy, not a pre-masked response.
  f.state.mrnMode = "INHERIT";
  let r = await f.request(path); assert.equal(r.body.result.rows[0].MRN, "*************54");
  f.state.mrnMode = "FULL"; r = await f.request(path); assert.equal(r.body.result.rows[0].MRN, "*************54");
  f.state.mrnMode = "OMIT"; r = await f.request(path); assert.equal(r.body.result.rows[0].MRN, "*************54");
  f.state.mrnMode = "INHERIT"; f.state.policy.columns = f.state.policy.columns.filter((c: any) => c.columnName !== "MRN"); f.state.policy.version++;
  r = await f.request(path); assert.equal(r.body.result.rows[0].MRN, undefined);
  assert.ok(!JSON.stringify(r.body).includes(rawMrn));
}));

test("preview Schema error exposes only safe code and guidance, never stale data", () => fixture(async f => {
  f.state.schemaMissing = true; const response = await f.request("/1/preview");
  assert.equal(response.status, 503); assert.equal(response.body.error.code, "SECURITY_SCHEMA_REQUIRED"); assert.equal(response.body.result, undefined); assert.equal(f.state.calls, 0);
}));
