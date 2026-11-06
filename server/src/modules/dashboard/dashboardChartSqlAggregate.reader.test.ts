import test from "node:test";
import assert from "node:assert/strict";
import {
  createVersionBoundCountProofReader, type PublishedCountSqlSnapshot,
} from "./dashboardChartSqlAggregate.reader.js";
import { evaluateServerChartApproval } from "./dashboardChartApproval.policy.js";

const config = {
  version: 1, chartType: "BAR", dataSourceKey: "PRIMARY",
  categoryColumn: "ROOM", valueColumn: "TOTAL",
  valueMode: "QUERY_RESULT", maxPoints: 20, showLegend: false,
};
const reference: PublishedCountSqlSnapshot = {
  queryId: 9, datasetId: 10, queryRevision: "a".repeat(16),
  datasetRevision: "b".repeat(16), dialect: "SQLSERVER",
  sqlText: "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM dbo.OPERATIONS GROUP BY ROOM_CODE",
};
const reader = (snapshot: PublishedCountSqlSnapshot | null) => {
  let calls = 0;
  const verify = createVersionBoundCountProofReader(config, async () => {
    calls++;
    return snapshot;
  });
  return { verify, calls: () => calls };
};
const readProof = (verify: ReturnType<typeof reader>["verify"]) =>
  verify(reference.queryId, reference.datasetId, reference.queryRevision, reference.datasetRevision);

test("published SQL snapshot and both revisions must match before parser issues narrow proof", async () => {
  const fixture = reader(reference);
  const proof = await readProof(fixture.verify);
  assert(proof);
  assert.deepEqual({
    queryId: proof.queryId, datasetId: proof.datasetId,
    queryRevision: proof.queryRevision, datasetRevision: proof.datasetRevision,
    categoryColumn: proof.categoryColumn, valueColumn: proof.valueColumn,
  }, {
    queryId: 9, datasetId: 10,
    queryRevision: "a".repeat(16), datasetRevision: "b".repeat(16),
    categoryColumn: "ROOM", valueColumn: "TOTAL",
  });
  assert.match(proof.evidenceVersion, /^[a-f0-9]{64}$/);
  assert.equal(fixture.calls(), 1);
});
test("Oracle dialect uses same version-bound flow with quoted SQL", async () => {
  const oracle = reader({
    ...reference, dialect: "ORACLE",
    sqlText: 'SELECT "ROOM_CODE" AS "ROOM", COUNT(*) AS "TOTAL" FROM "HOSP"."OPERATIONS" GROUP BY "ROOM_CODE"',
  });
  const proof = await readProof(oracle.verify);
  assert(proof);
  assert.equal(proof.valueColumn, "TOTAL");
});
test("unpublished or missing source snapshot cannot be treated as valid", async () => {
  const f = reader(null);
  assert.equal(await readProof(f.verify), null);
  assert.equal(f.calls(), 1);
});
test("crossed Query/Dataset identity and stale/ABA revision are rejected", async () => {
  for (const delta of [
    { queryId: 8 }, { datasetId: 88 },
    { queryRevision: "c".repeat(16) },
    { datasetRevision: "c".repeat(16) },
    { dialect: "MYSQL" as "SQLSERVER" },
  ]) {
    const f = reader({ ...reference, ...delta });
    assert.equal(await readProof(f.verify), null);
  }
});
test("SQL text must itself satisfy closed grouped-count semantics", async () => {
  for (const sqlText of [
    "SELECT ROOM_CODE AS ROOM, PATIENT_ID AS TOTAL FROM OPS",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM OPS JOIN PAT ON 1=1 GROUP BY ROOM_CODE",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM OPS GROUP BY ROOM_CODE UNION SELECT 'ALL', 9",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM OPS WHERE PATIENT_ID=1 GROUP BY ROOM_CODE",
    "SELECT PATIENT_ID AS ROOM, COUNT(*) AS TOTAL FROM OPS GROUP BY PATIENT_ID",
  ]) {
    const f = reader({ ...reference, sqlText });
    // A patient identifier can be syntactically grouped. This syntax test is
    // not a patient privacy decision; the Dataset/public display policy must
    // separately reject such a sensitive grouping before playback.
    const result = await readProof(f.verify);
    if (sqlText.includes("PATIENT_ID AS ROOM")) assert(result);
    else assert.equal(result, null, sqlText);
  }
});
test("invalid chart config or malformed revisions avoid even calling read-only SQL", async () => {
  let calls = 0;
  const get = async () => { calls++; return reference; };
  const invalid = createVersionBoundCountProofReader({
    ...config, valueMode: "SUM_IN_BROWSER",
  }, get);
  assert.equal(await readProof(invalid), null);
  const normal = createVersionBoundCountProofReader(config, get);
  assert.equal(await normal(9, 10, "bad", reference.datasetRevision), null);
  assert.equal(await normal(9, 10, reference.queryRevision, "bad"), null);
  assert.equal(await normal(0, 10, reference.queryRevision, reference.datasetRevision), null);
  assert.equal(calls, 0);
});
test("repository failure or invalid SQL does not reveal errors or proof", async () => {
  const failed = createVersionBoundCountProofReader(config, async () => { throw new Error("sensitive SQL connection details"); });
  assert.equal(await readProof(failed), null);
});
test("new version or altered SQL invalidates a previously issued proof version", async () => {
  const old = (await readProof(reader(reference).verify))!;
  const newer = { ...reference, queryRevision: "d".repeat(16) };
  const proof = (await createVersionBoundCountProofReader(config, async () => newer)(
    newer.queryId, newer.datasetId, newer.queryRevision, newer.datasetRevision))!;
  assert.notEqual(proof.evidenceVersion, old.evidenceVersion);
  const other = { ...reference, sqlText: "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM dbo.NEW_OPERATIONS GROUP BY ROOM_CODE" };
  const changed = (await readProof(reader(other).verify))!;
  assert.notEqual(changed.evidenceVersion, old.evidenceVersion);
});
