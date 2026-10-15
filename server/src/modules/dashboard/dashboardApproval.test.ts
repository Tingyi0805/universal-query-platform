import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import { createServer } from "node:http";
import { env } from "../../config/env.js";
import { createAuthenticateJwt } from "../auth/auth.middleware.js";
import { errorHandler } from "../../middleware/errorHandler.js";
import { SecurityContractError } from "../securityContract/securityContract.js";
import { createDashboardApprovalRouter } from "./dashboardApproval.routes.js";
import { createDashboardApprovalService, approvalVersion, assertBasicApprovalWrite, assertEmptyApprovalCreation,
  assertSourceApprovalBindings, type ApprovalStore, type ApprovalState, type ApprovalPatch } from "./dashboardApproval.service.js";
import { resolveDashboardDisclosureMasks, maskDeviceRows } from "./dashboardDeviceMasking.js";

const actor = { userId: 1, tokenVersion: 1 };
function fixture() {
  const policy = { version: 1, columns: [
    { columnName: "姓名", sensitivityType: "NAME", deviceMaskMode: "CUSTOM" as const, customMask: { prefix: 1, suffix: 0, symbol: "*" } },
    { columnName: "病歷號", sensitivityType: "MRN", deviceMaskMode: "OMIT" as const },
    { columnName: "ROOM", sensitivityType: "OTHER", deviceMaskMode: "NONE" as const },
  ] };
  const state: ApprovalState = { dashboardId: 1, queryId: 2, rowVersion: "0000000000000001", isActive: false,
    parameters: { WARD: "synthetic-private-bind", staticText: "固定文字", deviceColumnTypes: { 姓名: "NAME" }, deviceColumnMasks: {}, deviceSourceColumnMasks: {} },
    sources: [{ id: 1, sourceKey: "PRIMARY", datasetId: 3, rowVersion: "0000000000000001", policy },
      { id: 5, sourceKey: "EXTRA", datasetId: 4, rowVersion: "0000000000000002", policy: structuredClone(policy) }] };
  const control = { state, schema: true, allowed: true, design: true, tokenVersion: 1, mode: "LEGACY", management: false,
    failAudit: false, audits: [] as unknown[], commits: 0, rollbacks: 0, epoch: 2n };
  let tail = Promise.resolve();
  const store: ApprovalStore = { transaction: async (_id, run) => {
    const previous = tail; let release!: () => void; tail = new Promise<void>(r => { release = r; }); await previous;
    const staged = structuredClone(control.state); const audits: unknown[] = [];
    try {
      if (!control.schema) throw new SecurityContractError("SECURITY_SCHEMA_REQUIRED");
      if (control.management || control.mode !== "LEGACY") throw Object.assign(new Error("guarded"), { code: "QUERY_SOURCE_LEGACY_WRITER_DISABLED", status: 409 });
      const result = await run({
        read: async (_id, who) => {
          if (who.tokenVersion !== control.tokenVersion) throw Object.assign(new Error("revoked"), { code: "TOKEN_REVOKED", status: 401 });
          if (!control.allowed || !control.design) throw Object.assign(new Error("forbidden"), { code: "FORBIDDEN", status: 403 });
          return structuredClone(staged);
        },
        update: async (_id, parameters) => { staged.parameters = structuredClone(parameters); staged.rowVersion = (++control.epoch).toString(16).padStart(16, "0"); },
        audit: async (id, userId, sourceKey) => { if (control.failAudit) throw new Error("synthetic-audit-failure"); audits.push({ id, userId, sourceKey }); },
      }); control.state = staged; control.audits.push(...audits); control.commits++; return result;
    } catch (error) { control.rollbacks++; throw error; } finally { release(); }
  } };
  return { control, service: createDashboardApprovalService(store) };
}
const patch = (version: string, sourceKey = "PRIMARY", upsert: ApprovalPatch["upsert"] = { 姓名: "INHERIT" }, remove: string[] = []): ApprovalPatch => ({ expectedVersion: version, sourceKey, upsert, remove });
test("GET returns scoped administration fields without bind, SQL or patient data", async () => {
  const f = fixture(); const view = await f.service.get(1, actor);
  assert.match(view.version, /^[a-f0-9]{64}$/); assert.equal(view.sources.length, 2);
  assert.ok(!JSON.stringify(view).includes("synthetic-private-bind")); assert.ok(!JSON.stringify(view).includes("staticText"));
});
for (const sourceKey of ["PRIMARY", "EXTRA"]) test(`${sourceKey}: incremental add/update/remove preserves other settings and classification`, async () => {
  const f = fixture(); const before = structuredClone(f.control.state);
  let view = await f.service.get(1, actor);
  view = await f.service.patch(1, actor, patch(view.version, sourceKey));
  const masks = resolveDashboardDisclosureMasks(f.control.state.parameters, sourceKey, before.sources[0]!.policy.columns);
  assert.deepEqual(maskDeviceRows([{ 姓名: "合成患者", 病歷號: "synthetic-1", ROOM: "TEST" }], masks, before.sources[0]!.policy.columns), [{ 姓名: "合***" }]);
  view = await f.service.patch(1, actor, patch(view.version, sourceKey, { 姓名: "FULL" }));
  await f.service.patch(1, actor, patch(view.version, sourceKey, {}, ["姓名"]));
  assert.deepEqual(f.control.state.parameters.deviceColumnTypes, before.parameters.deviceColumnTypes);
  assert.deepEqual(f.control.state.sources, before.sources);
  assert.equal(f.control.state.parameters.staticText, "固定文字"); assert.equal(f.control.state.parameters.WARD, "synthetic-private-bind");
  assert.deepEqual(maskDeviceRows([{ 姓名: "合成患者" }], resolveDashboardDisclosureMasks(f.control.state.parameters, sourceKey, before.sources[0]!.policy.columns)), [{}]);
  const other = sourceKey === "PRIMARY" ? "EXTRA" : "PRIMARY";
  assert.deepEqual(resolveDashboardDisclosureMasks(f.control.state.parameters, other, before.sources[0]!.policy.columns), {});
});
test("CUSTOM cannot become incomparable partial/raw; Dataset OMIT never discloses", async () => {
  const f = fixture();
  for (const mode of ["NAME", "MRN", "NONE", "PHONE", "GENERIC"] as const) await assert.rejects(f.service.patch(1, actor, patch(approvalVersion(f.control.state), "PRIMARY", { 姓名: mode })), { code: "DASHBOARD_APPROVAL_MASK_INVALID" });
  for (const mode of ["INHERIT", "CUSTOM", "FULL", "OMIT"] as const) await f.service.patch(1, actor, patch(approvalVersion(f.control.state), "PRIMARY", { 姓名: mode }));
  await assert.rejects(f.service.patch(1, actor, patch(approvalVersion(f.control.state), "PRIMARY", { 病歷號: "FULL" })));
  await f.service.patch(1, actor, patch(approvalVersion(f.control.state), "PRIMARY", { 病歷號: "INHERIT" }));
  assert.deepEqual(maskDeviceRows([{ 病歷號: "synthetic-1" }], resolveDashboardDisclosureMasks(f.control.state.parameters, "PRIMARY", f.control.state.sources[0]!.policy.columns)), [{}]);
});
test("stale and concurrent updates allow only one administrator to commit", async () => {
  const f = fixture(); const version = (await f.service.get(1, actor)).version;
  const results = await Promise.allSettled([f.service.patch(1, actor, patch(version)), f.service.patch(1, actor, patch(version, "EXTRA"))]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason.code, "DASHBOARD_APPROVAL_VERSION_CONFLICT");
  assert.equal(f.control.audits.length, 1);
});
test("audit failure rolls back Parameters and leaves no partial approval", async () => {
  const f = fixture(); const before = structuredClone(f.control.state); f.control.failAudit = true;
  await assert.rejects(f.service.patch(1, actor, patch(approvalVersion(before))));
  assert.deepEqual(f.control.state, before); assert.equal(f.control.audits.length, 0);
});
test("active, missing Schema, wrong source, ambiguous input and missing permissions reject", async () => {
  const f = fixture();
  f.control.state.isActive = true; await assert.rejects(f.service.patch(1, actor, patch(approvalVersion(f.control.state))), { code: "DASHBOARD_APPROVAL_REQUIRES_DISABLED" });
  assert.equal((await f.service.get(1, actor)).isActive, true); f.control.state.isActive = false;
  await assert.rejects(f.service.patch(1, actor, patch(approvalVersion(f.control.state), "MISSING")), { status: 404 });
  await assert.rejects(f.service.patch(1, actor, patch(approvalVersion(f.control.state), "PRIMARY", { ROOM: "NONE", room: "FULL" })), { status: 400 });
  await assert.rejects(f.service.patch(1, actor, patch(approvalVersion(f.control.state), "PRIMARY", { ROOM: "NONE" }, ["room"])), { status: 400 });
  f.control.schema = false; await assert.rejects(f.service.get(1, actor), { code: "SECURITY_SCHEMA_REQUIRED" });
  f.control.schema = true; f.control.allowed = false; await assert.rejects(f.service.get(1, actor));
});
test("removing case-ambiguous old approvals preserves legacy classification", async () => {
  const f = fixture(); f.control.state.parameters.deviceColumnMasks = { ROOM: "NONE", room: "FULL" };
  await f.service.patch(1, actor, patch(approvalVersion(f.control.state), "PRIMARY", {}, ["room"]));
  assert.deepEqual(f.control.state.parameters.deviceColumnMasks, {}); assert.deepEqual(f.control.state.parameters.deviceColumnTypes, { 姓名: "NAME" });
});
test("rowversion detects parent/source ABA, independent source edits and replacements", async () => {
  const f = fixture(); const first = approvalVersion(f.control.state);
  await f.service.patch(1, actor, patch(first));
  await f.service.patch(1, actor, patch(approvalVersion(f.control.state), "PRIMARY", {}, ["姓名"]));
  assert.deepEqual(f.control.state.parameters.deviceColumnMasks, {}); assert.notEqual(approvalVersion(f.control.state), first);
  const old = approvalVersion(f.control.state); f.control.state.sources[1]!.rowVersion = "0000000000000099";
  assert.notEqual(approvalVersion(f.control.state), old);
  f.control.state.rowVersion = "invalid"; assert.throws(() => approvalVersion(f.control.state), { status: 503 });
});
test("legacy create/basic/binding guards retain unchanged JSON and block all grant transfer", () => {
  assert.doesNotThrow(() => assertEmptyApprovalCreation({ deviceColumnMasks: {}, deviceColumnTypes: {} }));
  const settings = { deviceColumnMasks: { 姓名: "INHERIT" }, deviceColumnTypes: { 姓名: "NAME" }, deviceSourceColumnMasks: { EXTRA: { 姓名: "FULL" } } };
  assert.throws(() => assertEmptyApprovalCreation(settings), { code: "DASHBOARD_APPROVAL_WRITE_REQUIRED" });
  assert.doesNotThrow(() => assertBasicApprovalWrite(settings, { ...settings, WARD: "new" }, 2, 2));
  assert.throws(() => assertBasicApprovalWrite(settings, { ...settings, deviceColumnMasks: {} }, 2, 2), { code: "DASHBOARD_APPROVAL_WRITE_REQUIRED" });
  assert.throws(() => assertBasicApprovalWrite(settings, settings, 2, 9), { code: "DASHBOARD_APPROVAL_BINDING_CHANGED" });
  for (const next of [[], [{ sourceKey: "EXTRA", datasetId: 9 }]]) assert.throws(() => assertSourceApprovalBindings(settings, [{ sourceKey: "EXTRA", datasetId: 4 }], next));
  assert.throws(() => assertSourceApprovalBindings(settings, [], [{ sourceKey: "EXTRA", datasetId: 4 }]));
  assert.doesNotThrow(() => assertSourceApprovalBindings(settings, [{ sourceKey: "EXTRA", datasetId: 4 }], [{ sourceKey: "EXTRA", datasetId: 4 }]));
});
test("HTTP uses JWT/TokenVersion and DESIGN_QUERY; real GET version drives PATCH", async () => {
  const f = fixture(); const oldSecret = env.JWT_SECRET; env.JWT_SECRET = "synthetic-approval-secret";
  const session = { isActive: true, tokenVersion: 1, permissions: ["DESIGN_QUERY"] };
  const app = express(); app.use(express.json()); app.use(createAuthenticateJwt(async () => session)); app.use(createDashboardApprovalRouter(f.service)); app.use(errorHandler);
  const server = createServer(app); await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const token = jwt.sign({ sub: "1", tokenVersion: 1 }, env.JWT_SECRET);
  const request = async (body?: unknown, auth = true) => { const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/1/column-approvals`, {
    method: body ? "PATCH" : "GET", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() }; };
  try {
    assert.equal((await request(undefined, false)).status, 401); session.tokenVersion = 2; assert.equal((await request()).status, 401); session.tokenVersion = 1;
    session.permissions = []; assert.equal((await request()).status, 403); session.permissions = ["DESIGN_QUERY"];
    const view = await request(); assert.equal(view.status, 200);
    assert.equal((await request(patch(view.body.version))).status, 200);
    assert.equal((await request(patch(view.body.version))).status, 409);
    f.control.schema = false; assert.equal((await request()).status, 503);
  } finally { await new Promise<void>(r => server.close(() => r())); env.JWT_SECRET = oldSecret; }
});
