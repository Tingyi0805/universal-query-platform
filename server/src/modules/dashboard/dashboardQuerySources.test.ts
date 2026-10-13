import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import express from "express";
import type sql from "mssql";
import { querySourcePatchSchema, type QuerySourcePatch } from "./dashboardQuerySources.schema.js";
import { createQuerySourceManagement, QuerySourceError, sourceVersion, type SourceState, type SourceStore, type SourceTransaction } from "./dashboardQuerySources.service.js";
import { safeParameterFailure, querySourceSchemaReady, createQuerySourceStore } from "./dashboardQuerySources.repository.js";
import { assertLegacyDashboardWriter } from "./dashboardSourceWriteGuard.js";
import { createQuerySourceRouter } from "./dashboardQuerySources.routes.js";
import { coerceRuntimeParameters } from "../dataset/parameter.service.js";
import type { DatasetParameterRecord } from "../dataset/parameter.repository.js";

function fixture() {
  let state: SourceState = {
    dashboard: { id: 1, queryDefinitionId: 20, isActive: false, parameters: {}, updatedAtUtc: "2026-10-13T00:00:00Z",
      maxRows: null, refreshSeconds: 30, pageSize: 10, pageSeconds: 15 },
    sources: [{ id: 10, sourceKey: "WARD", datasetId: 3, queryDefinitionId: null, queryBindingRevision: 0,
      maxRows: null, parameters: { WARD: "SYNTHETIC_PRIVATE_VALUE" }, refreshSeconds: 30, pageSize: 10, pageSeconds: 15, isEnabled: true }],
    references: ["WARD"],
  };
  const control = { enabled: true, schema: true, transactions: 0, rollback: 0, writes: 0, auditFailure: false,
    queries: new Map([[20, { datasetId: 2, published: true, active: true, archived: false, allowed: true, required: false }],
      [21, { datasetId: 3, published: true, active: true, archived: false, allowed: true, required: true }]]),
    audits: [] as unknown[], afterValidation: () => {} };
  const store: SourceStore = {
    async transaction(work) {
      control.transactions++;
      const staged = structuredClone(state), audits: unknown[] = [];
      const tx: SourceTransaction = {
        schemaReady: async () => control.schema,
        readState: async () => structuredClone(staged),
        validateQuery: async (_user, id, parameters) => {
          const q = control.queries.get(id);
          if (!q?.published || !q.active || q.archived) throw new QuerySourceError("QUERY_SOURCE_QUERY_NOT_AVAILABLE");
          if (!q.allowed) throw new QuerySourceError("QUERY_SOURCE_QUERY_FORBIDDEN", 403);
          try {
            coerceRuntimeParameters(q.required ? [{ name: "WARD", dataType: "STRING", controlType: "TEXT", isRequired: true, defaultValue: null } as DatasetParameterRecord] : [], parameters);
          } catch (error) { safeParameterFailure(error); }
          control.afterValidation();
          return q.datasetId;
        },
        upsert: async (_dashboardId, source) => {
          control.writes++;
          if (source.id === null) staged.sources.push({ ...structuredClone(source), id: Math.max(0, ...staged.sources.map(s => s.id)) + 1 });
          else staged.sources[staged.sources.findIndex(s => s.id === source.id)] = structuredClone(source) as SourceState["sources"][number];
        },
        remove: async (_dashboardId, id) => { control.writes++; staged.sources = staged.sources.filter(s => s.id !== id); },
        markManaged: async () => { staged.dashboard.maxRows ??= 1000; staged.dashboard.updatedAtUtc = "2026-10-13T00:00:01Z"; },
        audit: async (_user, dashboardId, changes) => {
          if (control.auditFailure) throw new Error("private SQL Token=synthetic connection-string");
          audits.push({ dashboardId, changes });
        },
      };
      try { const result = await work(tx); state = staged; control.audits.push(...audits); return result; }
      catch (error) { control.rollback++; throw error; }
    },
  };
  const service = createQuerySourceManagement(store, () => control.enabled);
  const upsert = () => ({ id: 10, sourceKey: "WARD", queryDefinitionId: 21, parameters: { WARD: "SYNTHETIC_PRIVATE_VALUE" },
    refreshSeconds: 45, pageSize: 10, pageSeconds: 15, maxRows: 100, isEnabled: true });
  const patch = (): QuerySourcePatch => ({ expectedVersion: sourceVersion(state), upserts: [upsert()], removals: [] });
  return { control, service, upsert, patch, state: () => state };
}
test("strict Query-only contract rejects Dataset, SQL, PRIMARY, duplicate keys and unknown fields", () => {
  const f = fixture(), p = f.patch();
  assert.equal(querySourcePatchSchema.safeParse(p).success, true);
  for (const field of ["datasetId", "sql", "sqlText"]) assert.equal(querySourcePatchSchema.safeParse({ ...p, upserts: [{ ...p.upserts[0], [field]: 3 }] }).success, false);
  assert.equal(querySourcePatchSchema.safeParse({ ...p, upserts: [{ ...p.upserts[0], sourceKey: "PRIMARY" }] }).success, false);
  assert.equal(querySourcePatchSchema.safeParse({ ...p, removals: [{ id: 10, sourceKey: "ward" }] }).success, false);
});
test("default-off capability and missing 917 reject without writes or legacy fallback", async () => {
  const f = fixture(); f.control.enabled = false;
  await assert.rejects(f.service.patch(1, 1, f.patch()), { code: "QUERY_SOURCE_MANAGEMENT_DISABLED" });
  assert.equal(f.control.transactions, 0);
  f.control.enabled = true; f.control.schema = false;
  await assert.rejects(f.service.patch(1, 1, f.patch()), { code: "QUERY_SOURCE_SCHEMA_REQUIRED", status: 503 });
  assert.equal(f.control.writes, 0);
});
test("explicit conversion and incremental update keep source ID, history, key and references", async () => {
  const f = fixture(); const before = structuredClone(f.state());
  const result = await f.service.patch(1, 1, f.patch());
  assert.equal(result.playbackEnabled, false); assert.equal(result.primary.sourceKey, "PRIMARY");
  assert.equal(f.state().sources[0]!.id, before.sources[0]!.id);
  assert.equal(f.state().sources[0]!.datasetId, 3);
  assert.equal(f.state().sources[0]!.queryBindingRevision, 1);
  assert.deepEqual(f.state().references, before.references);
  f.control.queries.get(21)!.datasetId = 99;
  const p = f.patch(); p.upserts[0]!.refreshSeconds = 50;
  await f.service.patch(1, 1, p);
  assert.equal(f.state().sources[0]!.datasetId, 3); // Current Query Dataset never overwrites history.
  assert.equal(f.state().sources[0]!.queryBindingRevision, 2);
});
test("untouched legacy rows and parameters are preserved; additions/removals are explicit", async () => {
  const f = fixture(), before = structuredClone(f.state().sources[0]);
  await f.service.patch(1, 1, { ...f.patch(), upserts: [{ ...f.upsert(), id: null, sourceKey: "ROOM" }] });
  assert.deepEqual(f.state().sources[0], before);
  const room = f.state().sources[1]!;
  await f.service.patch(1, 1, { expectedVersion: sourceVersion(f.state()), upserts: [], removals: [{ id: room.id, sourceKey: "ROOM" }] });
  assert.deepEqual(f.state().sources, [before]);
});
test("same settings do not replace IDs or advance revisions", async () => {
  const f = fixture(); await f.service.patch(1, 1, f.patch());
  const before = structuredClone(f.state()), writes = f.control.writes;
  await f.service.patch(1, 1, f.patch());
  assert.deepEqual(f.state(), before); assert.equal(f.control.writes, writes);
});
test("stale concurrent edit version is rejected before changes", async () => {
  const f = fixture(), stale = f.patch(); await f.service.patch(1, 1, stale);
  const before = structuredClone(f.state());
  await assert.rejects(f.service.patch(1, 1, stale), { code: "QUERY_SOURCE_VERSION_CONFLICT" });
  assert.deepEqual(f.state(), before);
});
test("permission revoked after initial validation is rechecked before the first write", async () => {
  const f = fixture(); let calls = 0;
  f.control.afterValidation = () => { if (++calls === 2) f.control.queries.get(21)!.allowed = false; };
  await assert.rejects(f.service.patch(1, 1, f.patch()), { code: "QUERY_SOURCE_QUERY_FORBIDDEN" });
  assert.equal(f.control.writes, 0); assert.equal(f.state().sources[0]!.queryDefinitionId, null);
});
test("referenced deletion and key/id renaming are rejected without mutation", async () => {
  const f = fixture(), before = structuredClone(f.state());
  await assert.rejects(f.service.patch(1, 1, { ...f.patch(), upserts: [], removals: [{ id: 10, sourceKey: "WARD" }] }), { code: "QUERY_SOURCE_IN_USE" });
  for (const change of [{ id: 99 }, { sourceKey: "ward" }, { sourceKey: "RENAMED" }])
    await assert.rejects(f.service.patch(1, 1, { ...f.patch(), upserts: [{ ...f.upsert(), ...change }] }), { code: "QUERY_SOURCE_IDENTITY_CONFLICT" });
  assert.deepEqual(f.state(), before);
});
for (const field of ["published", "active", "archived", "allowed", "required"] as const) {
  test(`Query ${field} failure is classified and rolls back`, async () => {
    const f = fixture(), before = structuredClone(f.state()), patch = f.patch();
    if (field === "required") patch.upserts[0]!.parameters = {};
    else f.control.queries.get(21)![field] = field === "archived";
    await assert.rejects(f.service.patch(1, 1, patch), { code: field === "allowed" ? "QUERY_SOURCE_QUERY_FORBIDDEN" : field === "required" ? "PARAMETER_REQUIRED" : "QUERY_SOURCE_QUERY_NOT_AVAILABLE" });
    assert.deepEqual(f.state(), before); assert.equal(f.control.writes, 0);
  });
}
test("pending conversion never guesses a different Dataset Query, active dashboards remain protected", async () => {
  const f = fixture(); f.control.queries.get(21)!.datasetId = 999;
  await assert.rejects(f.service.patch(1, 1, f.patch()), { code: "QUERY_SOURCE_CONVERSION_DATASET_MISMATCH" });
  f.state().dashboard.isActive = true;
  await assert.rejects(f.service.patch(1, 1, f.patch()), { code: "QUERY_SOURCE_DASHBOARD_MUST_BE_INACTIVE" });
  assert.equal(f.control.writes, 0);
});
test("maximum 8 includes PRIMARY and disabled/pending extras; oversized legacy data is not deleted", async () => {
  const f = fixture(); f.state().sources = Array.from({ length: 8 }, (_, i) => ({ ...f.state().sources[0]!, id: i + 10, sourceKey: `LEGACY${i}`, isEnabled: false }));
  const read = await f.service.read(1, 1); assert.equal(read.overCapacity, true); assert.equal(read.sources.length, 8);
  const before = structuredClone(f.state());
  await assert.rejects(f.service.patch(1, 1, { ...f.patch(), upserts: [{ ...f.upsert(), id: null, sourceKey: "NEW" }] }), { code: "QUERY_SOURCE_LIMIT" });
  assert.deepEqual(f.state(), before);
});
test("seven extras are accepted; an eighth new extra is rejected while existing data remains intact", async () => {
  const f = fixture(); f.state().references = [];
  f.state().sources = Array.from({ length: 6 }, (_, i) => ({ ...f.state().sources[0]!, id: i + 10, sourceKey: `LEGACY${i}` }));
  await f.service.patch(1, 1, { ...f.patch(), upserts: [{ ...f.upsert(), id: null, sourceKey: "NEW" }] });
  assert.equal(f.state().sources.length + 1, 8);
  const before = structuredClone(f.state());
  await assert.rejects(f.service.patch(1, 1, { ...f.patch(), upserts: [{ ...f.upsert(), id: null, sourceKey: "EXCESS" }] }), { code: "QUERY_SOURCE_LIMIT" });
  assert.deepEqual(f.state(), before);
});
test("mandatory safe audit failure rolls back writes; responses and audit contain no bind values", async () => {
  const f = fixture(), before = structuredClone(f.state()); f.control.auditFailure = true;
  await assert.rejects(f.service.patch(1, 1, f.patch())); assert.deepEqual(f.state(), before);
  f.control.auditFailure = false;
  const result = await f.service.patch(1, 1, f.patch());
  assert.equal(JSON.stringify([result, f.control.audits]).includes("SYNTHETIC_PRIVATE_VALUE"), false);
  assert.deepEqual(f.control.audits, [{ dashboardId: 1, changes: [{ sourceKey: "WARD", queryDefinitionId: 21, action: "UPDATE" }] }]);
});
test("unknown parameter details are never reflected", () => {
  assert.throws(() => safeParameterFailure(new Error("PARAMETER_REQUIRED:private SQL patient token")), { code: "PARAMETER_REQUIRED", message: "PARAMETER_REQUIRED" });
  assert.throws(() => safeParameterFailure(new Error("private connection-string")), { code: "QUERY_SOURCE_PARAMETER_VALIDATION_FAILED" });
});

test("legacy writer guard handles pre-917, partial schema, bound state and enabled flag", async () => {
  const tx = {} as sql.Transaction;
  for (const [columns, bound, code] of [[{}, false, null], [{ Marker: 4 }, false, "QUERY_SOURCE_SCHEMA_REQUIRED"],
    [{ Marker: 4, Binding: 8 }, true, "QUERY_SOURCE_LEGACY_WRITER_DISABLED"], [{ Marker: 4, Binding: 8 }, false, null]] as const) {
    let step = 0;
    const fake = () => ({ input() { return this; }, async query(text: string) {
      assert.doesNotMatch(text, /DELETE|INSERT|UPDATE\s+uqp/i);
      return { recordset: step++ === 0 ? [{ Id: 1 }] : step === 2 ? [columns] : bound ? [{ Id: 1 }] : [] };
    } }) as unknown as sql.Request;
    if (code) await assert.rejects(assertLegacyDashboardWriter(tx, 1, fake, false), { code });
    else await assertLegacyDashboardWriter(tx, 1, fake, false);
  }
  await assert.rejects(assertLegacyDashboardWriter(tx, 1, () => { throw new Error("must not access DB"); }, true), { code: "QUERY_SOURCE_LEGACY_WRITER_DISABLED" });
});
test("Schema readiness checks trusted constraints and computed state without querying missing new columns", async () => {
  let captured = "";
  assert.equal(await querySourceSchemaReady({ async query(text: string) { captured = text; return { recordset: [{ Ready: 0 }] }; } } as sql.Request), false);
  assert.match(captured, /is_not_trusted=0/); assert.match(captured, /is_computed=1/);
  assert.doesNotMatch(captured, /SELECT \* FROM uqp/);
});
test("Mock HTTP boundary: RBAC, safe errors, disabled/missing schema and sibling-route isolation", async () => {
  const f = fixture(); let permissions = ["DESIGN_QUERY"];
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.authUser = { id: 1, username: "synthetic", displayName: "synthetic", permissions }; req.id = "synthetic-request"; next(); });
  app.use(createQuerySourceRouter(f.service)); app.get("/unrelated", (_req, res) => res.json({ ok: true }));
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = async (body?: unknown) => {
    const response = await fetch(`${base}/1/query-sources/v1`, body ? { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
  };
  try {
    permissions = [];
    assert.equal((await request()).status, 403);
    assert.equal((await fetch(`${base}/unrelated`)).status, 200);
    permissions = ["DESIGN_QUERY"]; f.control.enabled = false;
    assert.equal((await request()).status, 404);
    f.control.enabled = true; f.control.schema = false;
    assert.equal((await request(f.patch())).status, 503);
    f.control.schema = true;
    assert.equal((await request({ ...f.patch(), datasetId: 3 })).status, 400);
    f.control.auditFailure = true;
    const failed = await request(f.patch()); assert.equal(failed.status, 503);
    assert.equal(failed.body.error.requestId, "synthetic-request"); assert.equal(failed.cache, "no-store");
    assert.equal(JSON.stringify(failed.body).includes("connection-string"), false);
    f.control.auditFailure = false;
    assert.equal((await request(f.patch())).status, 200);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

for (const auditFailure of [false, true]) {
  test(`production store SQL/transaction boundary with Mock driver, audit failure=${auditFailure}`, async () => {
    const statements: string[] = [], audits: unknown[] = [];
    let committed = false, rolledBack = false;
    const transaction = { begin: async () => {}, commit: async () => { committed = true; }, rollback: async () => { rolledBack = true; } } as unknown as sql.Transaction;
    const columns = { Id: 1, QueryDefinitionId: 20, ParametersJson: "{}", UpdatedAtUtc: "2026-10-13T00:00:00Z", QuerySourceMaxRows: null,
      RefreshSeconds: 30, PageSize: 10, PageSeconds: 15, IsActive: false };
    const source = { Id: 10, SourceKey: "WARD", DatasetId: 3, QueryDefinitionId: 21, QueryBindingRevision: 1,
      MaxRows: 100, ParametersJson: "{}", RefreshSeconds: 30, PageSize: 10, PageSeconds: 15, IsEnabled: true };
    const store = createQuerySourceStore({
      getPool: async () => ({} as sql.ConnectionPool), createTransaction: () => transaction,
      createRequest: tx => {
        assert.equal(tx, transaction);
        return { input() { return this; }, async query(text: string) {
          statements.push(text);
          if (text.includes("END AS Ready")) return { recordset: [{ Ready: 1 }] };
          if (text.startsWith("SELECT * FROM uqp.Dashboard WITH")) return { recordset: [columns] };
          if (text.startsWith("SELECT * FROM uqp.DashboardDataSource")) return { recordset: [source] };
          if (text.includes("SELECT w.ConfigJson")) return { recordset: [{ ConfigJson: '{"dataSourceKey":"WARD"}' }] };
          if (text.includes("FROM uqp.QueryDefinition WHERE")) return { recordset: [{ Id: 21, DatasetId: 999, IsPublished: true, IsActive: true, IsArchived: false }] };
          return { recordset: [] };
        } } as unknown as sql.Request;
      },
      getEffectiveQueryAccess: async (_user, _query, tx) => {
        assert.equal(tx, transaction); return { canView: true, canExecute: true } as NonNullable<Awaited<ReturnType<typeof import("../queryDefinition/queryDefinition.repository.js").getEffectiveQueryAccess>>>;
      },
      getDataset: async (id, tx) => { assert.equal(id, 999); assert.equal(tx, transaction);
        return { id, isActive: true, isArchived: false, sqlText: "SELECT 1" } as NonNullable<Awaited<ReturnType<typeof import("../dataset/dataset.repository.js").getDataset>>>; },
      listDatasetParameters: async (_id, tx) => { assert.equal(tx, transaction); return []; },
      writeAuditEvent: async (input, tx) => {
        assert.equal(tx, transaction); audits.push(input);
        if (auditFailure) throw new Error("private audit SQL/bind"); return 1;
      },
    });
    const service = createQuerySourceManagement(store, () => true);
    const read = await service.read(1, 1); committed = false;
    const input: QuerySourcePatch = { expectedVersion: read.version, upserts: [{ id: 10, sourceKey: "WARD", queryDefinitionId: 21,
      parameters: { PRIVATE: "SYNTHETIC_SECRET" }, refreshSeconds: 45, pageSize: 10, pageSeconds: 15, maxRows: 100, isEnabled: true }], removals: [] };
    if (auditFailure) await assert.rejects(service.patch(1, 1, input)); else await service.patch(1, 1, input);
    assert.equal(committed, !auditFailure); assert.equal(rolledBack, auditFailure);
    const update = statements.find(s => s.startsWith("UPDATE uqp.DashboardDataSource"))!;
    assert.ok(update); assert.doesNotMatch(update.split("WHERE")[0]!, /(DatasetId|SourceKey)=/);
    assert.match(update, /WHERE Id=@id AND DashboardId=@dashboardId AND SourceKey=@sourceKey/);
    assert.equal(statements.some(s => s.startsWith("DELETE FROM uqp.DashboardDataSource")), false);
    assert.match(statements.find(s => s.includes("SELECT w.ConfigJson"))!, /UPDLOCK,HOLDLOCK/);
    assert.equal(JSON.stringify(audits).includes("SYNTHETIC_SECRET"), false);
  });
}
