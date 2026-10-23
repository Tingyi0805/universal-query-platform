/**
 * Synthetic SQL Server 2019 DDL/Catalog rehearsal in a disposable GitHub Actions
 * container only. No production secrets, platform DB connections or grants.
 * Passing this script is NOT F1-F6 production acceptance or delivery permission.
 */
import assert from "node:assert/strict";
import sql from "mssql";
import { render923CatalogSql, render923Draft } from "../modules/dataset/datasetMetadata923Catalog.js";

const dbName = "UQP923_CI_SYNTHETIC";
const expectedMachine = "uqp-923-ephemeral";

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

async function main() {
  assertIsolatedRuntime();
  const master = await startup();
  let isolated: sql.ConnectionPool | undefined;
  let syntheticCreated = false;
  try {
    await assertSyntheticServer(master);
    await master.request().batch(`CREATE DATABASE [${dbName}]`);
    syntheticCreated = true;
    await master.request().batch(`ALTER DATABASE [${dbName}] SET COMPATIBILITY_LEVEL = 150`);
    isolated = await connect(dbName);
    const setup = `
      CREATE SCHEMA [uqp];
      CREATE TABLE [uqp].[Dataset] ([Id] BIGINT NOT NULL CONSTRAINT PK_Synthetic_Dataset PRIMARY KEY);
      CREATE TABLE [uqp].[DataSource] ([Id] BIGINT NOT NULL CONSTRAINT PK_Synthetic_DataSource PRIMARY KEY);
      CREATE TABLE [uqp].[AppUser] ([Id] BIGINT NOT NULL CONSTRAINT PK_Synthetic_AppUser PRIMARY KEY);
    `;
    for (const statement of setup.split(";").map(s => s.trim()).filter(Boolean))
      await isolated.request().batch(statement);
    const initial = await status(isolated);
    assert.equal(initial.state, "NOT_INSTALLED", "Baseline catalog must be entirely absent");

    const ddl = render923Draft();
    const statements = ddl.split(/;\s*(?:\r?\n|$)/u).map(s => s.trim()).filter(Boolean);
    assert.ok(statements.length >= 9);
    // Leave the sequence-only state deliberately incomplete to prove fail-closed detection.
    assert.match(statements[0]!, /CREATE SEQUENCE/u);
    await isolated.request().batch(statements[0]!);
    const partial = await status(isolated);
    assert.equal(partial.state, "REJECTED_PARTIAL_OR_DIFFERENT", "Partial 923 must refuse");

    for (const statement of statements.slice(1)) await isolated.request().batch(statement);
    const exact = await status(isolated);
    assert.equal(exact.state, "EXACT_MATCH",
      `Exact SQL Server 2019 catalog mismatch; missing=${exact.missing}; extra=${exact.unexpected}`);
    const again = await status(isolated);
    assert.equal(again.state, "EXACT_MATCH");
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

main().catch(() => {
  // Opaque CI error only; never expose connection strings/driver details.
  console.error("UQP923_EPHEMERAL_SYNTHETIC_ACCEPTANCE_FAILED");
  process.exitCode = 1;
});
