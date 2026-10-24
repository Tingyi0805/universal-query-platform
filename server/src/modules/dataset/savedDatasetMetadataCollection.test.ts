import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import sql from "mssql";
import { SqlServerAdapter } from "../datasource/adapters/sqlServerAdapter.js";
import type { DataSourceConfig } from "../datasource/datasource.types.js";
import { syntheticParameter } from "./parameterTestFixture.js";
import { createSavedDatasetMetadataCollection, type MetadataFixtureAuthorization,
  type SavedMetadataCollectionPorts, type SavedMetadataFixtureSnapshot } from "./savedDatasetMetadataCollection.js";

const datasetId = "9007199254740993", dataSourceId = "9007199254740995", actorId = "9007199254740997";
const rv = "0000000000000001", sourceRv = "0000000000000002";
const command = { scope: "SYNTHETIC_TEST_ONLY", datasetId, actorId,
  requestId: "11111111-1111-4111-8111-111111111111", expectedDefinitionRowVersion: rv, expectedConfigurationRowVersion: sourceRv };
function fixture(t: TestContext) {
  const reference = { identity: "22222222-2222-4222-8222-222222222222", schemaGeneration: rv,
    leaseId: "33333333-3333-4333-8333-333333333333", leaseVersion: rv };
  const state = {
    snapshot: { scope: "SYNTHETIC_TEST_ONLY", datasetId, dataSourceId, definitionRowVersion: rv, configurationRowVersion: sourceRv,
      datasetActive: true, datasetArchived: false, sourceActive: true, sourceType: "SQLSERVER", engineMajor: 15,
      sql: "SELECT 1 AS OPAQUE_7", parameters: [], source: reference, baseContract: { state: "MISSING" } } as SavedMetadataFixtureSnapshot,
    authorization: { scope: "SYNTHETIC_TEST_ONLY", datasetId, dataSourceId, actorId, active: true, designQuery: true, executeQuery: true,
      scopeAllowed: true, tokenVersion: "1", authorizationEpoch: rv, scopeRowVersion: rv } as MetadataFixtureAuthorization,
    source: { provenance: "SYNTHETIC_TEST_ONLY" as const, ...reference, lease: { state: "SYNTHETIC_VALIDATED" as const, ...reference,
      validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2026-01-01T01:00:00.000Z" } },
    now: "2026-01-01T00:01:00.000Z", rows: [{ name: "OPAQUE_7", system_type_name: "int", column_ordinal: 1, is_hidden: false }] as any[],
    receipt: { auditId: "9007199254740999" } as unknown, events: [] as Readonly<Record<string, unknown>>[],
    calls: [] as string[], afterDescribe: () => {}, afterAudit: () => {}, rpcFailure: false,
  };
  const binds = new Map<string, unknown>();
  const request = {
    input(name: string, _type: unknown, value: unknown) { binds.set(name, value); return this; },
    async execute(procedure: string) {
      assert.equal(procedure, "sys.sp_describe_first_result_set"); state.calls.push("describe-rpc");
      assert.equal(binds.get("tsql"), state.snapshot.sql); assert.equal(binds.get("params"), null);
      if (state.rpcFailure) throw new Error("SELECT private; password=synthetic-private");
      state.afterDescribe(); return { recordset: structuredClone(state.rows) };
    },
    async query() { assert.fail("data queries are forbidden"); },
  };
  t.mock.method(sql, "ConnectionPool", function (config: any) {
    assert.equal(config.options.encrypt, true); assert.equal(config.options.trustServerCertificate, false);
    return { async connect() { state.calls.push("connect"); }, request: () => request,
      async close() { state.calls.push("close"); } };
  } as any);
  const adapter = new SqlServerAdapter();
  const ports: SavedMetadataCollectionPorts = {
    readSaved: async id => { assert.equal(id, datasetId); state.calls.push("snapshot"); return structuredClone(state.snapshot); },
    authorize: async (actor, id) => { assert.equal(actor, actorId); assert.equal(id, datasetId); return structuredClone(state.authorization); },
    source: { observe: async (id, lease) => {
      assert.equal(id, dataSourceId); assert.equal(lease, reference.leaseId); return structuredClone(state.source);
    } },
    describe: async (id, input) => { assert.equal(id, dataSourceId);
      return adapter.describeQuery({ connectionTimeoutSec: 10, queryTimeoutSec: 10,
        encryptConnection: true, trustServerCertificate: false } as DataSourceConfig, input); },
    recordAttempt: async event => { state.calls.push("attempt-audit"); state.events.push(event); state.afterAudit(); return state.receipt; },
    now: () => state.now,
  };
  return { state, ports, collect: createSavedDatasetMetadataCollection(ports) };
}
test("saved parameter-free SQL uses describe RPC only; versions/IDs remain exact and candidate never gains authority", async t => {
  const f = fixture(t); const result = await f.collect(command);
  assert.equal(result.binding.datasetId, datasetId); assert.equal(result.binding.dataSourceId, dataSourceId);
  assert.equal(result.binding.definitionRowVersion, rv); assert.equal(result.binding.configurationRowVersion, sourceRv);
  assert.equal(result.binding.parameterExpansion, "PARAMETER_FREE_DESCRIPTION_ONLY_V1");
  assert.equal(result.candidate.trust, "UNBOUND_CANDIDATE"); assert.equal(result.candidate.requiresExecutionComparison, true);
  assert.equal(result.metadataState, "NOT_INITIALIZED"); assert.equal(result.classificationState, "UNCONFIRMED");
  assert.equal(result.authority, "NONE"); assert.equal(result.deliveryAllowed, false); assert.equal(result.runtimeBindVerified, false);
  assert.equal(result.persistence, "NOT_PROVEN"); assert.equal(result.productionSafetyProven, false);
  assert.ok(result.blockers.includes("TRUSTED_SOURCE_PROVIDER_MISSING")); assert.equal(result.auditId, "9007199254740999");
  assert.equal(f.state.calls.filter(c => c === "describe-rpc").length, 1);
  assert.ok(f.state.calls.indexOf("close") < f.state.calls.indexOf("attempt-audit"));
  assert.ok(!JSON.stringify(result).includes("SELECT")); assert.ok(!JSON.stringify(f.state.events).includes("SELECT"));
  assert.deepEqual(Object.keys(result.candidate).sort(), ["columns", "evidenceType", "requiresExecutionComparison", "trust"]);
});
for (const field of ["definitionRowVersion", "configurationRowVersion"] as const) test(`${field} CAS expectation rejects stale saved snapshot before RPC`, async t => {
  const f = fixture(t); f.state.snapshot[field] = "0000000000000003";
  await assert.rejects(f.collect(command), { code: "METADATA_COLLECTION_CONFLICT" }); assert.ok(!f.state.calls.includes("connect"));
});
for (const phase of ["afterDescribe", "afterAudit"] as const) for (const drift of ["sql", "definition", "source", "parameters", "token", "epoch", "scope", "schema", "lease"] as const) {
  test(`${drift} drift ${phase} rejects result without producing metadata proof`, async t => {
    const f = fixture(t);
    f.state[phase] = () => {
      if (drift === "sql") f.state.snapshot.sql += " ";
      if (drift === "definition") f.state.snapshot.definitionRowVersion = "0000000000000003";
      if (drift === "source") f.state.snapshot.configurationRowVersion = "0000000000000003";
      if (drift === "parameters") f.state.snapshot.parameters = [{ ...syntheticParameter, id: "1", datasetId, lookupDatasetId: null }];
      if (drift === "token") f.state.authorization.tokenVersion = "2";
      if (drift === "epoch") f.state.authorization.authorizationEpoch = "0000000000000003";
      if (drift === "scope") f.state.authorization.scopeRowVersion = "0000000000000003";
      if (drift === "schema") f.state.source.schemaGeneration = "0000000000000003";
      if (drift === "lease") f.state.now = f.state.source.lease.validUntil;
    };
    await assert.rejects(f.collect(command));
  });
}
for (const kind of ["SCALAR", "FIXED_LIST", "MISSING_DEFINITION"] as const) test(`unproven ${kind} binding is rejected before source RPC`, async t => {
  const f = fixture(t); f.state.snapshot.sql = "SELECT {{P}} AS OPAQUE_7";
  if (kind !== "MISSING_DEFINITION") f.state.snapshot.parameters = [{ ...syntheticParameter,
    id: "9007199254740999", datasetId, name: "P", lookupDatasetId: null, controlType: kind === "FIXED_LIST" ? "MULTISELECT" : "TEXT" }];
  await assert.rejects(f.collect(command)); assert.ok(!f.state.calls.includes("connect")); assert.deepEqual(f.state.events, []);
});
for (const invalid of ["duplicate", "order", "empty", "type", "hidden", "name-control"] as const) test(`invalid column ${invalid} is rejected without initialization`, async t => {
  const f = fixture(t);
  if (invalid === "duplicate") f.state.rows.push({ ...f.state.rows[0], name: "opaque_7", column_ordinal: 2 });
  if (invalid === "order") f.state.rows[0].column_ordinal = 2;
  if (invalid === "empty") f.state.rows = [];
  if (invalid === "type") f.state.rows[0].system_type_name = "dbo.UnknownType";
  if (invalid === "hidden") f.state.rows[0].is_hidden = true;
  if (invalid === "name-control") f.state.rows[0].name = "X\nY";
  await assert.rejects(f.collect(command)); assert.deepEqual(f.state.events, []); assert.ok(f.state.calls.includes("close"));
});
for (const type of ["int", "bigint", "bit", "date", "datetime2(7)", "nvarchar(4000)", "varchar(max)", "decimal(38, 8)"])
  test(`supported column type ${type} remains a candidate`, async t => {
    const f = fixture(t); f.state.rows[0].system_type_name = type;
    const result = await f.collect(command); assert.equal(result.candidate.columns[0]?.dataType, type); assert.equal(result.deliveryAllowed, false);
  });
for (const receipt of [{ auditId: 9007199254740992 }, { auditId: "01" }, { auditId: "9223372036854775808" }, { auditId: "9", success: true }, null])
  test("unsafe or unknown audit receipt cannot prove collection completion", async t => {
    const f = fixture(t); f.state.receipt = receipt; await assert.rejects(f.collect(command), { code: "METADATA_COLLECTION_INVALID" });
  });
test("RPC and audit failures escape as data-free codes only", async t => {
  const f = fixture(t); f.state.rpcFailure = true;
  await assert.rejects(f.collect(command), error => { assert.equal(JSON.stringify(error).includes("SELECT"), false);
    assert.equal(String(error).includes("synthetic-private"), false); return true; });
  f.state.rpcFailure = false; f.ports.recordAttempt = async () => { throw new Error("patient private SQL"); };
  await assert.rejects(f.collect(command), { code: "METADATA_COLLECTION_FAILED" });
});
test("getters/Proxy hooks, unknown command fields, frontend CONFIRMED and Number IDs are rejected", async t => {
  const f = fixture(t); let invoked = 0;
  const getter = Object.defineProperty({}, "scope", { enumerable: true, get() { invoked++; return "SYNTHETIC_TEST_ONLY"; } });
  const proxy = new Proxy({}, { ownKeys() { invoked++; return []; }, getPrototypeOf() { invoked++; return null; } });
  for (const bad of [getter, proxy, { ...command, confirmed: true }, { ...command, datasetId: Number(datasetId) }, { ...command, scope: "PRODUCTION" }])
    await assert.rejects(f.collect(bad));
  assert.equal(invoked, 0); assert.deepEqual(f.state.calls, []);
});
test("missing lease, inactive scope, Oracle and unknown engine capability fail before description", async t => {
  const f = fixture(t);
  for (const mutate of [() => { (f.state.source as any).lease = null; }, () => { (f.state.authorization as any).scopeAllowed = false; },
    () => { (f.state.snapshot as any).sourceType = "ORACLE"; }, () => { (f.state.snapshot as any).engineMajor = 14; }]) {
    const before = structuredClone({ snapshot: f.state.snapshot, source: f.state.source, authorization: f.state.authorization });
    mutate(); await assert.rejects(f.collect(command)); Object.assign(f.state, before);
  }
  assert.ok(!f.state.calls.includes("connect"));
});

for (const statement of ["DELETE FROM Synthetic", "SELECT {{P}} AS X", "SELECT 1 -- ignored", "SELECT @P AS X"])
  test("unsupported SQL/binds are rejected explicitly before RPC", async t => {
    const f = fixture(t); f.state.snapshot.sql = statement;
    await assert.rejects(f.collect(command), { code: "METADATA_COLLECTION_SQL_UNSUPPORTED" });
    assert.ok(!f.state.calls.includes("connect"));
  });
test("unexpected row-bearing or frontend-confirmed adapter payload cannot become metadata", async t => {
  const f = fixture(t);
  for (const extra of [{ rows: [{ private: "synthetic" }] }, { trust: "CONFIRMED" }]) {
    f.ports.describe = async () => ({ trust: "UNBOUND_CANDIDATE", requiresExecutionComparison: true,
      evidenceType: "SQLSERVER_DESCRIBE_FIRST_RESULT_SET", columns: [{ name: "OPAQUE_7", dataType: "int", ordinal: 1 }], ...extra } as never);
    await assert.rejects(f.collect(command), { code: "METADATA_COLLECTION_INVALID" });
  }
  assert.deepEqual(f.state.events, []);
});
test("A to B to A content with a new revision cannot revive a prior collection request", async t => {
  const f = fixture(t); await f.collect(command);
  f.state.snapshot.sql = "SELECT 2 AS OPAQUE_7"; f.state.snapshot.definitionRowVersion = "0000000000000003";
  f.state.snapshot.sql = "SELECT 1 AS OPAQUE_7"; f.state.snapshot.definitionRowVersion = "0000000000000004";
  await assert.rejects(f.collect(command), { code: "METADATA_COLLECTION_CONFLICT" });
});
