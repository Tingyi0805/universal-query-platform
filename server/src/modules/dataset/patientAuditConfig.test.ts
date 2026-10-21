import test from "node:test";
import assert from "node:assert/strict";
import { createPatientAuditService, definitionHash, type PatientAuditStore, type PatientConfigInput, type PatientState } from "./patientAuditConfig.service.js";
import { SecurityContractError } from "../securityContract/securityContract.js";
import express from "express";
import jwt from "jsonwebtoken";
import { createServer } from "node:http";
import { env } from "../../config/env.js";
import { createAuthenticateJwt } from "../auth/auth.middleware.js";
import { createPatientAuditConfigRouter } from "./patientAuditConfig.routes.js";

const input: PatientConfigInput = { expectedVersion: "0", isEnabled: true, patientKeyColumn: "MRN", identifierConfirmed: true };
test("source changed during a successful preview cannot certify the executed aliases", async () => {
  const f = patientFixture();
  const executed = { datasetId: 1, ...f.control.state.definition, values: {}, maxRows: 10 };
  f.control.state.definition.dataSourceId = 99;
  await f.service.recordPreview(1, { sqlText: executed.sqlText, dataSourceId: executed.dataSourceId }, ["MRN"], 2);
  assert.equal(f.control.state.metadata, null);
});
export function patientFixture() {
  const state: PatientState = { definition: { sqlText: "SELECT MRN, NAME FROM synthetic", dataSourceId: 1 },
    config: null, metadata: null, nameColumns: ["NAME"] };
  state.metadata = { definitionHash: definitionHash(state.definition), columns: ["MRN", "NAME"] };
  const control = { state, schema: true, key: true, auditFailure: false, audits: [] as unknown[], commits: 0, rollbacks: 0 };
  let tail = Promise.resolve();
  const store: PatientAuditStore = { transaction: async run => {
    const previous = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const staged = structuredClone(control.state); const audits: unknown[] = [];
    try {
      if (!control.schema) throw new SecurityContractError("SECURITY_SCHEMA_REQUIRED");
      const result = await run({ read: async () => structuredClone(staged),
        save: async (_id, config) => { staged.config = structuredClone(config); },
        metadata: async (_id, value) => { staged.metadata = structuredClone(value); },
        audit: async (_id, _userId, config) => { if (control.auditFailure) throw new Error("synthetic-audit-failed"); audits.push(config); },
      });
      control.state = staged; control.audits.push(...audits); control.commits++; return result;
    } catch (error) { control.rollbacks++; throw error; } finally { release(); }
  } };
  const service = createPatientAuditService(store, () => {
    if (!control.key) throw new Error("synthetic-key-unavailable");
    return { activeVersion: 1, versions: new Map([[1, Buffer.alloc(32, 7)]]) };
  });
  return { control, service };
}
test("patient config starts at zero; create/update increments canonical string versions", async () => {
  const f = patientFixture();
  assert.equal((await f.service.get(1)).status, "NOT_CONFIGURED");
  assert.equal((await f.service.put(1, input, 2)).version, "1");
  assert.equal((await f.service.put(1, { ...input, expectedVersion: "1" }, 2)).version, "2");
  assert.equal(f.control.audits.length, 2);
});
test("stale versions and concurrent initial writes cannot both commit", async () => {
  const f = patientFixture();
  const results = await Promise.allSettled([f.service.put(1, input, 2), f.service.put(1, input, 3)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const rejected = results.find(r => r.status === "rejected") as PromiseRejectedResult;
  assert.equal(rejected.reason.code, "PATIENT_AUDIT_VERSION_CONFLICT");
  assert.equal(f.control.state.config?.version, "1"); assert.equal(f.control.audits.length, 1);
});
test("audit failure rolls back configuration, proof epoch and management audit together", async () => {
  const f = patientFixture(); f.control.auditFailure = true;
  await assert.rejects(f.service.put(1, input, 2));
  assert.equal(f.control.state.config, null); assert.equal(f.control.audits.length, 0);
  f.control.auditFailure = false; await f.service.put(1, input, 2);
  const before = structuredClone(f.control.state); f.control.auditFailure = true;
  await assert.rejects(f.service.recordPreview(1, { ...before.definition, sqlText: "unsaved" }, ["MRN"], 2));
  assert.deepEqual(f.control.state, before);
});
test("missing Schema rejects reads, writes, proof creation and Dashboard validation", async () => {
  const f = patientFixture(); f.control.schema = false;
  for (const action of [() => f.service.get(1), () => f.service.put(1, input, 2),
    () => f.service.recordPreview(1, f.control.state.definition, ["MRN"], 2), () => f.service.requireDisclosure(1)])
    await assert.rejects(action(), { code: "SECURITY_SCHEMA_REQUIRED", status: 503 });
  assert.equal(f.control.audits.length, 0);
});
for (const kind of ["sql", "source", "case", "missing", "name", "key"] as const)
  test(`patient setting refuses ${kind} mismatch without changes`, async () => {
    const f = patientFixture();
    if (kind === "sql") f.control.state.definition.sqlText += " ";
    if (kind === "source") f.control.state.definition.dataSourceId++;
    if (kind === "case") f.control.state.metadata!.columns = ["MRN", "mrn"];
    if (kind === "missing") f.control.state.metadata!.columns = ["NAME"];
    if (kind === "name") f.control.state.nameColumns = ["mrn"];
    if (kind === "key") f.control.key = false;
    await assert.rejects(f.service.put(1, input, 2));
    assert.equal(f.control.state.config, null); assert.equal(f.control.audits.length, 0);
  });
test("proof uses exact successful execution definition; unsaved/source mismatch invalidates it", async () => {
  const f = patientFixture(); f.control.state.metadata = null;
  await f.service.recordPreview(1, f.control.state.definition, ["MRN", "NAME"], 2);
  assert.equal((f.control.state as PatientState).metadata?.definitionHash, definitionHash(f.control.state.definition));
  for (const executed of [{ ...f.control.state.definition, sqlText: "unsaved" }, { ...f.control.state.definition, dataSourceId: 99 }]) {
    await f.service.recordPreview(1, executed, ["MRN"], 2);
    assert.equal(f.control.state.metadata, null);
  }
  await f.service.recordPreview(1, f.control.state.definition, ["MRN", "mrn"], 2);
  assert.equal(f.control.state.metadata, null);
});
test("confirmation, enabled state, exact alias and version exhaustion are mandatory", async () => {
  const f = patientFixture();
  for (const patch of [{ identifierConfirmed: false }, { isEnabled: false }, { patientKeyColumn: "mrn" }, { expectedVersion: "01" }])
    await assert.rejects(f.service.put(1, { ...input, ...patch } as PatientConfigInput, 2));
  f.control.state.config = { isEnabled: true, patientKeyColumn: "MRN", version: "9223372036854775807" };
  await assert.rejects(f.service.put(1, { ...input, expectedVersion: f.control.state.config.version }, 2), { code: "SECURITY_VERSION_EXHAUSTED" });
});
test("Dashboard config/proof changes invalidate fingerprints including proof A→missing→A", async () => {
  const f = patientFixture(); await f.service.put(1, input, 2);
  const first = await f.service.dashboardState(1);
  await f.service.put(1, { ...input, expectedVersion: "1" }, 2);
  assert.notEqual((await f.service.dashboardState(1)).fingerprint, first.fingerprint);
  const original = structuredClone(f.control.state.definition);
  const before = (await f.service.dashboardState(1)).fingerprint;
  await f.service.recordPreview(1, { ...original, sqlText: "unsaved" }, ["MRN", "NAME"], 2);
  await assert.rejects(f.service.requireDisclosure(1), { status: 503 });
  await f.service.recordPreview(1, original, ["MRN", "NAME"], 2);
  assert.notEqual((await f.service.dashboardState(1)).fingerprint, before);
  assert.equal((await f.service.requireDisclosure(1)).config.version, "4");
});
test("Dashboard rejects absent/disabled/keyless/unproven states; GET does not reveal SQL or hash", async () => {
  const f = patientFixture(); await assert.rejects(f.service.requireDisclosure(1));
  await f.service.put(1, input, 2);
  for (const mode of ["disabled", "key", "metadata"] as const) {
    const saved = structuredClone(f.control.state);
    if (mode === "disabled") f.control.state.config!.isEnabled = false;
    if (mode === "key") f.control.key = false;
    if (mode === "metadata") f.control.state.metadata = null;
    await assert.rejects(f.service.requireDisclosure(1), { status: 503 });
    f.control.state = saved; f.control.key = true;
  }
  const body = JSON.stringify(await f.service.get(1));
  assert.ok(!body.includes("SELECT")); assert.ok(!body.includes("definitionHash"));
});

test("real JWT/TokenVersion, DESIGN_QUERY and strict HTTP contract protect patient settings", async () => {
  const f = patientFixture(); const previous = env.JWT_SECRET; env.JWT_SECRET = "synthetic-stage2-test-secret";
  const session = { isActive: true, tokenVersion: 1, permissions: ["DESIGN_QUERY"] };
  const app = express(); app.use(express.json()); app.use(createAuthenticateJwt(async () => session));
  app.use(createPatientAuditConfigRouter(f.service));
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/1/patient-audit-config`;
  const token = jwt.sign({ sub: "2", tokenVersion: 1 }, env.JWT_SECRET);
  const request = async (body?: unknown, authenticated = true) => {
    const response = await fetch(base, { method: body === undefined ? "GET" : "PUT", headers: { "Content-Type": "application/json", ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await request(undefined, false)).status, 401);
    session.tokenVersion = 2; assert.equal((await request()).status, 401); session.tokenVersion = 1;
    session.permissions = []; assert.equal((await request()).status, 403); session.permissions = ["DESIGN_QUERY"];
    assert.equal((await request()).body.version, "0");
    for (const patch of [{ expectedVersion: 0 }, { expectedVersion: undefined }, { isEnabled: false }, { identifierConfirmed: false }, { extra: true }])
      assert.equal((await request({ ...input, ...patch })).status, 400);
    assert.equal((await request(input)).body.version, "1");
    const conflict = await request(input); assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, "PATIENT_AUDIT_VERSION_CONFLICT");
    f.control.schema = false; assert.equal((await request()).status, 503);
    assert.equal(f.control.audits.length, 1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); env.JWT_SECRET = previous; }
});
