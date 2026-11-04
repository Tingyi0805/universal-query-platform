import test from "node:test";
import assert from "node:assert/strict";
import { proveSimpleGroupedCount, type GroupedCountProofInput } from "./dashboardChartSqlAggregate.proof.js";

const sqlServer: GroupedCountProofInput = {
  dialect: "SQLSERVER",
  sqlText: "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM dbo.OPERATIONS GROUP BY ROOM_CODE;",
  queryId: 10, datasetId: 11, queryRevision: "a".repeat(16),
  datasetRevision: "b".repeat(16), categoryColumn: "ROOM", valueColumn: "TOTAL",
};
const oracle: GroupedCountProofInput = {
  ...sqlServer, dialect: "ORACLE",
  sqlText: 'SELECT "ROOM_CODE" AS "ROOM", COUNT(*) AS "TOTAL" FROM "HOSP"."OPERATIONS" GROUP BY "ROOM_CODE"',
};

test("SQL Server direct grouped COUNT(*) yields revision-scoped narrow evidence", () => {
  const proven = proveSimpleGroupedCount(sqlServer);
  assert(proven);
  assert.equal(proven.verified, true);
  assert.equal(proven.categoryColumn, "ROOM");
  assert.equal(proven.valueColumn, "TOTAL");
  assert.match(proven.evidenceVersion, /^[a-f0-9]{64}$/);
  assert.deepEqual(proveSimpleGroupedCount(sqlServer), proven);
});
test("Oracle quoted and unquoted identifiers normalize only according to dialect", () => {
  const quoted = proveSimpleGroupedCount(oracle);
  assert(quoted);
  const unquoted = proveSimpleGroupedCount({
    ...oracle, sqlText: "select room_code as room, count(*) as total from hosp.operations group by room_code",
  });
  assert(unquoted);
  assert.equal(unquoted.categoryColumn, "ROOM");
  assert.equal(unquoted.valueColumn, "TOTAL");
  assert.notEqual(quoted.evidenceVersion, unquoted.evidenceVersion);
  assert.equal(proveSimpleGroupedCount({ ...oracle, categoryColumn: "room" }), null);
});
test("SQL Server bracket-quoted identifiers are supported; Oracle rejects square brackets", () => {
  const query = "SELECT [ROOM_CODE] AS [ROOM], COUNT(*) AS [TOTAL] FROM [dbo].[OPERATIONS] GROUP BY [ROOM_CODE]";
  assert(proveSimpleGroupedCount({ ...sqlServer, sqlText: query }));
  assert.equal(proveSimpleGroupedCount({ ...oracle, sqlText: query }), null);
  assert.equal(proveSimpleGroupedCount({
    ...sqlServer,
    sqlText: 'SELECT "ROOM_CODE" AS "ROOM", COUNT(*) AS "TOTAL" FROM "HOSP"."OPERATIONS" GROUP BY "ROOM_CODE"',
  }), null);
});
test("GROUP BY mention is not enough: full grammar must parse and consume", () => {
  for (const sqlText of [
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM dbo.OPERATIONS GROUP BY ROOM_CODE HAVING COUNT(*) > 1",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM dbo.OPERATIONS WHERE ACTIVE = 1 GROUP BY ROOM_CODE",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM dbo.OPERATIONS GROUP BY ROOM_CODE ORDER BY ROOM_CODE",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM dbo.OPERATIONS JOIN PATIENT ON PATIENT.ID = OPERATIONS.ID GROUP BY ROOM_CODE",
    "WITH x AS (SELECT ROOM_CODE FROM OPS) SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM x GROUP BY ROOM_CODE",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM (SELECT * FROM OPS) X GROUP BY ROOM_CODE",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM dbo.OPERATIONS GROUP BY ROOM_CODE UNION SELECT 1, 2",
    "SELECT DISTINCT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM OPS GROUP BY ROOM_CODE",
    "SELECT TOP 100 ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM OPS GROUP BY ROOM_CODE",
    "SELECT ROOM_CODE AS ROOM, SUM(VALUE) AS TOTAL FROM OPS GROUP BY ROOM_CODE",
    "SELECT ROOM_CODE AS ROOM, COUNT(DISTINCT PATIENT_ID) AS TOTAL FROM OPS GROUP BY ROOM_CODE",
    "SELECT ROOM_CODE AS ROOM, COUNT(ROOM_CODE) AS TOTAL FROM OPS GROUP BY ROOM_CODE",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL, MAX(ID) AS BIGGEST FROM OPS GROUP BY ROOM_CODE",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM OPS GROUP BY ROOM_CODE, PATIENT_ID",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM OPS GROUP BY PATIENT_ID",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM OPS WHERE 1 = 1 GROUP BY ROOM_CODE",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM OPS GROUP BY ROOM_CODE; DROP TABLE OPS",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM OPS GROUP BY ROOM_CODE -- comment",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM OPS GROUP BY ROOM_CODE /* comment */",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM OPS GROUP BY ROOM_CODE; SELECT 1",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM OPS GROUP BY ROOM_CODE;",
  ]) {
    if (sqlText.endsWith("GROUP BY ROOM_CODE;") && sqlText.startsWith("SELECT ROOM_CODE")) continue;
    assert.equal(proveSimpleGroupedCount({ ...sqlServer, sqlText }), null, sqlText);
  }
});
test("untrusted syntax, quotes, binds and expressions fail closed", () => {
  for (const sqlText of [
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM OPS GROUP BY LOWER(ROOM_CODE)",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM OPS GROUP BY ROOM_CODE || PATIENT",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM OPS GROUP BY ROOM_CODE{{EXTRA}}",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM OPS GROUP BY ROOM_CODE @FLAG",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM OPS GROUP BY ROOM_CODE = 'ROOM_CODE'",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM OPS GROUP BY ROOM_CODE \n GO",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM OPS GROUP BY ROOM_CODE\u0000",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM OPS GROUP BY ROOM_CODE/2",
    "SELECT 'PATIENT' AS ROOM, COUNT(*) AS TOTAL FROM OPS GROUP BY ROOM_CODE",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS ROOM FROM OPS GROUP BY ROOM_CODE",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM OPS GROUP BY room_codeX",
    "SELECT ROOM_CODE AS ROOM, COUNT(*) AS TOTAL FROM OPS GROUP BY ROOM_CODE;--",
  ]) assert.equal(proveSimpleGroupedCount({ ...sqlServer, sqlText }), null, sqlText);
});
test("identity, dialect, version and selected aliases must match source evidence", () => {
  const base = proveSimpleGroupedCount(sqlServer)!;
  assert.notEqual(base.evidenceVersion, proveSimpleGroupedCount({ ...sqlServer, queryRevision: "c".repeat(16) })!.evidenceVersion);
  assert.notEqual(base.evidenceVersion, proveSimpleGroupedCount({ ...sqlServer, datasetRevision: "c".repeat(16) })!.evidenceVersion);
  assert.notEqual(base.evidenceVersion, proveSimpleGroupedCount({ ...sqlServer, sqlText: sqlServer.sqlText.replace("dbo.OPERATIONS", "dbo.OPERATIONS2") })!.evidenceVersion);
  for (const changes of [
    { queryId: 0 }, { datasetId: -1 }, { queryRevision: "bad" },
    { datasetRevision: "" }, { categoryColumn: "PATIENT" },
    { valueColumn: "WRONG" }, { dialect: "MYSQL" as "SQLSERVER" },
    { sqlText: sqlServer.sqlText + " ".repeat(3000) },
  ]) assert.equal(proveSimpleGroupedCount({ ...sqlServer, ...changes }), null);
});
