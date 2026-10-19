import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../../../database/migrations/917_dashboard_query_source_model.sql", import.meta.url), "utf8");
const executable = migration.replace(/--[^\n]*/g, "");

test("917 is additive, transactional, and never maps datasets or changes legacy data", () => {
  assert.doesNotMatch(executable, /\b(UPDATE|DELETE|INSERT|MERGE|TRUNCATE|DROP|GRANT|REVOKE)\b/i);
  assert.doesNotMatch(executable, /^\s*GO\s*$/im);
  assert.match(executable, /SET XACT_ABORT ON/i);
  assert.match(executable, /BEGIN TRANSACTION[\s\S]*COMMIT TRANSACTION/i);
  assert.match(executable, /BEGIN CATCH[\s\S]*XACT_STATE\(\)[\s\S]*ROLLBACK TRANSACTION[\s\S]*THROW/i);
  assert.doesNotMatch(executable, /ALTER TABLE uqp\.(?!(DashboardDataSource|Dashboard)\b)/i);
  assert.doesNotMatch(executable, /ALTER COLUMN/i);
});

test("917 requires the old source schema and rejects partial installation", () => {
  for (const field of ["DatasetId", "SourceKey", "PageSize", "PageSeconds"])
    assert.ok(executable.includes(`COL_LENGTH(N'uqp.DashboardDataSource', N'${field}') IS NULL`));
  for (const field of ["QueryDefinitionId", "QueryBindingRevision", "MaxRows"])
    assert.ok(executable.includes(`COL_LENGTH(N'uqp.DashboardDataSource', N'${field}') IS NOT NULL`));
  assert.match(executable, /name=N'QueryBindingState'/);
  assert.match(executable, /ALREADY_OR_PARTIALLY_INSTALLED/);
});

test("917 has a nullable Query FK, derived pending state and bounded Query rows", () => {
  assert.match(executable, /QueryDefinitionId BIGINT NULL/);
  assert.match(executable, /FOREIGN KEY \(QueryDefinitionId\) REFERENCES uqp.QueryDefinition\(Id\)/);
  assert.doesNotMatch(executable, /ON DELETE CASCADE|ON UPDATE CASCADE/i);
  assert.match(executable, /WHEN QueryDefinitionId IS NULL THEN ''PENDING_CONVERSION''/);
  assert.match(executable, /ELSE ''QUERY_BOUND''/);
  assert.match(executable, /CHECK \(MaxRows IS NULL OR MaxRows BETWEEN 1 AND 10000\)/);
  assert.match(executable, /CHECK \(QueryDefinitionId IS NULL OR MaxRows IS NOT NULL\)/);
  assert.match(executable, /CHECK \(QueryBindingRevision >= 0\)/);
  assert.match(executable, /ALTER TABLE uqp.Dashboard ADD QuerySourceMaxRows INT NULL/);
  assert.match(executable, /CHECK \(QuerySourceMaxRows IS NULL OR QuerySourceMaxRows BETWEEN 1 AND 10000\)/);
});

// Isolated specification model, not production code or a T-SQL emulator.
// Demonstrates migration preservation and the future incremental-write contract.
type LegacySource = { id: number; sourceKey: string; datasetId: number; parameters: object; refreshSeconds: number };
type QuerySource = LegacySource & { queryDefinitionId: number | null; queryBindingRevision: number; maxRows: number | null };
const legacy: LegacySource[] = [
  { id: 10, sourceKey: "WARD", datasetId: 3, parameters: { ward: "SYNTHETIC" }, refreshSeconds: 30 },
  { id: 11, sourceKey: "ROOM", datasetId: 4, parameters: {}, refreshSeconds: 60 },
];
const addColumns = (sources: LegacySource[]): QuerySource[] => sources.map(source => ({ ...structuredClone(source), queryDefinitionId: null, queryBindingRevision: 0, maxRows: null }));

test("Mock additive migration preserves original IDs, DatasetIds, keys, parameters and playback settings", () => {
  const input = structuredClone(legacy);
  const output = addColumns(input);
  assert.deepEqual(input, legacy);
  assert.deepEqual(output.map(({ queryDefinitionId, queryBindingRevision, maxRows, ...old }) => old), legacy);
  assert.ok(output.every(s => s.queryDefinitionId === null && s.maxRows === null && s.queryBindingRevision === 0));
  // The mock never takes candidates or grants as input: even a unique candidate stays pending.
});

test("Mock capacity includes virtual PRIMARY and preserves oversized legacy configurations", () => {
  const project = (extras: QuerySource[]) => ({ count: extras.length + 1, canEnable: extras.length + 1 <= 8, extras });
  assert.equal(project(addColumns(Array.from({ length: 7 }, (_, id) => ({ ...legacy[0]!, id })))).canEnable, true);
  const oversized = addColumns(Array.from({ length: 8 }, (_, id) => ({ ...legacy[0]!, id })));
  const before = structuredClone(oversized);
  assert.equal(project(oversized).canEnable, false);
  assert.equal(project(oversized).count, 9);
  assert.deepEqual(oversized, before);
});

function incremental(before: QuerySource[], desired: QuerySource[], references: string[]): QuerySource[] {
  const key = (source: QuerySource) => source.sourceKey.toUpperCase();
  if (desired.length + 1 > 8) throw new Error("OVER_CAPACITY");
  if (new Set(desired.map(key)).size !== desired.length || desired.some(s => key(s) === "PRIMARY")) throw new Error("SOURCE_KEY_CONFLICT");
  const remaining = new Set(desired.map(key));
  if (before.some(s => !remaining.has(key(s)) && references.some(ref => ref.toUpperCase() === key(s)))) throw new Error("SOURCE_IN_USE");
  return desired.map(s => {
    const old = before.find(o => key(o) === key(s));
    if (!old) return structuredClone(s);
    if (old.sourceKey !== s.sourceKey) throw new Error("SOURCE_KEY_IMMUTABLE");
    return { ...structuredClone(s), id: old.id, datasetId: old.datasetId, queryBindingRevision: old.queryBindingRevision + 1 };
  });
}

test("Mock incremental update retains source identity, historical Dataset and widget binding", () => {
  const before = addColumns(legacy);
  const desired = before.map(s => ({ ...s, id: 999, datasetId: 999, queryDefinitionId: 20, maxRows: 100, refreshSeconds: 45 }));
  const after = incremental(before, desired, ["WARD", "ROOM"]);
  assert.deepEqual(after.map(s => [s.id, s.datasetId, s.sourceKey]), before.map(s => [s.id, s.datasetId, s.sourceKey]));
  assert.ok(after.every(s => s.queryBindingRevision === 1));
  assert.deepEqual(before, addColumns(legacy));
});

test("Mock rejects referenced deletion and key rename atomically; only explicit unused deletion succeeds", () => {
  const before = addColumns(legacy), saved = structuredClone(before);
  assert.throws(() => incremental(before, [before[0]!], ["ROOM"]), /SOURCE_IN_USE/);
  assert.throws(() => incremental(before, [{ ...before[0]!, sourceKey: "ward" }, before[1]!], []), /SOURCE_KEY_IMMUTABLE/);
  assert.deepEqual(before, saved);
  assert.deepEqual(incremental(before, [before[0]!], ["WARD"]).map(s => s.id), [10]);
  const added = { ...before[0]!, id: 12, sourceKey: "LAB" };
  assert.deepEqual(incremental(before, [...before, added], []).map(s => s.id), [10, 11, 12]);
});

test("Mock preserves Dashboard, widgets, device and legacy snapshot namespace without inferred Query identity", () => {
  const untouched = {
    dashboard: { id: 1, queryDefinitionId: 20, parameters: {}, pageSeconds: 15 },
    widget: { config: { dataSourceKey: "WARD" }, sourceKey: "NAME" },
    device: { id: 7, dashboardId: 1 },
    primarySnapshot: { queryId: 20, datasetId: 3 },
    supplementalSnapshot: { queryId: 10, datasetId: 3, sourceScope: "datasource:2:dashboard-source:WARD" },
  };
  const saved = structuredClone(untouched);
  const sources = addColumns(legacy);
  assert.deepEqual(untouched, saved);
  assert.equal(sources[0]!.queryDefinitionId, null);
  assert.notEqual(untouched.supplementalSnapshot.queryId, untouched.primarySnapshot.queryId);
});
