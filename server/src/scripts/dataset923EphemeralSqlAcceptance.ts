/**
 * Synthetic SQL Server 2019 DDL/Catalog rehearsal in a disposable GitHub Actions
 * container only. No production secrets, platform DB connections or grants.
 * Passing this script is NOT F1-F6 production acceptance or delivery permission.
 */
import assert from "node:assert/strict";
import sql from "mssql";
import { render923CatalogSql, render923Draft } from "../modules/dataset/datasetMetadata923Catalog.js";
import { SqlServerAdapter } from "../modules/datasource/adapters/sqlServerAdapter.js";
import type { DataSourceConfig } from "../modules/datasource/datasource.types.js";
import { test923ScopeCasInDisposableSqlServer } from "./dataset923EphemeralCas.js";
import { test923SyntheticDecisionAuditAtomicity } from "./dataset923EphemeralDecisionAudit.js";
import { test923ManualInstallerOnSyntheticSqlServer } from "./dataset923EphemeralInstallAcceptance.js";
import { test923ExactAuditReceiptOnDisposableSql2019 } from "./dataset923EphemeralRealAudit.js";
import { test923RealAuditScopeDecisionOnDisposableSql2019 } from "./dataset923EphemeralRealAuditDecision.js";

const dbName = "UQP923_CI_SYNTHETIC";
const expectedMachine = "uqp-923-ephemeral";
let stage = "BOOT";

function assertIsolatedRuntime() {
  if (process.env.GITHUB_ACTIONS !== "true"
    || process.env.UQP_923_CI_EPHEMERAL !== "1"
    || process.env.UQP_923_CI_HOST !== "127.0.0.1"
    || process.env.UQP_923_CI_PORT !== "14333"
    || !process.env.UQP_923_CI_PASSWORD
    || Object.keys(process.env).some(name => name.startsWith("PLATFORM_DB_"))) {
    throw new Error("UQP_923_CI_ISOLATION_NOT_ATTESTED");
  }
}

async function connect(database: string) {
  return new sql.ConnectionPool({
    server: "127.0.0.1", port: 14333, database, user: "sa",
    password: process.env.UQP_923_CI_PASSWORD!,
    options: { encrypt: true, trustServerCertificate: true },
    pool: { min: 0, max: 2 }, connectionTimeout: 2000, requestTimeout: 30000,
  }).connect();
}

async function startup() {
  for (let attempt = 0; attempt < 45; attempt++) {
    try { return await connect("master"); } catch {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  throw new Error("UQP_923_CI_CONTAINER_NOT_AVAILABLE");
}

async function assertSyntheticServer(pool: sql.ConnectionPool) {
  const r = await pool.request().query(`
    SELECT CONVERT(nvarchar(128),SERVERPROPERTY(N'MachineName')) AS Machine,
      TRY_CONVERT(int,SERVERPROPERTY(N'ProductMajorVersion')) AS Major,
      DB_NAME() AS DbName, ORIGINAL_LOGIN() AS LoginName,
      DB_ID(N'${dbName}') AS ExistingSyntheticDatabase
  `);
  const v = r.recordset[0];
  assert.equal(v?.Machine, expectedMachine, "Unexpected SQL Server machine; no writes allowed");
  assert.equal(v?.Major, 15, "SQL Server 2019 (engine 15) required");
  assert.equal(v?.DbName, "master");
  assert.equal(v?.LoginName, "sa");
  assert.equal(v?.ExistingSyntheticDatabase, null, "Cannot modify an existing database");
}

async function status(pool: sql.ConnectionPool) {
  const r = await pool.request().query(render923CatalogSql());
  assert.equal(r.recordset.length, 1);
  const item = r.recordset[0];
  assert.equal(item?.authority, "NONE");
  assert.equal(item?.runtimeBindVerified, false);
  assert.equal(item?.deliveryAllowed, false);
  assert.equal(item?.productionSafetyProven, false);
  return { state: String(item.CatalogStatus),
    missing: String(item.MissingDefinitionCount),
    unexpected: String(item.UnexpectedDefinitionCount) };
}

async function summarizeSyntheticCatalogDrift(pool: sql.ConnectionPool) {
  // Reuse the same CTE, but project mismatches only for this disposable CI instance.
  // No application rows or credentials are accessed by the sys.catalog query.
  const original = render923CatalogSql();
  const marker = "\nSELECT CASE WHEN v.ok<>1";
  const offset = original.lastIndexOf(marker);
  assert.ok(offset > 0, "Reviewed catalog query final projection changed");
  const diagnose = original.slice(0, offset) + `
    SELECT N'MISSING' AS Side, category, owner, name, signature FROM Missing
    UNION ALL
    SELECT N'UNEXPECTED' AS Side, category, owner, name, signature FROM Unexpected;
  `;
  const result = await pool.request().query(diagnose);
  const rows = result.recordset.map(row => ({
    side: row.Side, category: row.category, owner: row.owner, name: row.name,
    signature: String(row.signature).slice(0, 900),
  }));
  const liveChecks = result.recordset
    .filter(row => row.Side === "UNEXPECTED" && row.category === "CHECK")
    .map(row => ({ owner: String(row.owner), name: String(row.name), signature: String(row.signature) }))
    .sort((x, y) => (x.owner + "/" + x.name).localeCompare(y.owner + "/" + y.name));
  // The container is disposable; the record contains ONLY check-constraint definitions
  // from the synthetic schema created by this CI run. Capture once for review.
  if (liveChecks.length === 24) {
    console.error("UQP923_REAL_CHECK_GOLDEN=" + JSON.stringify(liveChecks));
  }
  console.error("UQP923_CATALOG_REAL_DRIFT_COUNT=" + rows.length);
  console.error("UQP923_CATALOG_REAL_DRIFT_SAMPLE=" + JSON.stringify([
    ...rows.filter(row => row.side === "MISSING").slice(0, 3),
    ...rows.filter(row => row.side === "UNEXPECTED").slice(0, 3),
  ]));
}

async function main() {
  stage = "PRECHECK"; assertIsolatedRuntime();
  stage = "CONNECT"; const master = await startup();
  let isolated: sql.ConnectionPool | undefined;
  let syntheticCreated = false;
  try {
    stage = "IDENTITY"; await assertSyntheticServer(master);
    stage = "CREATE_SYNTHETIC_DB"; await master.request().batch(`CREATE DATABASE [${dbName}]`);
    syntheticCreated = true;
    stage = "SET_COMPAT"; await master.request().batch(`ALTER DATABASE [${dbName}] SET COMPATIBILITY_LEVEL = 150`);
    stage = "CONNECT_SYNTHETIC"; isolated = await connect(dbName);
    const setup = `
      CREATE SCHEMA [uqp];
      CREATE TABLE [uqp].[Dataset] ([Id] BIGINT NOT NULL CONSTRAINT PK_Synthetic_Dataset PRIMARY KEY, [IsActive] BIT NOT NULL DEFAULT 1, [IsArchived] BIT NOT NULL DEFAULT 0);
      CREATE TABLE [uqp].[DataSource] ([Id] BIGINT NOT NULL CONSTRAINT PK_Synthetic_DataSource PRIMARY KEY, [IsActive] BIT NOT NULL DEFAULT 1);
      CREATE TABLE [uqp].[AppUser] ([Id] BIGINT NOT NULL CONSTRAINT PK_Synthetic_AppUser PRIMARY KEY, [IsActive] BIT NOT NULL DEFAULT 1, [TokenVersion] INT NOT NULL DEFAULT 1);
    `;
    stage = "CREATE_PREREQS"; for (const statement of setup.split(";").map(s => s.trim()).filter(Boolean))
      await isolated.request().batch(statement);
    stage = "CATALOG_ABSENT"; const initial = await status(isolated);
    assert.equal(initial.state, "NOT_INSTALLED", "Baseline catalog must be entirely absent");

    const ddl = render923Draft();
    const statements = ddl.split(/;\s*(?:\r?\n|$)/u).map(s => s.trim()).filter(Boolean);
    assert.ok(statements.length >= 9);
    // Leave the sequence-only state deliberately incomplete to prove fail-closed detection.
    assert.match(statements[0]!, /CREATE SEQUENCE/u);
    stage = "DDL_SEQUENCE"; await isolated.request().batch(statements[0]!);
    stage = "CATALOG_PARTIAL"; const partial = await status(isolated);
    assert.equal(partial.state, "REJECTED_PARTIAL_OR_DIFFERENT", "Partial 923 must refuse");

    for (const [index, statement] of statements.slice(1).entries()) {
      stage = `DDL_OBJECT_${index+1}`;
      await isolated.request().batch(statement);
    }
    stage = "CATALOG_EXACT"; const exact = await status(isolated);
    if (exact.state !== "EXACT_MATCH") await summarizeSyntheticCatalogDrift(isolated);
    assert.equal(exact.state, "EXACT_MATCH",
      `Exact SQL Server 2019 catalog mismatch; missing=${exact.missing}; extra=${exact.unexpected}`);
    stage = "CATALOG_REPEAT"; const again = await status(isolated);
    assert.equal(again.state, "EXACT_MATCH");

    // This is the actual SQL Server 2019 metadata-only RPC that the Dataset
    // Designer uses. No business table, patient rows, preview, or policy writes.
    stage = "LIVE_SP_DESCRIBE_FIRST_RESULT_SET";
    const syntheticSource = {
      type: "SQLSERVER", host: "127.0.0.1", port: 14333,
      databaseName: dbName, username: "sa",
      password: process.env.UQP_923_CI_PASSWORD!,
      isActive: true, connectionTimeoutSec: 10, queryTimeoutSec: 10,
      encryptConnection: true, trustServerCertificate: true,
    } as DataSourceConfig;
    const description = await new SqlServerAdapter().describeQuery(syntheticSource, {
      sql: "SELECT CAST(1 AS int) AS SYNTHETIC_FIELD_A, CAST(2 AS bigint) AS SYNTHETIC_FIELD_B",
      parameters: [], timeoutSec: 10,
    });
    assert.equal(description.trust, "UNBOUND_CANDIDATE");
    assert.equal(description.requiresExecutionComparison, true);
    assert.equal(description.evidenceType, "SQLSERVER_DESCRIBE_FIRST_RESULT_SET");
    assert.deepEqual(description.columns.map(column => column.name),
      ["SYNTHETIC_FIELD_A", "SYNTHETIC_FIELD_B"]);
    assert.deepEqual(description.columns.map(column => column.ordinal), [1, 2]);
    assert.deepEqual(description.columns.map(column => column.dataType), ["int", "bigint"]);
    assert.ok(!("rows" in description));
    console.log("UQP923_EPHEMERAL_SQL2019_METADATA_DESCRIBE: 2 CANDIDATE COLUMNS, NO ROWS");
    // Genuine SQL Server locking / rollback mechanics, but NOT production
    // source-fence, confirmation Writer, audit or authorization acceptance.
    stage = "923_SCOPE_CAS_TWO_SESSIONS";
    await test923ScopeCasInDisposableSqlServer(isolated, () => connect(dbName));
    // F5 synthetic ledger/receipt transaction rehearsal. Uses a private table,
    // never a genuine AuditLog or application-issued security decision.
    stage = "923_SYNTHETIC_F5_ATOMIC_DECISION_AUDIT";
    await test923SyntheticDecisionAuditAtomicity(isolated);
    stage = "923_REAL_AUDIT_LOG_TRANSACTION_RECEIPT";
    await test923ExactAuditReceiptOnDisposableSql2019(isolated);
    stage = "923_REAL_AUDIT_DECISION_ATOMIC_CAS";
    await test923RealAuditScopeDecisionOnDisposableSql2019(isolated);

    stage = "923_DEDICATED_INSTALLER_ON_SECOND_SYNTHETIC_DATABASE";
    await test923ManualInstallerOnSyntheticSqlServer(master);




    console.log("UQP923_EPHEMERAL_SQL2019_SYNTHETIC: NOT_INSTALLED -> PARTIAL_REJECTED -> EXACT_MATCH -> EXACT_MATCH");
    console.log("F1/F2/F3/F4/F5/F6=NOT_RUN; SQL_LOCK_VERIFIED=false; deliveryAllowed=false");
  } finally {
    if (isolated) await isolated.close().catch(() => undefined);
    if (syntheticCreated) {
      // This name can exist only in the verified disposable container, created above.
      await assertSyntheticServerForCleanup(master);
      await master.request().batch(`ALTER DATABASE [${dbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${dbName}]`)
        .catch(() => undefined);
    }
    await master.close().catch(() => undefined);
  }
}

async function assertSyntheticServerForCleanup(pool: sql.ConnectionPool) {
  const result = await pool.request().query(`
    SELECT CONVERT(nvarchar(128),SERVERPROPERTY(N'MachineName')) AS Machine,
      TRY_CONVERT(int,SERVERPROPERTY(N'ProductMajorVersion')) AS Major, DB_NAME() AS DbName
  `);
  assert.equal(result.recordset[0]?.Machine, expectedMachine);
  assert.equal(result.recordset[0]?.Major, 15);
  assert.equal(result.recordset[0]?.DbName, "master");
}

main().catch((error: unknown) => {
  // Identifies synthetic failure stage without SQL, credentials or connection string.
  const v = error as { code?: unknown; number?: unknown } | null;
  const code = typeof v?.code === "string" && /^[A-Z_]{1,32}$/u.test(v.code) ? v.code : "UNKNOWN";
  const number = typeof v?.number === "number" && Number.isSafeInteger(v.number) ? v.number : 0;
  console.error(`UQP923_EPHEMERAL_SYNTHETIC_ACCEPTANCE_FAILED stage=${stage} driverCode=${code} sqlNumber=${number}`);
  process.exitCode = 1;
});
