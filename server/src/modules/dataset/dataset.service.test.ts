import assert from "node:assert/strict";
import test from "node:test";
import { createDatasetService, type DatasetServiceDependencies } from "./dataset.service.js";
import type { DatasetParameterRecord } from "./parameter.repository.js";
import { runtimeParameterDefinitions } from "./parameterSync.js";
import { syntheticParameter } from "./parameterTestFixture.js";
import type { DatasetRecord } from "./dataset.types.js";
import type { DataSourceConfig } from "../datasource/datasource.types.js";
import type { ExecuteQueryInput } from "../datasource/adapters/datasourceAdapter.js";
import { safeErrorDiagnostic } from "../../middleware/safeErrorDiagnostic.js";
function fixture() {
  const state = { sqlText: "SELECT {{WARD}} AS SYNTHETIC", archived: false, active: true, loads: 0, queries: [] as ExecuteQueryInput[],
    definitions: [{ ...syntheticParameter, dataType: "NUMBER" as const, controlType: "NUMBER" as const, defaultValue: "7" }] as DatasetParameterRecord[], failure: null as Error | null,
    stage: "query" };
  const deps: DatasetServiceDependencies = {
    getDataset: async () => ({ id: 2, dataSourceId: 4, sqlText: state.sqlText, isArchived: state.archived, isActive: state.active, maxRows: 500, queryTimeoutSec: 10 } as DatasetRecord),
    listDatasetParameters: async () => { state.loads++; if (state.failure && state.stage === "parameters") throw state.failure; return structuredClone(state.definitions); },
    getDataSourceConfig: async () => ({ type: "SQLSERVER", isActive: true, queryTimeoutSec: 30 } as DataSourceConfig),
    createAdapter: async () => ({ testConnection: async () => ({ ok: true, message: "synthetic" }), executeQuery: async (_config, input) => {
      state.queries.push(input); if (state.failure) throw state.failure;
      return { columns: [{ name: "SYNTHETIC" }], rows: [{ SYNTHETIC: 7 }], rowCount: 1, truncated: false, elapsedMs: 1 };
    } }),
  };
  return { state, deps, service: createDatasetService(deps) };
}
test("saved patient query loads/coerces parameters once and binds typed values", async () => {
  const f = fixture(); const result = await f.service.executeSavedDataset(2, { WARD: "42" }, 25);
  assert.equal(f.state.loads, 1); assert.deepEqual(f.state.queries[0]!.binds, { WARD: 42 });
  assert.equal(f.state.queries[0]!.maxRows, 25); assert.equal(f.state.queries[0]!.timeoutSec, 10);
  assert.equal(result.rowCount, 1);
});
test("retained unused settings do not block query or require obsolete values", async () => {
  const f = fixture(); f.state.definitions.push({ ...f.state.definitions[0]!, name: "OLD", defaultValue: null });
  await f.service.executeSavedDataset(2, {});
  assert.deepEqual(f.state.queries[0]!.binds, { WARD: 7 });
});
test("missing definitions, invalid input and malformed SQL stop before driver execution", async () => {
  for (const mode of ["missing", "invalid", "malformed", "required"]) {
    const f = fixture();
    if (mode === "missing") f.state.definitions = [];
    if (mode === "malformed") f.state.sqlText = "SELECT {{bad}}";
    if (mode === "required") f.state.definitions[0]!.defaultValue = null;
    await assert.rejects(f.service.executeSavedDataset(2, mode === "invalid" ? { WARD: "invalid" } : {}), /PARAMETER_/);
    assert.equal(f.state.queries.length, 0);
  }
});
test("archived/disabled saved dataset remains blocked", async () => {
  for (const property of ["archived", "active"] as const) {
    const f = fixture(); f.state[property] = property === "archived";
    await assert.rejects(f.service.executeSavedDataset(2, {}), /DATASET_(ARCHIVED|DISABLED)/);
    assert.equal(f.state.loads, 0); assert.equal(f.state.queries.length, 0);
  }
});
test("parameter loading and patient SQL execution failures retain distinct safe diagnostic modules", async () => {
  for (const stage of ["parameters", "query"]) {
    const f = fixture(); f.state.stage = stage;
    const failure = Object.assign(new Error("synthetic patient SQL bind password Token"), { code: "EREQUEST", number: stage === "parameters" ? 229 : 208 });
    f.state.failure = failure;
    await assert.rejects(f.service.executeSavedDataset(2, {}), e => e === failure);
    assert.deepEqual(safeErrorDiagnostic(failure), { module: stage === "parameters" ? "dataset.parameters.load" : "dataset.query.execute",
      errorType: "DATABASE", driverCode: "EREQUEST", sqlServerNumber: stage === "parameters" ? 229 : 208 });
  }
});
test("DATE/boolean/multiselect patient parameters are passed once with configured defaults", async () => {
  const f = fixture();
  f.state.definitions = [ { ...syntheticParameter, dateOutputMode: "NATIVE", defaultValue: "2026-01-02" },
    { ...syntheticParameter, name: "FLAG", dataType: "BOOLEAN", controlType: "CHECKBOX", defaultValue: "false" },
    { ...syntheticParameter, name: "IDS", dataType: "NUMBER", controlType: "MULTISELECT", defaultValue: null } ];
  f.state.sqlText = "SELECT {{WARD}}, {{FLAG}} WHERE 1 IN ({{IDS}})";
  await f.service.executeSavedDataset(2, { IDS: [1, "2"] });
  const binds = f.state.queries[0]!.binds;
  assert.ok(binds.WARD instanceof Date); assert.equal(binds.FLAG, false); assert.equal(binds.IDS_1, 2);
  assert.equal(f.state.loads, 1);
});

test("designer preview applies saved defaults/types while preserving unused settings", async () => {
  const f = fixture();
  f.state.definitions.push({ ...syntheticParameter, name: "OLD", isRequired: true });
  await f.service.previewDataset({ datasetId: 2, dataSourceId: 4, sqlText: f.state.sqlText, values: {}, maxRows: 10 });
  assert.deepEqual(f.state.queries[0]!.binds, { WARD: 7 });
});

test("patient query input metadata excludes unused lookup/required settings and rejects missing definitions", () => {
  const unused = { ...syntheticParameter, name: "OLD", isRequired: true, optionMode: "DATASET" as const, lookupDatasetId: 99 };
  assert.deepEqual(runtimeParameterDefinitions("SELECT {{WARD}}", [syntheticParameter, unused]), [syntheticParameter]);
  assert.deepEqual(runtimeParameterDefinitions("SELECT 1", [unused]), []);
  assert.throws(() => runtimeParameterDefinitions("SELECT {{NEW}}", [syntheticParameter]), /PARAMETER_DEFINITION_MISMATCH/);
});

test("active patient option lookup ignores retained obsolete required settings but blocks active required inputs", async () => {
  for (const active of [false, true]) {
    const f = fixture();
    const parent = { ...syntheticParameter, optionMode: "DATASET" as const, lookupDatasetId: 9, lookupValueField: "SYNTHETIC", lookupLabelField: "SYNTHETIC" };
    f.deps.listDatasetParameters = async id => id === 2 ? [parent] : [{ ...syntheticParameter, name: "OLD", defaultValue: null }];
    f.deps.getDataset = async id => ({ id, dataSourceId: 4, sqlText: active ? "SELECT {{OLD}}" : "SELECT 7 AS SYNTHETIC", isActive: true, isArchived: false, maxRows: 500 } as DatasetRecord);
    if (active) {
      await assert.rejects(f.service.getParameterOptions(2, "WARD"), /PARAMETER_LOOKUP_REQUIRES_INPUT/);
      assert.equal(f.state.queries.length, 0);
    } else {
      assert.deepEqual(await f.service.getParameterOptions(2, "WARD"), [{ value: 7, label: "7" }]);
    }
  }
});
