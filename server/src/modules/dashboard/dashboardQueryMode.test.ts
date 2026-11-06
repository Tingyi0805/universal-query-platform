import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import express from "express";
import jwt from "jsonwebtoken";
import { createServer } from "node:http";
import { env } from "../../config/env.js";
import { createAuthenticateJwt } from "../auth/auth.middleware.js";
import { createQueryModeRouter } from "./dashboardQueryMode.routes.js";
import { createQueryModeService, type ModeTransaction } from "./dashboardQueryMode.service.js";
import { QuerySourceError, sourceVersion, type SourceState, type SourceStore } from "./dashboardQuerySources.service.js";

function fixture() {
  let state: SourceState = { dashboard: { id: 1, queryDefinitionId: 20, mode: "LEGACY", modeVersion: 0, isActive: false,
    parameters: {}, updatedAtUtc: "2026-10-13T00:00:00Z", maxRows: 1000, refreshSeconds: 30, pageSize: 10, pageSeconds: 5 },
    sources: [{ id: 10, sourceKey: "WARD", queryDefinitionId: 21, datasetId: 3, queryBindingRevision: 1,
      maxRows: 100, parameters: { WARD: "SYNTHETIC" }, refreshSeconds: 30, pageSize: 10, pageSeconds: 5, isEnabled: true }], references: ["PRIMARY", "WARD"] };
  let credentials = "old-hash";
  const control = { enabled: true, schema: true, actorVersion: 1, deniedOwner: false, stationRevoked: false, policyReady: true,
    auditFailure: false, lifecycleManaged: false, noDevices: false, unpublished: false, checks: [] as number[], audits: [] as string[] };
  const store: SourceStore = { async transaction(work) {
    const staged = structuredClone(state); let token = credentials;
    const tx: ModeTransaction = {
      schemaReady: async () => true, modeReady: async () => control.schema,
      readState: async () => structuredClone(staged),
      actor: async (_id, version) => { if (version !== control.actorVersion) throw new QuerySourceError("TOKEN_REVOKED", 401); },
      validateQuery: async (user, id, parameters) => {
        control.checks.push(user);
        if (control.unpublished) throw new QuerySourceError("QUERY_SOURCE_QUERY_NOT_AVAILABLE");
        if (user === 2 && control.deniedOwner) throw new QuerySourceError("QUERY_SOURCE_QUERY_FORBIDDEN", 403);
        if (id === 21 && !parameters.WARD) throw new QuerySourceError("PARAMETER_REQUIRED", 400);
        return id === 20 ? 2 : 3;
      },
      devices: async () => control.noDevices ? [] : [{ id: 7, ownerId: 2, workstationId: 9, expiresAt: null, lifecycleManaged: control.lifecycleManaged }],
      delegation: async () => { if (control.stationRevoked) throw new QuerySourceError("QUERY_DEVICE_WORKSTATION_INVALID"); },
      policy: async () => { if (!control.policyReady) throw new QuerySourceError("QUERY_SOURCE_SENSITIVITY_NOT_READY"); },
      switchMode: async (_id, enabled) => { staged.dashboard.mode = enabled ? "QUERY_ONLY" : "QUERY_ONLY_DISABLED"; staged.dashboard.modeVersion!++; staged.dashboard.isActive = enabled; token = "invalidated-token-hash"; },
      modeAudit: async (_user, _id, enabled) => { if (control.auditFailure) throw new Error("private audit SQL/bind"); control.audits.push(enabled ? "ENABLE" : "DISABLE"); },
      issueDevice: async (_id, _device, hash) => { token = hash; },
      revokeDevice: async (_id, deviceId) => {if(deviceId!==7 || control.noDevices)throw new QuerySourceError("DASHBOARD_DEVICE_NOT_FOUND",404);token="revoked-hash";},
      revokeAudit: async () => {if(control.auditFailure)throw new Error("SYNTHETIC_PRIVATE_SQL");},
      issueAudit: async () => { if (control.auditFailure) throw new Error("private audit SQL/bind"); },
      upsert: async () => assert.fail(), remove: async () => assert.fail(), markManaged: async () => assert.fail(), audit: async () => assert.fail(),
    };
    const result = await work(tx); state = staged; credentials = token; return result;
  } };
  return { control, service: createQueryModeService(store, () => control.enabled), state: () => state, credentials: () => credentials };
}
test("918 is additive, preserves legacy mode/settings/tokens and uses one rollback boundary", () => {
  const script = readFileSync(new URL("../../../../database/migrations/918_dashboard_query_playback_mode.sql", import.meta.url), "utf8").replace(/--[^\n]*/g, "");
  assert.doesNotMatch(script, /\b(UPDATE|DELETE|INSERT|MERGE|DROP|GRANT)\b/i);
  assert.doesNotMatch(script, /^\s*GO\s*$/im);
  assert.match(script, /DEFAULT \(''LEGACY''\)/); assert.match(script, /DEFAULT \(0\)/);
  assert.match(script, /QueryModeGrantVersion BIGINT NULL, DelegatorTokenVersion BIGINT NULL/);
  assert.match(script, /ROLLBACK TRANSACTION/); assert.match(script, /917_REQUIRED/);
});
test("enable/disable persists explicit monotonic modes, invalidates credentials and audits", async () => {
  const f = fixture(); const oldSources = structuredClone(f.state().sources);
  const enabled = await f.service.change(1, 1, 1, sourceVersion(f.state()), true);
  assert.equal(enabled.mode, "QUERY_ONLY"); assert.equal(enabled.modeVersion, 1);
  assert.equal(enabled.deviceCredentialsInvalidated, true); assert.notEqual(f.credentials(), "old-hash");
  assert.ok(f.control.checks.includes(1) && f.control.checks.includes(2));
  const disabled = await f.service.change(1, 1, 1, sourceVersion(f.state()), false);
  assert.equal(disabled.mode, "QUERY_ONLY_DISABLED"); assert.equal(disabled.modeVersion, 2);
  assert.equal(f.state().dashboard.isActive, false); assert.deepEqual(f.state().sources, oldSources);
  assert.deepEqual(f.control.audits, ["ENABLE", "DISABLE"]);
});
for (const fault of ["pending", "parameters", "owner", "station", "policy", "devices", "query", "references", "count", "version", "schema", "actor"] as const)
  test(`activation ${fault} rejects atomically with no credential change`, async () => {
    const f = fixture();
    if (fault === "pending") f.state().sources[0]!.queryDefinitionId = null;
    if (fault === "parameters") f.state().sources[0]!.parameters = {};
    if (fault === "owner") f.control.deniedOwner = true;
    if (fault === "station") f.control.stationRevoked = true;
    if (fault === "policy") f.control.policyReady = false;
    if (fault === "devices") f.control.noDevices = true;
    if (fault === "query") f.control.unpublished = true;
    if (fault === "references") f.state().references.push("UNKNOWN");
    if (fault === "count") f.state().sources = Array.from({ length: 8 }, (_, id) => ({ ...f.state().sources[0]!, id: id + 10, sourceKey: `EXTRA${id}` }));
    if (fault === "schema") f.control.schema = false;
    if (fault === "actor") f.control.actorVersion++;
    const before = structuredClone(f.state());
    await assert.rejects(f.service.change(1, 1, 1, fault === "version" ? "0".repeat(64) : sourceVersion(f.state()), true));
    assert.deepEqual(f.state(), before); assert.equal(f.credentials(), "old-hash");
  });
test("PRIMARY must be converted before Query-only preflight or activation", async () => {
  const f = fixture();
  f.state().dashboard.maxRows = null;
  const before = structuredClone(f.state());
  const checked = await f.service.preflight(1, 1, 1);
  assert.equal(checked.ready, false);
  assert.ok(checked.checks.some(c => c.name === "primaryConversion" && !c.ok && c.code === "QUERY_SOURCE_CONVERSION_REQUIRED"));
  await assert.rejects(f.service.change(1, 1, 1, sourceVersion(f.state()), true), {
    code: "QUERY_SOURCE_CONVERSION_REQUIRED",
  });
  assert.deepEqual(f.state(), before);
  assert.equal(f.credentials(), "old-hash");
});
test("mandatory audit failure rolls back mode and credential invalidation", async () => {
  const f = fixture(), before = structuredClone(f.state()); f.control.auditFailure = true;
  await assert.rejects(f.service.change(1, 1, 1, sourceVersion(f.state()), true));
  assert.deepEqual(f.state(), before); assert.equal(f.credentials(), "old-hash");
});
test("credential issuance independently checks the delegator and commits only after audit", async () => {
  const f = fixture(); await f.service.change(1, 1, 1, sourceVersion(f.state()), true);
  f.control.deniedOwner = true;
  await assert.rejects(f.service.issue(1, 7, 1, 1, sourceVersion(f.state())), { code: "QUERY_SOURCE_QUERY_FORBIDDEN" });
  f.control.deniedOwner = false; f.control.auditFailure = true; const before = f.credentials();
  await assert.rejects(f.service.issue(1, 7, 1, 1, sourceVersion(f.state()))); assert.equal(f.credentials(), before);
  f.control.auditFailure = false;
  const issued = await f.service.issue(1, 7, 1, 1, sourceVersion(f.state()));
  assert.match(issued.token, /^[A-Za-z0-9_-]{43}$/); assert.notEqual(f.credentials(), issued.token);
});
test("disable invalidates issued device credential and never returns another token", async () => {
  const f = fixture();
  const enabled = await f.service.change(1, 1, 1, sourceVersion(f.state()), true);
  assert.equal(enabled.deviceCredentialsInvalidated, true);
  const issued = await f.service.issue(1, 7, 1, 1, sourceVersion(f.state()));
  const priorHash = f.credentials();
  assert.notEqual(priorHash, issued.token);
  const stopped = await f.service.change(1, 1, 1, sourceVersion(f.state()), false);
  assert.equal(stopped.mode, "QUERY_ONLY_DISABLED");
  assert.equal(stopped.deviceCredentialsInvalidated, true);
  assert.notEqual(f.credentials(), priorHash);
  assert.equal("token" in stopped, false);
  await assert.rejects(f.service.issue(1, 7, 1, 1, sourceVersion(f.state())), {
    code: "QUERY_SOURCE_MODE_NOT_ACTIVATED",
  });
});
test("capability remains off and IsActive alone is never a valid mode", async () => {
  const f = fixture(); f.control.enabled = false;
  await assert.rejects(f.service.change(1, 1, 1, sourceVersion(f.state()), true), { code: "QUERY_DEVICE_PLAYBACK_DISABLED" });
  f.control.enabled = true; f.state().dashboard.isActive = true;
  await assert.rejects(f.service.change(1, 1, 1, sourceVersion(f.state()), true), { code: "QUERY_MODE_TRANSITION_CONFLICT" });
});
test("Mock mode HTTP enforces JWT/RBAC/TokenVersion, strict input and explicit credential issuance", async () => {
  const f = fixture(), oldSecret = env.JWT_SECRET; env.JWT_SECRET = "isolated-query-mode-test";
  let permissions = ["DESIGN_QUERY"];
  const token = jwt.sign({ sub: "1", tokenVersion: 1 }, env.JWT_SECRET, { expiresIn: "1h" });
  const app = express(); app.use(express.json());
  app.use(createAuthenticateJwt(async () => ({ isActive: true, tokenVersion: f.control.actorVersion, permissions })));
  app.use(createQueryModeRouter(f.service));
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/1/query-mode/v1`;
  const request = async (body?: unknown, suffix = "", credential = token, method = "POST") => {
    const response = await fetch(base + suffix, { headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
      ...(body ? { method, body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await request(undefined, "", "invalid")).status, 401);
    permissions = []; assert.equal((await request()).status, 403);
    assert.equal((await request(undefined,"/preflight")).status,403);
    assert.equal((await request({expectedVersion:sourceVersion(f.state())},"/devices/7/credential",token,"DELETE")).status,403);
    permissions = ["DESIGN_QUERY"];
    assert.equal((await request(undefined,"/preflight")).body.ready,true);
    assert.equal((await request({ expectedVersion: sourceVersion(f.state()), activate: true, ownerId: 1 })).status, 400);
    assert.equal((await request({ expectedVersion: sourceVersion(f.state()), activate: true })).body.mode, "QUERY_ONLY");
    const issued = await request({ expectedVersion: sourceVersion(f.state()) }, "/devices/7/credential");
    assert.equal(issued.status, 200); assert.match(issued.body.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal((await request({ expectedVersion: sourceVersion(f.state()), activate: false })).body.mode, "QUERY_ONLY_DISABLED");
    assert.equal((await request({ expectedVersion: sourceVersion(f.state()) }, "/devices/7/credential")).status, 409);
    const revoked=await request({expectedVersion:sourceVersion(f.state())},"/devices/7/credential",token,"DELETE");assert.equal(revoked.status,200);
    f.control.actorVersion = 2; assert.equal((await request()).status, 401);
    assert.equal((await request(undefined,"/preflight")).status,401);
  } finally { env.JWT_SECRET = oldSecret; await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("preflight is read-only and reports safe per-source and independent delegator failures",async()=>{
  const f=fixture(),before=structuredClone(f.state()),token=f.credentials();
  const ready=await f.service.preflight(1,1,1);assert.equal(ready.ready,true);assert.equal(ready.sourceCount,2);
  assert.deepEqual(f.state(),before);assert.equal(f.credentials(),token);assert.deepEqual(f.control.audits,[]);
  f.state().sources[0]!.parameters={};f.control.deniedOwner=true;
  const failed=await f.service.preflight(1,1,1);
  assert.equal(failed.ready,false);assert.equal(failed.queries[0]!.ok,true);
  assert.equal(failed.queries[1]!.code,"PARAMETER_REQUIRED");assert.equal(failed.delegators[0]!.code,"QUERY_SOURCE_QUERY_FORBIDDEN");
  assert.doesNotMatch(JSON.stringify(failed),/SYNTHETIC|ParametersJson|token|sqlText/);
});
test("preflight capacity, pending, references, workstation and policy remain fail-closed",async()=>{
  for(const kind of ["pending","references","station","policy","capacity","devices"]){
    const f=fixture();
    if(kind==="pending")f.state().sources[0]!.queryDefinitionId=null;
    if(kind==="references")f.state().sources[0]!.isEnabled=false;
    if(kind==="station")f.control.stationRevoked=true;
    if(kind==="policy")f.control.policyReady=false;
    if(kind==="devices")f.control.noDevices=true;
    if(kind==="capacity")f.state().sources=Array.from({length:8},(_,i)=>({...f.state().sources[0]!,sourceKey:`KEY${i}`,id:i+10}));
    assert.equal((await f.service.preflight(1,1,1)).ready,false,kind);
  }
});
test("revoke requires current mode/version but remains available after delegation is revoked, audit failure rolls back",async()=>{
  const f=fixture();await f.service.change(1,1,1,sourceVersion(f.state()),true);
  await f.service.issue(1,7,1,1,sourceVersion(f.state()));const token=f.credentials();
  f.control.deniedOwner=true;f.control.stationRevoked=true;
  await assert.rejects(f.service.revoke(1,7,1,1,"0".repeat(64)),{code:"QUERY_SOURCE_VERSION_CONFLICT"});
  f.control.auditFailure=true;await assert.rejects(f.service.revoke(1,7,1,1,sourceVersion(f.state())));assert.equal(f.credentials(),token);
  f.control.auditFailure=false;assert.equal((await f.service.revoke(1,7,1,1,sourceVersion(f.state()))).revoked,true);
  assert.equal(f.credentials(),"revoked-hash");
});
test("activation rejects a disabled source still referenced by a widget",async()=>{
  const f=fixture();f.state().sources[0]!.isEnabled=false;
  await assert.rejects(f.service.change(1,1,1,sourceVersion(f.state()),true),{code:"QUERY_SOURCE_REFERENCE_INVALID"});
});

test("old Query-mode credential endpoint cannot issue for a managed lifecycle cycle",async()=>{
 const f=fixture();await f.service.change(1,1,1,sourceVersion(f.state()),true);f.control.lifecycleManaged=true;
 const before=f.credentials();await assert.rejects(f.service.issue(1,7,1,1,sourceVersion(f.state())),{code:"DASHBOARD_DEVICE_VERSIONED_API_REQUIRED"});assert.equal(f.credentials(),before);
});
