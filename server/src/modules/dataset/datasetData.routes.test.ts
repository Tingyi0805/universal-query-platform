import { DatasetColumnSyncError } from "./column.repository.js";
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { createServer } from "node:http";
import { env } from "../../config/env.js";
import { errorHandler } from "../../middleware/errorHandler.js";
import { createAuthenticateJwt } from "../auth/auth.middleware.js";
import { createRuntimeIdentityVerifier } from "../queryDefinition/queryDelivery.js";
import { createDatasetDataRouter, defaultDatasetDataRouteDependencies } from "./datasetData.routes.js";
import { createDatasetDataDelivery, defaultDatasetDataDependencies } from "./datasetDataDelivery.js";
import { type ConfirmedDatasetDeliverySnapshot, DatasetDeliverySnapshotError } from "./datasetDeliveryPolicy.repository.js";
import { syntheticParameter } from "./parameterTestFixture.js";
import { DatasetColumnCandidateError } from "./datasetColumnCandidate.js";

const version = "0000000000000001", rawName = "王小明", rawId = "SYNTHETIC-AUDIT-ID";
function policy(datasetId: number): ConfirmedDatasetDeliverySnapshot {
  return { datasetId, definitionVersion: version, sensitivityVersion: "1", patientAuditVersion: "1",
    policy: { state: "CONFIRMED", version: "1", rules: [
      { columnName: "NAME", mode: "CUSTOM", customMask: { prefix: 1, suffix: 1, symbol: "○" } },
      { columnName: "MRN", mode: "OMIT" },
      { columnName: "CODE", mode: "NONE" }, { columnName: "LABEL", mode: "NONE" },
    ], patientAuditOnlyColumns: ["MRN"] },
    patientAudit: { configured: true, enabled: true, patientKeyColumn: "MRN" } };
}

async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const previous = env.JWT_SECRET; env.JWT_SECRET = "synthetic-dataset-delivery-key";
  const f = await setup();
  try { await run(f); }
  finally { f.server.closeAllConnections(); await new Promise<void>(resolve => f.server.close(() => resolve())); env.JWT_SECRET = previous; }
}
async function setup() {
  const state = {
    session: { isActive: true, tokenVersion: 1, permissions: ["DESIGN_QUERY", "EXECUTE_QUERY"] },
    snapshots: new Map([[1, policy(1)], [2, policy(2)]]), snapshotReads: [] as number[],
    executions: [] as number[], disclosures: [] as Array<{ datasetId: number; masked: boolean; identity: unknown }>,
    parameters: [{ ...syntheticParameter, name: "WARD", optionMode: "DATASET" as "DATASET" | "FIXED" | "NONE",
      lookupDatasetId: 2, lookupValueField: "CODE", lookupLabelField: "LABEL", defaultValue: "A", fixedOptionsJson: '[{"value":"A","label":"A"}]' }],
    sourceActive: true, sourceRevision: "source-1", policyUnconfirmed: false, patientStatus: "CONFIRMED", patientFingerprint: "proof-1",
    sqlText: "SELECT NAME, MRN, CODE, LABEL WHERE CODE={{WARD}}", phase: "", change: () => {},
    auditFailure: false, operationFailure: false, failureWriteFailure: false, missingDisclosure: false,
    operationStatus: "NONE", schemaMissing: false, startAudits: 0, candidateCalls: 0, candidateDrift: false, candidateFailure: false,
    lookupValue: "A" as unknown, syncedColumns: [] as string[], syncFailure: false,
  };
  const deps = {
    ...defaultDatasetDataDependencies,
    snapshot: async (id: number) => { state.snapshotReads.push(id);
      if (state.schemaMissing) throw new DatasetDeliverySnapshotError("DATASET_DELIVERY_SCHEMA_REQUIRED");
      if (state.policyUnconfirmed) throw new DatasetDeliverySnapshotError("DATASET_DELIVERY_POLICY_UNCONFIRMED");
      return structuredClone(state.snapshots.get(id)!); },
    dataset: async (id: number) => ({ id, dataSourceId: id + 10, sqlText: state.sqlText, isActive: true, isArchived: false, maxRows: 100 }),
    source: async () => ({ isActive: state.sourceActive, revision: state.sourceRevision }),
    parameters: async () => structuredClone(state.parameters),
    patientState: async () => ({ status: state.patientStatus, fingerprint: state.patientFingerprint }),
    execute: async (id: number) => {
      state.executions.push(id); if (state.phase === "sql") state.change();
      return { columns: ["NAME", "MRN", "CODE", "LABEL"].map(name => ({ name })),
        rows: [{ NAME: rawName, MRN: rawId, CODE: state.lookupValue, LABEL: "Synthetic option" }], rowCount: 1, truncated: false, elapsedMs: 1 };
    },
    auditPatient: async (input: { datasetId: number; masked: boolean; rows: ReadonlyArray<Record<string, unknown>> }) => {
      state.disclosures.push({ datasetId: input.datasetId, masked: input.masked, identity: input.rows[0]?.MRN });
      if (state.phase === "patient-audit") state.change();
      if (state.auditFailure) throw new Error("SYNTHETIC_DISCLOSURE_FAILURE");
      return state.missingDisclosure ? null : 7;
    },
  } as unknown as typeof defaultDatasetDataDependencies;
  const session = async () => structuredClone(state.session);
  const app = express(); app.use(express.json()); app.use(createAuthenticateJwt(session));
  app.use("/datasets", createDatasetDataRouter({
    ...defaultDatasetDataRouteDependencies, delivery: createDatasetDataDelivery(deps), identity: createRuntimeIdentityVerifier(session),
    syncColumns: async (_id, columns, options) => {
      await options.reauthorize({} as never);
      if (state.syncFailure) throw new DatasetColumnSyncError("DATASET_COLUMN_SYNC_FAILED");
      assert.equal(options.dataSourceId, 11); assert.equal(options.definitionVersion, version);
      state.syncedColumns = columns.map(c => c.name);
    },
    candidate: { open: async (id: number) => {
      assert.equal(id, 1);
      return {
        definitionVersion: version, configurationVersion: version, dataSourceId: 11,
        revalidate: async () => {
          if (state.candidateDrift) throw new DatasetColumnCandidateError("DATASET_COLUMN_DESCRIPTION_CONFLICT");
        },
        describe: async () => {
          state.candidateCalls++;
          if (state.candidateFailure) throw new DatasetColumnCandidateError("DATASET_COLUMN_DESCRIPTION_FAILED", 503);
          return { trust: "UNBOUND_CANDIDATE" as const,
            requiresExecutionComparison: true as const, evidenceType: "SQLSERVER_DESCRIBE_FIRST_RESULT_SET" as const,
            columns: [{ name: "OPAQUE_A", dataType: "int", ordinal: 1 }] };
        },
      };
    } },

    startAudit: async input => {
      state.startAudits++; state.operationStatus = "STARTED";
      const serialized = JSON.stringify(input.parameters);
      assert.ok(!serialized.includes(rawId) && !serialized.includes(rawName) && !serialized.includes("SELECT"));
      return 8;
    },
    finalizeDeliveryAudit: async (_id, _stats, validate) => {
      if (state.phase === "operation-audit") state.change();
      if (state.operationFailure) throw new Error("SYNTHETIC_OPERATION_FAILURE");
      // Model uncommitted SUCCESS; failure leaves the durable state STARTED.
      await validate({} as never); state.operationStatus = "SUCCESS";
    },
    completeAuditFailure: async () => {
      if (state.failureWriteFailure) throw new Error("failure write"); state.operationStatus = "FAILED";
    },
  }));
  app.use(errorHandler);
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/datasets`;
  const token = jwt.sign({ sub: "4", tokenVersion: 1 }, env.JWT_SECRET!, { expiresIn: 3600 });
  const request = (path: string, body?: unknown, authorization: string | null = `Bearer ${token}`) => fetch(base + path, {
    method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...(authorization ? { authorization } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { state, server, request };
}

test("saved design preview applies Dataset masks with required authorization, exact version and audits", () => fixture(async f => {
  const proof = await f.request("/1/design-preview/context"); assert.equal(proof.status, 200);
  assert.equal((await proof.json() as any).definitionVersion, version);
  const response = await f.request("/1/design-preview", { expectedDefinitionVersion: version, values: {} });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json() as any).result.rows[0].NAME, "王○明");
  assert.deepEqual(f.state.disclosures, [{ datasetId: 1, masked: true, identity: rawId }]);
  assert.equal(f.state.operationStatus, "SUCCESS");
}));

test("ordinary saved Dataset execution masks data and cannot select a raw purpose", () => fixture(async f => {
  let response = await f.request("/1/execute", { values: {} }); assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.result.rows[0].NAME, "王○明"); assert.equal(body.result.rows[0].MRN, undefined);
  assert.equal(body.result.columns.some((c: any) => c.name === "MRN"), false);
  response = await f.request("/1/execute", { values: {}, raw: true, purpose: "RAW_DESIGN" }); assert.equal(response.status, 400);
  assert.equal(f.state.disclosures[0]?.masked, true);
}));

for (const permissions of [["DESIGN_QUERY"], ["VIEW_QUERY", "EXECUTE_QUERY"], []]) {
  test(`raw design, execute and lookup require both design and execute authority: ${permissions.join("+")}`, () => fixture(async f => {
    f.state.session.permissions = permissions;
    for (const path of ["/1/design-preview", "/1/execute"]) assert.equal((await f.request(path, { expectedDefinitionVersion: version, values: {} })).status, 403);
    assert.equal((await f.request("/1/parameters/WARD/options")).status, 403);
    assert.deepEqual(f.state.executions, []); assert.equal(f.state.startAudits, 0);
  }));
}

test("missing, invalid, expired or revoked JWT cannot reach a data executor", () => fixture(async f => {
  for (const auth of [null, "Bearer invalid", `Bearer ${jwt.sign({ sub: "4", tokenVersion: 1 }, env.JWT_SECRET!, { expiresIn: -1 })}`])
    assert.equal((await f.request("/1/execute", { values: {} }, auth)).status, 401);
  f.state.session.tokenVersion = 2;
  assert.equal((await f.request("/1/design-preview", { values: {}, expectedDefinitionVersion: version })).status, 401);
  assert.deepEqual(f.state.executions, []);
}));

for (const mismatch of ["unsaved", "sql", "source", "version", "missing-version"]) {
  test(`candidate ${mismatch} is denied before SQL and cannot create metadata`, () => fixture(async f => {
    const before = structuredClone(f.state.snapshots);
    const body: any = { datasetId: 1, dataSourceId: 11, sqlText: f.state.sqlText, expectedDefinitionVersion: version, values: {} };
    if (mismatch === "unsaved") delete body.datasetId;
    if (mismatch === "sql") body.sqlText += " AND 1=1";
    if (mismatch === "source") body.dataSourceId = 99;
    if (mismatch === "version") body.expectedDefinitionVersion = "0000000000000003";
    if (mismatch === "missing-version") delete body.expectedDefinitionVersion;
    const response = await f.request("/preview/run", body); assert.equal(response.status, 409);
    assert.deepEqual(f.state.executions, []); assert.deepEqual(f.state.snapshots, before);
    assert.equal(f.state.startAudits, 0);
  }));
}

test("legacy preview URL admits only an exact saved/versioned definition and uses raw audit purpose", () => fixture(async f => {
  const response = await f.request("/preview/run", { datasetId: 1, dataSourceId: 11, sqlText: f.state.sqlText,
    expectedDefinitionVersion: version, values: {} });
  assert.equal(response.status, 200); assert.deepEqual(f.state.executions, [1]);
  assert.equal((await response.json() as any).result.rows[0].NAME, "王○明");
}));

test("lookup uses the actual source policy and audits raw source identities", () => fixture(async f => {
  const response = await f.request("/1/parameters/WARD/options"); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { options: [{ value: "A", label: "Synthetic option" }] });
  assert.deepEqual(f.state.executions, [2]); assert.ok(f.state.snapshotReads.includes(2));
  assert.deepEqual(f.state.disclosures, [{ datasetId: 2, masked: true, identity: rawId }]);
}));

test("a parent OMIT rule cannot replace the lookup source's confirmed policy", () => fixture(async f => {
  const parent = f.state.snapshots.get(1)!;
  f.state.snapshots.set(1, { ...parent, policy: { ...parent.policy, rules: [...parent.policy.rules.filter(r => r.columnName !== "CODE"), { columnName: "CODE", mode: "OMIT" }] } });
  const response = await f.request("/1/parameters/WARD/options");
  assert.equal(response.status, 200); assert.equal((await response.json() as any).options[0].value, "A");
  assert.deepEqual(f.state.executions, [2]);
}));

for (const enabled of [false, true]) test(`raw design refuses absent or disabled patient audit evidence (enabled=${enabled})`, () => fixture(async f => {
  const current = f.state.snapshots.get(1)!;
  f.state.snapshots.set(1, { ...current, patientAudit: { configured: !enabled, enabled, patientKeyColumn: enabled ? "MRN" : null } });
  const response = await f.request("/1/design-preview", { values: {}, expectedDefinitionVersion: version });
  assert.equal(response.status, 503); assert.deepEqual(f.state.executions, []);
}));

for (const mode of ["CUSTOM", "FULL", "OMIT"] as const) for (const field of ["CODE", "LABEL"]) {
  test(`source ${field} ${mode} blocks lookup before SQL despite permissive parent`, () => fixture(async f => {
    const source = f.state.snapshots.get(2)!;
    f.state.snapshots.set(2, { ...source, policy: { ...source.policy, rules: [...source.policy.rules.filter(r => r.columnName !== field),
      { columnName: field, mode, ...(mode === "CUSTOM" ? { customMask: { prefix: 0, suffix: 0, symbol: "*" } } : {}) }] } });
    const response = await f.request("/1/parameters/WARD/options"); assert.equal(response.status, 409);
    assert.equal((await response.json() as any).error.code, "PARAMETER_LOOKUP_PROTECTED_FIELD");
    assert.deepEqual(f.state.executions, []);
  }));
}

const changes = {
  token: (s: any) => { s.session.tokenVersion++; },
  permission: (s: any) => { s.session.permissions = ["DESIGN_QUERY"]; },
  definition: (s: any) => { s.snapshots.get(1).definitionVersion = "0000000000000003"; },
  sourceDefinition: (s: any) => { s.snapshots.get(2).definitionVersion = "0000000000000003"; },
  sourcePolicy: (s: any) => { s.snapshots.get(2).sensitivityVersion = "3"; s.snapshots.get(2).policy.version = "3"; },
  patient: (s: any) => { s.patientFingerprint = "proof-3"; },
  inactive: (s: any) => { s.sourceActive = false; },
};
for (const phase of ["sql", "patient-audit", "operation-audit"]) for (const change of ["token", "permission", "definition"] as const) {
  test(`raw design rejects ${change} during ${phase} without committing SUCCESS`, () => fixture(async f => {
    f.state.phase = phase; f.state.change = () => changes[change](f.state);
    const response = await f.request("/1/design-preview", { values: {}, expectedDefinitionVersion: version });
    assert.ok(response.status >= 400); assert.notEqual(f.state.operationStatus, "SUCCESS");
    const text = await response.text(); assert.ok(!text.includes(rawName) && !text.includes(rawId));
  }));
}
for (const phase of ["sql", "patient-audit", "operation-audit"]) for (const [change, mutate] of Object.entries(changes)) {
  test(`lookup rejects ${change} during ${phase} and leaves no durable SUCCESS`, () => fixture(async f => {
    f.state.phase = phase; f.state.change = () => mutate(f.state); f.state.failureWriteFailure = phase === "operation-audit";
    const response = await f.request("/1/parameters/WARD/options"); assert.ok(response.status >= 400);
    const text = await response.text(); assert.ok(!text.includes(rawName) && !text.includes(rawId));
    assert.notEqual(f.state.operationStatus, "SUCCESS");
  }));
}

test("a legacy source policy cannot borrow confirmation from the parent Dataset", () => fixture(async f => {
  const source = f.state.snapshots.get(2)!;
  f.state.snapshots.set(2, { ...source, policy: { ...source.policy, rules: [{ columnName: "CODE", mode: "MRN" } as never] } });
  assert.equal((await f.request("/1/parameters/WARD/options")).status, 409);
  assert.deepEqual(f.state.executions, []);
}));

for (const failure of ["patient", "operation", "missing-disclosure", "schema", "proof"]) {
  test(`raw preview ${failure} failure refuses delivery`, () => fixture(async f => {
    f.state.auditFailure = failure === "patient"; f.state.operationFailure = failure === "operation";
    f.state.missingDisclosure = failure === "missing-disclosure"; f.state.schemaMissing = failure === "schema";
    if (failure === "proof") f.state.patientStatus = "METADATA_UNCONFIRMED";
    const response = await f.request("/1/design-preview", { values: {}, expectedDefinitionVersion: version });
    assert.ok(response.status >= 400); assert.notEqual(f.state.operationStatus, "SUCCESS");
    const text = await response.text(); assert.ok(!text.includes(rawName) && !text.includes(rawId));
  }));
}

test("fixed options do not execute a Dataset and require the same parent authorization", () => fixture(async f => {
  f.state.parameters[0]!.optionMode = "FIXED";
  assert.deepEqual(await (await f.request("/1/parameters/WARD/options")).json(), { options: [{ value: "A", label: "A" }] });
  assert.deepEqual(f.state.executions, []);
}));

// BUG-002: classification claims and candidate metadata never grant admission.
for (const kind of ["A_ORDINARY", "B_SENSITIVE_NON_PATIENT", "C_PATIENT_UNCONFIRMED"] as const) {
  for (const claim of [false, true]) test(`${kind}: initialization remains closed (client claim=${claim})`, () => fixture(async f => {
    const current = f.state.snapshots.get(1)!;
    f.state.snapshots.set(1, { ...current, patientAuditVersion: "0",
      patientAudit: { configured: false, enabled: false, patientKeyColumn: null },
      policy: { state: "CONFIRMED", version: "1", rules: kind === "A_ORDINARY" ? [] : current.policy.rules } });
    const input = { datasetId: 1, dataSourceId: 11, sqlText: f.state.sqlText, expectedDefinitionVersion: version,
      values: {}, ...(claim ? { nonPatientConfirmed: true } : {}) };
    const before = structuredClone(f.state.snapshots);
    const response = await f.request("/preview/run", input);
    assert.equal(response.status, claim ? 400 : 503);
    const body = await response.json() as any;
    assert.equal(body.error.code, claim ? "VALIDATION_ERROR" : "DATASET_PREVIEW_INITIALIZATION_REQUIRED");
    assert.deepEqual(f.state.executions, []); assert.deepEqual(f.state.disclosures, []);
    assert.equal(f.state.startAudits, 0); assert.deepEqual(f.state.snapshots, before);
  }));
}
for (const injection of [{ nonPatientConfirmed: true }, { metadata: { trust: "CONFIRMED", columns: ["NAME"] } },
  { metadata: { trust: "UNBOUND_CANDIDATE", columns: ["OPAQUE"] } }, { sensitivityConfirmed: true }, { purpose: "NON_PATIENT_DESIGN" }]) {
  test(`client-provided proof cannot authorize preview: ${JSON.stringify(Object.keys(injection))}`, () => fixture(async f => {
    const response = await f.request("/preview/run", { datasetId: 1, dataSourceId: 11, sqlText: f.state.sqlText,
      expectedDefinitionVersion: version, values: {}, ...injection });
    assert.equal(response.status, 400); assert.deepEqual(f.state.executions, []); assert.equal(f.state.startAudits, 0);
  }));
}
test("context contains versions only, no candidate metadata, SQL or rows", () => fixture(async f => {
  const response = await f.request("/1/design-preview/context"); assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(await response.json() as object).sort(), ["datasetId", "definitionVersion", "patientAuditVersion", "sensitivityVersion"]);
  assert.deepEqual(f.state.executions, []); assert.deepEqual(f.state.disclosures, []);
}));

test("column candidates route returns metadata-only fields and audited attempt without data rows", () => fixture(async f => {
  const response = await f.request("/1/column-candidates");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const result = await response.json() as any;
  assert.equal(result.trust, "UNBOUND_CANDIDATE");
  assert.equal(result.metadataState, "NOT_INITIALIZED");
  assert.equal(result.deliveryAllowed, false);
  assert.deepEqual(result.columns, [{ name: "OPAQUE_A", dataType: "int", ordinal: 1 }]);
  assert.ok(!JSON.stringify(result).includes(rawName));
  assert.ok(!JSON.stringify(result).includes(rawId));
  assert.ok(!("rows" in result) && !("result" in result));
  assert.equal(f.state.candidateCalls, 1);
  assert.deepEqual(f.state.executions, []);
  assert.deepEqual(f.state.disclosures, []);
  assert.equal(f.state.operationStatus, "SUCCESS");
}));
test("column candidate metadata cannot be requested without both permissions", () => fixture(async f => {
  f.state.session.permissions = ["DESIGN_QUERY"];
  const response = await f.request("/1/column-candidates");
  assert.equal(response.status, 403); assert.equal(f.state.candidateCalls, 0);
  assert.equal(f.state.startAudits, 0);
}));
test("column candidate description failure returns no result and records failed attempt", () => fixture(async f => {
  f.state.candidateFailure = true;
  const response = await f.request("/1/column-candidates");
  assert.equal(response.status, 503);
  const body = await response.json() as any;
  assert.equal(body.error.code, "DATASET_COLUMN_DESCRIPTION_FAILED");
  assert.ok(!JSON.stringify(body).includes(rawName));
  assert.equal(f.state.operationStatus, "FAILED");
  assert.deepEqual(f.state.executions, []);
}));
test("column candidate source revision change before audit confirmation rejects metadata", () => fixture(async f => {
  f.state.phase = "operation-audit"; f.state.change = () => { f.state.candidateDrift = true; };
  const response = await f.request("/1/column-candidates");
  assert.equal(response.status, 409);
  assert.equal((await response.json() as any).error.code, "DATASET_COLUMN_DESCRIPTION_CONFLICT");
  assert.equal(f.state.operationStatus, "FAILED");
}));
test("column candidate audit writer failure never releases described fields", () => fixture(async f => {
  f.state.operationFailure = true;
  const response = await f.request("/1/column-candidates");
  assert.equal(response.status, 500);
  assert.equal(f.state.operationStatus, "FAILED");
  assert.equal(f.state.candidateCalls, 1);
  assert.deepEqual(f.state.executions, []);
}));


test("new saved Dataset sync endpoint writes field choices only, with audited metadata and fresh authority", () => fixture(async f => {
  f.state.snapshots.clear(); // No policy, patient configuration or preview proof needed to list field choices.
  const response = await f.request("/1/columns/sync", {});
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.deepEqual(body.columns, [{ name: "OPAQUE_A", dataType: "int", ordinal: 1 }]);
  assert.equal(body.purpose, "DISPLAY_COLUMN_OPTIONS_ONLY"); assert.equal(body.deliveryAllowed, false);
  assert.equal(body.trust, "UNBOUND_CANDIDATE"); assert.deepEqual(f.state.syncedColumns, ["OPAQUE_A"]);
  assert.deepEqual(f.state.executions, []); assert.deepEqual(f.state.disclosures, []);
  assert.equal(f.state.operationStatus, "SUCCESS");
}));
for (const kind of ["permission", "token", "audit", "drift", "describe", "sync", "forged-columns"]) {
  test(`column sync ${kind} refuses without row execution`, () => fixture(async f => {
    if (kind === "permission") f.state.session.permissions = ["DESIGN_QUERY"];
    if (kind === "token") f.state.session.tokenVersion++;
    if (kind === "audit") f.state.operationFailure = true;
    if (kind === "drift") f.state.candidateDrift = true;
    if (kind === "describe") f.state.candidateFailure = true;
    if (kind === "sync") f.state.syncFailure = true;
    const response = await f.request("/1/columns/sync", kind === "forged-columns" ? { columns: [{ name: "FORGED" }] } : {});
    assert.ok(response.status >= 400); assert.deepEqual(f.state.syncedColumns, []);
    assert.deepEqual(f.state.executions, []); assert.deepEqual(f.state.disclosures, []);
  }));
}
