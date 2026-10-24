import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { env } from "../../config/env.js";
import { errorHandler } from "../../middleware/errorHandler.js";
import { createAuthenticateJwt } from "../auth/auth.middleware.js";
import { DatasetDeliverySnapshotError, type ConfirmedDatasetDeliverySnapshot } from "../dataset/datasetDeliveryPolicy.repository.js";
import { createQueryDelivery, createRuntimeIdentityVerifier, defaultQueryDeliveryDependencies } from "./queryDelivery.js";
import { createQueryRuntimeRouter, defaultQueryRuntimeDependencies } from "./queryRuntime.routes.js";
import type { ReportColumnRecord } from "./reportColumn.repository.js";

const rawName = "王小明", rawId = "SYNTHETIC-ID-ONLY-BACKEND";
const formats = ["execute", "export/csv", "export/excel"] as const;
const report = (columnName: string, index: number): ReportColumnRecord => ({
  columnName, dataType: "string", displayLabel: columnName, displayOrder: index,
  isVisible: true, width: null, displayFormat: null, alignment: "LEFT", groupOrder: null, aggregateType: "NONE",
});

async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const previous = env.JWT_SECRET;
  env.JWT_SECRET = "synthetic-query-delivery-signing-key";
  const f = await setup();
  try { await run(f); }
  finally { f.server.closeAllConnections(); await new Promise<void>(resolve => f.server.close(() => resolve())); env.JWT_SECRET = previous; }
}

async function setup() {
  const state = {
    session: { isActive: true, tokenVersion: 1, permissions: ["VIEW_QUERY", "EXECUTE_QUERY", "EXPORT_QUERY"] },
    query: { id: 4, datasetId: 7, code: "SYNTHETIC", name: "Report", canView: true, canExecute: true, canExport: true,
      isPublished: true, isActive: true, isArchived: false, lastUsedAtUtc: null as string | null },
    snapshot: {
      datasetId: 7, definitionVersion: "0000000000000001", sensitivityVersion: "1", patientAuditVersion: "1",
      policy: { state: "CONFIRMED", version: "1", rules: [
        { columnName: "NAME", mode: "CUSTOM", customMask: { prefix: 1, suffix: 1, symbol: "○" } },
        { columnName: "MRN", mode: "OMIT" },
        { columnName: "ROOM", mode: "NONE" },
      ], patientAuditOnlyColumns: ["MRN"] },
      patientAudit: { configured: true, enabled: true, patientKeyColumn: "MRN" },
    } as ConfirmedDatasetDeliverySnapshot,
    reports: [report("NAME", 0), report("MRN", 1), report("ROOM", 2)],
    raw: { columns: [{ name: "NAME" }, { name: "MRN" }, { name: "ROOM" }], rows: [{ NAME: rawName, MRN: rawId, ROOM: "R,1" }],
      rowCount: 1, truncated: false, elapsedMs: 1 },
    revision: "acl-1", patientFingerprint: "patient-1", patientStatus: "CONFIRMED", policyError: "",
    executes: 0, patientAudits: 0, starts: 0, successes: 0, failures: 0, optionReads: 0,
    failureWriteFailure: false, auditFailure: false, successFailure: false, startFailure: false, missingDisclosure: false,
    parameterMode: "NONE", phase: "", change: () => {},
  };
  const dependencies = {
    ...defaultQueryDeliveryDependencies,
    access: async () => structuredClone(state.query),
    accessRevision: async () => state.revision,
    snapshot: async () => {
      if (state.policyError) throw new DatasetDeliverySnapshotError(state.policyError as never);
      return structuredClone(state.snapshot);
    },
    dataset: async () => ({ id: 7, dataSourceId: 3, sqlText: "SELECT NAME, MRN, ROOM", isActive: true, isArchived: false }),
    patientState: async () => ({ status: state.patientStatus, fingerprint: state.patientFingerprint }),
    reports: async () => structuredClone(state.reports),
    execute: async () => { state.executes++; if (state.phase === "sql") state.change(); return state.raw; },
    auditPatient: async (input: { rows: ReadonlyArray<Record<string, unknown>>; masked: boolean }) => {
      state.patientAudits++;
      assert.equal(input.rows[0]?.MRN, rawId);
      assert.equal(input.rows[0]?.NAME ?? input.rows[0]?.["姓名"], rawName);
      assert.equal(input.masked, true);
      if (state.phase === "patient-audit") state.change();
      if (state.auditFailure) throw new Error("SYNTHETIC_AUDIT_FAILURE");
      return state.missingDisclosure ? null : 11;
    },
  } as unknown as typeof defaultQueryDeliveryDependencies;
  const session = async () => structuredClone(state.session);
  const app = express(); app.use(express.json());
  app.use("/api/queries", createQueryRuntimeRouter({
    ...defaultQueryRuntimeDependencies,
    authenticate: createAuthenticateJwt(session), identity: createRuntimeIdentityVerifier(session), delivery: createQueryDelivery(dependencies),
    listAccessibleQueries: async () => [state.query] as never,
    listDatasetParameters: async () => [{ name: "WARD", optionMode: state.parameterMode }] as never,
    getParameterOptions: async () => { state.optionReads++; return [{ value: "A", label: "A" }]; },
    startAudit: async input => {
      state.starts++; assert.equal(input.parameters, null);
      if (state.startFailure) throw new Error("SYNTHETIC_START_FAILURE");
      return 10;
    },
    finalizeDeliveryAudit: async (_id, _stats, validate) => {
      if (state.phase === "success-audit") state.change();
      if (state.successFailure) throw new Error("SYNTHETIC_SUCCESS_FAILURE");
      await validate({} as never);
      state.successes++;
      state.query.lastUsedAtUtc = new Date().toISOString();
    },
    completeAuditFailure: async () => { if (state.failureWriteFailure) throw new Error("synthetic failure-write failure"); state.failures++; },
    createQueryExcel: async (...args) => {
      const buffer = await defaultQueryRuntimeDependencies.createQueryExcel(...args);
      if (state.phase === "serialize") state.change();
      return buffer;
    },
  }));
  app.use(errorHandler);
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/queries/4`;
  const token = jwt.sign({ sub: "1", tokenVersion: 1 }, env.JWT_SECRET!, { expiresIn: 3600 });
  async function request(path: string, method = "POST", authorization: string | null = `Bearer ${token}`) {
    return fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(authorization ? { authorization } : {}) },
      ...(method === "POST" ? { body: JSON.stringify({ values: { PATIENT: rawId }, bypassMasking: true }) } : {}) });
  }
  return { state, server, request };
}

async function deliveredCells(format: typeof formats[number], response: Response): Promise<unknown[]> {
  if (format === "execute") {
    const body = await response.json() as any;
    assert.deepEqual(body.result.columns.map((c: any) => c.name), ["NAME", "ROOM"]);
    assert.deepEqual(body.result.rows, [{ NAME: "王○明", ROOM: "R,1" }]);
    return Object.values(body.result.rows[0]);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  if (format === "export/excel") await workbook.xlsx.load(buffer as any);
  else await workbook.csv.read(Readable.from([buffer]));
  const values: unknown[] = [];
  workbook.worksheets[0]!.eachRow(row => row.eachCell(cell => values.push(cell.value)));
  assert.ok(values.includes("NAME")); assert.ok(values.includes("ROOM"));
  assert.ok(values.includes("王○明")); assert.ok(values.includes("R,1"));
  return values;
}

for (const format of formats) for (const admin of [false, true]) {
  test(`${format}: standard users and administrators receive identical policy-processed data (admin=${admin})`, () => fixture(async f => {
    if (admin) f.state.session.permissions.push("DESIGN_QUERY", "MANAGE_USERS");
    const before = structuredClone(f.state.raw);
    const response = await f.request(`/${format}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const values = await deliveredCells(format, response);
    assert.equal(JSON.stringify(values).includes(rawName), false);
    assert.equal(JSON.stringify(values).includes(rawId), false);
    assert.equal(values.includes("MRN"), false);
    assert.equal(f.state.patientAudits, 1); assert.equal(f.state.successes, 1);
    assert.deepEqual(f.state.raw, before);
  }));
}

for (const format of formats) {
  test(`${format}: all OMIT fields never reappear through fallback`, () => fixture(async f => {
    f.state.snapshot = { ...f.state.snapshot, policy: { state: "CONFIRMED", version: "1", rules:
      ["NAME", "MRN", "ROOM"].map(columnName => ({ columnName, mode: "OMIT" as const })), patientAuditOnlyColumns: ["MRN"] } };
    const response = await f.request(`/${format}`); assert.equal(response.status, 200);
    if (format === "execute") {
      const body = await response.json() as any;
      assert.deepEqual(body.result.columns, []); assert.deepEqual(body.result.rows, [{}]);
    } else {
      const workbook = new ExcelJS.Workbook(), buffer = Buffer.from(await response.arrayBuffer());
      if (format === "export/excel") await workbook.xlsx.load(buffer as any);
      else await workbook.csv.read(Readable.from([buffer]));
      workbook.worksheets[0]!.eachRow(row => row.eachCell(cell => assert.ok(![rawName, rawId, "MRN", "NAME", "ROOM"].includes(String(cell.value)))));
    }
  }));

  for (const failure of ["patient", "success", "start", "missing-disclosure"] as const) {
    test(`${format}: ${failure} audit failure refuses delivery`, () => fixture(async f => {
      f.state.auditFailure = failure === "patient"; f.state.successFailure = failure === "success";
      f.state.startFailure = failure === "start"; f.state.missingDisclosure = failure === "missing-disclosure";
      const response = await f.request(`/${format}`); assert.ok(response.status >= 400);
      const text = await response.text(); assert.ok(!text.includes(rawName) && !text.includes(rawId));
      assert.equal(response.headers.get("content-disposition"), null);
      assert.equal(f.state.successes, 0);
    }));
  }
}

const changes = {
  token: (s: any) => { s.session.tokenVersion++; },
  rbac: (s: any) => { s.session.permissions = ["VIEW_QUERY"]; },
  acl: (s: any) => { s.query.canExecute = false; },
  "acl-revision": (s: any) => { s.revision = "acl-2"; },
  unpublished: (s: any) => { s.query.isPublished = false; },
  binding: (s: any) => { s.query.datasetId = 8; },
  "definition-aba": (s: any) => { s.snapshot.definitionVersion = "0000000000000003"; },
  policy: (s: any) => { s.snapshot.sensitivityVersion = "3"; s.snapshot.policy.version = "3"; },
  patient: (s: any) => { s.snapshot.patientAuditVersion = "3"; },
  proof: (s: any) => { s.patientFingerprint = "patient-2"; },
};
for (const phase of ["sql", "patient-audit", "success-audit", "serialize"]) for (const [name, change] of Object.entries(changes)) {
  test(`${phase}: ${name} changes discard results before delivery`, () => fixture(async f => {
    f.state.phase = phase; f.state.change = () => change(f.state); f.state.failureWriteFailure = phase === "success-audit";
    const response = await f.request("/export/excel"); assert.ok(response.status >= 400);
    const text = await response.text(); assert.ok(!text.includes(rawName) && !text.includes(rawId));
    assert.equal(response.headers.get("content-disposition"), null);
    assert.equal(f.state.successes, 0);
  }));
}

test("detail metadata omits hidden fields and refuses unsafe grouping/aggregation", () => fixture(async f => {
  let response = await f.request("", "GET"); assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.deepEqual(body.reportColumns.map((r: any) => r.columnName), ["NAME", "ROOM"]);
  for (const kind of ["group", "aggregate"]) {
    f.state.reports[1]!.groupOrder = kind === "group" ? 0 : null;
    f.state.reports[1]!.aggregateType = kind === "aggregate" ? "COUNT" : "NONE";
    response = await f.request("", "GET"); assert.equal(response.status, 409);
    assert.equal((await response.json() as any).error.code, "QUERY_REPORT_POLICY_CONFLICT");
  }
}));

test("lookup options fail closed without executing the lookup Dataset", () => fixture(async f => {
  f.state.parameterMode = "DATASET";
  const response = await f.request("/parameters/WARD/options", "GET");
  assert.equal(response.status, 503); assert.equal(f.state.optionReads, 0); assert.equal(f.state.executes, 0);
}));

for (const code of ["DATASET_DELIVERY_SCHEMA_REQUIRED", "DATASET_DELIVERY_POLICY_INVALID", "DATASET_DELIVERY_POLICY_UNCONFIRMED"]) {
  test(`${code}: JSON, CSV, Excel and detail refuse before SQL`, () => fixture(async f => {
    f.state.policyError = code;
    for (const format of formats) assert.ok((await f.request(`/${format}`)).status >= 400);
    assert.ok((await f.request("", "GET")).status >= 400);
    assert.equal(f.state.executes, 0); assert.equal(f.state.starts, 0);
  }));
}

test("JWT, TokenVersion, RBAC and actual Query ACL are required before SQL", () => fixture(async f => {
  assert.equal((await f.request("/execute", "POST", null)).status, 401);
  assert.equal((await f.request("/execute", "POST", "Bearer invalid")).status, 401);
  const expired = jwt.sign({ sub: "1", tokenVersion: 1 }, env.JWT_SECRET!, { expiresIn: -1 });
  assert.equal((await f.request("/execute", "POST", `Bearer ${expired}`)).status, 401);
  f.state.session.tokenVersion = 2; assert.equal((await f.request("/execute")).status, 401);
  f.state.session.tokenVersion = 1; f.state.session.permissions = ["DESIGN_QUERY"];
  assert.equal((await f.request("/execute")).status, 403);
  f.state.session.permissions = ["VIEW_QUERY", "EXECUTE_QUERY", "EXPORT_QUERY"];
  f.state.query.canExecute = false; assert.equal((await f.request("/execute")).status, 403);
  assert.equal(f.state.executes, 0);
}));

test("JWT expiration during SQL is rechecked before patient disclosure or delivery", async t => {
  try {
    await fixture(async f => {
      const expiredNow = Date.now() + 3_601_000;
      f.state.phase = "sql";
      f.state.change = () => { t.mock.method(Date, "now", () => expiredNow); };
      const response = await f.request("/execute");
      assert.equal(response.status, 401);
      assert.equal(f.state.patientAudits, 0); assert.equal(f.state.successes, 0);
    });
  } finally { t.mock.restoreAll(); }
});

test("explicitly hidden report columns do not fall back to every policy-visible column", () => fixture(async f => {
  for (const r of f.state.reports) r.isVisible = false;
  for (const format of ["export/csv", "export/excel"]) {
    const response = await f.request(`/${format}`); assert.equal(response.status, 200);
    const workbook = new ExcelJS.Workbook(), buffer = Buffer.from(await response.arrayBuffer());
    if (format === "export/excel") await workbook.xlsx.load(buffer as any);
    else await workbook.csv.read(Readable.from([buffer]));
    workbook.worksheets[0]!.eachRow(row => row.eachCell(cell => assert.ok(!["NAME", "ROOM", "王○明"].includes(String(cell.value)))));
  }
}));

test("legacy modes and mismatched policy evidence refuse before SQL", () => fixture(async f => {
  f.state.snapshot = { ...f.state.snapshot, policy: { ...f.state.snapshot.policy, rules: [{ columnName: "NAME", mode: "NAME" } as never] } };
  assert.equal((await f.request("/execute")).status, 409);
  f.state.snapshot = { ...f.state.snapshot, policy: { state: "CONFIRMED", version: "2", rules: [] } };
  assert.equal((await f.request("/execute")).status, 503);
  assert.equal(f.state.executes, 0);
}));

test("ordinary non-patient data requires explicit raw column configuration", () => fixture(async f => {
  f.state.snapshot = { ...f.state.snapshot, patientAuditVersion: "0", policy: { state: "CONFIRMED", version: "1", rules: [{ columnName: "ROOM", mode: "NONE" }] },
    patientAudit: { configured: false, enabled: false, patientKeyColumn: null } };
  // This is ordinary synthetic data under an explicitly confirmed empty policy.
  f.state.raw = { ...f.state.raw, columns: [{ name: "ROOM" }], rows: [{ ROOM: "R,1" }] } as never;
  const response = await f.request("/execute"); assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as any).result.rows, [{ ROOM: "R,1" }]);
  assert.equal(f.state.patientAudits, 0);
}));

test("invalid patient proof and ambiguous SQL aliases never deliver rows", () => fixture(async f => {
  f.state.patientStatus = "METADATA_UNCONFIRMED";
  assert.equal((await f.request("/execute")).status, 503); assert.equal(f.state.executes, 0);
  f.state.patientStatus = "CONFIRMED";
  f.state.raw.columns.push({ name: "name" });
  assert.equal((await f.request("/execute")).status, 409); assert.equal(f.state.successes, 0);
}));

test("all standard delivery routes reject OMIT group and aggregate references", () => fixture(async f => {
  for (const kind of ["group", "aggregate"]) {
    f.state.reports[1]!.groupOrder = kind === "group" ? 0 : null;
    f.state.reports[1]!.aggregateType = kind === "aggregate" ? "COUNT" : "NONE";
    for (const format of formats) {
      const response = await f.request(`/${format}`); assert.equal(response.status, 409);
      assert.equal((await response.json() as any).error.code, "QUERY_REPORT_POLICY_CONFLICT");
    }
  }
  assert.equal(f.state.successes, 0);
}));

for (const format of formats) {
  test(`${format}: Oracle surgery dashboard-style Chinese columns preserve masking and omit patient key`, () => fixture(async f => {
    (f.state as any).raw = {
      columns: [{ name: "姓名" }, { name: "手術室" }, { name: "手術動向" }, { name: "住院床號" }, { name: "MRN" }],
      rows: [{ "姓名": rawName, "手術室": "OR-1", "手術動向": "準備中", "住院床號": "5-12", MRN: rawId }],
      rowCount: 1, truncated: false, elapsedMs: 1,
    };
    f.state.snapshot = { ...f.state.snapshot, policy: { ...f.state.snapshot.policy, rules: [
      { columnName: "姓名", mode: "CUSTOM", customMask: { prefix: 1, suffix: 1, symbol: "○" } },
      { columnName: "手術室", mode: "NONE" },
      { columnName: "手術動向", mode: "NONE" },
      { columnName: "住院床號", mode: "NONE" },
      { columnName: "MRN", mode: "OMIT" },
    ] } };
    f.state.reports = ["姓名", "手術室", "手術動向", "住院床號", "MRN"].map(report);
    const response = await f.request(`/${format}`);
    assert.equal(response.status, 200);
    let output: string;
    if (format === "execute") {
      const json = await response.json() as any;
      assert.deepEqual(json.result.columns.map((c: any) => c.name), ["姓名", "手術室", "手術動向", "住院床號"]);
      assert.deepEqual(json.result.rows, [{ "姓名": "王○明", "手術室": "OR-1", "手術動向": "準備中", "住院床號": "5-12" }]);
      output = JSON.stringify(json);
    } else {
      const bytes = Buffer.from(await response.arrayBuffer());
      const workbook = new ExcelJS.Workbook();
      if (format === "export/excel") await workbook.xlsx.load(bytes as any);
      else await workbook.csv.read(Readable.from([bytes]));
      const sheet = workbook.worksheets[0]!;
      const headings = sheet.getRow(1).values as unknown[];
      assert.deepEqual(headings.slice(1), ["姓名", "手術室", "手術動向", "住院床號"]);
      assert.deepEqual((sheet.getRow(2).values as unknown[]).slice(1), ["王○明", "OR-1", "準備中", "5-12"]);
      output = JSON.stringify(sheet.getSheetValues());
    }
    assert.ok(!output.includes(rawName));
    assert.ok(!output.includes(rawId));
    assert.ok(!output.includes("MRN"));
    assert.equal(f.state.patientAudits, 1);
    assert.equal(f.state.successes, 1);
  }));
}
