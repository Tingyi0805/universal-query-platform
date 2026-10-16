import test from "node:test";
import assert from "node:assert/strict";
import sql from "mssql";
import { createDashboardApprovalStore, createDashboardApprovalEvidenceReader, defaultApprovalDependencies } from "./dashboardApproval.repository.js";
import { createDashboardApprovalService, type ApprovalPatch } from "./dashboardApproval.service.js";
import { lockLegacyBindings, prepareLegacyLocks } from "./dashboardLegacyLocks.js";
import { SecurityContractError } from "../securityContract/securityContract.js";
import { assertLegacyDashboardWriter } from "./dashboardSourceWriteGuard.js";

test("Legacy arbitration covers all synthetic flag combinations and converted modes", async () => {
  for (const management of [false, true]) for (const execution of [false, true]) for (const playback of [false, true]) {
    for (const mode of ["LEGACY", "QUERY_ONLY", "QUERY_ONLY_DISABLED"]) {
      let calls = 0;
      const request = () => ({ input() { return this; }, async query(text: string) {
        calls++;
        if (text.includes(" AS Mode")) return { recordset: [{ Mode: 24 }] };
        if (text.includes("SELECT QueryMode")) return { recordset: [{ QueryMode: mode }] };
        if (text.includes(" AS Marker")) return { recordset: [{ Marker: 4, Binding: 8 }] };
        if (text.includes("SELECT Id FROM uqp.Dashboard WHERE")) return { recordset: [] };
        return { recordset: [{ Id: 1 }] };
      } }) as unknown as sql.Request;
      const run = assertLegacyDashboardWriter({} as sql.Transaction, 1, request, management);
      if (management || mode !== "LEGACY") await assert.rejects(run, { code: "QUERY_SOURCE_LEGACY_WRITER_DISABLED" }); else await run;
      if (management) assert.equal(calls, 0);
      // Execution/playback switches cannot turn a converted row into Legacy.
      // Both are deliberately independent of the management arbitration input.
    }
  }
});

test("production snapshot evidence reads parent/source rowversions together and rejects missing evidence", async () => {
  const calls: string[] = []; let revision = 1; let missing = false; let schema = true;
  const tx = { begin: async (level: number) => { assert.equal(level, sql.ISOLATION_LEVEL.SERIALIZABLE); }, commit: async () => { calls.push("commit"); }, rollback: async () => { calls.push("rollback"); } } as unknown as sql.Transaction;
  const read = createDashboardApprovalEvidenceReader({
    getPool: async () => ({}) as sql.ConnectionPool, createTransaction: () => tx,
    schema: async () => { if (!schema) throw new SecurityContractError("SECURITY_SCHEMA_REQUIRED"); },
    createRequest: actual => {
      assert.equal(actual, tx);
      const request = { input() { return this; }, query: async (text: string) => {
        calls.push(text); assert.doesNotMatch(text, /INSERT|UPDATE|DELETE/i); assert.ok(text.includes("HOLDLOCK"));
        if (text.includes("DashboardDataSource")) return { recordset: [{ Id: 5, SourceKey: "EXTRA", DatasetId: 4, ApprovalRowVersion: missing ? null : Buffer.from(revision.toString(16).padStart(16, "0"), "hex") }] };
        return { recordset: [{ QueryDefinitionId: 2, ApprovalRowVersion: Buffer.from("0000000000000001", "hex") }] };
      } }; return request as unknown as sql.Request;
    },
  });
  const first = await read(1); revision++; assert.notEqual(await read(1), first);
  missing = true; await assert.rejects(read(1), { code: "SECURITY_SCHEMA_REQUIRED" }); assert.equal(calls.at(-1), "rollback");
  schema = false; await assert.rejects(read(1), { code: "SECURITY_SCHEMA_REQUIRED" });
});

test("legacy Dataset→Dashboard→source locks are sorted and binding drift aborts", async () => {
  const parent = { Id: 1, QueryDefinitionId: 2, PrimaryDatasetId: 8 };
  const sources = [{ Id: 5, SourceKey: "EXTRA", DatasetId: 4 }];
  const events: string[] = []; const lockedIds: number[] = [];
  const request = () => {
    const values: Record<string, unknown> = {};
    const r = { input: (key: string, _type: unknown, value: unknown) => { values[key] = value; return r; }, query: async (text: string) => {
      events.push(text);
      if (text.includes("FROM uqp.Dataset WITH")) { lockedIds.push(Number(values.datasetId)); return { recordset: [{ Id: values.datasetId }] }; }
      if (text.includes(" AS Mode")) return { recordset: [{ Mode: 24 }] };
      if (text.includes("SELECT QueryMode")) return { recordset: [{ QueryMode: "LEGACY" }] };
      if (text.includes(" AS Marker")) return { recordset: [{ Marker: 4, Binding: 8 }] };
      if (text.includes("SELECT Id FROM uqp.Dashboard WHERE")) return { recordset: [] };
      if (text.includes("FROM uqp.DashboardDataSource")) return { recordset: structuredClone(sources) };
      if (text.includes("FROM uqp.Dashboard d")) return { recordset: [structuredClone(parent)] };
      return { recordset: [{ Id: 1 }] };
    } }; return r as unknown as sql.Request;
  };
  const pool = { request } as unknown as sql.ConnectionPool;
  const seed = await prepareLegacyLocks(pool, 1, undefined, [9, 4]); events.length = 0;
  await lockLegacyBindings({} as sql.Transaction, 1, seed, request, false);
  assert.deepEqual(lockedIds, [4, 8, 9]);
  const dashboardIndex = events.findIndex(e => e.includes("FROM uqp.Dashboard WITH"));
  assert.ok(events.slice(0, dashboardIndex).every(e => e.includes("FROM uqp.Dataset WITH")));
  assert.ok(events.some(e => e.includes("DashboardDataSource WITH (UPDLOCK,HOLDLOCK)")));
  parent.PrimaryDatasetId = 10;
  await assert.rejects(lockLegacyBindings({} as sql.Transaction, 1, seed, request, false), { code: "DASHBOARD_APPROVAL_BINDING_CHANGED" });
  const count = events.length;
  await assert.rejects(lockLegacyBindings({} as sql.Transaction, 1, seed, request, true), { code: "QUERY_SOURCE_LEGACY_WRITER_DISABLED" });
  assert.equal(events.length, count);
});

for (const fail of ["none", "audit", "schema", "acl", "token", "rowversion", "timeout"] as const)
  test(`production approval store keeps update/audit atomic; failure=${fail}`, async () => {
    let parameters = "{}", staged = parameters; let epoch = 1; const events: string[] = [];
    const tx = { begin: async (level: number) => { assert.equal(level, sql.ISOLATION_LEVEL.SERIALIZABLE); events.push("begin"); },
      commit: async () => { parameters = staged; events.push("commit"); }, rollback: async () => { staged = parameters; events.push("rollback"); } } as unknown as sql.Transaction;
    const parent = { QueryDefinitionId: 2, PrimaryDatasetId: 3 };
    const request = () => {
      const values: Record<string, unknown> = {};
      const r = { input: (key: string, _type: unknown, value: unknown) => { values[key] = value; return r; }, query: async (text: string) => {
        events.push(text);
        if (text.includes("SELECT ParametersJson")) return { recordset: [{ ParametersJson: staged, IsActive: false, ApprovalRowVersion: fail === "rowversion" ? null : Buffer.from(epoch.toString(16).padStart(16, "0"), "hex") }] };
        if (text.includes("SELECT d.Id FROM uqp.Dataset")) return { recordset: [{ Id: 3 }] };
        if (text.includes("SELECT VersionNumber")) return { recordset: [{ VersionNumber: 1 }] };
        if (text.includes("SELECT ColumnName")) return { recordset: [{ ColumnName: "NAME", SensitivityType: "NAME", DeviceMaskMode: "FULL", CustomMaskJson: null }] };
        if (text.includes("UPDATE uqp.Dashboard")) { staged = String(values.parameters); epoch++; }
        return { recordset: [] };
      } }; return r as unknown as sql.Request;
    };
    const deps: typeof defaultApprovalDependencies = { ...defaultApprovalDependencies,
      getPool: async () => ({}) as sql.ConnectionPool, createTransaction: () => tx, createRequest: actual => { assert.equal(actual, tx); return request(); },
      prepare: async () => ({ signature: "synthetic", datasetIds: [3], extraQueries: [] }),
      schema: async () => { events.push("schema"); if (fail === "schema") throw new SecurityContractError("SECURITY_SCHEMA_REQUIRED"); },
      lock: async () => { events.push("lock"); return { parent, sources: [] }; },
      session: async (_id, actual) => { assert.equal(actual, tx); return { isActive: true, tokenVersion: fail === "token" ? 2 : 1, permissions: ["DESIGN_QUERY"] }; },
      access: async (_id, _query, actual) => { assert.equal(actual, tx); if (fail === "timeout") throw Object.assign(new Error("private"), { number: 1222 });
        return fail === "acl" ? null : { canView: true, canExecute: true } as NonNullable<Awaited<ReturnType<typeof defaultApprovalDependencies.access>>>; },
      audit: async (input, actual) => { assert.equal(actual, tx); events.push("audit"); assert.notEqual(staged, parameters);
        assert.deepEqual(input.parameters, { dashboardId: 1, sourceKey: "PRIMARY" });
        if (fail === "audit") throw new Error("synthetic-audit-failed"); return 1; },
    };
    const service = createDashboardApprovalService(createDashboardApprovalStore(deps));
    const actor = { userId: 1, tokenVersion: 1 };
    if (["schema", "acl", "token", "rowversion", "timeout"].includes(fail)) {
      await assert.rejects(service.get(1, actor)); assert.equal(parameters, "{}"); assert.equal(events.at(-1), "rollback"); return;
    }
    const version = (await service.get(1, actor)).version; events.length = 0;
    const patch: ApprovalPatch = { expectedVersion: version, sourceKey: "PRIMARY", upsert: { NAME: "INHERIT" }, remove: [] };
    if (fail === "audit") { await assert.rejects(service.patch(1, actor, patch)); assert.equal(parameters, "{}"); assert.equal(staged, "{}"); assert.equal(events.at(-1), "rollback"); }
    else { const result = await service.patch(1, actor, patch); assert.notEqual(result.version, version); assert.ok(parameters.includes("INHERIT")); assert.equal(events.at(-1), "commit"); }
    assert.ok(events.indexOf("schema") < events.indexOf("lock"));
    assert.ok(events.indexOf("audit") > events.findIndex(e => e.includes("UPDATE uqp.Dashboard")));
    assert.ok(!events.some(e => /DELETE|INSERT INTO uqp.DashboardDataSource/.test(e)));
    assert.ok(events.includes("SET LOCK_TIMEOUT 0")); assert.ok(events.includes("SET LOCK_TIMEOUT -1"));
  });

test("915 catalog mismatch rejects approval evidence before any 919-column query", async () => {
  const events: string[] = [];
  const tx = {
    begin: async () => { events.push("begin"); },
    commit: async () => { events.push("commit"); },
    rollback: async () => { events.push("rollback"); },
  } as unknown as sql.Transaction;
  const read = createDashboardApprovalEvidenceReader({
    getPool: async () => ({}) as sql.ConnectionPool,
    createTransaction: () => tx,
    schema: async () => {
      events.push("schema");
      throw new SecurityContractError("SECURITY_SCHEMA_REQUIRED");
    },
    createRequest: () => ({
      input() { return this; },
      async query() { events.push("query"); throw new Error("unexpected query after missing schema"); },
    }) as unknown as sql.Request,
  });
  await assert.rejects(read(10), { code: "SECURITY_SCHEMA_REQUIRED" });
  assert.deepEqual(events, ["begin", "schema", "rollback"]);
});

test("915 legacy writer allows missing 917/918 columns, blocks partial migration and converted mode", async () => {
  for (const scenario of [
    { marker: null, binding: null, mode: null, expected: "allow" },
    { marker: 4, binding: null, mode: null, expected: "QUERY_SOURCE_SCHEMA_REQUIRED" },
    { marker: null, binding: 8, mode: null, expected: "QUERY_SOURCE_SCHEMA_REQUIRED" },
    { marker: 4, binding: 8, mode: "QUERY_ONLY", expected: "QUERY_SOURCE_LEGACY_WRITER_DISABLED" },
  ] as const) {
    const queries: string[] = [];
    const request = () => ({
      input() { return this; },
      async query(statement: string) {
        queries.push(statement);
        if (statement.includes("SELECT COL_LENGTH('uqp.Dashboard','QueryMode') AS Mode"))
          return { recordset: [{ Mode: scenario.mode === null ? null : 24 }] };
        if (statement.includes("SELECT QueryMode FROM uqp.Dashboard"))
          return { recordset: [{ QueryMode: scenario.mode }] };
        if (statement.includes(" AS Marker")) return { recordset: [{ Marker: scenario.marker, Binding: scenario.binding }] };
        if (statement.includes("SELECT Id FROM uqp.Dashboard WHERE"))
          return { recordset: [] };
        return { recordset: [{ Id: 1 }] };
      },
    }) as unknown as sql.Request;
    const call = assertLegacyDashboardWriter({} as sql.Transaction, 1, request, false);
    if (scenario.expected === "allow") await assert.doesNotReject(call);
    else await assert.rejects(call, { code: scenario.expected });
    if (scenario.marker === null && scenario.binding === null)
      assert.equal(queries.some(q => q.includes("QuerySourceMaxRows IS NOT NULL")), false);
  }
});
